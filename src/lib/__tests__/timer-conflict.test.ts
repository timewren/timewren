import { describe, expect, it } from "vitest";
import {
  isCrossClientTimerConflict,
  timerConflictLocation,
} from "@/lib/timer-conflict";

describe("isCrossClientTimerConflict", () => {
  it("blocks a fresh start when a different client is already running", () => {
    const running = { isRunning: true, lastSyncedFrom: "extension" };
    expect(isCrossClientTimerConflict(running, "web")).toBe(true);
  });

  it("allows the same client to resume/heartbeat its own running timer", () => {
    const running = { isRunning: true, lastSyncedFrom: "web" };
    expect(isCrossClientTimerConflict(running, "web")).toBe(false);
  });

  it("does not block when no timer is running", () => {
    const stopped = { isRunning: false, lastSyncedFrom: "extension" };
    expect(isCrossClientTimerConflict(stopped, "web")).toBe(false);
  });

  it("does not block when there is no timer state", () => {
    expect(isCrossClientTimerConflict(null, "web")).toBe(false);
    expect(isCrossClientTimerConflict(undefined, "web")).toBe(false);
  });

  it("does not block when lastSyncedFrom is unknown (null)", () => {
    const running = { isRunning: true, lastSyncedFrom: null };
    expect(isCrossClientTimerConflict(running, "web")).toBe(false);
  });

  it("blocks the extension when the web app owns the running timer", () => {
    const running = { isRunning: true, lastSyncedFrom: "web" };
    expect(isCrossClientTimerConflict(running, "extension")).toBe(true);
  });
});

describe("timerConflictLocation", () => {
  it("labels a web-owned timer", () => {
    expect(timerConflictLocation("web")).toBe("i web-appen");
  });

  it("labels any non-web source as another device", () => {
    expect(timerConflictLocation("extension")).toBe("på en anden enhed");
    expect(timerConflictLocation("mobile")).toBe("på en anden enhed");
    expect(timerConflictLocation(null)).toBe("på en anden enhed");
  });
});
