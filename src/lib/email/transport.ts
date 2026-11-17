/**
 * Fælles mail-transport. Alle afsendere kalder `resend.emails.send(...)` (se
 * `@/lib/resend`), som lander her, så indholdet af mailene er uændret uanset
 * transport.
 *
 * Valg af transport (første der passer):
 * 1. `MAIL_TRANSPORT=resend|smtp|log` hvis sat eksplicit
 * 2. `RESEND_API_KEY` sat → Resend (som før; produktion rammer altid denne)
 * 3. `SMTP_HOST` sat → SMTP via nodemailer
 * 4. ellers log-only: mailen skrives til serverloggen og sendes ikke
 */

import type { CreateEmailOptions, CreateEmailResponse } from "resend";
import { isDemoMode, logDemoSuppressed } from "@/lib/demo/demo-mode";

export type MailTransportName = "resend" | "smtp" | "log";

export type SendMailPayload = CreateEmailOptions;
export type SendMailResult = CreateEmailResponse;

export function getMailTransport(
  env: NodeJS.ProcessEnv = process.env,
): MailTransportName {
  const explicit = env.MAIL_TRANSPORT?.trim().toLowerCase();
  if (explicit === "resend" || explicit === "smtp" || explicit === "log") {
    return explicit;
  }
  if (env.RESEND_API_KEY) return "resend";
  if (env.SMTP_HOST?.trim()) return "smtp";
  return "log";
}

/** Kan der sendes rigtige mails? (false = log-only, brugere får ingen mails). */
export function isMailTransportConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getMailTransport(env) !== "log";
}

/**
 * Må afsendere forsøge at sende? Ja med en rigtig transport, og i udvikling
 * også uden (log-only). I produktion uden transport springer afsenderne over
 * som før, så ingen fejlagtigt tror en mail er afsted. Demoen (DEMO_MODE=1)
 * lader flowene gennemføres; sendMail sender så intet.
 */
export function isMailAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    isDemoMode(env) ||
    isMailTransportConfigured(env) ||
    env.NODE_ENV === "development"
  );
}

type AddressList = string | string[] | undefined;

function toList(value: AddressList): string[] | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value : [value];
}

function smtpSettings(env: NodeJS.ProcessEnv) {
  const port = Number(env.SMTP_PORT) || 587;
  const secure =
    env.SMTP_SECURE !== undefined && env.SMTP_SECURE !== ""
      ? env.SMTP_SECURE.toLowerCase() === "true"
      : port === 465;
  const user = env.SMTP_USER?.trim();
  return {
    host: env.SMTP_HOST?.trim(),
    port,
    secure,
    ...(user ? { auth: { user, pass: env.SMTP_PASSWORD ?? "" } } : {}),
  };
}

type SmtpTransporter = import("nodemailer").Transporter;
let smtpTransporter: SmtpTransporter | null = null;

async function getSmtpTransporter(
  env: NodeJS.ProcessEnv,
): Promise<SmtpTransporter> {
  if (!smtpTransporter) {
    const { default: nodemailer } = await import("nodemailer");
    smtpTransporter = nodemailer.createTransport(smtpSettings(env));
  }
  return smtpTransporter;
}

/** Til tests. */
export function resetMailTransportForTests(): void {
  smtpTransporter = null;
  warnedLogOnly = false;
}

/** Resends payload (camelCase) → nodemailers beskedformat. */
export function toSmtpMessage(
  payload: SendMailPayload,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const p = payload as Record<string, unknown> & {
    from: string;
    to: AddressList;
    cc?: AddressList;
    bcc?: AddressList;
    replyTo?: AddressList;
    subject: string;
    html?: string;
    text?: string;
    headers?: Record<string, string>;
    attachments?: Array<{
      filename?: string | false;
      content?: string | Buffer;
      path?: string;
      contentType?: string;
      contentId?: string;
    }>;
  };

  if (p.react) {
    throw new Error("SMTP-transporten understøtter ikke react-payloads");
  }

  return {
    from: env.SMTP_FROM?.trim() || p.from,
    to: toList(p.to),
    cc: toList(p.cc),
    bcc: toList(p.bcc),
    replyTo: toList(p.replyTo)?.join(", "),
    subject: p.subject,
    html: p.html,
    text: p.text,
    headers: p.headers,
    attachments: p.attachments?.map((a) => ({
      filename: a.filename === false ? undefined : a.filename,
      content: a.content,
      path: a.path,
      contentType: a.contentType,
      cid: a.contentId,
    })),
  };
}

function okResult(id: string): SendMailResult {
  return { data: { id }, error: null, headers: null };
}

function errorResult(message: string): SendMailResult {
  return {
    data: null,
    error: { name: "application_error", statusCode: null, message },
    headers: null,
  };
}

let warnedLogOnly = false;

/**
 * Sender en mail via den valgte transport. Returnerer samme form som
 * Resends SDK (`{ data, error }`), så eksisterende kald virker uændret.
 */
export async function sendMail(
  payload: SendMailPayload,
  deliver?: () => Promise<SendMailResult>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SendMailResult> {
  // Offentlig demo: ingen mail forlader instansen, uanset transport.
  if (isDemoMode(env)) {
    logDemoSuppressed("Mail");
    return okResult(`demo-${Date.now()}`);
  }

  const transport = getMailTransport(env);

  if (transport === "resend") {
    if (!deliver) throw new Error("Resend-afsendelse mangler deliver");
    return deliver();
  }

  if (transport === "smtp") {
    if (!env.SMTP_HOST?.trim()) {
      return errorResult("MAIL_TRANSPORT=smtp kræver SMTP_HOST");
    }
    try {
      const transporter = await getSmtpTransporter(env);
      const info = await transporter.sendMail(toSmtpMessage(payload, env));
      return okResult(info.messageId ?? `smtp-${Date.now()}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Mail] SMTP-afsendelse fejlede:", message);
      return errorResult(message);
    }
  }

  if (!warnedLogOnly) {
    warnedLogOnly = true;
    console.warn(
      "[Mail] Ingen mail-transport er sat (RESEND_API_KEY eller SMTP_HOST). Mails sendes ikke, men skrives til loggen.",
    );
  }
  const p = payload as { to?: AddressList; subject?: string; text?: string };
  // Brødteksten (links, tokens, kundedata) logges kun i udvikling.
  const body =
    process.env.NODE_ENV === "development" ? `\n${p.text ?? ""}` : "";
  console.info(
    `[Mail:log] til=${toList(p.to)?.join(",") ?? ""} emne="${p.subject ?? ""}"${body}`,
  );
  return okResult(`log-${Date.now()}`);
}
