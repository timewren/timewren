import { resolveApiUrl } from "../config";
import { t } from "../i18n/core";
import {
  ApiError,
  noConnectionMessage,
  trpcErrorCode,
  trpcErrorMessage,
} from "../lib/api-error";
import {
  appCodeFromErrorBody,
  CLIENT_TOO_OLD,
  clientHeaders,
} from "../lib/client-version";
import type { PrepaidChoice } from "../lib/prepaid";
import { Sentry } from "../lib/sentry";
import {
  rememberSession,
  type SessionAwareResponse,
} from "../lib/timer-session";
import { markClientTooOld, trackSave } from "../lib/update-state";
import { serverFetch } from "../server-connection";
import type {
  Client,
  PrepaidPackage,
  Project,
  ServerPrepaidChoice,
  TimerState,
} from "../types";

/** Husk sessionen fra et tilstandssvar og returnér svaret uændret. */
async function remembered<T extends { sessionId?: string | null }>(
  state: T,
): Promise<T> {
  await rememberSession(state);
  return state;
}

// SuperJSON wraps data in { json: ... } format
interface TRPCResponse<T> {
  result: {
    data: {
      json: T;
    };
  };
}

const REQUEST_TIMEOUT_MS = 8000;
/**
 * Gem af en stoppet timer får længere tid: en langsom server, der alligevel
 * når at gemme, skal ikke ligne en fejl (det gav dobbelte poster).
 */
export const SAVE_TIMEOUT_MS = 20000;

/** Fejlsvar fra serveren → ApiError med HTTP-status, så kalderen kan se om
 *  det var en sikker afvisning (4xx) eller noget usikkert (5xx/proxy-side). */
async function httpError(response: Response): Promise<ApiError> {
  let message: string;
  let appCode: string | null = null;
  try {
    const body = await response.json();
    appCode = appCodeFromErrorBody(body);
    message = translateError(body, response.status);
  } catch {
    // Proxyens HTML-fejlside (502/504) er ikke JSON
    message = t("errors.serverStatus", { status: response.status });
    if (response.status === 401) void expireSession();
  }
  if (appCode === CLIENT_TOO_OLD) {
    // Serveren afviser denne version: vis "Opdatér" og hent opdateringen
    void markClientTooOld();
    message = t("errors.clientTooOld");
  }
  return new ApiError(message, "http", response.status, appCode);
}

/** Timeouts rapporteres til Sentry — de var før helt usynlige. */
function timeoutError(procedure: string, method: string, timeoutMs: number) {
  const error = new ApiError(t("errors.timeout"), "timeout");
  Sentry.captureException(error, {
    level: "warning",
    tags: { procedure, method, kind: "timeout" },
    extra: { timeoutMs },
  });
  return error;
}

function isTransientFetchError(error: unknown): boolean {
  if (!(error instanceof TypeError)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message === "failed to fetch" ||
    message.includes("networkerror") ||
    message.includes("load failed")
  );
}

/**
 * Fejlsvar → dansk besked. Ved UNAUTHORIZED (tokenet er tilbagekaldt eller
 * udløbet) logges der ud: tokenet ryddes, og `sessionExpired` får login-
 * skærmen til at sige hvorfor. authStore lytter på storage, så popup og ny
 * fane skifter til login med det samme.
 */
function translateError(body: unknown, status: number): string {
  const code = trpcErrorCode(body);
  if (code === "UNAUTHORIZED" || status === 401) {
    void expireSession();
  }
  return trpcErrorMessage(body);
}

export async function expireSession(): Promise<void> {
  try {
    await chrome.storage.local.set({ sessionExpired: true });
    await chrome.storage.local.remove(["extensionToken"]);
  } catch {
    // Best-effort: næste kald fejler igen og prøver på ny
  }
}

/** Browserens netværksfejl ("Failed to fetch") → dansk ApiError. */
function connectionError(): ApiError {
  return new ApiError(noConnectionMessage(), "network");
}

async function getToken(): Promise<string | null> {
  const result = await chrome.storage.local.get(["extensionToken"]);
  const token = result.extensionToken;
  return typeof token === "string" ? token : null;
}

async function getSelectedOrgId(): Promise<string | null> {
  const result = await chrome.storage.local.get(["selectedOrgId"]);
  return typeof result.selectedOrgId === "string" ? result.selectedOrgId : null;
}

export async function trpcQuery<T>(
  procedure: string,
  input?: Record<string, unknown>,
): Promise<T> {
  const token = await getToken();

  if (!token) {
    throw new Error(t("errors.notLoggedIn"));
  }

  const apiUrl = await resolveApiUrl();

  // tRPC queries MUST use GET — the HTTP adapter rejects POST for query
  // procedures with "Unsupported POST-request to query procedure".
  // The token is included in the input object (required by the server's
  // extension procedures) and ends up in the URL query string. This is
  // a tRPC architectural constraint — the alternative would be server-
  // side middleware that extracts the token from a header instead.
  const orgId = await getSelectedOrgId();
  const inputWithToken = {
    ...(orgId ? { organizationId: orgId } : {}),
    ...input,
    token,
  };
  const url = new URL(`${apiUrl}/${procedure}`);
  url.searchParams.set("input", JSON.stringify({ json: inputWithToken }));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await serverFetch(
      url.toString(),
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...clientHeaders(),
        },
        signal: controller.signal,
      },
      token,
    );

    if (!response.ok) {
      throw await httpError(response);
    }

    const data = await response.json();
    // Validate tRPC response shape before accessing nested properties.
    // A malformed response (proxy error page, CDN HTML, etc.) would
    // otherwise throw a confusing "Cannot read properties of undefined"
    // deep inside the component that made the call.
    if (!data?.result?.data?.json && data?.result?.data?.json !== null) {
      throw new ApiError(t("errors.invalidResponse"), "invalid_response");
    }
    return (data as TRPCResponse<T>).result.data.json;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw timeoutError(procedure, "query", REQUEST_TIMEOUT_MS);
    }
    if (isTransientFetchError(error)) {
      throw connectionError();
    }
    Sentry.captureException(error, { tags: { procedure, method: "query" } });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Skrivninger meldes "i gang", så en opdatering ikke genstarter midt i dem. */
export function trpcMutation<T>(
  procedure: string,
  input: Record<string, unknown>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return trackSave(() => trpcMutationRequest<T>(procedure, input, timeoutMs));
}

async function trpcMutationRequest<T>(
  procedure: string,
  input: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  const token = await getToken();

  if (!token) {
    throw new Error(t("errors.notLoggedIn"));
  }

  // Include token in input for extension endpoints that require it
  const orgId = await getSelectedOrgId();
  const inputWithToken = {
    ...(orgId ? { organizationId: orgId } : {}),
    ...input,
    token,
  };

  const apiUrl = await resolveApiUrl();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await serverFetch(
      `${apiUrl}/${procedure}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...clientHeaders(),
        },
        body: JSON.stringify({ json: inputWithToken }),
        signal: controller.signal,
      },
      token,
    );

    if (!response.ok) {
      throw await httpError(response);
    }

    const data = await response.json();
    // Validate tRPC response shape before accessing nested properties.
    // A malformed response (proxy error page, CDN HTML, etc.) would
    // otherwise throw a confusing "Cannot read properties of undefined"
    // deep inside the component that made the call.
    if (!data?.result?.data?.json && data?.result?.data?.json !== null) {
      throw new ApiError(t("errors.invalidResponse"), "invalid_response");
    }
    return (data as TRPCResponse<T>).result.data.json;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw timeoutError(procedure, "mutation", timeoutMs);
    }
    if (isTransientFetchError(error)) {
      throw connectionError();
    }
    Sentry.captureException(error, { tags: { procedure, method: "mutation" } });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const apiClient = {
  // Auth
  validateToken: async (token: string, manualServer?: string) => {
    const apiUrl = await resolveApiUrl();
    const url = new URL(`${apiUrl}/extension.validateToken`);
    // SuperJSON format: wrap input in { json: ... }
    url.searchParams.set("input", JSON.stringify({ json: { token } }));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await serverFetch(
        url.toString(),
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...clientHeaders(),
          },
          signal: controller.signal,
        },
        token,
        manualServer,
      );

      if (!response.ok) {
        // HTTP error from the server. This could be:
        //   - 429 rate-limit (token is fine, slow down)
        //   - 5xx server outage (token is fine, server is down)
        //   - 403 tRPC guard / middleware rejection (not necessarily
        //     a bad token — e.g. a module guard or a feature flag
        //     blocking the call at the router level)
        // Only a 200 OK response with `valid: false` is authoritative
        // that the token itself is invalid. Throw here so authStore's
        // catch block preserves the stored token across transient
        // server-side hiccups. Prevents "logged out after a week"
        // when any upstream deploy briefly breaks this endpoint.
        throw new Error(
          t("errors.auth.tokenValidationStatus", { status: response.status }),
        );
      }

      const data = (await response.json()) as TRPCResponse<{
        valid: boolean;
        user: {
          id: string;
          name: string;
          email: string;
          defaultHourlyRate: number | null;
        } | null;
      }>;
      return data.result.data.json;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  listOrganizations: async (token: string) => {
    const apiUrl = await resolveApiUrl();
    const url = new URL(`${apiUrl}/extension.listOrganizations`);
    url.searchParams.set("input", JSON.stringify({ json: { token } }));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await serverFetch(
        url.toString(),
        {
          method: "GET",
          headers: { "Content-Type": "application/json", ...clientHeaders() },
          signal: controller.signal,
        },
        token,
      );
      if (!response.ok) {
        throw new Error(
          t("errors.auth.orgsFailed", { status: response.status }),
        );
      }
      const data = await response.json();
      if (!data?.result?.data?.json) {
        throw new Error(t("errors.invalidResponse"));
      }
      return (
        data as TRPCResponse<Array<{ id: string; name: string; role: string }>>
      ).result.data.json;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(t("errors.timeout"));
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  // Timer. Hvert tilstandssvar bærer serverens sessionId (2.6.0), som
  // huskes i chrome.storage — så baggrunden og en genåbnet popup kender det.
  getTimerState: async () =>
    remembered(await trpcQuery<TimerState>("extension.getTimerState")),

  getTimerStateWithVersion: async () =>
    remembered(
      await trpcQuery<
        TimerState & {
          version: number;
          intent: string | null;
          intentFrom: string | null;
          /** Fra server-PR #767; fraværende på ældre servere. */
          intentAt?: string | null;
        }
      >("extension.getTimerStateWithVersion"),
    ),

  updateTimerState: async (
    state: Partial<TimerState> & {
      isFreshStart?: boolean;
      /** Skriv kun til denne session (2.6.0) */
      sessionId?: string;
      /** Idempotensnøgle på en frisk start (2.6.0, #784) */
      clientOpId?: string;
      expectedVersion?: number;
    },
  ) =>
    // Serveren bumper rækkens version ved HVER write og returnerer den nye —
    // klienten SKAL opdatere sin serverVersion fra svaret, ellers fejler det
    // næste claimForStop med version_mismatch.
    remembered(
      await trpcMutation<
        TimerState &
          SessionAwareResponse & {
            version?: number;
          }
      >("extension.updateTimerState", state),
    ),

  claimForStop: (expectedVersion: number, sessionId?: string | null) =>
    trpcMutation<{
      success: boolean;
      reason?: string;
      version: number;
      stoppedBy?: string;
      /** Klippekort-valget der gælder for stoppet (#422). */
      prepaidChoice?: ServerPrepaidChoice;
      /** Den claimede session (eller rækkens, ved session_mismatch). */
      sessionId?: string | null;
      /** Sessionens øjebliksbillede i stop-øjeblikket (#785). */
      session?: {
        id: string | null;
        projectId: string | null;
        clientId: string | null;
        description: string;
        startedAt: string;
      };
    }>("extension.claimForStop", {
      expectedVersion,
      source: "extension",
      ...(sessionId ? { sessionId } : {}),
    }),

  // Klippekort-valg for den kørende timer (#422), så stop fra web/app
  // respekterer valget. success=false/reason="not_active" = ingen session.
  setPrepaidChoice: (clientId: string, choice: PrepaidChoice) =>
    trpcMutation<{ success: boolean; reason?: string }>(
      "extension.setPrepaidChoice",
      { clientId, choice },
    ),

  confirmStop: (version: number, sessionId?: string | null) =>
    trpcMutation<{ success: boolean; reason?: string; version?: number }>(
      "extension.confirmStop",
      { version, source: "extension", ...(sessionId ? { sessionId } : {}) },
    ),

  /** `already_saved`: sessionen ER gemt (tabt svar) — serveren har ryddet. */
  cancelStop: (version: number, sessionId?: string | null) =>
    trpcMutation<{ success: boolean; reason?: string; version?: number }>(
      "extension.cancelStop",
      { version, source: "extension", ...(sessionId ? { sessionId } : {}) },
    ),

  // Projects & Clients
  getProjectsAndClients: () =>
    trpcQuery<{ projects: Project[]; clients: Client[] }>(
      "extension.getProjectsAndClients",
    ),

  // Time Entries
  createTimeEntry: (entry: {
    projectId?: string;
    clientId?: string;
    hours: number;
    description: string;
    date: string;
    startTime?: string;
    endTime?: string;
    source?: "auto_track" | "api";
    /** Idempotency key — retries with the same key never create duplicates. */
    clientEntryId?: string;
    /** Klippekort tiden skal trækkes fra. Serveren validerer at kortet
     *  hører til samme kunde som posten. */
    prepaidPackageId?: string | null;
    /** Timer-sessionen posten gemmer (2.6.0): én session ⇒ højst én post. */
    timerSessionId?: string;
  }) =>
    trpcMutation<{
      /** null når sessionen allerede var gemt af en anden klient (2.6.0) */
      id: string | null;
      success: boolean;
      alreadySaved?: boolean;
      prepaidDeduction?: {
        packageName: string;
        hoursDeducted: number;
        remainingHours: number;
        overflowedToInvoice: boolean;
      } | null;
    }>("extension.createTimeEntry", entry, SAVE_TIMEOUT_MS),

  getRecentEntries: (limit = 5) =>
    trpcQuery<
      Array<{
        id: string;
        description: string;
        hours: number;
        date: string;
        projectId: string | null;
        projectName: string | null;
        clientId: string | null;
        clientName: string | null;
        startTime: string | null;
        endTime: string | null;
      }>
    >("extension.getRecentEntries", { limit }),

  getTimeEntries: (startDate: string, endDate: string) =>
    trpcQuery<
      Array<{
        id: string;
        description: string;
        hours: number;
        date: string;
        projectId: string | null;
        projectName: string | null;
        clientId: string | null;
        clientName: string | null;
        createdAt: string;
        startTime: string | null;
        endTime: string | null;
        /** Trukket fra et klippekort (fraværende på ældre servere) */
        isFromPrepaid?: boolean;
      }>
    >("extension.getTimeEntries", { startDate, endDate }),

  // Update/Delete time entries
  updateTimeEntry: (entry: {
    id: string;
    hours: number;
    date: string;
    description?: string;
    startTime?: string;
    endTime?: string;
    projectId?: string | null;
    clientId?: string | null;
  }) => trpcMutation<{ success: boolean }>("extension.updateTimeEntry", entry),

  deleteTimeEntry: (id: string) =>
    trpcMutation<{ success: boolean }>("extension.deleteTimeEntry", { id }),

  // Prepaid packages
  getActivePackages: () =>
    trpcQuery<PrepaidPackage[]>("extension.getPrepaidPackages"),
};
