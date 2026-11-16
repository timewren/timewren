import { Resend } from "resend";
import { brand } from "@/lib/brand";
import { getEmailDomain } from "@/lib/config";
import { type SendMailPayload, sendMail } from "@/lib/email/transport";

// Lazy-initialized Resend client to avoid build-time errors
// The client is only created when actually needed at runtime
let _resend: Resend | null = null;

const RESEND_TIMEOUT_MS = 15_000;

export function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "RESEND_API_KEY is not configured. Please set it in your environment variables.",
      );
    }
    _resend = new Resend(apiKey);
  }
  return _resend;
}

// Legacy export for backwards compatibility - use getResend() instead
// This will throw at runtime if RESEND_API_KEY is not set
export const resend = {
  /**
   * `send` går gennem det fælles mail-transportlag (Resend, SMTP eller
   * log-only, se `@/lib/email/transport`). Alt andet (receiving m.fl.) er
   * Resends egen klient og kræver RESEND_API_KEY.
   */
  get emails(): Resend["emails"] {
    return new Proxy({} as Resend["emails"], {
      get(_target, prop) {
        if (prop === "send") {
          return (
            payload: SendMailPayload,
            options?: Parameters<Resend["emails"]["send"]>[1],
          ) =>
            sendMail(payload, async () => {
              // Et hængende Resend-kald må ikke holde en request eller et
              // cron-run åbent. SDK'et giver et afbrudt kald tilbage som en
              // almindelig `{ error }`, og logger kun uden for produktion.
              // Kalderens eget signal kombineres med fristen, så det ikke
              // slår timeouten fra.
              const timeout = AbortSignal.timeout(RESEND_TIMEOUT_MS);
              const signal = options?.signal
                ? AbortSignal.any([options.signal, timeout])
                : timeout;
              const result = await getResend().emails.send(payload, {
                ...options,
                signal,
              });
              if (result.error && signal.aborted) {
                console.error(
                  "[Mail] Resend-afsendelse afbrudt (timeout eller annulleret):",
                  result.error.message,
                );
              }
              return result;
            });
        }
        const emails = getResend().emails;
        const value = Reflect.get(emails, prop);
        return typeof value === "function" ? value.bind(emails) : value;
      },
    });
  },
  get contacts() {
    return getResend().contacts;
  },
  get audiences() {
    return getResend().audiences;
  },
  get domains() {
    return getResend().domains;
  },
  get apiKeys() {
    return getResend().apiKeys;
  },
  get batch() {
    return getResend().batch;
  },
};

// Default sender email (should be verified domain in Resend). TimeTrack Cloud
// sender fra den rene adresse som hidtil; andre brands får afsendernavnet med.
export const DEFAULT_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  (brand.id === "timetrack"
    ? `noreply@${getEmailDomain()}`
    : `${brand.name} <noreply@${getEmailDomain()}>`);

// Personal sender for drip/lifecycle emails from Mads
export const PERSONAL_FROM_EMAIL =
  process.env.PERSONAL_FROM_EMAIL || DEFAULT_FROM_EMAIL;
