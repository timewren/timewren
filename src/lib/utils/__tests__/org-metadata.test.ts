import { describe, expect, it } from "vitest";
import {
  getAllowedDomains,
  isEmailDomainAllowed,
  parseOrgMetadata,
} from "@/lib/utils/org-metadata";

describe("parseOrgMetadata", () => {
  it("passes through an object", () => {
    expect(parseOrgMetadata({ type: "freelance" })).toEqual({
      type: "freelance",
    });
  });

  it("parses a JSON string (Better-Auth stores metadata stringified)", () => {
    expect(
      parseOrgMetadata('{"type":"freelance","allowedDomains":["example.dk"]}'),
    ).toEqual({ type: "freelance", allowedDomains: ["example.dk"] });
  });

  it("returns {} for null, invalid JSON, or non-object", () => {
    expect(parseOrgMetadata(null)).toEqual({});
    expect(parseOrgMetadata(undefined)).toEqual({});
    expect(parseOrgMetadata("not json")).toEqual({});
    expect(parseOrgMetadata("123")).toEqual({});
  });
});

describe("getAllowedDomains", () => {
  it("lowercases and trims", () => {
    expect(
      getAllowedDomains({ allowedDomains: [" Example.DK ", "Foo.Com"] }),
    ).toEqual(["example.dk", "foo.com"]);
  });

  it("returns [] when unset or not an array", () => {
    expect(getAllowedDomains({})).toEqual([]);
    expect(getAllowedDomains({ allowedDomains: "x" })).toEqual([]);
  });

  it("reads from stringified metadata", () => {
    expect(getAllowedDomains('{"allowedDomains":["Example.dk"]}')).toEqual([
      "example.dk",
    ]);
  });
});

describe("isEmailDomainAllowed", () => {
  it("allows any email when no whitelist is configured", () => {
    expect(isEmailDomainAllowed({}, "anyone@gmail.com")).toBe(true);
    expect(isEmailDomainAllowed(null, "anyone@gmail.com")).toBe(true);
  });

  it("matches case-insensitively (the original customer bug)", () => {
    const meta = { allowedDomains: ["Example.dk"] };
    expect(isEmailDomainAllowed(meta, "kk@example.dk")).toBe(true);
    expect(isEmailDomainAllowed(meta, "KK@EXAMPLE.DK")).toBe(true);
  });

  it("rejects a non-whitelisted domain", () => {
    expect(
      isEmailDomainAllowed({ allowedDomains: ["example.dk"] }, "x@gmail.com"),
    ).toBe(false);
  });

  it("rejects an email with no domain", () => {
    expect(
      isEmailDomainAllowed({ allowedDomains: ["example.dk"] }, "broken"),
    ).toBe(false);
  });

  it("works with stringified metadata", () => {
    expect(
      isEmailDomainAllowed(
        '{"allowedDomains":["example.dk"]}',
        "kk@example.dk",
      ),
    ).toBe(true);
  });
});
