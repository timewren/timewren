import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { describe, expect, it } from "vitest";
import { isNetworkError } from "@/lib/offline/queue";
import type { AppRouter } from "@/lib/trpc/routers";
import {
  errorToastAction,
  friendlyErrorLink,
  friendlyErrorMessage,
  NETWORK_ERROR_MESSAGE,
  SERVER_ERROR_MESSAGE,
} from "../friendly-error";

function serverError(message: string, code: string, httpStatus: number) {
  return TRPCClientError.from<AppRouter>({
    error: { message, code: -32603, data: { code, httpStatus, path: "x" } },
  });
}

describe("friendlyErrorMessage", () => {
  it("oversætter browserens netværksfejl (TIMETRACK-1T) til dansk", () => {
    for (const raw of [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "Load failed",
      "Network request failed",
    ]) {
      expect(
        friendlyErrorMessage(TRPCClientError.from(new TypeError(raw))),
      ).toBe(NETWORK_ERROR_MESSAGE);
    }
  });

  it("oversætter et HTML-svar fra proxyen under et deploy", () => {
    const error = TRPCClientError.from(
      new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON"),
    );
    expect(friendlyErrorMessage(error)).toBe(SERVER_ERROR_MESSAGE);
  });

  it("skjuler tekniske serverfejl, men beholder bevidste danske beskeder", () => {
    expect(
      friendlyErrorMessage(
        serverError(
          'Failed query: select "id" from "clients"',
          "INTERNAL_SERVER_ERROR",
          500,
        ),
      ),
    ).toBe(SERVER_ERROR_MESSAGE);
    expect(
      friendlyErrorMessage(
        serverError(
          "Cannot read properties of undefined (reading 'id')",
          "INTERNAL_SERVER_ERROR",
          500,
        ),
      ),
    ).toBe(SERVER_ERROR_MESSAGE);
    expect(
      friendlyErrorMessage(
        serverError(
          "Fakturaen er allerede sendt",
          "INTERNAL_SERVER_ERROR",
          500,
        ),
      ),
    ).toBeNull();
  });

  it("erstatter zods JSON-liste med en forståelig besked", () => {
    const zodMessage = JSON.stringify(
      [{ code: "too_small", path: ["name"], message: "String must contain" }],
      null,
      2,
    );
    expect(
      friendlyErrorMessage(serverError(zodMessage, "BAD_REQUEST", 400)),
    ).toMatch(/felter/);
  });

  it("giver danske tekster, når serveren kun sendte koden", () => {
    expect(
      friendlyErrorMessage(serverError("UNAUTHORIZED", "UNAUTHORIZED", 401)),
    ).toMatch(/log ind/i);
    expect(
      friendlyErrorMessage(
        serverError("TOO_MANY_REQUESTS", "TOO_MANY_REQUESTS", 429),
      ),
    ).toMatch(/vent/i);
  });

  it("lader bevidste beskeder være", () => {
    expect(
      friendlyErrorMessage(serverError("Kunden findes ikke", "NOT_FOUND", 404)),
    ).toBeNull();
  });

  it("rører ikke afbrudte forespørgsler", () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    expect(friendlyErrorMessage(TRPCClientError.from(abort))).toBeNull();
  });
});

describe("friendlyErrorLink", () => {
  it("giver fejlen en dansk besked, men bevarer data og type", async () => {
    const raw = serverError(
      'relation "x" does not exist',
      "INTERNAL_SERVER_ERROR",
      500,
    );
    const link = friendlyErrorLink()({} as never);
    const result = link({
      op: { id: 1, type: "mutation", path: "x", input: null, context: {} },
      next: () =>
        observable((observer) => {
          observer.error(raw);
        }),
    } as never);

    const error = await new Promise<TRPCClientError<AppRouter>>((resolve) => {
      result.subscribe({
        error: (e) => resolve(e as TRPCClientError<AppRouter>),
      });
    });

    expect(error).toBeInstanceOf(TRPCClientError);
    expect(error.message).toBe(SERVER_ERROR_MESSAGE);
    expect(error.data?.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("bevarer netværksfejlen, så offline-køen stadig genkender den", async () => {
    const raw = TRPCClientError.from<AppRouter>(
      new TypeError("Failed to fetch"),
    );
    const link = friendlyErrorLink()({} as never);
    const result = link({
      op: { id: 1, type: "mutation", path: "x", input: null, context: {} },
      next: () =>
        observable((observer) => {
          observer.error(raw);
        }),
    } as never);

    const error = await new Promise<Error>((resolve) => {
      result.subscribe({ error: (e) => resolve(e as Error) });
    });

    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(isNetworkError(error)).toBe(true);
  });
});

describe("errorToastAction", () => {
  it("tilbyder 'Prøv igen' ved netværks- og serverfejl", () => {
    expect(
      errorToastAction(TRPCClientError.from(new TypeError("Failed to fetch"))),
    ).toBe("retry");
    expect(
      errorToastAction(serverError("x", "INTERNAL_SERVER_ERROR", 500)),
    ).toBe("retry");
  });

  it("tilbyder 'Log ind', når sessionen er udløbet", () => {
    expect(
      errorToastAction(serverError("UNAUTHORIZED", "UNAUTHORIZED", 401)),
    ).toBe("login");
  });

  it("tilbyder intet ved valideringsfejl og bevidste afvisninger", () => {
    expect(
      errorToastAction(serverError("Ugyldigt antal timer", "BAD_REQUEST", 400)),
    ).toBeNull();
    expect(
      errorToastAction(new Error("Beskrivelse må ikke være tom")),
    ).toBeNull();
    expect(errorToastAction(null)).toBeNull();
  });
});
