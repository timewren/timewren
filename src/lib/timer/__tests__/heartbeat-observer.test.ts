import { describe, expect, it } from "vitest";
import {
  isPureKeepAlive,
  OWNER_STALE_MS,
  observerKeepAliveDecision,
  sawOwnerActivity,
} from "../heartbeat-observer";

const A = {
  projectId: "p1",
  clientId: "c1",
  taskId: null,
  description: "",
};

describe("isPureKeepAlive", () => {
  const base = {
    isRunning: true,
    isFreshStart: false,
    sessionEstablished: true,
    lastServerDetails: A,
    local: A,
    hasUnsyncedSelection: false,
  };

  it("en kørende, etableret session med serverens detaljer er et rent keep-alive", () => {
    expect(isPureKeepAlive(base)).toBe(true);
  });

  it("en lokal ændring er ikke et keep-alive", () => {
    expect(
      isPureKeepAlive({ ...base, local: { ...A, description: "møde" } }),
    ).toBe(false);
    expect(isPureKeepAlive({ ...base, local: { ...A, clientId: "c2" } })).toBe(
      false,
    );
    expect(isPureKeepAlive({ ...base, hasUnsyncedSelection: true })).toBe(
      false,
    );
  });

  it("pause, fresh start, ikke-etableret session og ukendt serverstand sendes altid", () => {
    expect(isPureKeepAlive({ ...base, isRunning: false })).toBe(false);
    expect(isPureKeepAlive({ ...base, isFreshStart: true })).toBe(false);
    expect(isPureKeepAlive({ ...base, sessionEstablished: false })).toBe(false);
    expect(isPureKeepAlive({ ...base, lastServerDetails: null })).toBe(false);
  });
});

describe("observerKeepAliveDecision", () => {
  const now = 1_000_000_000;

  it("ikke observatør: skriv som normalt", () => {
    expect(
      observerKeepAliveDecision({
        observer: false,
        pureKeepAlive: true,
        ownerSeenAt: now,
        now,
      }),
    ).toBe("send");
  });

  it("observatør med en levende ejer springer keep-alive over", () => {
    expect(
      observerKeepAliveDecision({
        observer: true,
        pureKeepAlive: true,
        ownerSeenAt: now - OWNER_STALE_MS + 1,
        now,
      }),
    ).toBe("skip");
  });

  it("observatør der ændrer noget lokalt, skriver", () => {
    expect(
      observerKeepAliveDecision({
        observer: true,
        pureKeepAlive: false,
        ownerSeenAt: now,
        now,
      }),
    ).toBe("send");
  });

  it("ejeren ikke set i 2 min: afstem og afgør igen", () => {
    expect(OWNER_STALE_MS).toBe(120_000);
    expect(
      observerKeepAliveDecision({
        observer: true,
        pureKeepAlive: true,
        ownerSeenAt: now - OWNER_STALE_MS,
        now,
      }),
    ).toBe("check-owner");
  });
});

describe("sawOwnerActivity", () => {
  it("en ny version er en fremmed skrivning", () => {
    expect(
      sawOwnerActivity({
        prevVersion: 19800,
        version: 19801,
        prevLastSyncedAt: null,
        lastSyncedAt: null,
      }),
    ).toBe(true);
  });

  it("en ny lastSyncedAt er en fremmed skrivning", () => {
    expect(
      sawOwnerActivity({
        prevVersion: 5,
        version: 5,
        prevLastSyncedAt: 1000,
        lastSyncedAt: 31000,
      }),
    ).toBe(true);
  });

  it("uændret række: ejeren er ikke set", () => {
    expect(
      sawOwnerActivity({
        prevVersion: 5,
        version: 5,
        prevLastSyncedAt: 1000,
        lastSyncedAt: 1000,
      }),
    ).toBe(false);
    expect(
      sawOwnerActivity({
        prevVersion: 5,
        version: undefined,
        prevLastSyncedAt: null,
        lastSyncedAt: 1000,
      }),
    ).toBe(false);
  });
});
