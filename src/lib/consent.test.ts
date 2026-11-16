import { describe, expect, it } from "vitest";
import { sharedCookieDomainFor } from "./consent";

describe("sharedCookieDomainFor", () => {
  it("deler cookien på marketing-domænet og app-subdomænet (prod uændret)", () => {
    const m = "https://timetrack.dk";
    expect(sharedCookieDomainFor("timetrack.dk", m)).toBe(".timetrack.dk");
    expect(sharedCookieDomainFor("app.timetrack.dk", m)).toBe(".timetrack.dk");
  });

  it("er host-only uden marketing-URL eller for fremmede værter", () => {
    expect(sharedCookieDomainFor("timetrack.dk", undefined)).toBeUndefined();
    expect(
      sharedCookieDomainFor("tid.example.org", "https://timetrack.dk"),
    ).toBeUndefined();
    expect(
      sharedCookieDomainFor("nottimetrack.dk", "https://timetrack.dk"),
    ).toBeUndefined();
  });

  it("deler ikke når marketing-URL'en selv er et subdomæne", () => {
    expect(
      sharedCookieDomainFor("tid.example.org", "https://tid.example.org"),
    ).toBeUndefined();
  });
});
