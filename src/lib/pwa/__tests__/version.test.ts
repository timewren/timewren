import { describe, expect, it } from "vitest";
import {
  APP_VERSION_ATTRIBUTE,
  appVersionAttributes,
  buildVersion,
  deployedVersion,
} from "../version";

function fakeDocument(attrs: Record<string, string>) {
  return {
    documentElement: {
      getAttribute: (name: string) => attrs[name] ?? null,
    },
  };
}

describe("deployedVersion", () => {
  it("læser APP_VERSION ved kørsel, så den ikke bages ind i bundtet", () => {
    expect(deployedVersion({ APP_VERSION: "0.32.1-abc1234" })).toBe(
      "0.32.1-abc1234",
    );
  });

  it("falder tilbage til et NEXT_PUBLIC_APP_VERSION fra et ældre build-script", () => {
    expect(deployedVersion({ NEXT_PUBLIC_APP_VERSION: "legacy-1" })).toBe(
      "legacy-1",
    );
    expect(
      deployedVersion({ APP_VERSION: "ny", NEXT_PUBLIC_APP_VERSION: "gammel" }),
    ).toBe("ny");
  });

  it("er null uden version (lokale builds)", () => {
    expect(deployedVersion({})).toBeNull();
    expect(deployedVersion({ APP_VERSION: "" })).toBeNull();
  });
});

describe("buildVersion", () => {
  it("læser versionen, serveren satte på <html>", () => {
    expect(
      buildVersion(fakeDocument({ [APP_VERSION_ATTRIBUTE]: "build-1" })),
    ).toBe("build-1");
  });

  it("er null uden attribut og uden document (SSR)", () => {
    expect(buildVersion(fakeDocument({}))).toBeNull();
    expect(buildVersion(undefined)).toBeNull();
  });
});

describe("appVersionAttributes", () => {
  it("giver <html> den attribut, buildVersion læser", () => {
    const attrs = appVersionAttributes({ APP_VERSION: "build-2" });
    expect(attrs).toEqual({ [APP_VERSION_ATTRIBUTE]: "build-2" });
    expect(buildVersion(fakeDocument(attrs))).toBe("build-2");
  });

  it("er tom uden version, så <html> er uændret", () => {
    expect(appVersionAttributes({})).toEqual({});
  });
});
