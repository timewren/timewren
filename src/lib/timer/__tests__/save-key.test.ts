import { describe, expect, it } from "vitest";
import { createSaveKeyCache } from "../save-key";

describe("createSaveKeyCache (idempotent gem af et timer-stop)", () => {
  it("samme session → samme nøgle på tværs af gentagne Gem-klik", () => {
    const cache = createSaveKeyCache();
    const first = cache.keyFor(1_700_000_000_000);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(cache.keyFor(1_700_000_000_000)).toBe(first);
  });

  it("ny session → ny nøgle", () => {
    const cache = createSaveKeyCache();
    const a = cache.keyFor(1_700_000_000_000);
    const b = cache.keyFor(1_700_000_600_000);
    expect(b).not.toBe(a);
  });

  it("efter et gennemført gem nulstilles nøglen", () => {
    const cache = createSaveKeyCache();
    const a = cache.keyFor(1_700_000_000_000);
    cache.reset();
    expect(cache.keyFor(1_700_000_000_000)).not.toBe(a);
  });

  it("uden sessionsstart → ingen nøgle", () => {
    expect(createSaveKeyCache().keyFor(null)).toBeUndefined();
  });
});
