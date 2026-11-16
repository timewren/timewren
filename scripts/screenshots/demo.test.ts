import { describe, expect, it } from "vitest";
import deTasks from "../../src/i18n/messages/de/tasks.json";
import esTasks from "../../src/i18n/messages/es/tasks.json";
import { demoData, localDatabase, locales, scenes } from "./demo";

describe("screenshot contract", () => {
  it.each([deTasks, esTasks])(
    "translates the visible task board controls",
    (tasks) => {
      expect(tasks.board).toHaveProperty("sort");
      expect(tasks.laneHeader).toHaveProperty("customize");
    },
  );
  it("covers all four languages with fictional companies and no CVR", () => {
    expect(locales).toEqual(["en", "da", "de", "es"]);
    for (const locale of locales) {
      const data = demoData(locale, new Date("2026-11-09T12:00:00Z"));
      expect(data.clients).toHaveLength(7);
      expect(data.email).toMatch(/@timewren\.invalid$/);
      expect(data.text.work).toHaveLength(6);
      for (const client of data.clients) {
        expect(client.cvrNumber).toBeNull();
        expect(client.name).not.toMatch(/\b\d{8}\b/);
      }
      expect(data.day(-42).toISOString()).toBe("2026-09-28T09:00:00.000Z");
    }
  });
  it("refuses remote or unrelated local databases", () => {
    for (const url of [
      "",
      "postgres://x@localhost/timewren_screenshots",
      "postgres://x@db/timewren_screenshots",
      "postgres://x@127.0.0.1/production",
      "postgres://x@127.0.0.1/timewren_screenshots?host=remote",
    ]) {
      expect(() => localDatabase(url)).toThrow();
    }
    expect(
      localDatabase("postgres://x@127.0.0.1:54321/timewren_screenshots"),
    ).toContain("127.0.0.1");
  });
  it("exports exactly the shared filenames and two dark variants", () => {
    expect(Object.keys(scenes)).toEqual([
      "dashboard",
      "timer",
      "prepaid-hours",
      "invoices",
      "clients",
      "projects",
      "tasks",
      "reports",
      "calendar",
      "mobile-dashboard",
      "dashboard-dark",
      "prepaid-hours-dark",
    ]);
  });
});
