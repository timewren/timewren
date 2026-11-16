import { describe, expect, it } from "vitest";
import { filterTourSteps, type TourStep } from "./tour-steps";

const steps: TourStep[] = [
  { target: "a", title: "A", description: "", placement: "center" },
  {
    target: "b",
    title: "B",
    description: "",
    placement: "top",
    requiresModule: "tasks",
  },
  {
    target: "c",
    title: "C",
    description: "",
    placement: "top",
    requiresModule: "klippekort",
  },
];

describe("filterTourSteps", () => {
  it("beholder steps uden requiresModule", () => {
    const result = filterTourSteps(steps, () => false);
    expect(result.map((s) => s.target)).toEqual(["a"]);
  });

  it("beholder steps for tændte moduler", () => {
    const result = filterTourSteps(steps, (m) => m === "tasks");
    expect(result.map((s) => s.target)).toEqual(["a", "b"]);
  });

  it("beholder alle når alle moduler er tændt", () => {
    const result = filterTourSteps(steps, () => true);
    expect(result).toHaveLength(3);
  });
});
