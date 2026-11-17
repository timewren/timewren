import { buildVersion } from "@/lib/pwa/version";
import {
  CLIENT_HEADER,
  CLIENT_TOO_OLD,
  type ClientKind,
  formatClientHeader,
} from "./index";

/**
 * Web-klientens `x-timetrack-client`: `web/<build>` i en fane, `pwa/<build>`
 * i den installerede app. Build = de første 12 tegn af git-SHA'en fra CI
 * (APP_VERSION, via <html data-app-version>), ellers "dev". En SHA kan ikke sammenlignes som
 * version — web-faner holdes friske af "Ny version — genindlæs"-prompten,
 * ikke af et minimum.
 */
export function webClientVersion(
  build: string | null = buildVersion(),
): string {
  return build ? build.slice(0, 12) : "dev";
}

export function webClientKind(): ClientKind {
  try {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(display-mode: standalone)").matches
    ) {
      return "pwa";
    }
  } catch {
    // matchMedia mangler i nogle testmiljøer
  }
  return "web";
}

export function webClientHeaders(): Record<string, string> {
  return {
    [CLIENT_HEADER]: formatClientHeader(webClientKind(), webClientVersion()),
  };
}

/** Er fejlen (TRPCClientError eller lignende) en CLIENT_TOO_OLD-afvisning? */
export function isClientTooOldClientError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: { appCode?: unknown } | null }).data;
  return data?.appCode === CLIENT_TOO_OLD;
}
