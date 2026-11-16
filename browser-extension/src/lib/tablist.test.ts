import { describe, expect, it } from "vitest";
import { tabKeyTarget } from "./tablist";

describe("tabKeyTarget", () => {
  it("piletaster går rundt i fanerne", () => {
    expect(tabKeyTarget(4, 0, "ArrowRight")).toBe(1);
    expect(tabKeyTarget(4, 3, "ArrowRight")).toBe(0);
    expect(tabKeyTarget(4, 0, "ArrowLeft")).toBe(3);
  });

  it("Home og End går til første og sidste fane", () => {
    expect(tabKeyTarget(4, 2, "Home")).toBe(0);
    expect(tabKeyTarget(4, 1, "End")).toBe(3);
  });

  it("andre taster flytter ikke", () => {
    expect(tabKeyTarget(4, 1, "Enter")).toBeNull();
    expect(tabKeyTarget(4, 1, "ArrowDown")).toBeNull();
  });
});
