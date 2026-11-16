import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TimeEntry } from "@/lib/types";
import { CalendarEntry } from "../CalendarEntry";

const baseEntry: TimeEntry = {
  id: "e1",
  remote_id: null,
  project_id: "p1",
  client_id: null,
  klippekort_id: null,
  description: null,
  start_time: "2026-07-18T10:00:00",
  end_time: "2026-07-18T12:00:00",
  duration: 7200,
  is_billable: true,
  is_running: false,
  source: "manual",
  created_at: "2026-07-18T10:00:00",
  updated_at: "2026-07-18T10:00:00",
  synced_at: null,
  project_name: "Projekt",
  client_name: null,
  project_color: "#3b82f6",
};

const HOUR_HEIGHT = 60;
const START_HOUR = 0;

function topOf(container: HTMLElement): string {
  const btn = container.querySelector("button");
  if (!btn) throw new Error("entry button not rendered");
  return (btn as HTMLElement).style.top;
}

describe("CalendarEntry displayStart/displayEnd", () => {
  it("recomputes position when displayStart changes on the same entry", () => {
    // Same component instance reused (midnight-split segment) with a new
    // displayStart must reposition — the memoized style depends on it.
    const { container, rerender } = render(
      <CalendarEntry
        entry={baseEntry}
        hourHeight={HOUR_HEIGHT}
        startHour={START_HOUR}
        onClick={() => {}}
        displayStart="2026-07-18T10:00:00"
      />,
    );
    const topBefore = topOf(container);

    rerender(
      <CalendarEntry
        entry={baseEntry}
        hourHeight={HOUR_HEIGHT}
        startHour={START_HOUR}
        onClick={() => {}}
        displayStart="2026-07-18T14:00:00"
      />,
    );
    const topAfter = topOf(container);

    // 10:00 → top 600px, 14:00 → top 840px at hourHeight 60.
    expect(topBefore).toBe("600px");
    expect(topAfter).toBe("840px");
  });
});
