import { describe, expect, it } from "vitest";
import { resolveSentryEnvironment } from "./sentry-environment";

// Beta og prod kører begge med NODE_ENV=production og rapporterede derfor
// begge som "production" i Sentry (#764).

describe("resolveSentryEnvironment", () => {
  it("bruger SENTRY_ENVIRONMENT når den er sat", () => {
    expect(
      resolveSentryEnvironment({
        explicit: "staging",
        appUrl: "https://beta.timetrack.dk",
        nodeEnv: "production",
      }),
    ).toBe("staging");
  });

  it("udleder beta fra app-URL'en", () => {
    expect(
      resolveSentryEnvironment({
        appUrl: "https://beta.timetrack.dk",
        nodeEnv: "production",
      }),
    ).toBe("beta");
  });

  it("udleder beta fra browserens hostname før app-URL'en", () => {
    expect(
      resolveSentryEnvironment({
        hostname: "beta.timetrack.dk",
        appUrl: "https://app.timetrack.dk",
        nodeEnv: "production",
      }),
    ).toBe("beta");
  });

  it("giver production for prod-hosten", () => {
    expect(
      resolveSentryEnvironment({
        appUrl: "https://app.timetrack.dk",
        nodeEnv: "production",
      }),
    ).toBe("production");
  });

  it("giver development for localhost, også i et production-build", () => {
    expect(
      resolveSentryEnvironment({
        appUrl: "http://localhost:3000",
        nodeEnv: "production",
      }),
    ).toBe("development");
  });

  it("falder tilbage til NODE_ENV uden URL", () => {
    expect(resolveSentryEnvironment({ nodeEnv: "development" })).toBe(
      "development",
    );
    expect(resolveSentryEnvironment({ nodeEnv: "production" })).toBe(
      "production",
    );
  });

  it("ignorerer en tom eller ugyldig værdi", () => {
    expect(
      resolveSentryEnvironment({
        explicit: "  ",
        appUrl: "ikke en url",
        nodeEnv: "production",
      }),
    ).toBe("production");
  });
});
