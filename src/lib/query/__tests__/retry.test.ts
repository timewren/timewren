import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";
import { shouldRetryQuery } from "../retry";

const networkError = TRPCClientError.from(new TypeError("Failed to fetch"));
const serverError = TRPCClientError.from({
  error: {
    message: "Kunden findes ikke",
    code: -32004,
    data: { code: "NOT_FOUND", httpStatus: 404 },
  },
});

describe("shouldRetryQuery", () => {
  it("prøver netværksfejl op til tre gange (fx skift fra wifi til mobilnet)", () => {
    expect(shouldRetryQuery(0, networkError)).toBe(true);
    expect(shouldRetryQuery(1, networkError)).toBe(true);
    expect(shouldRetryQuery(2, networkError)).toBe(true);
    expect(shouldRetryQuery(3, networkError)).toBe(false);
  });

  it("prøver andre fejl én gang som før", () => {
    expect(shouldRetryQuery(0, serverError)).toBe(true);
    expect(shouldRetryQuery(1, serverError)).toBe(false);
  });
});
