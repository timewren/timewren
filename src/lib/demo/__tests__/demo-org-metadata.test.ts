import { describe, expect, it } from "vitest";
import { orgRegionFromMetadata } from "@/lib/org/region";
import { demoOrgMetadata } from "../create-demo-account";

describe("demoOrgMetadata", () => {
  it("gives the English demo EUR and no country", () => {
    const metadata = demoOrgMetadata("en");
    expect(metadata.type).toBe("freelance");
    expect(orgRegionFromMetadata(metadata)).toEqual({
      currency: "EUR",
      country: null,
      locale: "en",
    });
  });

  it("keeps EUR in a Danish demo, with Denmark as the country", () => {
    expect(orgRegionFromMetadata(demoOrgMetadata("da"))).toEqual({
      currency: "EUR",
      country: "DK",
      locale: "da",
    });
  });
});
