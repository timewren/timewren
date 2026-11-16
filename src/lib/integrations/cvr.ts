import { syncT } from "@/i18n/sync-text";
import { cached } from "@/lib/cache";
import { CVR_API_TIMEOUT_MS } from "@/lib/config";

export interface CVRCompany {
  cvrNumber: string;
  name: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  industry?: string;
  industryDescription?: string;
  status: string;
  phoneNumber?: string;
  email?: string;
  startDate?: string;
}

/** Svar fra cvrapi.dk gemmes i Valkey i et døgn (sparer kvoten). */
const CVR_CACHE_TTL_SECONDS = 24 * 60 * 60;

export type CvrLookupErrorKind =
  | "invalid"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "unavailable";

const CVR_ERROR_KEYS: Record<CvrLookupErrorKind, string> = {
  invalid: "integrations.cvr.invalid",
  not_found: "integrations.cvr.notFound",
  rate_limited: "integrations.cvr.rateLimited",
  timeout: "integrations.cvr.timeout",
  unavailable: "integrations.cvr.unavailable",
};

/**
 * Forventet fejl fra CVR-opslaget med en dansk besked, der kan vises direkte.
 * cvrapi.dk rate-limiter og timer ud (Sentry TIMETRACK-1Y); det er ikke
 * fejl i TimeTrack og skal ikke behandles som serverfejl.
 */
export class CvrLookupError extends Error {
  readonly kind: CvrLookupErrorKind;
  constructor(kind: CvrLookupErrorKind) {
    super(syncT(CVR_ERROR_KEYS[kind]));
    this.name = "CvrLookupError";
    this.kind = kind;
  }
}

/** Matcher også på navn: med Turbopack kan klassen findes i flere chunks. */
export function isCvrLookupError(error: unknown): error is CvrLookupError {
  return (
    error instanceof CvrLookupError ||
    (error instanceof Error && error.name === "CvrLookupError")
  );
}

/** Shape of a company from Mahope's CVR service (cvr.mahoje.dk). */
interface MahopeVirksomhed {
  cvr: string;
  navn: string;
  adresse?: {
    vej?: string | null;
    husnummer?: string | null;
    etage?: string | null;
    sidedoer?: string | null;
    postnr?: string | null;
    by?: string | null;
  };
  branche?: { kode: string; tekst?: string | null } | null;
  status?: string | null;
  aktiv?: boolean;
  stiftet?: string | null;
  kontakt?: { email?: string | null; telefon?: string | null };
}

/** Short timeout so a slow service falls back to cvrapi.dk quickly. */
const MAHOPE_CVR_TIMEOUT_MS = 3000;

function fromMahope(v: MahopeVirksomhed): CVRCompany {
  const a = v.adresse ?? {};
  const etage = [a.etage, a.sidedoer].filter(Boolean).join(" ");
  const street = [a.vej, a.husnummer].filter(Boolean).join(" ");
  return {
    cvrNumber: v.cvr,
    name: v.navn || "",
    address: etage ? `${street}, ${etage}` : street,
    city: a.by || "",
    postalCode: a.postnr || "",
    country: "Danmark",
    industry: v.branche?.kode || undefined,
    industryDescription: v.branche?.tekst || undefined,
    status: v.aktiv === false ? "Ophørt" : "Aktiv",
    phoneNumber: v.kontakt?.telefon || undefined,
    email: v.kontakt?.email || undefined,
    startDate: v.stiftet || undefined,
  };
}

/**
 * Ask Mahope's own CVR service (a local copy of the whole register, ~1 ms per
 * lookup). Returns `undefined` when the service is not configured or fails, so
 * the caller falls back to cvrapi.dk; `null` means "not found".
 */
async function mahopeCvr<T>(path: string): Promise<T | null | undefined> {
  const key = process.env.CVR_SERVICE_API_KEY;
  if (!key) return undefined;
  const base = process.env.CVR_SERVICE_URL || "https://cvr.mahoje.dk";
  try {
    const response = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(MAHOPE_CVR_TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

// biome-ignore lint/suspicious/noExplicitAny: cvrapi.dk's svar er utypet JSON
type CvrApiData = Record<string, any>;

/**
 * Ét kald til cvrapi.dk. Returnerer null, når virksomheden ikke findes, og
 * kaster CvrLookupError ved rate-limit, timeout og andre fejl.
 */
async function fetchCvrApi(param: string): Promise<CvrApiData | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CVR_API_TIMEOUT_MS);

  try {
    const response = await fetch(`https://cvrapi.dk/api?${param}&country=dk`, {
      method: "GET",
      headers: { "User-Agent": "TimeTrack/1.0" },
      signal: controller.signal,
    });

    // cvrapi.dk sender fejl som {"error": "..."}, både med og uden fejlstatus.
    const data: CvrApiData | null = await response.json().catch(() => null);
    const apiError = typeof data?.error === "string" ? data.error : null;

    if (
      response.status === 402 ||
      response.status === 429 ||
      apiError === "QUOTA_EXCEEDED"
    ) {
      throw new CvrLookupError("rate_limited");
    }
    if (response.status === 404 || apiError === "NOT_FOUND") return null;
    if (!response.ok || apiError || !data) {
      console.warn(
        `[cvr] cvrapi.dk svarede ${response.status}${apiError ? ` (${apiError})` : ""}`,
      );
      throw new CvrLookupError("unavailable");
    }
    return data;
  } catch (error) {
    if (isCvrLookupError(error)) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new CvrLookupError("timeout");
    }
    console.warn("[cvr] cvrapi.dk kunne ikke nås:", error);
    throw new CvrLookupError("unavailable");
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Slå en virksomhed op på CVR-nummer: først Mahopes CVR-tjeneste (når
 * CVR_SERVICE_API_KEY er sat), ellers cvrapi.dk (gratis og uden nøgle).
 * Kaster CvrLookupError ("not_found", hvis nummeret ikke findes).
 */
export async function lookupCVR(cvrNumber: string): Promise<CVRCompany | null> {
  // Clean CVR number (remove spaces and non-digits)
  const cleanCVR = cvrNumber.replace(/\D/g, "");
  if (cleanCVR.length !== 8) {
    throw new CvrLookupError("invalid");
  }

  const own = await mahopeCvr<MahopeVirksomhed>(`/v1/virksomhed/${cleanCVR}`);
  if (own === null) throw new CvrLookupError("not_found");
  if (own) return fromMahope(own);

  return cached(`cvr:lookup:${cleanCVR}`, CVR_CACHE_TTL_SECONDS, async () => {
    const data = await fetchCvrApi(`vat=${cleanCVR}`);
    if (!data) throw new CvrLookupError("not_found");

    return {
      cvrNumber: cleanCVR,
      name: data.name || "",
      address: data.address || "",
      city: data.city || "",
      postalCode: data.zipcode || "",
      country: "Danmark",
      industry: data.industrycode || undefined,
      industryDescription: data.industrydesc || undefined,
      status: data.status || "Aktiv",
      phoneNumber: data.phone || undefined,
      email: data.email || undefined,
      startDate: data.startdate || undefined,
    };
  });
}

/**
 * Smart CVR search — auto-detects query type:
 * - 8 digits → exact CVR lookup (?vat=)
 * - 8 digits with spaces/dashes → cleaned CVR lookup
 * - Mostly digits (8+) → phone search (?phone=)
 * - Otherwise → free-text name search (?search=)
 *
 * Returnerer null uden fund; kaster CvrLookupError ved fejl hos cvrapi.dk.
 */
export async function searchCVR(
  query: string,
  opts: { skipService?: boolean } = {},
): Promise<CVRCompany | null> {
  const cleaned = query.trim();
  if (!cleaned) return null;

  const digitsOnly = cleaned.replace(/\D/g, "");

  let param: string;
  if (digitsOnly.length === 8 && /^\d[\d\s-]*$/.test(cleaned)) {
    // Looks like CVR number
    const own = await mahopeCvr<MahopeVirksomhed>(
      `/v1/virksomhed/${digitsOnly}`,
    );
    if (own !== undefined) return own && fromMahope(own);
    param = `vat=${digitsOnly}`;
  } else if (digitsOnly.length >= 8 && /^\d[\d\s\-+]*$/.test(cleaned)) {
    // Looks like phone number (Mahope's service has no phone search)
    param = `phone=${digitsOnly}`;
  } else {
    // Free text — company name search
    const own = opts.skipService
      ? undefined
      : await mahopeCvr<{ resultater: { virksomhed: MahopeVirksomhed }[] }>(
          `/v1/soeg?q=${encodeURIComponent(cleaned)}&limit=1`,
        );
    if (own !== undefined) {
      const first = own?.resultater[0]?.virksomhed;
      return first ? fromMahope(first) : null;
    }
    param = `search=${encodeURIComponent(cleaned)}`;
  }

  return cached(
    `cvr:search:${cleaned.toLowerCase()}`,
    CVR_CACHE_TTL_SECONDS,
    async () => {
      const data = await fetchCvrApi(param);
      if (!data) return null;

      return {
        cvrNumber: String(data.vat || ""),
        name: data.name || "",
        address: data.address || "",
        city: data.city || "",
        postalCode: data.zipcode || "",
        country: "Danmark",
        industry: data.industrycode ? String(data.industrycode) : undefined,
        industryDescription: data.industrydesc || undefined,
        status: data.enddate ? "Ophørt" : "Aktiv",
        phoneNumber: data.phone || undefined,
        email: data.email || undefined,
        startDate: data.startdate || undefined,
      };
    },
  );
}

/**
 * Name suggestions for a type-ahead (desktop customer form): up to `limit`
 * companies. Uses Mahope's CVR service (fuzzy name search); without a key or
 * when the service fails it degrades to the single hit from `searchCVR`, so
 * the caller gets at least what cvrapi.dk can offer. A CVR number or a phone
 * number resolves to at most one company.
 */
export async function searchCVRMany(
  query: string,
  limit = 8,
): Promise<CVRCompany[]> {
  const cleaned = query.trim();
  if (!cleaned) return [];
  const digitsOnly = cleaned.replace(/\D/g, "");
  const looksNumeric = digitsOnly.length >= 8 && /^\d[\d\s\-+]*$/.test(cleaned);
  if (!looksNumeric) {
    const own = await mahopeCvr<{
      resultater: { virksomhed: MahopeVirksomhed }[];
    }>(`/v1/soeg?q=${encodeURIComponent(cleaned)}&limit=${limit}&aktiv=true`);
    if (own !== undefined) {
      return (own?.resultater ?? []).map((r) => fromMahope(r.virksomhed));
    }
  }
  // The service was already tried (and failed) for names; don't wait for it twice.
  const single = await searchCVR(cleaned, { skipService: !looksNumeric });
  return single ? [single] : [];
}

/**
 * Validate CVR number format
 */
export function validateCVRNumber(cvrNumber: string): boolean {
  const cleanCVR = cvrNumber.replace(/\D/g, "");
  return cleanCVR.length === 8;
}

/**
 * Format CVR number with spaces (12 34 56 78)
 */
export function formatCVRNumber(cvrNumber: string): string {
  const cleanCVR = cvrNumber.replace(/\D/g, "");
  if (cleanCVR.length !== 8) return cvrNumber;
  return cleanCVR.replace(/(\d{2})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4");
}
