import { describe, expect, it } from "vitest";
import { TIME_ENTRY_DOMAINS } from "@/lib/query/invalidate-domains";
import {
  entitiesForDomains,
  formatDeviceStreamFrame,
  toDeviceStreamEvent,
} from "@/lib/realtime-device";

const timerMsg = JSON.stringify({
  userId: "u1",
  type: "stopped",
  isRunning: false,
  projectId: "p-hemmelig",
  clientId: "c-hemmelig",
  taskId: null,
  description: "Møde med Bageriet",
  version: 42,
  userName: "Mads",
});

describe("toDeviceStreamEvent", () => {
  it("timer-event på brugerens kanal → kun type og version", () => {
    const ev = toDeviceStreamEvent("timer:user:u1", timerMsg);
    expect(ev).toEqual({ type: "timer", event: "stopped", version: 42 });
    expect(JSON.stringify(ev)).not.toMatch(/hemmelig|Bageriet|Mads/);
  });

  it("kollegers timer-events på org-kanalen sendes ikke", () => {
    expect(toDeviceStreamEvent("timer:org:o1", timerMsg)).toBeNull();
  });

  it("data_changed → områder, også fra org-kanalen", () => {
    const msg = JSON.stringify({
      type: "data_changed",
      userId: "u2",
      domains: ["clients", "projects"],
      origin: "tab-1",
    });
    expect(toDeviceStreamEvent("timer:org:o1", msg)).toEqual({
      type: "data",
      entities: ["clients", "projects"],
    });
  });

  it("en gemt tidspost rammer poster, klippekort, fakturaer og opgaver", () => {
    expect(entitiesForDomains(TIME_ENTRY_DOMAINS)).toEqual([
      "entries",
      "clients",
      "projects",
      "klippekort",
      "invoices",
      "tasks",
    ]);
  });

  it("matchningsregler har eget område (fuld sti, ikke routeren)", () => {
    expect(entitiesForDomains(["extension.rules"])).toEqual(["rules"]);
    expect(entitiesForDomains(["extension.getTimerState"])).toEqual([]);
  });

  it("ukendte domæner, ugyldig JSON og healthcheck-ping ignoreres", () => {
    expect(
      toDeviceStreamEvent(
        "timer:user:u1",
        JSON.stringify({ type: "data_changed", domains: ["vat", "user"] }),
      ),
    ).toBeNull();
    expect(toDeviceStreamEvent("timer:user:u1", "ping")).toBeNull();
    expect(toDeviceStreamEvent("timer:user:u1", "null")).toBeNull();
  });

  it("rammen har id, event-navn og data", () => {
    expect(
      formatDeviceStreamFrame(7, { type: "data", entities: ["tasks"] }),
    ).toBe(
      'id: 7\nevent: data\ndata: {"type":"data","entities":["tasks"]}\n\n',
    );
  });
});
