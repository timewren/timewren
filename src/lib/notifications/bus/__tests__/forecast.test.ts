import { expect, it } from "vitest";
import { renderNotification } from "../events";

it("renders a forecast as a plan warning for employee and manager", () => {
  const rendered = renderNotification("compliance.forecast", {
    weekStart: "2026-11-09",
    findings: ["Planen giver 10 timers hvile"],
  });
  expect(rendered.title).toContain("arbejdsplan");
  expect(rendered.body).toContain("10 timers hvile");
  expect(rendered.url).toBe("/dashboard/enterprise/work-plan");
});
