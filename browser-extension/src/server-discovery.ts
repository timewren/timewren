import { t } from "./i18n/core";
export const CLIENT_API_VERSION = 1;

export interface ServerDiscovery {
  protocol: "timetrack";
  product: string;
  serverVersion: string;
  apiVersion: { min: number; max: number };
  authMethods: string[];
  urls: { deviceLogin: string; trpc: string; stream: string };
  capabilities: { realtime: boolean; electric: boolean; push: boolean };
}

function localHost(host: string): boolean {
  if (host === "localhost" || host === "[::1]") return true;
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  )
    return false;
  return (
    parts[0] === 127 ||
    parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
  );
}

export function normalizeServerAddress(
  value: string,
  allowLocalHttp = false,
): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(t("errors.server.invalidFormat"));
  }
  if (
    url.protocol !== "https:" &&
    !(allowLocalHttp && url.protocol === "http:" && localHost(url.hostname))
  ) {
    throw new Error(t("errors.server.httpsRequired"));
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(t("errors.server.noPathOrCredentials"));
  }
  return url.origin;
}

function invalidServer(): never {
  throw new Error(t("errors.server.notTimeTrack"));
}

function validateDocument(value: unknown, origin: string): ServerDiscovery {
  if (!value || typeof value !== "object") return invalidServer();
  const doc = value as Partial<ServerDiscovery>;
  if (
    doc.protocol !== "timetrack" ||
    typeof doc.product !== "string" ||
    !doc.product ||
    typeof doc.serverVersion !== "string" ||
    !doc.serverVersion ||
    !doc.apiVersion ||
    !Number.isInteger(doc.apiVersion.min) ||
    !Number.isInteger(doc.apiVersion.max) ||
    doc.apiVersion.min < 0 ||
    doc.apiVersion.max < doc.apiVersion.min ||
    !Array.isArray(doc.authMethods) ||
    !doc.authMethods.every((method) => typeof method === "string") ||
    !doc.urls ||
    !doc.capabilities ||
    ![
      doc.capabilities.realtime,
      doc.capabilities.electric,
      doc.capabilities.push,
    ].every((flag) => typeof flag === "boolean")
  )
    return invalidServer();
  for (const value of [doc.urls.deviceLogin, doc.urls.trpc, doc.urls.stream]) {
    try {
      const url = new URL(value);
      if (
        url.origin !== origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return invalidServer();
    } catch {
      return invalidServer();
    }
  }
  if (doc.apiVersion.max < CLIENT_API_VERSION) {
    throw new Error(t("errors.server.tooOld", { version: CLIENT_API_VERSION }));
  }
  if (doc.apiVersion.min > CLIENT_API_VERSION) {
    throw new Error(t("errors.server.appTooOld"));
  }
  return doc as ServerDiscovery;
}

/** Discovery never carries a token and must not follow another server's redirect. */
export async function discoverServer(value: string): Promise<ServerDiscovery> {
  const origin = normalizeServerAddress(
    value,
    import.meta.env.MODE === "development",
  );
  let response: Response;
  try {
    response = await fetch(`${origin}/.well-known/timetrack.json`, {
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
  } catch {
    // Browsers intentionally expose TLS failures as generic network errors.
    throw new Error(t("errors.server.unreachableCheck"));
  }
  if (response.status === 426) throw new Error(t("errors.server.appTooOld"));
  if (response.status >= 500)
    throw new Error(t("errors.server.unreachableLater"));
  if (!response.ok) return invalidServer();
  let doc: unknown;
  try {
    doc = await response.json();
  } catch {
    return invalidServer();
  }
  return validateDocument(doc, origin);
}
