import { z } from "zod";
import { syncT } from "@/i18n/sync-text";
import { BaseIntegration, type IntegrationError } from "./base";

const TIMEOPS_BASE_URL = "https://api.timeops.dk";

// ============================================
// Zod schemas — runtime validation of API responses
// ============================================

const timeOpsCustomerSchema = z.object({
  id: z.number(),
  vatNumber: z.string().nullable().optional().default(null),
  name: z.string().nullable().optional().default(null),
  defaultRate: z.number().nullable().optional().default(null),
});

const timeOpsProjectSchema = z.object({
  id: z.number(),
  name: z.string().nullable().optional().default(null),
  customerId: z.number(),
  finishedAt: z.string().nullable().optional().default(null),
  billable: z.boolean().optional().default(false),
  rate: z.number().nullable().optional().default(null),
});

const timeOpsRegistrationSchema = z.object({
  id: z.number(),
  description: z.string().nullable().optional().default(null),
  startedAt: z.string(),
  stoppedAt: z.string().nullable().optional().default(null),
  projectId: z.number().nullable().optional().default(null),
  userId: z.number(),
  billable: z.boolean().optional().default(false),
  tags: z.array(z.number()).nullable().optional().default(null),
});

const timeOpsTagSchema = z.object({
  id: z.number().nullable().optional().default(null),
  text: z.string().nullable().optional().default(null),
});

const timeOpsOrganizationSchema = z.object({
  name: z.string().nullable().optional().default(null),
  vatNumber: z.string().nullable().optional().default(null),
  country: z.string().optional().default(""),
  address: z.string().nullable().optional().default(null),
  city: z.string().nullable().optional().default(null),
  zipCode: z.string().nullable().optional().default(null),
});

const paginatedRegistrationsSchema = z
  .record(z.string(), z.unknown())
  .transform((raw) => {
    const findArray = (): unknown[] => {
      for (const key of [
        "items",
        "Items",
        "registrations",
        "Registrations",
        "data",
        "Data",
        "results",
        "Results",
      ]) {
        if (Array.isArray(raw[key])) return raw[key] as unknown[];
      }
      if (Array.isArray(raw)) return raw as unknown[];
      const firstArrayKey = Object.keys(raw).find((k) => Array.isArray(raw[k]));
      if (firstArrayKey) {
        console.warn(
          `[TimeOps] Using fallback array key "${firstArrayKey}" from Registrations response`,
        );
        return raw[firstArrayKey] as unknown[];
      }
      return [];
    };

    const findCount = (): number => {
      for (const key of [
        "totalCount",
        "TotalCount",
        "totalResults",
        "TotalResults",
        "total",
        "Total",
        "count",
        "Count",
      ]) {
        if (typeof raw[key] === "number") return raw[key] as number;
      }
      return 0;
    };

    const findNumber = (keys: string[]): number => {
      for (const key of keys) {
        if (typeof raw[key] === "number") return raw[key] as number;
      }
      return 0;
    };

    const items = findArray().map((item) =>
      timeOpsRegistrationSchema.parse(item),
    );

    return {
      items,
      page: findNumber(["page", "Page"]),
      pageSize: findNumber(["pageSize", "PageSize"]),
      totalCount: findCount() || items.length,
    };
  });

// ============================================
// Inferred types (from schemas)
// ============================================

export type TimeOpsCustomer = z.infer<typeof timeOpsCustomerSchema>;
export type TimeOpsProject = z.infer<typeof timeOpsProjectSchema>;
export type TimeOpsRegistration = z.infer<typeof timeOpsRegistrationSchema>;
export type TimeOpsTag = z.infer<typeof timeOpsTagSchema>;
export type TimeOpsOrganization = z.infer<typeof timeOpsOrganizationSchema>;
export type PaginatedRegistrations = z.infer<
  typeof paginatedRegistrationsSchema
>;

// ============================================
// Client
// ============================================

export class TimeOpsClient extends BaseIntegration {
  protected integrationName = "TimeOps";
  private apiKey: string;

  constructor(apiKey: string) {
    super({
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30_000,
    });
    this.apiKey = apiKey;
  }

  private get headers(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(`${TIMEOPS_BASE_URL}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async testConnection(): Promise<boolean> {
    const result = await this.testConnectionDetailed();
    return result.ok;
  }

  /**
   * Like testConnection() but returns structured error info so the caller
   * can distinguish "invalid key" from "network error" for the user.
   */
  async testConnectionDetailed(): Promise<{
    ok: boolean;
    reason?: "invalid_key" | "network_error";
    detail?: string;
  }> {
    try {
      await this.fetchWithRetry<unknown>(
        this.buildUrl("/Ping"),
        { method: "GET", headers: this.headers },
        (r) => r.json(),
      );
      return { ok: true };
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "statusCode" in err &&
        ((err as { statusCode: number }).statusCode === 401 ||
          (err as { statusCode: number }).statusCode === 403)
      ) {
        return { ok: false, reason: "invalid_key" };
      }
      return {
        ok: false,
        reason: "network_error",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getOrganization(): Promise<TimeOpsOrganization> {
    const raw = await this.fetchWithRetry<unknown>(
      this.buildUrl("/Organization"),
      { method: "GET", headers: this.headers },
      (r) => r.json(),
    );
    return timeOpsOrganizationSchema.parse(raw);
  }

  /**
   * List customers. Requests a large pageSize to avoid silent truncation
   * if the API paginates by default. If the API returns all results
   * regardless, the extra param is ignored.
   */
  async listCustomers(): Promise<TimeOpsCustomer[]> {
    const raw = await this.fetchWithRetry<unknown>(
      this.buildUrl("/Customers", { pageSize: 5000 }),
      { method: "GET", headers: this.headers },
      (r) => r.json(),
    );
    const parsed = z.array(timeOpsCustomerSchema).parse(raw);
    if (parsed.length === 5000) {
      console.warn(
        "[TimeOps] listCustomers returned exactly 5000 — results may be truncated",
      );
    }
    return parsed;
  }

  /** List projects. See listCustomers for pagination note. */
  async listProjects(): Promise<TimeOpsProject[]> {
    const raw = await this.fetchWithRetry<unknown>(
      this.buildUrl("/Projects", { pageSize: 5000 }),
      { method: "GET", headers: this.headers },
      (r) => r.json(),
    );
    const parsed = z.array(timeOpsProjectSchema).parse(raw);
    if (parsed.length === 5000) {
      console.warn(
        "[TimeOps] listProjects returned exactly 5000 — results may be truncated",
      );
    }
    return parsed;
  }

  /** List tags. See listCustomers for pagination note. */
  async listTags(): Promise<TimeOpsTag[]> {
    const raw = await this.fetchWithRetry<unknown>(
      this.buildUrl("/Tags", { pageSize: 5000 }),
      { method: "GET", headers: this.headers },
      (r) => r.json(),
    );
    return z.array(timeOpsTagSchema).parse(raw);
  }

  async listRegistrations(params: {
    page: number;
    pageSize: number;
    from?: Date;
    to?: Date;
  }): Promise<PaginatedRegistrations> {
    const query: Record<string, string | number> = {
      page: params.page,
      pageSize: params.pageSize,
    };
    if (params.from) query.from = params.from.toISOString();
    if (params.to) query.to = params.to.toISOString();

    const raw = await this.fetchWithRetry<unknown>(
      this.buildUrl("/Registrations", query),
      { method: "GET", headers: this.headers },
      (r) => r.json(),
    );
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      console.info(
        "[TimeOps] Registrations response keys:",
        Object.keys(raw as Record<string, unknown>),
      );
    }
    // Handle both object responses and plain arrays
    if (Array.isArray(raw)) {
      const items = raw.map((item) => timeOpsRegistrationSchema.parse(item));
      return {
        items,
        page: 0,
        pageSize: items.length,
        totalCount: items.length,
      };
    }
    return paginatedRegistrationsSchema.parse(raw);
  }
}

/**
 * Factory function for creating a TimeOpsClient.
 */
export function createTimeOpsClient(apiKey: string): TimeOpsClient {
  return new TimeOpsClient(apiKey);
}

/**
 * Classify a TimeOps integration error for user-friendly messaging.
 * Returns a Danish message suitable for showing to end users.
 */
export function classifyTimeOpsError(error: unknown): {
  code: "invalid_key" | "not_premium" | "network" | "unknown";
  message: string;
} {
  if (typeof error === "object" && error !== null && "statusCode" in error) {
    const statusCode = (error as IntegrationError).statusCode;
    if (statusCode === 401 || statusCode === 403) {
      return {
        code: "invalid_key",
        message: syncT("integrations.timeops.invalidKey"),
      };
    }
    if (statusCode === 402) {
      return {
        code: "not_premium",
        message: syncT("integrations.timeops.premium"),
      };
    }
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as IntegrationError).code;
    if (code === "NETWORK_ERROR" || code === "MAX_RETRIES") {
      return {
        code: "network",
        message: syncT("integrations.timeops.network"),
      };
    }
  }
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "statusCode" in error
        ? `HTTP ${(error as IntegrationError).statusCode}`
        : String(error);
  console.error("[TimeOps] Unclassified error:", detail, error);
  return {
    code: "unknown",
    message: syncT("integrations.timeops.unexpected", { detail }),
  };
}
