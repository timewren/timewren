import { describe, expect, it } from "vitest";
import {
  isAllowedExtensionRedirectUri,
  pickExtensionOrgId,
} from "@/lib/extension-auth";

describe("isAllowedExtensionRedirectUri", () => {
  it("accepts a Chrome chromiumapp.org redirect", () => {
    expect(
      isAllowedExtensionRedirectUri("https://abcdef.chromiumapp.org/"),
    ).toBe(true);
  });

  it("accepts a Firefox extensions.allizom.org redirect", () => {
    expect(
      isAllowedExtensionRedirectUri(
        "https://1234-5678.extensions.allizom.org/",
      ),
    ).toBe(true);
  });

  it("rejects an arbitrary https host", () => {
    expect(isAllowedExtensionRedirectUri("https://evil.com/")).toBe(false);
  });

  it("rejects a lookalike host that only contains the suffix", () => {
    expect(
      isAllowedExtensionRedirectUri("https://chromiumapp.org.evil.com/"),
    ).toBe(false);
  });

  it("rejects non-https schemes", () => {
    expect(isAllowedExtensionRedirectUri("http://abc.chromiumapp.org/")).toBe(
      false,
    );
  });

  it("rejects malformed input", () => {
    expect(isAllowedExtensionRedirectUri("not a url")).toBe(false);
  });
});

describe("pickExtensionOrgId", () => {
  it("honors a requested org the user is a member of", () => {
    expect(pickExtensionOrgId("org-2", ["org-1", "org-2"], "org-1")).toBe(
      "org-2",
    );
  });

  it("falls back to primary when requested org is not a membership", () => {
    expect(pickExtensionOrgId("org-9", ["org-1", "org-2"], "org-1")).toBe(
      "org-1",
    );
  });

  it("falls back to primary when no org requested", () => {
    expect(pickExtensionOrgId(undefined, ["org-1"], "org-1")).toBe("org-1");
    expect(pickExtensionOrgId(null, ["org-1"], "org-1")).toBe("org-1");
  });

  it("returns null when the user has no org at all", () => {
    expect(pickExtensionOrgId(undefined, [], null)).toBe(null);
  });
});
