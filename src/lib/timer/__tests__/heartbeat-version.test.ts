import { describe, expect, it } from "vitest";
import {
  heartbeatExpectedVersion,
  isHeartbeatVersionConflict,
  normalizeDetails,
} from "../heartbeat-version";

const Y = normalizeDetails({ clientId: "client-y", description: "Møde" });
const X = normalizeDetails({ clientId: "client-x", description: "Møde" });

const base = {
  isRunning: true,
  isFreshStart: false,
  isAdoption: false,
  sessionEstablished: true,
  lastServerDetails: Y,
  local: Y,
  serverVersion: 7,
};

describe("heartbeatExpectedVersion", () => {
  it("et rent keep-alive sender den kendte version", () => {
    expect(heartbeatExpectedVersion(base)).toBe(7);
  });

  it("en lokal ændring sendes ubetinget, så den ikke tabes", () => {
    expect(heartbeatExpectedVersion({ ...base, local: X })).toBeUndefined();
  });

  it("fresh start, adoption, pause og uetableret session er ubetingede", () => {
    expect(
      heartbeatExpectedVersion({ ...base, isFreshStart: true }),
    ).toBeUndefined();
    expect(
      heartbeatExpectedVersion({ ...base, isAdoption: true }),
    ).toBeUndefined();
    expect(
      heartbeatExpectedVersion({ ...base, isRunning: false }),
    ).toBeUndefined();
    expect(
      heartbeatExpectedVersion({ ...base, sessionEstablished: false }),
    ).toBeUndefined();
  });

  it("ukendt serverstand sender ingen version", () => {
    expect(
      heartbeatExpectedVersion({ ...base, lastServerDetails: null }),
    ).toBeUndefined();
    expect(
      heartbeatExpectedVersion({ ...base, serverVersion: 0 }),
    ).toBeUndefined();
  });

  it("en afvigende opgave slår ikke versionstjekket fra", () => {
    expect(
      heartbeatExpectedVersion({
        ...base,
        lastServerDetails: { ...Y, taskId: "task-1" },
      }),
    ).toBe(7);
  });

  it("tom streng og null for ids behandles ens", () => {
    expect(
      heartbeatExpectedVersion({
        ...base,
        local: normalizeDetails({
          projectId: "",
          clientId: "client-y",
          description: "Møde",
        }),
      }),
    ).toBe(7);
  });
});

describe("isHeartbeatVersionConflict", () => {
  it("samme kilde og stadig kørende = versionskonflikt", () => {
    expect(
      isHeartbeatVersionConflict({
        expectedVersion: 7,
        current: { isRunning: true, lastSyncedFrom: "web" },
        source: "web",
      }),
    ).toBe(true);
  });

  it("en anden ejer er ikke en versionskonflikt (already_running)", () => {
    expect(
      isHeartbeatVersionConflict({
        expectedVersion: 7,
        current: { isRunning: true, lastSyncedFrom: "extension" },
        source: "web",
      }),
    ).toBe(false);
  });

  it("stoppet række eller intet versionstjek = ikke en konflikt", () => {
    expect(
      isHeartbeatVersionConflict({
        expectedVersion: 7,
        current: { isRunning: false, lastSyncedFrom: "web" },
        source: "web",
      }),
    ).toBe(false);
    expect(
      isHeartbeatVersionConflict({
        expectedVersion: undefined,
        current: { isRunning: true, lastSyncedFrom: "web" },
        source: "web",
      }),
    ).toBe(false);
  });
});
