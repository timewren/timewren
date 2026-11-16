import { syncT } from "@/i18n/sync-text";
/**
 * Base Integration Class
 *
 * Provides common functionality for all accounting integrations:
 * - Exponential backoff retry logic
 * - Rate limiting support
 * - Standardized error handling
 * - Request/response logging
 */

export interface IntegrationError {
  code: string;
  message: string;
  statusCode?: number;
  retryable: boolean;
  originalError?: unknown;
}

export class IntegrationAuthError extends Error {
  statusCode: number;
  integrationName: string;
  constructor(integrationName: string, statusCode: number) {
    super(syncT("integrations.authExpired", { name: integrationName }));
    this.name = "IntegrationAuthError";
    this.statusCode = statusCode;
    this.integrationName = integrationName;
  }
}

/** Frist for enkeltkald uden genforsøg (forbindelsestest, OAuth-tokens). */
export const INTEGRATION_REQUEST_TIMEOUT_MS = 15_000;

/**
 * fetch med en frist. Uden den kan et regnskabs-API, der ikke svarer, holde
 * en forespørgsel (og brugerens spinner) åben, til proxyen giver op.
 * Fristen gælder til svarets headere; selve body-læsningen er ikke dækket.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = INTEGRATION_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  retryableStatusCodes: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

export abstract class BaseIntegration {
  protected abstract integrationName: string;
  protected retryConfig: RetryConfig;
  private authRefreshFn?: () => Promise<boolean>;

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * Register a callback that refreshes credentials when an API returns 401/403.
   * The callback should update internal state (e.g., apiKey) and return true
   * if refresh succeeded (so the request can be retried), or false to give up.
   */
  setAuthRefresh(fn: () => Promise<boolean>): void {
    this.authRefreshFn = fn;
  }

  /**
   * Delay for specified milliseconds
   */
  protected async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  protected calculateDelay(attempt: number): number {
    const exponentialDelay = this.retryConfig.baseDelay * 2 ** (attempt - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
    return Math.min(exponentialDelay + jitter, this.retryConfig.maxDelay);
  }

  /**
   * Check if an error is retryable
   */
  protected isRetryable(statusCode: number): boolean {
    return this.retryConfig.retryableStatusCodes.includes(statusCode);
  }

  /**
   * Efter en 5xx, timeout eller netværksfejl ved vi ikke, om serveren nåede at
   * behandle kaldet. Kun idempotente metoder må gentages; et POST ville kunne
   * oprette fakturaer eller kontakter to gange. Det gælder også rene læse-POST'er
   * (fx token-udveksling); en kalder, der ved at kaldet er sikkert, må gentage selv.
   * 429 gentages altid, fordi kaldet da ikke er behandlet.
   */
  protected isIdempotent(options: RequestInit): boolean {
    const method = (options.method || "GET").toUpperCase();
    return (
      method === "GET" ||
      method === "HEAD" ||
      method === "PUT" ||
      method === "DELETE"
    );
  }

  /**
   * Parse rate limit headers and return wait time in ms
   */
  protected parseRateLimitHeaders(response: Response): number | null {
    // Check for Retry-After header (in seconds)
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
      const seconds = Number.parseInt(retryAfter, 10);
      if (!Number.isNaN(seconds)) {
        return seconds * 1000;
      }
    }

    // Check for X-RateLimit-Reset (Unix timestamp)
    const resetTime = response.headers.get("X-RateLimit-Reset");
    if (resetTime) {
      const resetTimestamp = Number.parseInt(resetTime, 10) * 1000;
      const waitTime = resetTimestamp - Date.now();
      if (waitTime > 0) {
        return Math.min(waitTime, this.retryConfig.maxDelay);
      }
    }

    return null;
  }

  /**
   * Execute a fetch request with retry logic
   */
  protected async fetchWithRetry<T>(
    url: string,
    options: RequestInit,
    parseResponse: (response: Response) => Promise<T>,
  ): Promise<T> {
    let lastError: IntegrationError | null = null;

    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      try {
        this.logRequest(url, options, attempt);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        // Handle rate limiting
        if (response.status === 429) {
          const waitTime =
            this.parseRateLimitHeaders(response) ||
            this.calculateDelay(attempt);
          this.logRateLimit(waitTime);

          if (attempt < this.retryConfig.maxRetries) {
            clearTimeout(timeoutId);
            await this.delay(waitTime);
            continue;
          }
        }

        // Handle retryable errors
        if (!response.ok) {
          console.error(
            `[${this.integrationName}] Failed ${options.method || "GET"} ${url} → ${response.status} (final URL: ${response.url})`,
          );

          if (response.status === 401 || response.status === 403) {
            if (this.authRefreshFn) {
              const refreshed = await this.authRefreshFn();
              if (refreshed) {
                this.authRefreshFn = undefined;
                clearTimeout(timeoutId);
                continue;
              }
            }
            throw new IntegrationAuthError(
              this.integrationName,
              response.status,
            );
          }

          const error = await this.parseErrorResponse(response);
          this.logError(error, attempt);

          if (
            this.isRetryable(response.status) &&
            this.isIdempotent(options) &&
            attempt < this.retryConfig.maxRetries
          ) {
            clearTimeout(timeoutId);
            await this.delay(this.calculateDelay(attempt));
            continue;
          }

          throw error;
        }

        // Success
        clearTimeout(timeoutId);
        const result = await parseResponse(response);
        this.logSuccess(url, attempt);
        return result;
      } catch (error) {
        clearTimeout(timeoutId);

        if (
          error instanceof IntegrationAuthError ||
          (error instanceof Error && error.name === "IntegrationAuthError")
        ) {
          throw error;
        }

        lastError = this.normalizeError(error);
        this.logError(lastError, attempt);

        // Network errors and aborted requests are retryable
        if (
          lastError.retryable &&
          this.isIdempotent(options) &&
          attempt < this.retryConfig.maxRetries
        ) {
          await this.delay(this.calculateDelay(attempt));
          continue;
        }

        throw lastError;
      }
    }

    // Should never reach here, but just in case
    throw (
      lastError || {
        code: "MAX_RETRIES",
        message: "Maximum retries exceeded",
        retryable: false,
      }
    );
  }

  /**
   * Parse error response from API
   */
  protected async parseErrorResponse(
    response: Response,
  ): Promise<IntegrationError> {
    let message = response.statusText || "Unknown error";

    try {
      const body = await response.text();
      // Log full response body for debugging
      console.error(`[${this.integrationName}] Error response body:`, body);

      const json = JSON.parse(body);
      // Different APIs return errors in different formats
      message =
        json.message ||
        json.error ||
        json.errorMessage ||
        json.Message ||
        json.errors?.[0]?.message ||
        json.errors?.[0]?.error ||
        (json.ModelState
          ? Object.values(json.ModelState).flat().join("; ")
          : null) ||
        JSON.stringify(json) ||
        message;
    } catch {
      // Could not parse error body
    }

    return {
      code: `HTTP_${response.status}`,
      message,
      statusCode: response.status,
      retryable: this.isRetryable(response.status),
    };
  }

  /**
   * Normalize any error to IntegrationError
   */
  protected normalizeError(error: unknown): IntegrationError {
    if (this.isIntegrationError(error)) {
      return error;
    }

    if (error instanceof Error) {
      // Network errors and timeouts
      const isNetworkError =
        error.name === "AbortError" ||
        error.message.includes("fetch") ||
        error.message.includes("network") ||
        error.message.includes("ECONNREFUSED") ||
        error.message.includes("ETIMEDOUT");

      return {
        code: "NETWORK_ERROR",
        message: error.message,
        retryable: isNetworkError,
        originalError: error,
      };
    }

    return {
      code: "UNKNOWN_ERROR",
      message: String(error),
      retryable: false,
      originalError: error,
    };
  }

  /**
   * Type guard for IntegrationError
   */
  protected isIntegrationError(error: unknown): error is IntegrationError {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "message" in error &&
      "retryable" in error
    );
  }

  /**
   * Log a request (for debugging)
   */
  protected logRequest(
    url: string,
    options: RequestInit,
    attempt: number,
  ): void {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[${this.integrationName}] Request attempt ${attempt}: ${options.method || "GET"} ${url}`,
      );
      if (
        options.body &&
        (options.method === "POST" || options.method === "PUT")
      ) {
        console.log(`[${this.integrationName}] Request body:`, options.body);
      }
    }
  }

  /**
   * Log success
   */
  protected logSuccess(url: string, attempt: number): void {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[${this.integrationName}] Success after ${attempt} attempt(s): ${url}`,
      );
    }
  }

  /**
   * Log error
   */
  protected logError(error: IntegrationError, attempt: number): void {
    console.error(
      `[${this.integrationName}] Error on attempt ${attempt}:`,
      error.message,
      error.code,
    );
  }

  /**
   * Log rate limiting
   */
  protected logRateLimit(waitTime: number): void {
    console.warn(
      `[${this.integrationName}] Rate limited. Waiting ${waitTime}ms before retry...`,
    );
  }

  /**
   * Helper to create standard JSON headers
   */
  protected createJsonHeaders(
    authHeaders: Record<string, string>,
  ): HeadersInit {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeaders,
    };
  }

  /**
   * Test connection to the API
   */
  abstract testConnection(): Promise<boolean>;
}
