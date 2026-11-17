import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Den offentlige demo har ingen Electric: /api/shapes/timer svarer 503, og
 * klienten må derfor ikke åbne strømmen dér (#1213). Polling og SSE bærer
 * synkroniseringen som på instanser uden Electric.
 */

const ShapeStream = vi.fn(function ShapeStream() {
  return { unsubscribeAll: vi.fn() };
});
const Shape = vi.fn(function Shape() {
  return { subscribe: () => () => {} };
});
vi.mock("@electric-sql/client", () => ({ Shape, ShapeStream }));

beforeEach(() => {
  vi.resetModules();
  ShapeStream.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

async function subscribeOnce(config: { demo?: true }) {
  vi.stubGlobal("window", {
    location: { origin: "http://localhost:3000" },
    __TT_CONFIG__: config,
  });
  const { subscribeElectricTimer } = await import("../timerSource");
  const unsubscribe = subscribeElectricTimer(() => {});
  // Den dynamiske import af @electric-sql/client skal nå at løse.
  await vi.dynamicImportSettled();
  await new Promise((r) => setTimeout(r, 0));
  unsubscribe();
}

describe("Electric-timerstrømmen", () => {
  it("åbnes ikke i demo-tilstand", async () => {
    await subscribeOnce({ demo: true });
    expect(ShapeStream).not.toHaveBeenCalled();
  });

  it("åbnes som hidtil uden demo-tilstand", async () => {
    await subscribeOnce({});
    expect(ShapeStream).toHaveBeenCalledTimes(1);
    expect(ShapeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://localhost:3000/api/shapes/timer",
      }),
    );
  });
});
