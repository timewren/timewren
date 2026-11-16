import { describe, expect, it } from "vitest";
import { runBatch } from "../batch";

describe("runBatch (approveMany/rejectMany)", () => {
  it("validerer hvert id for sig — én fejl stopper ikke resten", async () => {
    const calls: string[] = [];
    const result = await runBatch(["a", "b", "c"], async (id) => {
      calls.push(id);
      if (id === "b") throw new Error("Uden for dit scope");
    });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(result.succeeded).toEqual(["a", "c"]);
    expect(result.failed).toEqual([{ id: "b", message: "Uden for dit scope" }]);
  });

  it("kører dubletter kun én gang", async () => {
    let n = 0;
    const result = await runBatch(["a", "a", "b"], async () => {
      n++;
    });
    expect(n).toBe(2);
    expect(result.succeeded).toEqual(["a", "b"]);
  });

  it("kører sekventielt (ét id ad gangen)", async () => {
    let active = 0;
    let maxActive = 0;
    await runBatch(["a", "b", "c"], async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
    });
    expect(maxActive).toBe(1);
  });

  it("ukendte fejl får en neutral besked", async () => {
    const result = await runBatch(["x"], async () => {
      throw "boom";
    });
    expect(result.failed).toEqual([{ id: "x", message: "Ukendt fejl" }]);
  });
});
