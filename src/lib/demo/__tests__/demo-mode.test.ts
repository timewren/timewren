import { afterEach, describe, expect, it, vi } from "vitest";
import { isDemoEmail, isDemoMode } from "../demo-mode";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isDemoMode", () => {
  it("er kun slået til med DEMO_MODE=1", () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(isDemoMode()).toBe(false);
    vi.stubEnv("DEMO_MODE", "true");
    expect(isDemoMode()).toBe(false);
    vi.stubEnv("DEMO_MODE", "1");
    expect(isDemoMode()).toBe(true);
  });

  it("læser et medsendt env", () => {
    expect(isDemoMode({ DEMO_MODE: "1" })).toBe(true);
    expect(isDemoMode({})).toBe(false);
  });

  it("læser runtime-config i browseren", () => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubGlobal("window", { __TT_CONFIG__: {} });
    expect(isDemoMode()).toBe(false);
    vi.stubGlobal("window", { __TT_CONFIG__: { demo: true } });
    expect(isDemoMode()).toBe(true);
  });
});

describe("isDemoEmail", () => {
  it("genkender kun det reserverede domæne", () => {
    expect(isDemoEmail("demo-abc@demo.invalid")).toBe(true);
    expect(isDemoEmail("DEMO-ABC@DEMO.INVALID")).toBe(true);
    expect(isDemoEmail("anna@example.com")).toBe(false);
    expect(isDemoEmail("x@notdemo.invalid.example.com")).toBe(false);
    expect(isDemoEmail(null)).toBe(false);
  });
});
