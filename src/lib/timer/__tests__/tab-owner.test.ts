import { describe, expect, it, vi } from "vitest";
import {
  createSharedTabOwnership,
  hasWebLocksSupport,
  requestTabOwnership,
  shouldSendBackgroundTimerWrite,
  shouldTakeOverOnHandover,
} from "../tab-owner";
import { FakeLockManager, tick } from "./fake-lock-manager";

describe("hasWebLocksSupport", () => {
  it("false uden navigator (SSR)", () => {
    expect(hasWebLocksSupport(undefined)).toBe(false);
  });

  it("false uden locks-egenskab (gammel browser)", () => {
    expect(hasWebLocksSupport({})).toBe(false);
  });

  it("true når navigator.locks.request findes", () => {
    expect(hasWebLocksSupport({ locks: new FakeLockManager() })).toBe(true);
  });
});

describe("requestTabOwnership — tre faner om samme lås", () => {
  it("kun den første fane bliver ejer med det samme", () => {
    const manager = new FakeLockManager();
    const tab1 = vi.fn();
    const tab2 = vi.fn();
    const tab3 = vi.fn();

    requestTabOwnership(manager, tab1);
    requestTabOwnership(manager, tab2);
    requestTabOwnership(manager, tab3);

    expect(tab1).toHaveBeenCalledWith(true, expect.any(Boolean));
    expect(tab2).not.toHaveBeenCalled();
    expect(tab3).not.toHaveBeenCalled();
  });

  it("ejerskab går videre til næste ventende fane, når ejeren frigiver (lukning/navigation)", async () => {
    const manager = new FakeLockManager();
    const tab1 = vi.fn();
    const tab2 = vi.fn();
    const tab3 = vi.fn();

    const release1 = requestTabOwnership(manager, tab1);
    const release2 = requestTabOwnership(manager, tab2);
    requestTabOwnership(manager, tab3);

    release1();
    await tick();
    expect(tab1).toHaveBeenCalledWith(false);
    expect(tab2).toHaveBeenCalledWith(true, expect.any(Boolean));
    expect(tab3).not.toHaveBeenCalled();

    release2();
    await tick();
    expect(tab3).toHaveBeenCalledWith(true, expect.any(Boolean));
  });

  it("en fane der frigiver mens den stadig venter i køen, bliver aldrig ejer og springes over", async () => {
    const manager = new FakeLockManager();
    const tab1 = vi.fn();
    const tab2 = vi.fn();
    const tab3 = vi.fn();

    const release1 = requestTabOwnership(manager, tab1);
    const release2 = requestTabOwnership(manager, tab2);
    requestTabOwnership(manager, tab3);

    release2();
    await tick();
    expect(tab2).not.toHaveBeenCalledWith(true, expect.any(Boolean));

    release1();
    await tick();
    expect(tab3).toHaveBeenCalledWith(true, expect.any(Boolean));
    expect(tab2).not.toHaveBeenCalledWith(true, expect.any(Boolean));
  });
});

describe("requestTabOwnership — unmount uden at dokumentet destrueres", () => {
  it("en ejer der afmelder (React strict mode, remount) slipper låsen og kan blive ejer igen", async () => {
    const manager = new FakeLockManager();
    const first = vi.fn();
    const second = vi.fn();

    const release = requestTabOwnership(manager, first);
    expect(first).toHaveBeenCalledWith(true, expect.any(Boolean));

    release();
    requestTabOwnership(manager, second);
    await tick();
    expect(second).toHaveBeenCalledWith(true, expect.any(Boolean));
  });
});

describe("requestTabOwnership — ejer fra start eller ved overdragelse", () => {
  it("en fri lås giver ejerskab uden overdragelse; den ventende fane får det som overdragelse", async () => {
    const manager = new FakeLockManager();
    const tab1 = vi.fn();
    const tab2 = vi.fn();

    const release1 = requestTabOwnership(manager, tab1);
    requestTabOwnership(manager, tab2);
    expect(tab1).toHaveBeenCalledWith(true, false);

    release1();
    await tick();
    expect(tab2).toHaveBeenCalledWith(true, true);
  });
});

describe("shouldTakeOverOnHandover", () => {
  it("genindlæsning af eneste fane med kørende timer er ikke en overtagelse", () => {
    expect(
      shouldTakeOverOnHandover({
        handover: false,
        isRunning: true,
        pendingMountReconcile: true,
      }),
    ).toBe(false);
    expect(
      shouldTakeOverOnHandover({
        handover: false,
        isRunning: true,
        pendingMountReconcile: false,
      }),
    ).toBe(false);
  });

  it("overdragelse midt i mount-afstemningen venter på afstemningen", () => {
    expect(
      shouldTakeOverOnHandover({
        handover: true,
        isRunning: true,
        pendingMountReconcile: true,
      }),
    ).toBe(false);
  });

  it("overdragelse med kørende timer efter afstemning overtager; uden timer intet", () => {
    expect(
      shouldTakeOverOnHandover({
        handover: true,
        isRunning: true,
        pendingMountReconcile: false,
      }),
    ).toBe(true);
    expect(
      shouldTakeOverOnHandover({
        handover: true,
        isRunning: false,
        pendingMountReconcile: false,
      }),
    ).toBe(false);
  });
});

describe("fallback uden Web Locks (gammel browser/SSR)", () => {
  it("ingen understøttelse betyder: alle faner er ejere (dagens adfærd)", () => {
    // Selve fallback-grenen bor i useTimerTabOwner (React-state), men
    // beslutningen den bruger er ren og testes her: ingen locks → ingen
    // koordinering, så hver fane må opfatte sig selv som ejer.
    expect(hasWebLocksSupport(undefined)).toBe(false);
    expect(
      shouldSendBackgroundTimerWrite({ background: true, isOwner: true }),
    ).toBe(true);
  });
});

describe("shouldSendBackgroundTimerWrite", () => {
  it("brugerhandlinger sendes altid, uanset ejerskab", () => {
    expect(
      shouldSendBackgroundTimerWrite({ background: false, isOwner: false }),
    ).toBe(true);
    expect(
      shouldSendBackgroundTimerWrite({ background: false, isOwner: true }),
    ).toBe(true);
  });

  it("baggrunds-skrivninger sendes kun af ejeren", () => {
    expect(
      shouldSendBackgroundTimerWrite({ background: true, isOwner: true }),
    ).toBe(true);
    expect(
      shouldSendBackgroundTimerWrite({ background: true, isOwner: false }),
    ).toBe(false);
  });
});

describe("createSharedTabOwnership — flere hooks i samme fane", () => {
  it("to anmodninger fra samme fane står i kø bag hinanden (derfor deles én)", () => {
    const manager = new FakeLockManager();
    const syncHook = vi.fn();
    const enhancementsHook = vi.fn();
    requestTabOwnership(manager, syncHook);
    requestTabOwnership(manager, enhancementsHook);
    expect(syncHook).toHaveBeenCalledWith(true, false);
    expect(enhancementsHook).not.toHaveBeenCalled();
  });

  it("alle abonnenter i fanen ser samme ejerskab fra én anmodning", async () => {
    const manager = new FakeLockManager();
    const tab1 = createSharedTabOwnership(manager);
    const tab2 = createSharedTabOwnership(manager);
    const sync1 = vi.fn();
    const enh1 = vi.fn();
    const sync2 = vi.fn();
    const offSync1 = tab1.subscribe(sync1);
    const offEnh1 = tab1.subscribe(enh1);
    tab2.subscribe(sync2);

    expect(tab1.get()).toEqual({ isOwner: true, handover: false });
    expect(tab2.get()).toEqual({ isOwner: false, handover: false });
    expect(sync2).not.toHaveBeenCalled();

    // Én af fanens hooks afmelder (fx remount): låsen holdes stadig.
    offEnh1();
    await tick();
    expect(tab1.get().isOwner).toBe(true);
    expect(tab2.get().isOwner).toBe(false);

    // Sidste abonnent afmelder: næste fane får det som overdragelse.
    offSync1();
    await tick();
    expect(tab1.get()).toEqual({ isOwner: false, handover: false });
    expect(tab2.get()).toEqual({ isOwner: true, handover: true });
    expect(sync2).toHaveBeenLastCalledWith({ isOwner: true, handover: true });
  });

  it("en fane, der abonnerer igen efter fuld afmelding, er ejer uden overdragelse", async () => {
    const manager = new FakeLockManager();
    const tab = createSharedTabOwnership(manager);
    const off = tab.subscribe(vi.fn());
    off();
    await tick();
    tab.subscribe(vi.fn());
    expect(tab.get()).toEqual({ isOwner: true, handover: false });
  });
});
