import { describe, expect, it } from "vitest";
import {
  ApiError,
  errorTextMessage,
  noConnectionMessage,
  trpcErrorCode,
  trpcErrorMessage,
  userErrorMessage,
} from "./api-error";

// Samme form som serverens tRPC-svar med superjson (se client-version.test.ts)
const unauthorized = {
  error: {
    json: {
      message: "Token udløbet",
      code: -32001,
      data: { code: "UNAUTHORIZED", httpStatus: 401 },
    },
  },
};

describe("trpcErrorCode", () => {
  it("læser strengkoden i json.data.code, ikke JSON-RPC-tallet", () => {
    expect(trpcErrorCode(unauthorized)).toBe("UNAUTHORIZED");
  });

  it("læser REST-svar og svar uden superjson", () => {
    expect(trpcErrorCode({ error: { code: "FORBIDDEN" } })).toBe("FORBIDDEN");
    expect(
      trpcErrorCode({ error: { data: { code: "NOT_FOUND" }, code: -32004 } }),
    ).toBe("NOT_FOUND");
  });

  it("ukendt form giver null", () => {
    expect(trpcErrorCode(null)).toBeNull();
    expect(trpcErrorCode("<html>")).toBeNull();
    expect(trpcErrorCode({ error: { json: { code: -32600 } } })).toBeNull();
  });
});

describe("trpcErrorMessage", () => {
  it("UNAUTHORIZED giver altid session-teksten", () => {
    expect(trpcErrorMessage(unauthorized)).toBe(
      "Din session er udløbet. Log ind igen.",
    );
  });

  it("bevarer serverens danske besked (stop-flowet genkender klippekort-fejl)", () => {
    expect(
      trpcErrorMessage({
        error: {
          json: {
            message: "Klippekortet har ikke flere timer",
            code: -32600,
            data: { code: "BAD_REQUEST" },
          },
        },
      }),
    ).toBe("Klippekortet har ikke flere timer");
  });

  it("rå JSON fra validering når aldrig brugeren", () => {
    expect(
      trpcErrorMessage({
        error: {
          json: {
            message: '[{"code":"invalid_type","path":["hours"]}]',
            code: -32600,
            data: { code: "BAD_REQUEST" },
          },
        },
      }),
    ).toBe("Ugyldig forespørgsel");
  });

  it("serverfejl oversættes uanset besked", () => {
    expect(
      trpcErrorMessage({
        error: {
          json: {
            message: "relation does not exist",
            data: { code: "INTERNAL_SERVER_ERROR" },
          },
        },
      }),
    ).toBe("Serverfejl. Prøv igen om lidt");
  });
});

describe("errorTextMessage", () => {
  it("parser fejlkroppen som tekst", () => {
    expect(errorTextMessage(JSON.stringify(unauthorized), "x")).toBe(
      "Din session er udløbet. Log ind igen.",
    );
  });

  it("HTML-fejlside giver reserveteksten", () => {
    expect(errorTextMessage("<html>502</html>", "Serveren svarede 502")).toBe(
      "Serveren svarede 502",
    );
  });
});

describe("userErrorMessage", () => {
  it("browserens netværksfejl bliver til dansk", () => {
    expect(userErrorMessage(new TypeError("Failed to fetch"), "x")).toBe(
      noConnectionMessage(),
    );
    expect(
      userErrorMessage(
        new DOMException("signal is aborted without reason", "AbortError"),
        "x",
      ),
    ).toBe(noConnectionMessage());
  });

  it("vores egne fejl beholder deres besked", () => {
    expect(
      userErrorMessage(
        new ApiError("Forbindelsen tog for lang tid", "timeout"),
        "x",
      ),
    ).toBe("Forbindelsen tog for lang tid");
  });

  it("rå JSON og ukendte værdier giver reserveteksten", () => {
    expect(userErrorMessage(new Error('{"error":1}'), "Kunne ikke")).toBe(
      "Kunne ikke",
    );
    expect(userErrorMessage("noget", "Kunne ikke")).toBe("Kunne ikke");
  });
});
