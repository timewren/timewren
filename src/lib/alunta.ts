import { aluntaPlanIdGroups } from "@/lib/config";

const ALUNTA_BASE = "https://app.alunta.com/api/v1";

/** Fejlsvar fra Alunta (status = HTTP-status). */
export class AluntaApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AluntaApiError";
  }
}

/** Upstream-fejl hos Alunta (5xx) — ikke en fejl i vores kald. */
export function isAluntaUpstreamError(err: unknown): err is AluntaApiError {
  return (
    err instanceof Error &&
    err.name === "AluntaApiError" &&
    (err as AluntaApiError).status >= 500
  );
}

// Pauser før genforsøg. Alunta svarer af og til en enkelt 500 "Server Error"
// (fejlspor 53, TIMETRACK-29); et nyt forsøg sekunder senere går igennem.
// Kun GET prøves igen: POST/PUT/DELETE kan have virket hos Alunta, selvom
// svaret var en fejl.
let retryDelaysMs: readonly number[] = [1_000, 3_000];

/** Kun til tests: kortere (eller ingen) pauser mellem genforsøg. */
export function __setAluntaRetryDelaysForTests(delays: readonly number[]) {
  retryDelaysMs = delays;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

async function aluntaFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const apiKey = process.env.ALUNTA_API_KEY;
  if (!apiKey) throw new Error("ALUNTA_API_KEY is not configured");

  const url = `${ALUNTA_BASE}${path}`;
  const method = options?.method || "GET";
  const retries = method === "GET" ? retryDelaysMs.length : 0;
  console.log(`[Alunta] ${method} ${url}`);

  for (let attempt = 0; ; attempt++) {
    const retry = async (reason: string) => {
      const delay = retryDelaysMs[attempt];
      console.warn(
        `[Alunta] ${reason} ${path}, prøver igen om ${delay} ms (${attempt + 1}/${retries})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    };

    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...options?.headers,
        },
        signal: options?.signal ?? AbortSignal.timeout(20_000),
      });
    } catch (err) {
      // Netværksfejl eller timeout. Et afbrudt kald (kalderens signal)
      // prøves ikke igen.
      if (attempt < retries && !options?.signal?.aborted) {
        await retry(err instanceof Error ? err.name : "netværksfejl");
        continue;
      }
      throw err;
    }

    const contentType = res.headers.get("content-type") || "";

    if (!res.ok) {
      const text = await res.text();
      if (attempt < retries && isRetryableStatus(res.status)) {
        await retry(`API ${res.status}`);
        continue;
      }
      console.error(
        `[Alunta] API error ${res.status} ${path} (${contentType}):`,
        text.slice(0, 500),
      );
      throw new AluntaApiError(
        res.status,
        `Alunta API ${res.status}: ${text.slice(0, 200)}`,
      );
    }

    if (!contentType.includes("application/json")) {
      const text = await res.text();
      console.error(
        `[Alunta] Unexpected content-type "${contentType}" for ${path}:`,
        text.slice(0, 500),
      );
      throw new Error(
        `Alunta API returnerede uventet format (${contentType}). Tjek ALUNTA_API_KEY og API URL.`,
      );
    }

    return res.json();
  }
}

// ── Types ───────────────────────────────────────────────────────────

export interface AluntaCheckoutSession {
  data: {
    id: string;
    checkout_url: string;
  };
}

export interface AluntaSubscriptionTrial {
  start_date: string;
  end_date: string;
  is_active: boolean;
}

export interface AluntaSubscription {
  uuid: string;
  status: string;
  end_date: string | null;
  external_customer_id: string | null;
  metadata: Record<string, unknown> | null;
  interval: number;
  /** Seat/unit count for per-seat plans. */
  quantity?: number;
  trial: AluntaSubscriptionTrial | null;
  plan?: {
    uuid: string;
    name: string;
    [key: string]: unknown;
  };
  customer?: {
    uuid: string;
    external_customer_id: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface AluntaPaginatedResponse<T> {
  data: T[];
  meta?: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
}

export interface AluntaPortalLink {
  data: {
    url: string;
    expires_at: string;
  };
}

export interface AluntaInvoice {
  uuid: string;
  invoice_number: string | null;
  status: string;
  total: number;
  currency: string;
  created_at: string;
  date_from: string;
  date_to: string;
  pdf_url: string | null;
  [key: string]: unknown;
}

export interface AluntaPlan {
  uuid: string;
  name: string;
  slug: string;
  [key: string]: unknown;
}

export interface AluntaDiscount {
  uuid: string;
  discount_name: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  effective_date: string;
  end_date: string | null;
  subscription: { uuid: string };
}

export interface AluntaTransaction {
  uuid: string;
  price: number;
  currency: string;
  period_start: string;
  period_end: string;
  is_invoiced: boolean;
  membership: { uuid: string };
  customer: { uuid: string; name: string };
  plan: { uuid: string; name: string };
}

export interface AluntaWebhookDelivery {
  uuid: string;
  event: string;
  status: string;
  url: string;
  response_code: number | null;
  created_at: string;
  [key: string]: unknown;
}

export interface AluntaDiscountInput {
  discount_name: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  from_date: string; // YYYY-MM-DD
  to_date?: string | null; // YYYY-MM-DD or null for forever
}

// ── Client ──────────────────────────────────────────────────────────

/**
 * Map an Alunta plan UUID to our planTier by comparing against the
 * env-configured plan IDs. Delt mellem webhook-routen og
 * seat-reconciliation-cronen (#149). Falder tilbage til "solo".
 */
export function resolveAluntaPlanTier(
  planUuid: string | null | undefined,
): "privat" | "solo" | "team" | "business" {
  if (!planUuid) return "solo";

  // Grupperne indeholder både nuværende og legacy-planer (grandfathering),
  // og seats-add-ons løser til deres tier: team-/business-kunder kan have KUN
  // seats-add-on'en i Alunta (base slettet / founder-deal), og et renewal-
  // event må så ikke nedgradere kunden til "solo" eller clampe pladserne til
  // den forkerte tiers grænser. Se [[timetrack-alunta-tier-billing]].
  const groups = aluntaPlanIdGroups();
  if (groups.privatBase.includes(planUuid)) return "privat";
  if (
    groups.teamBase.includes(planUuid) ||
    groups.teamSeats.includes(planUuid)
  ) {
    return "team";
  }
  if (
    groups.businessBase.includes(planUuid) ||
    groups.businessSeats.includes(planUuid)
  ) {
    return "business";
  }
  return "solo";
}

async function listAllSubscriptions(
  params: Record<string, string>,
): Promise<AluntaSubscription[]> {
  const out: AluntaSubscription[] = [];
  let page = 1;
  while (true) {
    const res = await aluntaFetch<AluntaPaginatedResponse<AluntaSubscription>>(
      `/subscriptions?${new URLSearchParams({
        ...params,
        per_page: "100",
        page: String(page),
      })}`,
    );
    out.push(...res.data);
    if (!res.meta || page >= res.meta.last_page) break;
    page++;
  }
  return out;
}

export const alunta = {
  /** POST /checkout-sessions */
  checkoutSessions: {
    create: (data: {
      plan_id: string;
      external_customer_id: string;
      /** Number of seats/units for per-seat plans (base + extra seats). */
      quantity?: number;
      success_url?: string;
      back_url?: string;
      metadata?: Record<string, unknown>;
    }) =>
      aluntaFetch<AluntaCheckoutSession>("/checkout-sessions", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },

  /** /subscriptions */
  subscriptions: {
    list: (params?: Record<string, string>) =>
      aluntaFetch<AluntaPaginatedResponse<AluntaSubscription>>(
        `/subscriptions${params ? `?${new URLSearchParams(params)}` : ""}`,
      ),
    get: (uuid: string) =>
      aluntaFetch<{ data: AluntaSubscription }>(`/subscriptions/${uuid}`),
    cancel: (uuid: string) =>
      aluntaFetch<{ data: AluntaSubscription }>(
        `/subscriptions/${uuid}/cancel`,
        { method: "POST" },
      ),
    resume: (uuid: string) =>
      aluntaFetch<{ data: AluntaSubscription }>(
        `/subscriptions/${uuid}/resume`,
        { method: "POST" },
      ),
    addDiscount: (uuid: string, data: AluntaDiscountInput) =>
      aluntaFetch<{ data: AluntaDiscount }>(
        `/subscriptions/${uuid}/discounts`,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      ),
    /** PUT /subscriptions/{uuid}/trial — adjust trial end date */
    updateTrial: (uuid: string, endDate: string) =>
      aluntaFetch<{ data: AluntaSubscription }>(
        `/subscriptions/${uuid}/trial`,
        {
          method: "PUT",
          body: JSON.stringify({ end_date: endDate }),
        },
      ),
    /** GET /subscriptions?external_customer_id={id} */
    listByExternalCustomerId: (externalCustomerId: string) =>
      aluntaFetch<AluntaPaginatedResponse<AluntaSubscription>>(
        `/subscriptions?external_customer_id=${encodeURIComponent(externalCustomerId)}`,
      ),
    /**
     * GET /subscriptions?external_customer_id={id} med FULD pagination.
     * SKAL bruges overalt på den destruktive erstat-og-annullér-sti (#424):
     * en enkelt side ville tavst kunne overse subscriptions der skulle
     * annulleres eller beskyttes. Fejler højt (kaster) hvis en side ikke
     * kan hentes — kalderen afgør fallback.
     */
    listAllByExternalCustomerId: (
      externalCustomerId: string,
    ): Promise<AluntaSubscription[]> =>
      listAllSubscriptions({ external_customer_id: externalCustomerId }),
    /**
     * GET /subscriptions med FULD pagination og valgfrie filtre. Bemærk at
     * Alunta tilsyneladende ignorerer `customer_id` og returnerer alle
     * abonnementer — filtrér derfor klient-side på `customer.uuid`.
     */
    listAll: (params: Record<string, string> = {}) =>
      listAllSubscriptions(params),
    /**
     * PUT /subscriptions/{uuid}/quantity — sæt antal pladser på et
     * license_based add-on (verificeret mod Alunta 8/9-2026; PUT/PATCH på
     * selve /subscriptions/{uuid} svarer 405). Bruges af auto-udvidelse.
     */
    updateQuantity: (uuid: string, quantity: number) =>
      aluntaFetch<{ data: AluntaSubscription }>(
        `/subscriptions/${uuid}/quantity`,
        {
          method: "PUT",
          body: JSON.stringify({ quantity }),
        },
      ),
    /**
     * Alle subscriptions for en kunde: union af opslag pr. external_customer_id
     * OG pr. customer_uuid (filtreret klient-side). Nødvendigt fordi et
     * add-on oprettet manuelt i Alunta har external_customer_id=null på
     * selve subscriptionen — kun kunden bærer det eksterne id — så
     * `?external_customer_id=` returnerede [] (kunde A 8/9-2026), og
     * seat-reconciliation "rettede" pladser ned til de inkluderede.
     */
    listAllForCustomer: async (
      externalIds: (string | null | undefined)[],
      customerUuid?: string | null,
    ): Promise<AluntaSubscription[]> => {
      const ids = [...new Set(externalIds.filter((x): x is string => !!x))];
      const byUuid = new Map<string, AluntaSubscription>();
      for (const id of ids) {
        for (const s of await listAllSubscriptions({
          external_customer_id: id,
        })) {
          byUuid.set(s.uuid, s);
        }
      }
      if (customerUuid) {
        for (const s of await listAllSubscriptions({
          customer_uuid: customerUuid,
        })) {
          // Alunta kan ignorere filteret — match eksplicit på kunden
          if (
            s.customer?.uuid === customerUuid ||
            (s.customer?.external_customer_id &&
              ids.includes(s.customer.external_customer_id))
          ) {
            byUuid.set(s.uuid, s);
          }
        }
      }
      return [...byUuid.values()];
    },
    /** PUT /subscriptions/{uuid}/interval — change billing interval */
    changeInterval: (uuid: string, interval: number) =>
      aluntaFetch<{ data: AluntaSubscription }>(
        `/subscriptions/${uuid}/interval`,
        {
          method: "PUT",
          body: JSON.stringify({ interval }),
        },
      ),
    /** GET /subscriptions/{uuid}/discounts */
    listDiscounts: (uuid: string, page?: number) =>
      aluntaFetch<AluntaPaginatedResponse<AluntaDiscount>>(
        `/subscriptions/${uuid}/discounts${page ? `?page=${page}` : ""}`,
      ),
    /** DELETE /subscriptions/{uuid}/discounts/{discountUuid} */
    deleteDiscount: (subscriptionUuid: string, discountUuid: string) =>
      aluntaFetch<void>(
        `/subscriptions/${subscriptionUuid}/discounts/${discountUuid}`,
        { method: "DELETE" },
      ),
  },

  /** /customers */
  customers: {
    list: (params?: Record<string, string>) =>
      aluntaFetch<
        AluntaPaginatedResponse<{ uuid: string; [key: string]: unknown }>
      >(`/customers${params ? `?${new URLSearchParams(params)}` : ""}`),
    get: (uuid: string) =>
      aluntaFetch<{ data: { uuid: string; [key: string]: unknown } }>(
        `/customers/${uuid}`,
      ),
  },

  /** POST /portal-link/{customer_uuid} */
  portalLinks: {
    create: (data: { customer_uuid: string; expires_in_minutes?: number }) =>
      aluntaFetch<AluntaPortalLink>(`/portal-link/${data.customer_uuid}`, {
        method: "POST",
        body: JSON.stringify(
          data.expires_in_minutes
            ? { expires_in_minutes: data.expires_in_minutes }
            : {},
        ),
      }),
  },

  /** /invoices */
  invoices: {
    list: (params?: Record<string, string>) =>
      aluntaFetch<AluntaPaginatedResponse<AluntaInvoice>>(
        `/invoices${params ? `?${new URLSearchParams(params)}` : ""}`,
      ),
    get: (uuid: string) =>
      aluntaFetch<{ data: AluntaInvoice }>(`/invoices/${uuid}`),
  },

  /** /subscription-transactions */
  transactions: {
    list: (params?: Record<string, string>) =>
      aluntaFetch<AluntaPaginatedResponse<AluntaTransaction>>(
        `/subscription-transactions${params ? `?${new URLSearchParams(params)}` : ""}`,
      ),
    get: (uuid: string) =>
      aluntaFetch<{ data: AluntaTransaction }>(
        `/subscription-transactions/${uuid}`,
      ),
  },

  /** /plans */
  plans: {
    list: (params?: Record<string, string>) =>
      aluntaFetch<AluntaPaginatedResponse<AluntaPlan>>(
        `/plans${params ? `?${new URLSearchParams(params)}` : ""}`,
      ),
  },

  /** /webhooks */
  webhooks: {
    /** GET /webhooks — list webhook deliveries */
    list: (params?: Record<string, string>) =>
      aluntaFetch<AluntaPaginatedResponse<AluntaWebhookDelivery>>(
        `/webhooks${params ? `?${new URLSearchParams(params)}` : ""}`,
      ),
    /** GET /webhooks/{uuid} */
    get: (uuid: string) =>
      aluntaFetch<{ data: AluntaWebhookDelivery }>(`/webhooks/${uuid}`),
    /** POST /webhooks/replay/{uuid} — replay a webhook delivery */
    replay: (uuid: string) =>
      aluntaFetch<{ data: AluntaWebhookDelivery }>(`/webhooks/replay/${uuid}`, {
        method: "POST",
      }),
  },

  /** GET /ping — health check */
  ping: () => aluntaFetch<{ message: string }>("/ping"),
};
