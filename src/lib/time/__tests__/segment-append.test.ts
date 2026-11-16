import { describe, expect, it } from "vitest";
import { planSegmentAppend } from "../segment-append";

const at = (iso: string) => new Date(iso);

describe("planSegmentAppend (review P2 / A2 P1-4)", () => {
  it("efter Fortsæt: retro-segmentet bygges af postens timer, ikke start→slut-spændet", () => {
    // Fortsæt beholdt start 09:00, satte slut 13:00 og hours = 2 (pausen
    // 10-12 er ikke arbejdet). Spændet er 4 t — det må ikke blive timerne.
    const plan = planSegmentAppend({
      entryHours: 2,
      entryStartTime: at("2026-10-02T09:00:00Z"),
      entryEndTime: at("2026-10-02T13:00:00Z"),
      hasSegments: false,
      newStart: at("2026-10-02T14:00:00Z"),
      newEnd: at("2026-10-02T14:30:00Z"),
    });
    expect(plan.retroSegment).toEqual({
      startTime: at("2026-10-02T11:00:00Z"),
      endTime: at("2026-10-02T13:00:00Z"),
      durationMinutes: 120,
    });
    expect(plan.newHours).toBe(2.5);
  });

  it("manuelt rettede timer: forrige timer + nyt segment", () => {
    const plan = planSegmentAppend({
      entryHours: 1.33,
      entryStartTime: at("2026-10-02T09:00:00Z"),
      entryEndTime: at("2026-10-02T12:00:00Z"),
      hasSegments: true,
      newStart: at("2026-10-02T14:00:00Z"),
      newEnd: at("2026-10-02T14:45:00Z"),
    });
    expect(plan.retroSegment).toBeNull();
    expect(plan.newHours).toBe(2.08);
  });

  it("manuel post uden klokkeslæt: retro-segment slutter hvor det nye begynder", () => {
    const plan = planSegmentAppend({
      entryHours: 1,
      entryStartTime: null,
      entryEndTime: null,
      hasSegments: false,
      newStart: at("2026-10-02T14:00:00Z"),
      newEnd: at("2026-10-02T15:00:00Z"),
    });
    expect(plan.retroSegment).toEqual({
      startTime: at("2026-10-02T13:00:00Z"),
      endTime: at("2026-10-02T14:00:00Z"),
      durationMinutes: 60,
    });
    expect(plan.newHours).toBe(2);
  });

  it("post uden timer: intet retro-segment", () => {
    const plan = planSegmentAppend({
      entryHours: 0,
      entryStartTime: null,
      entryEndTime: null,
      hasSegments: false,
      newStart: at("2026-10-02T14:00:00Z"),
      newEnd: at("2026-10-02T14:20:00Z"),
    });
    expect(plan.retroSegment).toBeNull();
    expect(plan.newHours).toBe(0.33);
  });
});
