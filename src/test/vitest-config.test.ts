import { afterEach, describe, expect, it, vi } from "vitest";

/** Projekterne fra vitest.config.ts, læst med det env, testen har stubbet. */
async function projects() {
  vi.resetModules();
  const { default: config } = await import("../../vitest.config");
  const list = (config.test?.projects ?? []) as {
    test: { name: string; maxWorkers?: number };
  }[];
  return Object.fromEntries(list.map((p) => [p.test.name, p.test]));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vitest.config.ts workers", () => {
  it("bruger vitests standard for unit-projektet uden TT_UNIT_MAX_WORKERS", async () => {
    vi.stubEnv("TT_UNIT_MAX_WORKERS", undefined);
    const { unit, integration } = await projects();
    expect(unit).not.toHaveProperty("maxWorkers");
    expect(integration.maxWorkers).toBe(2);
  });

  it("begrænser kun unit-projektet, når CI sætter TT_UNIT_MAX_WORKERS", async () => {
    vi.stubEnv("TT_UNIT_MAX_WORKERS", "3");
    const { unit, integration } = await projects();
    expect(unit.maxWorkers).toBe(3);
    expect(integration.maxWorkers).toBe(2);
  });

  it("ignorerer en ugyldig værdi i stedet for at give vitest NaN", async () => {
    for (const value of ["", "0", "-1", "abc", "4abc", "2.5"]) {
      vi.stubEnv("TT_UNIT_MAX_WORKERS", value);
      const { unit } = await projects();
      expect(unit, value).not.toHaveProperty("maxWorkers");
    }
  });
});
