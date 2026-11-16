import { describe, expect, it } from "vitest";
import {
  decideAlreadyRunningAction,
  decidePersistedRunningOnMount,
  shouldAcceptMirrorReanchor,
  shouldHoldUnsyncedSelection,
} from "../reconcile";

describe("decideAlreadyRunningAction", () => {
  it("nulstiller ALDRIG på et heartbeat (#589)", () => {
    expect(
      decideAlreadyRunningAction({ isFreshStart: false, baseTime: 0 }),
    ).toBe("adopt");
    expect(
      decideAlreadyRunningAction({ isFreshStart: false, baseTime: 5400 }),
    ).toBe("adopt");
  });

  it("parkerer en blokeret genoptagelse så den pausede tid bevares", () => {
    expect(
      decideAlreadyRunningAction({ isFreshStart: true, baseTime: 5400 }),
    ).toBe("park-paused");
  });

  it("nulstiller kun en blokeret, helt frisk start", () => {
    expect(
      decideAlreadyRunningAction({ isFreshStart: true, baseTime: 0 }),
    ).toBe("reset");
  });
});

// Den præcise sekvens bag extension-quick-add (#595): extensionen lægger
// minutter på en timer, web'en også kender. Før #589-fixet nulstillede
// web-heartbeatet timeren umiddelbart efter — "timeren starter forfra".
describe("extension quick-add → web reconcile", () => {
  it("nulstiller ikke web-timeren når heartbeatet blokeres efter et quick-add", () => {
    // Quick-add sendes uden isRunning, så ejerskabet burde slet ikke skifte.
    // Skulle det alligevel blive blokeret (fx et samtidigt pause/genoptag fra
    // extensionen), er heartbeatets svar stadig "adoptér", aldrig "reset".
    expect(
      decideAlreadyRunningAction({ isFreshStart: false, baseTime: 0 }),
    ).toBe("adopt");
  });

  it("accepterer at serverens elapsed er HØJERE efter et quick-add", () => {
    // +15 min fra extensionen: serveren er 900 s foran. Fremadrettede spring
    // skal altid igennem, uanset hvem der sidst skrev.
    expect(
      shouldAcceptMirrorReanchor({
        localElapsed: 600,
        serverElapsed: 600 + 15 * 60,
        lastSyncedFrom: "extension",
      }),
    ).toBe(true);
    expect(
      shouldAcceptMirrorReanchor({
        localElapsed: 600,
        serverElapsed: 600 + 15 * 60,
        lastSyncedFrom: "web",
      }),
    ).toBe(true);
  });
});

describe("shouldAcceptMirrorReanchor", () => {
  it("accepterer altid fremadrettede spring", () => {
    expect(
      shouldAcceptMirrorReanchor({
        localElapsed: 100,
        serverElapsed: 400,
        lastSyncedFrom: "web",
      }),
    ).toBe(true);
  });

  it("afviser tilbagespring fra webbens egen skrivning", () => {
    expect(
      shouldAcceptMirrorReanchor({
        localElapsed: 900,
        serverElapsed: 600,
        lastSyncedFrom: "web",
      }),
    ).toBe(false);
  });

  it("accepterer tilbagespring fra en anden kilde", () => {
    expect(
      shouldAcceptMirrorReanchor({
        localElapsed: 900,
        serverElapsed: 600,
        lastSyncedFrom: "extension",
      }),
    ).toBe(true);
  });

  it("accepterer tilbagespring når ejerskabet er ukendt", () => {
    expect(
      shouldAcceptMirrorReanchor({
        localElapsed: 900,
        serverElapsed: 600,
        lastSyncedFrom: null,
      }),
    ).toBe(true);
  });
});

describe("decidePersistedRunningOnMount (genindlæst kørende timer)", () => {
  const clearedAt = "2026-10-01T07:34:10.000Z";
  const cleared = {
    isRunning: false,
    elapsedSeconds: 0,
    baseSeconds: 0,
    intent: null,
    lastSyncedAt: clearedAt,
  };

  it("serveren kører → adoptér serverens timer (aldrig fresh start)", () => {
    expect(
      decidePersistedRunningOnMount({
        server: { ...cleared, isRunning: true },
        localStartTime: Date.parse("2026-10-01T07:02:54Z"),
      }),
    ).toBe("adopt-server");
  });

  it("serveren er ryddet EFTER den lokale start → smid den lokale kopi (kunde A)", () => {
    expect(
      decidePersistedRunningOnMount({
        server: cleared,
        localStartTime: Date.parse("2026-10-01T07:02:54Z"),
      }),
    ).toBe("drop-local");
  });

  it("lokal start EFTER sidste rydning (starten nåede aldrig frem) → etablér igen", () => {
    expect(
      decidePersistedRunningOnMount({
        server: cleared,
        localStartTime: Date.parse("2026-10-01T08:00:00Z"),
      }),
    ).toBe("re-establish");
  });

  it("ingen række på serveren → etablér igen", () => {
    expect(
      decidePersistedRunningOnMount({
        server: { ...cleared, lastSyncedAt: null },
        localStartTime: Date.parse("2026-10-01T07:02:54Z"),
      }),
    ).toBe("re-establish");
  });

  it("pauset eller midt i et stop → den almindelige afstemning tager over", () => {
    expect(
      decidePersistedRunningOnMount({
        server: { ...cleared, baseSeconds: 600, elapsedSeconds: 600 },
        localStartTime: Date.parse("2026-10-01T07:02:54Z"),
      }),
    ).toBe("defer");
    expect(
      decidePersistedRunningOnMount({
        server: { ...cleared, isRunning: true, intent: "stopping" },
        localStartTime: Date.parse("2026-10-01T07:02:54Z"),
      }),
    ).toBe("defer");
  });
});

describe("shouldHoldUnsyncedSelection (kundeskift på kørende timer)", () => {
  const local = { projectId: "p-b", clientId: "c-b" };

  it("en lokal kundeændring der ikke er synket endnu, må ikke rulles tilbage af serverens gamle kunde", () => {
    expect(
      shouldHoldUnsyncedSelection({
        unsynced: { projectId: "p-b", clientId: "c-b" },
        local,
        server: { projectId: "p-a", clientId: "c-a" },
      }),
    ).toBe(true);
  });

  it("intet at holde når ændringen er synket", () => {
    expect(
      shouldHoldUnsyncedSelection({
        unsynced: null,
        local,
        server: { projectId: "p-a", clientId: "c-a" },
      }),
    ).toBe(false);
  });

  it("intet at holde når serveren allerede har den nye kunde", () => {
    expect(
      shouldHoldUnsyncedSelection({
        unsynced: { projectId: "p-b", clientId: "c-b" },
        local,
        server: { projectId: "p-b", clientId: "c-b" },
      }),
    ).toBe(false);
  });

  it("intet at holde når den lokale tilstand siden er ændret igen", () => {
    expect(
      shouldHoldUnsyncedSelection({
        unsynced: { projectId: "p-b", clientId: "c-b" },
        local: { projectId: null, clientId: "c-c" },
        server: { projectId: "p-a", clientId: "c-a" },
      }),
    ).toBe(false);
  });

  it("tomme værdier sammenlignes som null", () => {
    expect(
      shouldHoldUnsyncedSelection({
        unsynced: { projectId: null, clientId: "c-b" },
        local: { projectId: "", clientId: "c-b" },
        server: { projectId: undefined, clientId: "c-b" },
      }),
    ).toBe(false);
  });
});
