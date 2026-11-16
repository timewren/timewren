import { describe, expect, it } from "vitest";
import {
  evaluateStream,
  formatPingFrame,
  parsePing,
  REALTIME_STALE_AFTER_MS,
} from "@/lib/realtime-ping";

// EventSource udsender ingen JS-event for SSE-kommentarer (": ping"), så en
// stille død strøm kunne ikke skelnes fra en rolig. Et rigtigt ping-event
// med servertid og abonnent-status gør det muligt.
describe("formatPingFrame / parsePing", () => {
  it("er et navngivet SSE-event med servertid og abonnent-status", () => {
    const frame = formatPingFrame(1_000, true);
    expect(frame).toBe('event: ping\ndata: {"t":1000,"sub":"ok"}\n\n');
  });

  it("melder 'down' når processens abonnent ikke er aktiv", () => {
    expect(formatPingFrame(5, false)).toContain('"sub":"down"');
  });

  it("parser data-linjen tilbage", () => {
    expect(parsePing('{"t":1000,"sub":"ok"}')).toEqual({ t: 1000, sub: "ok" });
    expect(parsePing('{"t":1000,"sub":"down"}')).toEqual({
      t: 1000,
      sub: "down",
    });
  });

  it("afviser skrald", () => {
    expect(parsePing("nope")).toBeNull();
    expect(parsePing('{"t":"x"}')).toBeNull();
    expect(parsePing("null")).toBeNull();
  });
});

describe("evaluateStream", () => {
  const now = 1_000_000;

  it("ikke åbnet er ikke forbundet og skal ikke genforbinde (EventSource prøver selv)", () => {
    expect(
      evaluateStream({ open: false, lastSignalAt: null, lastSub: null, now }),
    ).toEqual({ connected: false, reconnect: false });
  });

  it("frisk signal og abonnent ok → forbundet", () => {
    expect(
      evaluateStream({
        open: true,
        lastSignalAt: now - 30_000,
        lastSub: "ok",
        now,
      }),
    ).toEqual({ connected: true, reconnect: false });
  });

  it("åben men tavs i over 60 s → ikke forbundet, genforbind", () => {
    expect(
      evaluateStream({
        open: true,
        lastSignalAt: now - REALTIME_STALE_AFTER_MS - 1,
        lastSub: "ok",
        now,
      }),
    ).toEqual({ connected: false, reconnect: true });
  });

  it("serverens abonnent nede → hurtig polling, men ingen genforbindelse", () => {
    expect(
      evaluateStream({
        open: true,
        lastSignalAt: now - 1_000,
        lastSub: "down",
        now,
      }),
    ).toEqual({ connected: false, reconnect: false });
  });

  it("lige åbnet uden ping endnu → forbundet (open tæller som signal)", () => {
    expect(
      evaluateStream({ open: true, lastSignalAt: now, lastSub: null, now }),
    ).toEqual({ connected: true, reconnect: false });
  });
});
