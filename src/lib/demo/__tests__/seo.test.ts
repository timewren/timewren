import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/globals.css", () => ({}));
vi.mock("next/font/google", () => ({
  Geist_Mono: () => ({ variable: "" }),
  Schibsted_Grotesk: () => ({ variable: "" }),
}));

import { makeMetadata } from "@/components/DocumentLayout";
import { brand } from "@/lib/brand";

afterEach(() => vi.unstubAllEnvs());

describe("metadata i demo-tilstand", () => {
  it("er noindex med DEMO_MODE=1", () => {
    vi.stubEnv("DEMO_MODE", "1");
    expect(makeMetadata(brand).robots).toEqual({ index: false, follow: false });
  });

  it("er uændret (indekserbar) uden DEMO_MODE", () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(makeMetadata(brand).robots).toMatchObject({ index: true });
  });
});
