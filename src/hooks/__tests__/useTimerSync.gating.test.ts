import { describe, expect, it } from "vitest";
import { shouldWatchdogAutoPause } from "@/lib/timer/idle";
import { mergeIdleStamp } from "@/lib/timer/idle-stamp-channel";
import {
  requestTabOwnership,
  shouldSendBackgroundTimerWrite,
} from "@/lib/timer/tab-owner";
import {
  FakeLockManager,
  tick,
} from "../../lib/timer/__tests__/fake-lock-manager";

/**
 * useTimerSync er en stor "use client"-hook bundet til tRPC/Zustand, og
 * repoet har ingen jsdom/React Testing Library (se useServerValue.test.ts
 * for samme mønster: ren logik testes, hooken selv er et tyndt React-lag
 * ovenpå). Testen her sammensætter de to primitiver useTimerSync bruger til
 * at gate baggrunds-skrivninger — requestTabOwnership (ejerskab via
 * Web Locks) og shouldSendBackgroundTimerWrite (gaten i syncToServer) — og
 * simulerer tre åbne faner i samme browser-profil, akkurat som i
 * bug-rapporten (extensionen starter en timer, tre web-faner adopterer den).
 */

interface SimulatedTab {
  isOwner: boolean;
  sentAdoptionWrites: number;
  sentHeartbeats: number;
  sentUserActions: number;
}

function makeTab(manager: FakeLockManager) {
  const tab: SimulatedTab = {
    isOwner: false,
    sentAdoptionWrites: 0,
    sentHeartbeats: 0,
    sentUserActions: 0,
  };
  const release = requestTabOwnership(manager, (isOwner) => {
    tab.isOwner = isOwner;
  });
  return {
    tab,
    release,
    // Svarer til syncToServer({ background: true }) kaldt fra adoptions-
    // grenen i "Set up periodic sync when timer is running".
    adoptionWrite: () => {
      if (
        shouldSendBackgroundTimerWrite({
          background: true,
          isOwner: tab.isOwner,
        })
      ) {
        tab.sentAdoptionWrites++;
      }
    },
    // Svarer til den 30s periodiske syncToServer({ background: true }).
    heartbeat: () => {
      if (
        shouldSendBackgroundTimerWrite({
          background: true,
          isOwner: tab.isOwner,
        })
      ) {
        tab.sentHeartbeats++;
      }
    },
    // Svarer til et eksplicit brugerkald (stop/claim/pause) — aldrig gated.
    userAction: () => {
      if (
        shouldSendBackgroundTimerWrite({
          background: false,
          isOwner: tab.isOwner,
        })
      ) {
        tab.sentUserActions++;
      }
    },
  };
}

describe("useTimerSync-gating: tre faner, én ejer", () => {
  it("alle tre faner forsøger at adoptere — kun ejeren sender adoption-writen", () => {
    const manager = new FakeLockManager();
    const tab1 = makeTab(manager);
    const tab2 = makeTab(manager);
    const tab3 = makeTab(manager);

    // Extensionen starter en timer; alle tre faners reconcile adopterer
    // serverens tilstand til visning og forsøger at tage ejerskab.
    tab1.adoptionWrite();
    tab2.adoptionWrite();
    tab3.adoptionWrite();

    expect(tab1.tab.sentAdoptionWrites).toBe(1);
    expect(tab2.tab.sentAdoptionWrites).toBe(0);
    expect(tab3.tab.sentAdoptionWrites).toBe(0);
  });

  it("kun ejerens 30s-heartbeat rammer serveren — ingen version_conflict fra de to andre", () => {
    const manager = new FakeLockManager();
    const tab1 = makeTab(manager);
    const tab2 = makeTab(manager);
    const tab3 = makeTab(manager);

    for (let i = 0; i < 3; i++) {
      tab1.heartbeat();
      tab2.heartbeat();
      tab3.heartbeat();
    }

    expect(tab1.tab.sentHeartbeats).toBe(3);
    expect(tab2.tab.sentHeartbeats).toBe(0);
    expect(tab3.tab.sentHeartbeats).toBe(0);
  });

  it("en ikke-ejer-fane kan stadig stoppe/pause timeren (brugerhandling går uden om gaten)", () => {
    const manager = new FakeLockManager();
    const tab1 = makeTab(manager); // bliver ejer
    const tab2 = makeTab(manager); // ikke-ejer

    expect(tab1.tab.isOwner).toBe(true);
    expect(tab2.tab.isOwner).toBe(false);

    tab2.userAction();
    expect(tab2.tab.sentUserActions).toBe(1);
  });

  it("ejerskabet går videre uden hul, når ejer-fanen lukkes — næste fane heartbeater straks", async () => {
    const manager = new FakeLockManager();
    const tab1 = makeTab(manager);
    const tab2 = makeTab(manager);

    tab1.release();
    await tick();

    expect(tab2.tab.isOwner).toBe(true);
    tab2.heartbeat();
    expect(tab2.tab.sentHeartbeats).toBe(1);
  });
});

describe("TimerEnhancements-gating: idle-auto-pause fra én fane", () => {
  const idleAt = new Date("2026-10-27T08:00:00Z").getTime();
  const twoHoursLater = idleAt + 125 * 60_000;
  const settings = { thresholdMinutes: 5, autoPauseAfterMinutes: 120 };

  // Svarer til vagthundens 30s-tik i TimerEnhancements, der kører i alle
  // åbne faner med hver sin kopi af idle-stemplet.
  function watchdogTick(tab: SimulatedTab, nowMs: number) {
    return shouldWatchdogAutoPause({
      ...settings,
      idleDetectedAtMs: idleAt,
      nowMs,
      isOwner: tab.isOwner,
    });
  }

  it("tre faner over den hårde grænse: kun ejeren pauser", () => {
    const manager = new FakeLockManager();
    const tabs = [makeTab(manager), makeTab(manager), makeTab(manager)];
    const pauses = tabs.map((t) => watchdogTick(t.tab, twoHoursLater));
    expect(pauses).toEqual([true, false, false]);
  });

  it("under grænsen pauser heller ikke ejeren", () => {
    const manager = new FakeLockManager();
    const owner = makeTab(manager);
    expect(watchdogTick(owner.tab, idleAt + 30 * 60_000)).toBe(false);
  });

  it("lukkes ejer-fanen, pauser den næste fane i stedet", async () => {
    const manager = new FakeLockManager();
    const tab1 = makeTab(manager);
    const tab2 = makeTab(manager);
    expect(watchdogTick(tab2.tab, twoHoursLater)).toBe(false);
    tab1.release();
    await tick();
    expect(watchdogTick(tab2.tab, twoHoursLater)).toBe(true);
  });

  it("ejer-fanen er skjult og så aldrig inaktiviteten: den pauser med den synlige fanes stempel", () => {
    const manager = new FakeLockManager();
    const owner = makeTab(manager); // skjult, ingen egen idle-registrering
    const visible = makeTab(manager); // brugeren gik fra denne fane
    let ownerStamp: number | null = null;
    // Den synlige fane registrerer inaktiviteten og deler stemplet.
    ownerStamp = mergeIdleStamp(ownerStamp, idleAt);
    const ownerPauses = shouldWatchdogAutoPause({
      ...settings,
      idleDetectedAtMs: ownerStamp,
      nowMs: twoHoursLater,
      isOwner: owner.tab.isOwner,
    });
    expect(ownerPauses).toBe(true);
    expect(watchdogTick(visible.tab, twoHoursLater)).toBe(false);
  });

  it("brugerens svar i dialogen sendes stadig fra en ikke-ejer-fane", () => {
    const manager = new FakeLockManager();
    makeTab(manager);
    const other = makeTab(manager);
    other.userAction();
    expect(other.tab.sentUserActions).toBe(1);
  });
});
