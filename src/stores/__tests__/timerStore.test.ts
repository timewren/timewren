import { beforeEach, describe, expect, it } from "vitest";
import { isGenuinePause, useTimerStore } from "../timerStore";

describe("timerStore — fortsat postering og kundeskift", () => {
  beforeEach(() => {
    useTimerStore.getState().resetTimer();
  });

  it("binder tiden til den fortsatte postering", () => {
    useTimerStore.getState().continueEntry({
      entryId: "entry-a",
      clientId: "client-a",
      projectId: "project-a",
      description: "Arbejde for A",
      hours: 1,
    });

    const state = useTimerStore.getState();
    expect(state.continuingEntryId).toBe("entry-a");
    expect(state.clientId).toBe("client-a");
    // Den oprindelige posts timer bæres SEPARAT — den nye session starter
    // på 0 og sendes uden base til serveren (ellers viser extensionen et
    // tidsspring og kan gemme gammel+ny tid som en ny post).
    expect(state.continuingEntryHours).toBe(1);
    expect(state.elapsedTime).toBe(0);
    expect(state.baseTime).toBe(0);
    expect(state.isRunning).toBe(true);
  });

  it("resetTimer og stopTimer rydder den fortsatte posts timer", () => {
    useTimerStore.getState().continueEntry({
      entryId: "entry-a",
      clientId: "client-a",
      description: "Arbejde for A",
      hours: 2.5,
    });
    useTimerStore.getState().stopTimer();
    expect(useTimerStore.getState().continuingEntryHours).toBe(0);

    useTimerStore.getState().continueEntry({
      entryId: "entry-a",
      clientId: "client-a",
      description: "Arbejde for A",
      hours: 2.5,
    });
    useTimerStore.getState().resetTimer();
    expect(useTimerStore.getState().continuingEntryHours).toBe(0);
  });

  it("dropper bindingen når kunden skiftes undervejs (kunde A 28/8)", () => {
    useTimerStore.getState().continueEntry({
      entryId: "entry-a",
      clientId: "client-a",
      projectId: "project-a",
      description: "Arbejde for A",
      hours: 1,
    });

    useTimerStore.getState().updateProject("project-b", "client-b");

    const state = useTimerStore.getState();
    expect(state.continuingEntryId).toBeNull();
    expect(state.clientId).toBe("client-b");
    // Den oprindelige posts time bliver på kunde A — kun sessionens egen tid
    // gemmes som en NY postering på kunde B (ingen dobbelttælling).
    expect(state.continuingEntryHours).toBe(0);
    expect(state.elapsedTime).toBe(0);
  });

  it("beholder bindingen når kun projektet skiftes på samme kunde", () => {
    useTimerStore.getState().continueEntry({
      entryId: "entry-a",
      clientId: "client-a",
      projectId: "project-a",
      description: "Arbejde for A",
      hours: 1,
    });

    useTimerStore.getState().updateProject("project-a2", "client-a");

    const state = useTimerStore.getState();
    expect(state.continuingEntryId).toBe("entry-a");
    expect(state.continuingEntryHours).toBe(1);
    expect(state.projectId).toBe("project-a2");
  });

  it("dropper også segment-bindingen ved kundeskift", () => {
    useTimerStore.getState().resumeAsSegment({
      entryId: "entry-a",
      clientId: "client-a",
      projectId: "project-a",
      description: "Arbejde for A",
    });

    useTimerStore.getState().updateProject("", "client-b");

    expect(useTimerStore.getState().resumeEntryId).toBeNull();
  });
});

describe("isGenuinePause — pauset tid må ikke følge med til en anden kunde", () => {
  it("er sand for en brugerpause med tid og sessionStartTime", () => {
    expect(
      isGenuinePause({
        isRunning: false,
        elapsedTime: 3600,
        baseTime: 3600,
        sessionStartTime: Date.now() - 3600_000,
      }),
    ).toBe(true);
  });

  it("er falsk for en parkeret rest uden sessionStartTime (allerede gemt)", () => {
    expect(
      isGenuinePause({
        isRunning: false,
        elapsedTime: 3600,
        baseTime: 3600,
        sessionStartTime: null,
      }),
    ).toBe(false);
  });

  it("er falsk når timeren kører eller er tom", () => {
    expect(
      isGenuinePause({
        isRunning: true,
        elapsedTime: 10,
        baseTime: 0,
        sessionStartTime: Date.now(),
      }),
    ).toBe(false);
    expect(
      isGenuinePause({
        isRunning: false,
        elapsedTime: 0,
        baseTime: 0,
        sessionStartTime: Date.now(),
      }),
    ).toBe(false);
  });
});

describe("timerStore.addMinutes — quick-add skal kunne stables", () => {
  beforeEach(() => {
    useTimerStore.getState().resetTimer();
  });

  it("lægger tre klik på +15 sammen til 45 minutter", () => {
    const { addMinutes } = useTimerStore.getState();
    addMinutes(15);
    addMinutes(15);
    addMinutes(15);

    const state = useTimerStore.getState();
    expect(state.elapsedTime).toBe(45 * 60);
    // baseTime bærer tiden, så den overlever ticks og sendes med ved sync
    expect(state.baseTime).toBe(45 * 60);
  });

  it("stabler forskellige beløb", () => {
    const { addMinutes } = useTimerStore.getState();
    addMinutes(5);
    addMinutes(10);
    addMinutes(30);

    expect(useTimerStore.getState().elapsedTime).toBe(45 * 60);
  });

  it("stabler oven på eksisterende tid uden at miste bindingen", () => {
    useTimerStore.getState().continueEntry({
      entryId: "entry-a",
      clientId: "client-a",
      projectId: "project-a",
      description: "Arbejde for A",
      hours: 1,
    });

    useTimerStore.getState().addMinutes(15);
    useTimerStore.getState().addMinutes(15);

    const state = useTimerStore.getState();
    expect(state.elapsedTime).toBe(30 * 60);
    expect(state.continuingEntryHours).toBe(1);
    expect(state.continuingEntryId).toBe("entry-a");
  });
});
