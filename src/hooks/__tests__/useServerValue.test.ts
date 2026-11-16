import { describe, expect, it } from "vitest";
import { nextServerValueState, shownServerValue } from "../useServerValue";

describe("nextServerValueState (inline-redigering i tidslisten)", () => {
  it("viser en refetchet serverværdi i stedet for den første prop", () => {
    const first = { server: "1", override: null };
    const next = nextServerValueState(first, "2.5");
    expect(shownServerValue(next)).toBe("2.5");
  });

  it("viser den optimistiske værdi indtil serveren svarer", () => {
    const optimistic = { server: "1", override: "3" };
    expect(shownServerValue(nextServerValueState(optimistic, "1"))).toBe("3");
  });

  it("en ny serverværdi rydder den optimistiske værdi", () => {
    const optimistic = { server: "1", override: "3" };
    const next = nextServerValueState(optimistic, "3.00");
    expect(next.override).toBeNull();
    expect(shownServerValue(next)).toBe("3.00");
  });

  it("returnerer samme objekt når intet er ændret (ingen ekstra render)", () => {
    const state = { server: "1", override: null };
    expect(nextServerValueState(state, "1")).toBe(state);
  });
});
