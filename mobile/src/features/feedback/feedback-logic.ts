/**
 * Bugbottle-agtig feedback i appen: kontekst, konsol-buffer og skærmbillede-grænser.
 * Formen matcher web's `feedbackContextSchema` (src/lib/feedback/schema.ts),
 * så rapporter fra app og web lander ens i /admin/feedback.
 */

export type ConsoleEntry = { ts: string; level: 'error' | 'warn'; message: string };

export const CONSOLE_BUFFER_SIZE = 30;
const MAX_MESSAGE = 600;

const LEADING_SLASH = /^\//;

/** Server-grænsen er 2 MB binært ≈ 2,8 MB base64 — hold os et stykke under. */
export const MAX_SCREENSHOT_BASE64 = 2_700_000;

function stringify(arg: unknown): string {
  if (arg instanceof Error)
    return `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string')
    return arg;
  try {
    return JSON.stringify(arg);
  }
  catch {
    return String(arg);
  }
}

/** Konsol-argumenter → én linje, kappet til serverens grænse. */
export function formatConsoleArgs(args: readonly unknown[]): string {
  return args.map(stringify).join(' ').slice(0, MAX_MESSAGE);
}

/** Tilføj en linje og behold kun de nyeste `size`. */
export function pushEntry(buffer: readonly ConsoleEntry[], entry: ConsoleEntry, size = CONSOLE_BUFFER_SIZE): ConsoleEntry[] {
  const next = [...buffer, entry];
  return next.length > size ? next.slice(next.length - size) : next;
}

export type ContextInput = {
  route: string;
  width: number;
  height: number;
  platform: string;
  osVersion: string | number;
  appVersion: string;
  language?: string;
  timezone?: string;
  colorScheme?: 'dark' | 'light';
  online?: boolean;
  console: readonly ConsoleEntry[];
  notes: readonly string[];
};

/** Kontekst i web's format. `url` er app-ruten, fx "timetrack://local/stats". */
export function buildContext(i: ContextInput) {
  return {
    url: `timetrack://${i.route.replace(LEADING_SLASH, '')}`.slice(0, 500),
    viewport: `${Math.round(i.width)}x${Math.round(i.height)}`,
    userAgent: `TimeTrack-app ${i.platform} ${i.osVersion}`.slice(0, 500),
    appVersion: i.appVersion.slice(0, 100),
    language: i.language?.slice(0, 35),
    timezone: i.timezone?.slice(0, 64),
    colorScheme: i.colorScheme,
    online: i.online,
    console: i.console.length ? i.console.slice(-50) : undefined,
    notes: i.notes.length ? i.notes.slice(0, 5).map(n => n.slice(0, 200)) : undefined,
  };
}

/** base64-PNG → data-url, eller null hvis den er for stor til serveren. */
export function screenshotDataUrl(base64: string | null): string | null {
  if (!base64 || base64.length > MAX_SCREENSHOT_BASE64)
    return null;
  return `data:image/png;base64,${base64}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;

/** Tom = ok (valgfri); ellers skal den ligne en e-mail. */
export function isValidOptionalEmail(email: string): boolean {
  const e = email.trim();
  return e === '' || (e.length <= 255 && EMAIL_RE.test(e));
}
