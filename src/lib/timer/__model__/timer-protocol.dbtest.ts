/**
 * MODELBASEREDE TESTS af timer-protokollen mod en RIGTIG Postgres.
 *
 * fast-check genererer tilfældige sekvenser af klient-handlinger (start,
 * heartbeat, kundeskift, pause/genoptag, stop → gem → bekræft, annullér,
 * genindlæsning, "Fortsæt", gensendte/forsinkede skrivninger, extensionens
 * offline-kø, cron-oprydning og tidsspring) for flere samtidige klienter
 * (web-faner, extension, mobil) med tabte svar og ur-skævhed — og tjekker
 * invarianterne i `sim.ts` efter hver handling. Fejler en invariant, krymper
 * fast-check sekvensen til det mindste modeksempel og skriver seed + path.
 *
 * Kører KUN med TT_DB_TESTS=1 og DATABASE_URL til en kasseret database med
 * repoets schema. Se docs/testing/timer-model-tests.md.
 *
 *   TT_MODEL_RUNS=500 TT_MODEL_SEED=random — udforsk nye sekvenser
 *   TT_MODEL_SEED=123 TT_MODEL_PATH="4:2:1" — genafspil et modeksempel
 */

import { appendFileSync } from "node:fs";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  captureEvent: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));
// Velkomstmail ved første post må ikke forsøge at sende noget
vi.mock("@/lib/email/engagement", () => ({
  sendFirstTimeEntryEmail: vi.fn(async () => undefined),
}));

import type { ClientSpec, Sim } from "./sim";
import type { TargetKey } from "./world";

/**
 * sim/world importeres først når testene faktisk kører: `@/lib/db` kaster
 * uden DATABASE_URL, og så ville filen fejle i stedet for at springe over.
 */
type Harness = typeof import("./sim") & typeof import("./world");
let h: Harness;
async function loadHarness(): Promise<void> {
  h = { ...(await import("./sim")), ...(await import("./world")) };
}

const ENABLED = process.env.TT_DB_TESTS === "1";
const NUM_RUNS = Number(process.env.TT_MODEL_RUNS ?? 150);
/**
 * Fast seed som standard, så CI kører de samme sekvenser hver gang (en rød
 * PR skyldes ændringen, ikke tilfældet). TT_MODEL_SEED=random udforsker nyt.
 */
const SEED =
  process.env.TT_MODEL_SEED === "random"
    ? undefined
    : Number(process.env.TT_MODEL_SEED ?? 20261003);
const PATH = process.env.TT_MODEL_PATH || undefined;
const MAX_COMMANDS = Number(process.env.TT_MODEL_MAX_COMMANDS ?? 30);

/** Faste ur-forskydninger (ms-skæve, så sessionsstarter aldrig kolliderer). */
const SKEWS = [0, 37_123, -53_457, 89_911, -12_345];

type Step = (sim: Sim) => Promise<void>;

class Cmd implements fc.AsyncCommand<object, Sim> {
  constructor(
    readonly label: string,
    readonly dtMs: number,
    readonly step: Step,
  ) {}
  check(): boolean {
    return true;
  }
  async run(_m: object, sim: Sim): Promise<void> {
    sim.advance(this.dtMs);
    await this.step(sim);
    await sim.checkInvariants(this.toString());
  }
  toString(): string {
    return `${this.label}+${Math.round(this.dtMs / 1000)}s`;
  }
}

function clientCommands(clients: ClientSpec[]) {
  const ci = fc.integer({ min: 0, max: clients.length - 1 });
  const lost = fc.oneof(
    { weight: 4, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  );
  const target = fc.constantFrom<TargetKey>("A", "B");
  const name = (i: number) => clients[i].id;
  const flag = (b: boolean, s: string) => (b ? `,${s}` : "");

  type Action = { client: number; label: string; step: Step };
  const actions: fc.Arbitrary<Action>[] = [
    fc.tuple(ci, target, fc.boolean(), lost).map(([i, t, q, l]) => ({
      client: i,
      label: `start(${name(i)},${t}${flag(q, "kø")}${flag(l, "tabt")})`,
      step: (s: Sim) => s.start(i, t, q, l),
    })),
    fc.tuple(ci, lost).map(([i, l]) => ({
      client: i,
      label: `heartbeat(${name(i)}${flag(l, "tabt")})`,
      step: (s: Sim) => s.heartbeat(i, l),
    })),
    fc.tuple(ci, target, lost).map(([i, t, l]) => ({
      client: i,
      label: `skift(${name(i)},${t}${flag(l, "tabt")})`,
      step: (s: Sim) => s.switchTarget(i, t, l),
    })),
    fc.tuple(ci, lost).map(([i, l]) => ({
      client: i,
      label: `pause(${name(i)}${flag(l, "tabt")})`,
      step: (s: Sim) => s.pause(i, l),
    })),
    fc.tuple(ci, lost).map(([i, l]) => ({
      client: i,
      label: `genoptag(${name(i)}${flag(l, "tabt")})`,
      step: (s: Sim) => s.resume(i, l),
    })),
    fc
      .tuple(ci, lost, lost, lost, fc.boolean(), lost)
      .map(([i, a, b, c, now, closed]) => ({
        client: i,
        label: `stop(${name(i)}${flag(now, "gem")}${flag(closed, "popup-lukket")}${flag(a, "claim-tabt")}${flag(b, "gem-tabt")}${flag(c, "confirm-tabt")})`,
        step: (s: Sim) => s.stop(i, a, b, c, now, closed),
      })),
    fc.tuple(ci, lost, lost).map(([i, a, b]) => ({
      client: i,
      label: `gem(${name(i)}${flag(a, "gem-tabt")}${flag(b, "confirm-tabt")})`,
      step: (s: Sim) => s.save(i, a, b),
    })),
    fc.tuple(ci, lost).map(([i, l]) => ({
      client: i,
      label: `annullér(${name(i)}${flag(l, "tabt")})`,
      step: (s: Sim) => s.cancelSave(i, l),
    })),
    ci.map((i) => ({
      client: i,
      label: `genindlæs(${name(i)})`,
      step: (s: Sim) => s.reload(i),
    })),
    ci.map((i) => ({
      client: i,
      label: `afstem(${name(i)})`,
      step: (s: Sim) => s.reconcileCmd(i),
    })),
    ci.map((i) => ({
      client: i,
      label: `kø-gensend(${name(i)})`,
      step: (s: Sim) => s.replay(i),
    })),
    ci.map((i) => ({
      client: i,
      label: `tøm-kø(${name(i)})`,
      step: (s: Sim) => s.flushQueue(i),
    })),
    fc.tuple(ci, lost).map(([i, l]) => ({
      client: i,
      label: `fortsæt(${name(i)}${flag(l, "tabt")})`,
      step: (s: Sim) => s.continueEntry(i, l),
    })),
    fc.tuple(ci, lost).map(([i, l]) => ({
      client: i,
      label: `hurtig-stop(${name(i)}${flag(l, "tabt")})`,
      step: (s: Sim) => s.quickStop(i, l),
    })),
  ];
  // start, heartbeat, skift, pause, genoptag, stop, gem, annullér,
  // genindlæs, afstem, gensend, tøm-kø, fortsæt, hurtig-stop
  const weights = [4, 2, 2, 1, 1, 4, 3, 1, 1, 1, 2, 1, 3, 1];
  return fc.oneof(
    ...actions.map((arbitrary, i) => ({ weight: weights[i], arbitrary })),
  );
}

function commandsFor(clients: ClientSpec[]) {
  const action = clientCommands(clients);
  const dt = fc.integer({ min: 1_000, max: 90_000 });
  const single = fc
    .tuple(action, dt)
    .map(([a, d]) => new Cmd(a.label, d, a.step));
  // To klienter på én gang — rigtig samtidighed mod databasen
  const parallel = fc.tuple(action, action, dt).map(
    ([a, b, d]) =>
      new Cmd(`samtidig[${a.label} ‖ ${b.label}]`, d, async (s) => {
        if (a.client === b.client) {
          // Samme klient gør ikke to ting på én gang
          await a.step(s);
          await b.step(s);
        } else {
          await Promise.all([a.step(s), b.step(s)]);
        }
      }),
  );
  const tick = fc
    .integer({ min: 60_000, max: 45 * 60_000 })
    .map((ms) => new Cmd(`tid`, ms, async () => {}));
  const cron = fc
    .constant(null)
    .map(() => new Cmd("cron", 1_000, (s) => s.cleanup()));
  return fc.commands(
    [...Array<typeof single>(8).fill(single), parallel, parallel, tick, cron],
    { maxCommands: MAX_COMMANDS, size: "max" },
  );
}

async function runCron(): Promise<void> {
  const { GET } = await import("@/app/api/cron/timer-cleanup/route");
  const res = await GET(
    new Request("http://model.test/api/cron/timer-cleanup", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }),
  );
  if (res.status !== 200) {
    throw new Error(`timer-cleanup svarede ${res.status}: ${await res.text()}`);
  }
}

let runNo = 0;

async function runScenario(
  specs: ClientSpec[],
  cmds: Iterable<fc.AsyncCommand<object, Sim>>,
): Promise<void> {
  runNo++;
  const fx = await h.seedFixture();
  // Hver kørsel får sin egen dag, så klippekort/poster ikke deler dato
  const clock = new h.SimClock(
    Date.UTC(2026, 9, 5, 7, 0, 0) + runNo * 86_400_000,
  );
  const sim = new h.Sim(fx, clock, specs, runCron);
  try {
    await fc.asyncModelRun(() => ({ model: {}, real: sim }), cmds);
    await sim.finish();
    if (process.env.TT_MODEL_DEBUG) {
      appendFileSync(
        process.env.TT_MODEL_DEBUG,
        `--- kørsel ${runNo} (${sim.trace.length} kald) ---\n${sim.trace.join("\n")}\n`,
      );
    }
  } catch (err) {
    if (err instanceof h.Violation) {
      err.message += `\n--- spor (sidste 40 kald) ---\n${sim.trace.slice(-40).join("\n")}`;
    }
    throw err;
  }
}

function property(specs: ClientSpec[]) {
  return fc.asyncProperty(commandsFor(specs), (cmds) =>
    runScenario(specs, cmds),
  );
}

const assertOpts = {
  numRuns: NUM_RUNS,
  seed: SEED,
  path: PATH,
  endOnFailure: false,
  verbose: 1 as const,
};

describe.skipIf(!ENABLED)("timer-protokollen — modelbaseret (Postgres)", () => {
  beforeAll(async () => {
    await loadHarness();
    vi.useFakeTimers({ toFake: ["Date"] });
    process.env.CRON_SECRET ||= "model-cron-secret";
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("to web-faner: invarianterne holder", async () => {
    await fc.assert(
      property([
        { id: "web1", kind: "web", skewMs: SKEWS[0] },
        { id: "web2", kind: "web", skewMs: SKEWS[2] },
      ]),
      assertOpts,
    );
  });

  it("web-faner + extension: invarianterne holder", async () => {
    await fc.assert(
      property([
        { id: "web1", kind: "web", skewMs: SKEWS[0] },
        { id: "web2", kind: "web", skewMs: SKEWS[1] },
        { id: "ext", kind: "ext", skewMs: SKEWS[2] },
      ]),
      assertOpts,
    );
  });

  it("to extension-instanser (2.6.0) + web: invarianterne holder", async () => {
    await fc.assert(
      property([
        { id: "web1", kind: "web", skewMs: SKEWS[3] },
        { id: "ext1", kind: "ext", skewMs: SKEWS[0] },
        { id: "ext2", kind: "ext", skewMs: SKEWS[4] },
      ]),
      assertOpts,
    );
  });

  it("web + extension 2.6.0 + ældre extension 2.5.x: invarianterne holder", async () => {
    await fc.assert(
      property([
        { id: "web1", kind: "web", skewMs: SKEWS[1] },
        { id: "ext", kind: "ext", skewMs: SKEWS[2] },
        { id: "ext25", kind: "ext", skewMs: SKEWS[3], legacy: true },
      ]),
      assertOpts,
    );
  });

  it("web + extension + mobil (Expo-app): invarianterne holder", async () => {
    await fc.assert(
      property([
        { id: "web1", kind: "web", skewMs: SKEWS[0] },
        { id: "ext", kind: "ext", skewMs: SKEWS[1] },
        { id: "mobil", kind: "mobile", skewMs: SKEWS[2] },
      ]),
      assertOpts,
    );
  });

  it("web + mobil (ny) + ældre mobil (build 5): invarianterne holder", async () => {
    await fc.assert(
      property([
        { id: "web1", kind: "web", skewMs: SKEWS[3] },
        { id: "mobil", kind: "mobile", skewMs: SKEWS[4] },
        { id: "mobil5", kind: "mobile", skewMs: SKEWS[1], legacy: true },
      ]),
      assertOpts,
    );
  });
});

/**
 * Deterministiske scenarier: KENDTE FEJL fundet af modellen (#783–#788) og
 * de rettede fejls modeksempler.
 *
 * - Rettet i fase 1 (server + web, docs/architecture/timer-sessions.md):
 *   modeksemplet er nu en almindelig test, der KRÆVER at alle invarianter
 *   holder (`expectHolds`).
 * - Kræver extension/mobil/desktop (fase 2): stadig "KENDT FEJL", der kræver
 *   bruddet. Når fase 2 retter den, bliver testen rød — vend den så til
 *   `expectHolds`, og fjern undvigelsen (`avoidKnownBugs`) i sim.ts.
 */
type ScenarioStep = [
  dtMs: number,
  label: string,
  run: (s: Sim) => Promise<void>,
];

async function scenario(
  specs: ClientSpec[],
  steps: ScenarioStep[],
): Promise<void> {
  runNo++;
  const fx = await h.seedFixture();
  const clock = new h.SimClock(
    Date.UTC(2026, 9, 5, 7, 0, 0) + runNo * 86_400_000,
  );
  const sim = new h.Sim(fx, clock, specs, runCron, false);
  try {
    for (const [dt, label, run] of steps) {
      sim.advance(dt);
      await run(sim);
      await sim.checkInvariants(label);
    }
    await sim.finish();
    if (process.env.TT_MODEL_DEBUG) {
      appendFileSync(
        process.env.TT_MODEL_DEBUG,
        `--- scenarie ---\n${sim.trace.join("\n")}\n`,
      );
    }
  } catch (err) {
    if (err instanceof h.Violation) {
      err.message += `\n--- spor ---\n${sim.trace.join("\n")}`;
    }
    throw err;
  }
}

async function expectKnownBug(
  violation: RegExp,
  specs: ClientSpec[],
  steps: ScenarioStep[],
): Promise<void> {
  await expect(scenario(specs, steps)).rejects.toThrow(violation);
}

/** Et rettet modeksempel: alle invarianter holder hele vejen. */
async function expectHolds(
  specs: ClientSpec[],
  steps: ScenarioStep[],
): Promise<void> {
  await scenario(specs, steps);
}

const web = (id: string, skewMs = 0): ClientSpec => ({
  id,
  kind: "web",
  skewMs,
});
/** Extension 2.6.0 (sessionsbevidst, fase 2) */
const ext = (id: string, skewMs = 0): ClientSpec => ({
  id,
  kind: "ext",
  skewMs,
});
/** Ældre extension 2.5.x (uden sessionId/clientOpId) */
const extLegacy = (id: string, skewMs = 0): ClientSpec => ({
  id,
  kind: "ext",
  skewMs,
  legacy: true,
});
/** Scenarier med en extension køres for både 2.6.0 og 2.5.x */
const EXT_VERSIONS = [
  ["2.6.0", ext],
  ["2.5.x", extLegacy],
] as const;
/** Expo-appen med sessioner (timetrack-app#18) */
const mobil = (id: string, skewMs = 0): ClientSpec => ({
  id,
  kind: "mobile",
  skewMs,
});
/** Ældre Expo-app (build 4/5, uden sessionId) */
const mobilLegacy = (id: string, skewMs = 0): ClientSpec => ({
  id,
  kind: "mobile",
  skewMs,
  legacy: true,
});
/** Scenarier med appen køres for både den nye og den ældre build */
const MOBILE_VERSIONS = [
  ["ny", mobil],
  ["build 5", mobilLegacy],
] as const;

describe.skipIf(!ENABLED)(
  "timer-protokollen — modeksempler (rettede og kendte fejl)",
  () => {
    beforeAll(async () => {
      await loadHarness();
      vi.useFakeTimers({ toFake: ["Date"] });
      process.env.CRON_SECRET ||= "model-cron-secret";
    });
    afterAll(() => {
      vi.useRealTimers();
    });

    // ── Rettet i fase 1 (server + web) ─────────────────────────────────

    it("RETTET K1 web: annullér efter et gem hvis svar gik tabt, afvises — sessionen er gemt (#783)", () =>
      expectHolds(
        [web("web1")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [600_000, "stop(web1)", (s) => s.stop(0, false, false, false)],
          [5_000, "gem(web1,gem-tabt)", (s) => s.save(0, true, false)],
          [5_000, "annullér(web1)", (s) => s.cancelSave(0, false)],
          [30_000, "heartbeat(web1)", (s) => s.heartbeat(0, false)],
        ],
      ));

    it.each(EXT_VERSIONS)(
      "RETTET K1 web (genindlæsning): cancelStopOnUnload efter et landet gem genopliver ikke (#783) — extension %s",
      (_v, mk) =>
        expectHolds(
          [web("web1"), mk("ext")],
          [
            [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
            [600_000, "stop(web1)", (s) => s.stop(0, false, false, false)],
            [5_000, "gem(web1,gem-tabt)", (s) => s.save(0, true, false)],
            [5_000, "genindlæs(web1)", (s) => s.reload(0)],
            [60_000, "afstem(ext)", (s) => s.reconcileCmd(1)],
            [60_000, "stop(ext)", (s) => s.stop(1, false, false, false)],
          ],
        ),
    );

    it.each(EXT_VERSIONS)(
      "RETTET K3 web: gem-dialogen bygger på sessionens øjebliksbillede fra claimet (#785) — extension %s",
      (_v, mk) =>
        expectHolds(
          [mk("ext"), web("web1")],
          [
            [1_000, "start(ext,B)", (s) => s.start(0, "B", false, false)],
            [10_000, "genindlæs(web1)", (s) => s.reload(1)],
            [10_000, "skift(ext,A)", (s) => s.switchTarget(0, "A", false)],
            [
              600_000,
              "stop(web1,gem)",
              (s) => s.stop(1, false, false, false, true),
            ],
          ],
        ),
    );

    it.each(EXT_VERSIONS)(
      "RETTET K4b: en gensendt start (tabt svar) overtager sin session i stedet for at overskrive et nyere kundeskift (#786) — extension %s",
      (_v, mk) =>
        expectHolds(
          [web("web1"), mk("ext")],
          [
            [1_000, "start(web1,A,tabt)", (s) => s.start(0, "A", false, true)],
            [10_000, "afstem(ext)", (s) => s.reconcileCmd(1)],
            [10_000, "skift(ext,B)", (s) => s.switchTarget(1, "B", false)],
            [30_000, "heartbeat(web1)", (s) => s.heartbeat(0, false)],
            [30_000, "heartbeat(web1)", (s) => s.heartbeat(0, false)],
          ],
        ),
    );

    it.each(EXT_VERSIONS)(
      "RETTET K6: et kundeskift fra extensionen lander ikke midt i et stop fra web (#787) — extension %s",
      (_v, mk) =>
        expectHolds(
          [web("web1"), mk("ext")],
          [
            [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
            [10_000, "afstem(ext)", (s) => s.reconcileCmd(1)],
            [600_000, "stop(web1)", (s) => s.stop(0, false, false, false)],
            [5_000, "skift(ext,B)", (s) => s.switchTarget(1, "B", false)],
            [5_000, "gem(web1)", (s) => s.save(0, false, false)],
          ],
        ),
    );

    it("RETTET K6 web-web: et kundeskift fra en anden fane lander ikke midt i et stop (#787)", () =>
      expectHolds(
        [web("web1"), web("web2")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "afstem(web2)", (s) => s.reconcileCmd(1)],
          [600_000, "stop(web1)", (s) => s.stop(0, false, false, false)],
          [5_000, "skift(web2,B)", (s) => s.switchTarget(1, "B", false)],
          [5_000, "gem(web1)", (s) => s.save(0, false, false)],
        ],
      ));

    // kunde A 5/10: extensionen startede, to faner adopterede timeren, og
    // derefter fik den ene fane version_conflict på HVERT heartbeat — den
    // anden fane skrev altid lige før (prod: 25 konflikter i træk).
    it.each(EXT_VERSIONS)(
      "RETTET heartbeat-løkke: en fane der taber til en anden aktiv skriver bliver observatør i stedet for at kæmpe — extension %s",
      (_v, mk) => {
        const rounds: ScenarioStep[] = [];
        for (let r = 0; r < 10; r++) {
          rounds.push(
            [18_000, `afstem(ext) #${r}`, (s) => s.reconcileCmd(0)],
            [1_000, `heartbeat(web2) #${r}`, (s) => s.heartbeat(2, false)],
            [1_000, `heartbeat(web1) #${r}`, (s) => s.heartbeat(1, false)],
            // web1's polling (prod: 15 s uden realtime)
            [10_000, `afstem(web1) #${r}`, (s) => s.reconcileCmd(1)],
          );
        }
        let startedSession: string | null = null;
        return expectHolds(
          [mk("ext"), web("web1"), web("web2")],
          [
            [1_000, "start(ext,A)", (s) => s.start(0, "A", false, false)],
            [
              59_000,
              "adoptér(web1)",
              async (s) => {
                await s.reconcileCmd(1);
                startedSession =
                  (await h.readTimerRow(s.fx.userId))?.currentSessionId ?? null;
              },
            ],
            [100, "adoptér(web2)", (s) => s.reconcileCmd(2)],
            ...rounds,
            [
              0,
              "tjek: højst én konflikt pr. adoption",
              async (s) => {
                const [, web1, web2] = s.clients;
                expect(
                  web1.versionConflicts + web2.versionConflicts,
                ).toBeLessThanOrEqual(1);
                expect(
                  web1.skippedKeepAlives + web2.skippedKeepAlives,
                ).toBeGreaterThan(5);
                // Ingen dataændring: samme session kører stadig, ingen post
                const row = await h.readTimerRow(s.fx.userId);
                expect(row?.isRunning).toBe(true);
                expect(row?.currentSessionId).toBe(startedSession);
                expect(await h.readEntries(s.fx.userId)).toHaveLength(0);
              },
            ],
            // Ejeren (web2) lukkes: observatøren overtager keep-alive efter 2 min
            [
              30_000,
              "heartbeat(web1) ejer lukket",
              (s) => s.heartbeat(1, false),
            ],
            [
              30_000,
              "heartbeat(web1) ejer lukket",
              (s) => s.heartbeat(1, false),
            ],
            [
              30_000,
              "heartbeat(web1) ejer lukket",
              (s) => s.heartbeat(1, false),
            ],
            [
              40_000,
              "heartbeat(web1) ejer lukket",
              (s) => s.heartbeat(1, false),
            ],
            [
              0,
              "tjek: fanen overtog keep-alive",
              async (s) => {
                const [, web1, web2] = s.clients;
                expect(web1.observer || web2.observer).toBe(false);
                expect(
                  web1.versionConflicts + web2.versionConflicts,
                ).toBeLessThanOrEqual(1);
                const row = await h.readTimerRow(s.fx.userId);
                expect(row?.isRunning).toBe(true);
                expect(row?.lastSyncedFrom).toBe("web");
                expect(row?.currentSessionId).toBe(startedSession);
              },
            ],
          ],
        );
      },
    );

    it.each(EXT_VERSIONS)(
      "RETTET K7: en web-fane med forældet session kan ikke claime en ANDEN session (#788) — extension %s",
      (_v, mk) =>
        expectHolds(
          [web("web1"), mk("ext"), web("web2")],
          [
            [1_000, "start(web2,A)", (s) => s.start(2, "A", false, false)],
            [10_000, "afstem(ext)", (s) => s.reconcileCmd(1)],
            [10_000, "skift(ext,B)", (s) => s.switchTarget(1, "B", false)],
            [600_000, "stop(ext)", (s) => s.stop(1, false, false, false)],
            [10_000, "start(web1,B)", (s) => s.start(0, "B", false, false)],
            [
              900_000,
              "stop(web2,gem)",
              (s) => s.stop(2, false, false, false, true),
            ],
          ],
        ),
    );

    it("RETTET web-faner (K2 for web): en start på en fane der ikke har set den kørende timer, overskriver den ikke (#784)", () =>
      expectHolds(
        [web("web1"), web("web2")],
        [
          [1_000, "start(web1,B)", (s) => s.start(0, "B", false, false)],
          [60_000, "start(web2,A)", (s) => s.start(1, "A", false, false)],
          [60_000, "skift(web1,A)", (s) => s.switchTarget(0, "A", false)],
          [60_000, "heartbeat(web2)", (s) => s.heartbeat(1, false)],
          [
            600_000,
            "stop(web2,gem)",
            (s) => s.stop(1, false, false, false, true),
          ],
        ],
      ));

    it("RETTET: en pause fra en fane med forældede detaljer overskriver ikke et nyere kundeskift (#786)", () =>
      expectHolds(
        [web("web1"), web("web2")],
        [
          [1_000, "start(web2,B)", (s) => s.start(1, "B", false, false)],
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [1_000, "skift(web1,A,tabt)", (s) => s.switchTarget(0, "A", true)],
          [1_000, "pause(web2)", (s) => s.pause(1, false)],
          [
            1_000,
            "stop(web1,gem,gem-tabt)",
            (s) => s.stop(0, false, true, false, true),
          ],
        ],
      ));

    it("RETTET (model): et kundeskift sendt mens starten er ubekræftet holdes lokalt og når serveren med næste skrivning", () =>
      expectHolds(
        [web("web1")],
        [
          [1_000, "start(web1,B,tabt)", (s) => s.start(0, "B", false, true)],
          [1_000, "skift(web1,A,tabt)", (s) => s.switchTarget(0, "A", true)],
          [1_000, "pause(web1)", (s) => s.pause(0, false)],
          [
            1_000,
            "stop(web1,gem)",
            (s) => s.stop(0, false, false, false, true),
          ],
        ],
      ));

    it("RETTET (model): et deduplikeret kundeskift tabes ikke ved adoption af egen session", () =>
      expectHolds(
        [web("web1")],
        [
          [1_000, "start(web1,B,tabt)", (s) => s.start(0, "B", false, true)],
          [1_000, "skift(web1,A)", (s) => s.switchTarget(0, "A", false)],
          [30_000, "heartbeat(web1)", (s) => s.heartbeat(0, false)],
          [
            1_000,
            "tjek: brugerens valg A står på sessionen",
            (s) =>
              s.expectServer(
                (r) =>
                  !!r?.isRunning && r?.clientId === s.fx.targets.A.clientId,
                "Brugerens kundeskift blev tabt ved adoption",
              ),
          ],
          [
            600_000,
            "stop(web1,gem)",
            (s) => s.stop(0, false, false, false, true),
          ],
        ],
      ));

    it("RETTET: adoption efter genindlæsning overskriver ikke et samtidigt kundeskift (#786)", () =>
      expectHolds(
        [web("web1"), web("web2")],
        [
          [1_000, "start(web2,A)", (s) => s.start(1, "A", false, false)],
          [
            1_000,
            "samtidig[skift(web2,B) ‖ genindlæs(web1)]",
            async (s) => {
              await Promise.all([s.switchTarget(1, "B", false), s.reload(0)]);
            },
          ],
          [30_000, "heartbeat(web1)", (s) => s.heartbeat(0, false)],
          [
            600_000,
            "stop(web1,gem)",
            (s) => s.stop(0, false, false, false, true),
          ],
        ],
      ));

    it("RETTET (review P1): en ældre klients heartbeat mellem post og confirm genopliver ikke den gemte session", () =>
      expectHolds(
        [web("web1"), mobilLegacy("mobil")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "afstem(mobil)", (s) => s.reconcileCmd(1)],
          [600_000, "stop(web1)", (s) => s.stop(0, false, false, false)],
          [
            5_000,
            "gem(web1) med heartbeat(mobil) mellem post og confirm",
            (s) =>
              s.save(0, false, false, { between: () => s.legacyHeartbeat(1) }),
          ],
          [
            1_000,
            "tjek: rækken er ryddet",
            (s) =>
              s.expectServer(
                (r) =>
                  !r?.isRunning && !r?.intent && (r?.baseSeconds ?? 0) === 0,
                "Gemt session lever videre efter confirm",
              ),
          ],
          [6 * 60_000, "cron", (s) => s.cleanup()],
          [
            1_000,
            "tjek: intet parkeret",
            (s) =>
              s.expectServer(
                (r) => !r?.isRunning && (r?.baseSeconds ?? 0) === 0,
                "Gemt session parkeret som pauset",
              ),
          ],
          [10_000, "afstem(mobil)", (s) => s.reconcileCmd(1)],
          [10_000, "stop(mobil)", (s) => s.stop(1, false, false, false)],
        ],
      ));

    it.each(EXT_VERSIONS)(
      "RETTET (review P2-4): extensionens genoptag mellem post og confirm skaber ikke en ny session med gemt tid — extension %s",
      (_v, mk) =>
        expectHolds(
          [mk("ext"), web("web1")],
          [
            [1_000, "start(ext,A)", (s) => s.start(0, "A", false, false)],
            [60_000, "pause(ext)", (s) => s.pause(0, false)],
            [10_000, "afstem(web1)", (s) => s.reconcileCmd(1)],
            [10_000, "stop(web1)", (s) => s.stop(1, false, false, false)],
            [
              5_000,
              "gem(web1) med genoptag(ext) mellem post og confirm",
              (s) =>
                s.save(1, false, false, { between: () => s.resume(0, false) }),
            ],
            [
              1_000,
              "tjek: rækken er ryddet",
              (s) =>
                s.expectServer(
                  (r) =>
                    !r?.isRunning && !r?.intent && (r?.baseSeconds ?? 0) === 0,
                  "Gemt session genoptaget",
                ),
            ],
            [60_000, "afstem(ext)", (s) => s.reconcileCmd(0)],
            [60_000, "stop(ext)", (s) => s.stop(0, false, false, false)],
          ],
        ),
    );

    it("RETTET (review P2-1): en ny start afløser et forladt stop, hvis sessionen er gemt", () =>
      expectHolds(
        [web("web1"), web("web2")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [600_000, "stop(web1)", (s) => s.stop(0, false, false, false)],
          [
            5_000,
            "gem(web1), fanen lukkes før confirm",
            (s) => s.save(0, false, false, { abandonBeforeConfirm: true }),
          ],
          [90_000, "start(web2,B)", (s) => s.start(1, "B", false, false)],
          [
            1_000,
            "tjek: den nye timer kører",
            (s) =>
              s.expectServer(
                (r) =>
                  !!r?.isRunning && !r?.intent && (r?.baseSeconds ?? 0) === 0,
                "Start blokeret af et forladt stop af en gemt session",
              ),
          ],
          [
            600_000,
            "stop(web2,gem)",
            (s) => s.stop(1, false, false, false, true),
          ],
        ],
      ));

    it("RETTET (review P2-1): et forladt stop med UGEMT tid blokerer stadig en ny start (ingen tid går tabt)", () =>
      expectHolds(
        [web("web1"), web("web2")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [600_000, "stop(web1)", (s) => s.stop(0, false, false, false)],
          [90_000, "start(web2,B)", (s) => s.start(1, "B", false, false)],
          [
            1_000,
            "tjek: stoppet står stadig",
            (s) =>
              s.expectServer(
                (r) => r?.intent === "stopping",
                "Et ugemt stop blev afløst",
              ),
          ],
          [5_000, "gem(web1)", (s) => s.save(0, false, false)],
        ],
      ));

    // ── Blandede klienter: ældre (uden sessionId) + sessionsbevidst web ──

    it.each(EXT_VERSIONS)(
      "BLANDET: web adopterer extensionens session og stopper den; en gentaget gem giver én post — extension %s",
      (_v, mk) =>
        expectHolds(
          [mk("ext"), web("web1")],
          [
            [1_000, "start(ext,A)", (s) => s.start(0, "A", false, false)],
            [10_000, "afstem(web1)", (s) => s.reconcileCmd(1)],
            [600_000, "stop(web1)", (s) => s.stop(1, false, false, false)],
            [5_000, "gem(web1,gem-tabt)", (s) => s.save(1, true, false)],
            [5_000, "gem(web1)", (s) => s.save(1, false, false)],
            [10_000, "afstem(ext)", (s) => s.reconcileCmd(0)],
          ],
        ),
    );

    it.each(EXT_VERSIONS)(
      "BLANDET: extensionen stopper og gemmer — web-fanens forældede kopi genopstår ikke — extension %s",
      (_v, mk) =>
        expectHolds(
          [web("web1"), mk("ext")],
          [
            [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
            [10_000, "afstem(ext)", (s) => s.reconcileCmd(1)],
            [600_000, "stop(ext)", (s) => s.stop(1, false, false, false)],
            [30_000, "heartbeat(web1)", (s) => s.heartbeat(0, false)],
            [30_000, "genindlæs(web1)", (s) => s.reload(0)],
            [30_000, "pause(web1)", (s) => s.pause(0, false)],
          ],
        ),
    );

    it.each(MOBILE_VERSIONS)(
      "BLANDET: mobilen stopper en web-session; web nulstilles og starter en ny — app %s",
      (_v, mk) =>
        expectHolds(
          [web("web1"), mk("mobil")],
          [
            [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
            [10_000, "afstem(mobil)", (s) => s.reconcileCmd(1)],
            [600_000, "stop(mobil)", (s) => s.stop(1, false, false, false)],
            [30_000, "heartbeat(web1)", (s) => s.heartbeat(0, false)],
            [30_000, "start(web1,B)", (s) => s.start(0, "B", false, false)],
            [
              600_000,
              "stop(web1,gem)",
              (s) => s.stop(0, false, false, false, true),
            ],
          ],
        ),
    );

    it.each(EXT_VERSIONS)(
      "BLANDET: extensionen pauser og genoptager en web-session; web stopper den med sessionId — extension %s",
      (_v, mk) =>
        expectHolds(
          [web("web1"), mk("ext")],
          [
            [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
            [10_000, "afstem(ext)", (s) => s.reconcileCmd(1)],
            [300_000, "pause(ext)", (s) => s.pause(1, false)],
            [60_000, "afstem(web1)", (s) => s.reconcileCmd(0)],
            [60_000, "genoptag(ext)", (s) => s.resume(1, false)],
            [60_000, "afstem(web1)", (s) => s.reconcileCmd(0)],
            [
              600_000,
              "stop(web1,gem)",
              (s) => s.stop(0, false, false, false, true),
            ],
          ],
        ),
    );

    it('BLANDET: "Fortsæt" med tabt svar på gem forlænger posten én gang', () =>
      expectHolds(
        [web("web1")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [
            600_000,
            "stop(web1,gem)",
            (s) => s.stop(0, false, false, false, true),
          ],
          [60_000, "fortsæt(web1)", (s) => s.continueEntry(0, false)],
          [600_000, "stop(web1)", (s) => s.stop(0, false, false, false)],
          [5_000, "gem(web1,gem-tabt)", (s) => s.save(0, true, false)],
          [5_000, "gem(web1)", (s) => s.save(0, false, false)],
        ],
      ));

    it.each(EXT_VERSIONS)(
      "BLANDET: oprydnings-cron'en rydder et forladt stop, hvis sessionen allerede er gemt — extension %s",
      (_v, mk) =>
        expectHolds(
          [web("web1"), mk("ext")],
          [
            [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
            [600_000, "stop(web1)", (s) => s.stop(0, false, false, false)],
            // Posten lander, svaret går tabt — dialogen står åben, intet confirm
            [5_000, "gem(web1,gem-tabt)", (s) => s.save(0, true, false)],
            [6 * 60_000, "cron", (s) => s.cleanup()],
            [10_000, "afstem(ext)", (s) => s.reconcileCmd(1)],
            [10_000, "stop(ext)", (s) => s.stop(1, false, false, false)],
          ],
        ),
    );

    // ── Kræver extension/mobil (fase 2) ─────────────────────────────────

    // ── Rettet i fase 2 (appen, timetrack-app#18) ──────────────────────

    it("RETTET K1 mobil (fase 2): et tabt svar på time.create frigiver ikke claimet — journalen gør stoppet færdigt (#783)", () =>
      expectHolds(
        [mobil("mobil")],
        [
          [1_000, "start(mobil,A)", (s) => s.start(0, "A", false, false)],
          [
            600_000,
            "stop(mobil,gem-tabt)",
            (s) => s.stop(0, false, true, false),
          ],
          [
            1_000,
            "tjek: sessionen kører ikke videre",
            (s) =>
              s.expectServer(
                (r) => !r?.isRunning || r?.intent === "stopping",
                "Claimet blev frigivet efter et tabt svar",
              ),
          ],
          [10_000, "tøm-kø(mobil) (journalen)", (s) => s.flushQueue(0)],
          [
            1_000,
            "tjek: rækken er ryddet",
            (s) =>
              s.expectServer(
                (r) =>
                  !r?.isRunning && !r?.intent && (r?.baseSeconds ?? 0) === 0,
                "Journalen gjorde ikke stoppet færdigt",
              ),
          ],
        ],
      ));

    it("RETTET K1 mobil (fase 2): journalen når først frem efter cron-parkering — sessionen gemmes én gang (#783)", () =>
      expectHolds(
        [mobil("mobil"), web("web1")],
        [
          [1_000, "start(mobil,A)", (s) => s.start(0, "A", false, false)],
          [
            600_000,
            "stop(mobil,gem-tabt)",
            (s) => s.stop(0, false, true, false),
          ],
          [6 * 60_000, "cron", (s) => s.cleanup()],
          [10_000, "tøm-kø(mobil) (journalen)", (s) => s.flushQueue(0)],
          [10_000, "afstem(web1)", (s) => s.reconcileCmd(1)],
          [
            10_000,
            "stop(web1,gem)",
            (s) => s.stop(1, false, false, false, true),
          ],
        ],
      ));

    it("RETTET K3 mobil (fase 2): stop gemmer sessionens projekt fra claimet, ikke appens forældede (#785)", () =>
      expectHolds(
        [web("web1"), mobil("mobil")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "afstem(mobil)", (s) => s.reconcileCmd(1)],
          [10_000, "skift(web1,B)", (s) => s.switchTarget(0, "B", false)],
          [600_000, "stop(mobil)", (s) => s.stop(1, false, false, false)],
        ],
      ));

    it("RETTET K5 mobil (fase 2): et kundeskift fra appens forældede visning rammer ikke en anden session", () =>
      expectHolds(
        [web("web1"), mobil("mobil")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "afstem(mobil)", (s) => s.reconcileCmd(1)],
          [
            600_000,
            "stop(web1,gem)",
            (s) => s.stop(0, false, false, false, true),
          ],
          [10_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "skift(mobil,B)", (s) => s.switchTarget(1, "B", false)],
          [
            1_000,
            "tjek: den nye session står stadig på A",
            (s) =>
              s.expectServer(
                (r) =>
                  !!r?.isRunning && r?.clientId === s.fx.targets.A.clientId,
                "Forældet kundeskift fra appen ramte den nye session",
              ),
          ],
        ],
      ));

    // ── Ældre app (build 4/5): rettet på serveren ─────────────────────

    it("RETTET K1 mobil (build 5, server): cancelStop efter et tabt svar på time.create genopliver ikke den gemte session (#783)", () =>
      expectHolds(
        [mobilLegacy("mobil")],
        [
          [1_000, "start(mobil,A)", (s) => s.start(0, "A", false, false)],
          [
            600_000,
            "stop(mobil,gem-tabt)",
            (s) => s.stop(0, false, true, false),
          ],
        ],
      ));

    // ── Rettet i fase 2 (extension 2.6.0) ─────────────────────────────

    it("RETTET K2 (fase 2): en start fra en anden extension-instans adopterer den kørende session i stedet for at overskrive den (#784)", () =>
      expectHolds(
        [ext("ext1"), ext("ext2")],
        [
          [1_000, "start(ext1,B)", (s) => s.start(0, "B", false, false)],
          [60_000, "start(ext2,B)", (s) => s.start(1, "B", false, false)],
          [60_000, "skift(ext1,A)", (s) => s.switchTarget(0, "A", false)],
          [
            1_000,
            "tjek: ext1's session kører stadig, nu på A",
            (s) =>
              s.expectServer(
                (r) =>
                  !!r?.isRunning &&
                  r?.clientId === s.fx.targets.A.clientId &&
                  (r?.startTime?.getTime() ?? 0) <= s.clock.start + 1_000,
                "Den kørende session blev overskrevet",
              ),
          ],
          [600_000, "stop(ext2)", (s) => s.stop(1, false, false, false)],
        ],
      ));

    it("RETTET K2 (fase 2): to samtidige starter fra to extension-instanser giver én session (#784)", () =>
      expectHolds(
        [ext("ext1"), ext("ext2")],
        [
          [
            1_000,
            "samtidig[start(ext1,A) ‖ start(ext2,B)]",
            async (s) => {
              await Promise.all([
                s.start(0, "A", false, false),
                s.start(1, "B", false, false),
              ]);
            },
          ],
          [60_000, "afstem(ext1)", (s) => s.reconcileCmd(0)],
          [60_000, "afstem(ext2)", (s) => s.reconcileCmd(1)],
          [600_000, "stop(ext1)", (s) => s.stop(0, false, false, false)],
          [10_000, "stop(ext2)", (s) => s.stop(1, false, false, false)],
        ],
      ));

    it("RETTET K5 (fase 2): et kundeskift fra extensionens forældede visning rammer ikke en anden session (#787)", () =>
      expectHolds(
        [web("web1"), ext("ext")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "afstem(ext)", (s) => s.reconcileCmd(1)],
          [
            600_000,
            "stop(web1,gem)",
            (s) => s.stop(0, false, false, false, true),
          ],
          [10_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "skift(ext,B)", (s) => s.switchTarget(1, "B", false)],
          [
            1_000,
            "tjek: den nye session står stadig på A",
            (s) =>
              s.expectServer(
                (r) =>
                  !!r?.isRunning && r?.clientId === s.fx.targets.A.clientId,
                "Forældet kundeskift ramte den nye session",
              ),
          ],
        ],
      ));

    it("RETTET K5 (fase 2): en pause fra extensionens forældede visning rammer ikke en anden session (#787)", () =>
      expectHolds(
        [web("web1"), ext("ext")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "afstem(ext)", (s) => s.reconcileCmd(1)],
          [
            600_000,
            "stop(web1,gem)",
            (s) => s.stop(0, false, false, false, true),
          ],
          [10_000, "start(web1,B)", (s) => s.start(0, "B", false, false)],
          [10_000, "pause(ext)", (s) => s.pause(1, false)],
          [
            1_000,
            "tjek: web-sessionen kører stadig",
            (s) =>
              s.expectServer(
                (r) => !!r?.isRunning && (r?.baseSeconds ?? 0) === 0,
                "Forældet pause ramte den nye session",
              ),
          ],
          [
            600_000,
            "stop(web1,gem)",
            (s) => s.stop(0, false, false, false, true),
          ],
        ],
      ));

    it("RETTET K6 extension-extension (fase 2): et kundeskift fra en anden extension-instans lander ikke midt i et stop (#787)", () =>
      expectHolds(
        [ext("ext1"), ext("ext2")],
        [
          [1_000, "start(ext1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "afstem(ext2)", (s) => s.reconcileCmd(1)],
          [
            600_000,
            "stop(ext1,popup-lukket)",
            (s) => s.stop(0, false, false, false, false, true),
          ],
          [5_000, "skift(ext2,B)", (s) => s.switchTarget(1, "B", false)],
          [5_000, "tøm-kø(ext1)", (s) => s.flushQueue(0)],
        ],
      ));

    it("RETTET (fase 2): et kundeskift fra en anden extension-instans efter pause/genoptag gælder samme session", () =>
      expectHolds(
        [web("web1"), ext("ext1"), ext("ext2")],
        [
          [1_000, "start(web1,B)", (s) => s.start(0, "B", false, false)],
          [13_000, "afstem(ext2)", (s) => s.reconcileCmd(2)],
          [9_000, "afstem(ext1)", (s) => s.reconcileCmd(1)],
          [69_000, "pause(ext1)", (s) => s.pause(1, false)],
          [1_000, "genoptag(ext1)", (s) => s.resume(1, false)],
          [1_000, "skift(ext2,A)", (s) => s.switchTarget(2, "A", false)],
          [
            600_000,
            "stop(ext1)",
            async (s) => {
              await s.reconcileCmd(1);
              await s.stop(1, false, false, false);
            },
          ],
        ],
      ));

    it("RETTET (fase 2): et tabt svar på en start gentages ikke som en ny session — extensionen adopterer sin egen", () =>
      expectHolds(
        [ext("ext"), web("web1")],
        [
          [1_000, "start(ext,A,tabt)", (s) => s.start(0, "A", false, true)],
          [10_000, "start(ext,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "skift(ext,B)", (s) => s.switchTarget(0, "B", false)],
          [
            600_000,
            "stop(web1,gem)",
            async (s) => {
              await s.reconcileCmd(1);
              await s.stop(1, false, false, false, true);
            },
          ],
        ],
      ));

    it("RETTET (fase 2): hurtig-stop fra en notifikation gemmer sessionen én gang og rydder rækken", () =>
      expectHolds(
        [ext("ext"), web("web1")],
        [
          [1_000, "start(ext,A)", (s) => s.start(0, "A", false, false)],
          [600_000, "hurtig-stop(ext)", (s) => s.quickStop(0, false)],
          [
            1_000,
            "tjek: rækken er ryddet",
            (s) =>
              s.expectServer(
                (r) =>
                  !r?.isRunning &&
                  (r?.baseSeconds ?? 0) === 0 &&
                  (r?.elapsedSeconds ?? 0) === 0 &&
                  !r?.currentSessionId,
                "quickStop efterlod tid på rækken",
              ),
          ],
          [10_000, "afstem(web1)", (s) => s.reconcileCmd(1)],
          [10_000, "start(web1,B)", (s) => s.start(1, "B", false, false)],
          [
            600_000,
            "stop(web1,gem)",
            (s) => s.stop(1, false, false, false, true),
          ],
        ],
      ));

    it("RETTET (fase 2): hurtig-stop lige efter start rydder rækken uden at efterlade en session", () =>
      expectHolds(
        [ext("ext1")],
        [
          [1_000, "start(ext1,A)", (s) => s.start(0, "A", false, false)],
          [0, "hurtig-stop(ext1)", (s) => s.quickStop(0, false)],
          [10_000, "start(ext1,B)", (s) => s.start(0, "B", false, false)],
          [600_000, "stop(ext1)", (s) => s.stop(0, false, false, false)],
        ],
      ));

    it("RETTET (fase 2): hurtig-stop med en forældet session stopper ikke en nyere session", () =>
      expectHolds(
        [ext("ext"), web("web1")],
        [
          [1_000, "start(ext,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "afstem(web1)", (s) => s.reconcileCmd(1)],
          [
            600_000,
            "stop(web1,gem)",
            (s) => s.stop(1, false, false, false, true),
          ],
          [10_000, "start(web1,B)", (s) => s.start(1, "B", false, false)],
          [60_000, "hurtig-stop(ext)", (s) => s.quickStop(0, false)],
          [
            1_000,
            "tjek: web-sessionen kører stadig",
            (s) =>
              s.expectServer(
                (r) =>
                  !!r?.isRunning && r?.clientId === s.fx.targets.B.clientId,
                "En gammel notifikation stoppede en ny session",
              ),
          ],
        ],
      ));

    it("RETTET (review P3): cron rydder en række der står pauset på en gemt session, så ældre klienter kan starte igen", () =>
      expectHolds(
        [ext("ext"), extLegacy("ext25")],
        [
          [1_000, "start(ext,A)", (s) => s.start(0, "A", false, false)],
          [600_000, "hurtig-stop(ext)", (s) => s.quickStop(0, false)],
          [
            60_000,
            "rest af gemt session (tabt nulstilling) → ældre start afvises → cron rydder",
            async (s) => {
              await h.forceSavedSessionLeftover(s.fx.userId, 600);
              await s.start(1, "B", false, false);
              await s.expectServer(
                (r) => !r?.isRunning,
                "Ældre start landede på en gemt session",
              );
              await s.cleanup();
              await s.expectServer(
                (r) =>
                  !r?.isRunning &&
                  (r?.baseSeconds ?? 0) === 0 &&
                  !r?.currentSessionId,
                "Cron ryddede ikke resten af den gemte session",
              );
            },
          ],
          [10_000, "afstem(ext25)", (s) => s.reconcileCmd(1)],
          [10_000, "start(ext25,B)", (s) => s.start(1, "B", false, false)],
          [
            1_000,
            "tjek: den ældre klients start landede",
            (s) =>
              s.expectServer(
                (r) =>
                  !!r?.isRunning && r?.clientId === s.fx.targets.B.clientId,
                "Ældre start blokeret efter oprydning",
              ),
          ],
          [600_000, "stop(ext25)", (s) => s.stop(1, false, false, false)],
        ],
      ));

    it("RETTET (fase 2): web-dialogens sene gem gemmer ikke en session igen, som extension 2.5.x har gemt efter cron-parkering", () =>
      expectHolds(
        [web("web1"), extLegacy("gammel")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [
            60 * 60_000,
            "stop(web1) — dialogen står åben",
            (s) => s.stop(0, false, false, false),
          ],
          [
            6 * 60_000,
            "cron (parkerer stoppet som pauset)",
            (s) => s.cleanup(),
          ],
          [10_000, "afstem(gammel)", (s) => s.reconcileCmd(1)],
          [
            10_000,
            "genoptag+stop(gammel)",
            async (s) => {
              await s.resume(1, false);
              await s.stop(1, false, false, false);
            },
          ],
          [10_000, "gem(web1) — sent", (s) => s.save(0, false, false)],
        ],
      ));

    it("RETTET (review P1): et usikkert gem bekræfter ikke stoppet før posten er landet — en manuel post tager ikke timerens plads", () =>
      expectHolds(
        [ext("ext"), web("web1")],
        [
          [1_000, "start(ext,A)", (s) => s.start(0, "A", false, false)],
          [
            75 * 60_000,
            "manuel post B (36 s) midt i timerens levetid",
            (s) => s.manualEntry("B", s.clock.now - 36_000, s.clock.now),
          ],
          [
            105 * 60_000,
            "stop(ext) — gem usikkert",
            (s) => s.stop(0, false, false, false, false, false, true),
          ],
          [60_000, "tøm-kø(ext)", (s) => s.flushQueue(0)],
          [
            1_000,
            "tjek: timerens 3 t er gemt på A",
            (s) =>
              s.expectEntries(
                (es) =>
                  es.some(
                    (e) =>
                      e.clientId === s.fx.targets.A.clientId && e.hours > 2.9,
                  ),
                "Timerens tid gik tabt",
              ),
          ],
        ],
      ));

    it("RETTET (review P1): et usikkert gem af en ny session returnerer ikke den forrige sessions post (ur-skævhed)", () =>
      expectHolds(
        [ext("ext1", SKEWS[3]), ext("ext2")],
        [
          [1_000, "start(ext1,A)", (s) => s.start(0, "A", false, false)],
          [600_000, "stop(ext1)", (s) => s.stop(0, false, false, false)],
          [10_000, "start(ext2,B)", (s) => s.start(1, "B", false, false)],
          [
            60_000,
            "stop(ext2) — gem usikkert",
            (s) => s.stop(1, false, false, false, false, false, true),
          ],
          [60_000, "tøm-kø(ext2)", (s) => s.flushQueue(1)],
          [
            1_000,
            "tjek: ext2's session er gemt på B",
            (s) =>
              s.expectEntries(
                (es) => es.some((e) => e.clientId === s.fx.targets.B.clientId),
                "Den nye sessions tid gik tabt",
              ),
          ],
        ],
      ));

    // ── Ældre extension 2.5.x: løses af minimumsversionen ──────────────

    it("KENDT FEJL K2 (extension 2.5.x): en fresh start fra en anden extension-instans overskriver en kørende session (#784)", () =>
      expectKnownBug(
        /Kundeskift uden brugerhandling/,
        [extLegacy("ext1"), extLegacy("ext2")],
        [
          [1_000, "start(ext1,B)", (s) => s.start(0, "B", false, false)],
          [60_000, "start(ext2,B)", (s) => s.start(1, "B", false, false)],
          [60_000, "skift(ext1,A)", (s) => s.switchTarget(0, "A", false)],
        ],
      ));

    it("RETTET K3 mobil (build 5, server): stop gemmer sessionens projekt, ikke appens forældede (#785)", () =>
      expectHolds(
        [web("web1"), mobilLegacy("mobil")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "afstem(mobil)", (s) => s.reconcileCmd(1)],
          [10_000, "skift(web1,B)", (s) => s.switchTarget(0, "B", false)],
          [600_000, "stop(mobil)", (s) => s.stop(1, false, false, false)],
        ],
      ));

    it("KENDT FEJL K5 (extension 2.5.x): et kundeskift fra extensionens forældede visning rammer en anden session (#787)", () =>
      expectKnownBug(
        /Kundeskift uden brugerhandling/,
        [web("web1"), extLegacy("ext")],
        [
          [1_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "afstem(ext)", (s) => s.reconcileCmd(1)],
          [
            600_000,
            "stop(web1,gem)",
            (s) => s.stop(0, false, false, false, true),
          ],
          [10_000, "start(web1,A)", (s) => s.start(0, "A", false, false)],
          [10_000, "skift(ext,B)", (s) => s.switchTarget(1, "B", false)],
        ],
      ));
  },
);
