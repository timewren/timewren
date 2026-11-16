import { describe, expect, it } from "vitest";
import { GENERAL_DEFAULT_LANES } from "./default-lanes";
import {
  categoryForLegacyStatus,
  completedAtChange,
  formLaneId,
  insertAt,
  isCompletedTask,
  isLaneCategory,
  type LaneForResolve,
  laneMatchesLegacyStatus,
  legacyStatusForLane,
  moveItem,
  resolveTaskLaneId,
  sortLaneTasks,
} from "./lane-category";

// Standardtavlen som den ser ud for alle eksisterende konti.
const DEFAULTS: LaneForResolve[] = GENERAL_DEFAULT_LANES.map((l) => ({
  id: l.name,
  name: l.name,
  category: l.category,
  order: l.order,
}));

// En tavle med egne navne og ingen Backlog (fx en Notion-import).
const CUSTOM: LaneForResolve[] = [
  { id: "haster", name: "Haster", category: "in_progress", order: 0 },
  { id: "igang", name: "Opgave igang", category: "in_progress", order: 1 },
  { id: "tilbud", name: "Tilbud", category: "not_started", order: 2 },
  { id: "ikke", name: "Ikke startet", category: "not_started", order: 3 },
  { id: "pause", name: "Pause", category: "cancelled", order: 4 },
  { id: "fakt", name: "Faktureres", category: "done", order: 5 },
];

describe("standardkolonnerne", () => {
  it("bevarer betydningen af de fire gamle statusser", () => {
    expect(
      GENERAL_DEFAULT_LANES.map((l) => [l.name, l.category, l.isArchive]),
    ).toEqual([
      ["Backlog", "not_started", false],
      ["Todo", "not_started", false],
      ["I gang", "in_progress", false],
      ["Afsluttet", "done", true],
    ]);
  });

  it.each([
    ["Backlog", "todo", "backlog"],
    ["Todo", "backlog", "todo"],
    ["I gang", "todo", "in_progress"],
    ["Afsluttet", "in_progress", "done"],
  ] as const)("kolonnen %s giver status %s → %s", (name, current, expected) => {
    const lane = GENERAL_DEFAULT_LANES.find((l) => l.name === name);
    if (!lane) throw new Error(name);
    expect(legacyStatusForLane(lane, current)).toBe(expected);
  });

  it.each([
    ["backlog", "Backlog"],
    ["todo", "Todo"],
    ["in_progress", "I gang"],
    ["done", "Afsluttet"],
  ])("en opgave uden kolonne med status %s står i %s", (status, lane) => {
    expect(resolveTaskLaneId({ statusId: null, status }, DEFAULTS)).toBe(lane);
  });
});

describe("statusmapping for egne kolonner", () => {
  it("kategorien bestemmer den gamle status", () => {
    const lane = (category: LaneForResolve["category"]) => ({
      name: "Egen",
      category,
    });
    expect(legacyStatusForLane(lane("in_progress"), "todo")).toBe(
      "in_progress",
    );
    expect(legacyStatusForLane(lane("done"), "todo")).toBe("done");
    expect(legacyStatusForLane(lane("cancelled"), "in_progress")).toBe("done");
  });

  it("ikke startet bevarer backlog/todo og ellers bliver det todo", () => {
    const lane = { name: "Tilbud", category: "not_started" as const };
    expect(legacyStatusForLane(lane, "backlog")).toBe("backlog");
    expect(legacyStatusForLane(lane, "todo")).toBe("todo");
    expect(legacyStatusForLane(lane, "in_progress")).toBe("todo");
    expect(legacyStatusForLane(lane, "done")).toBe("todo");
  });

  it("en omdøbt standardkolonne følger kategorien, ikke det gamle navn", () => {
    // "Afsluttet" omdøbt? Nej: en kolonne der HEDDER Afsluttet men er sat
    // til "i gang" må ikke lukke opgaverne.
    expect(
      legacyStatusForLane(
        { name: "Afsluttet", category: "in_progress" },
        "todo",
      ),
    ).toBe("in_progress");
  });

  it("annulleret og afsluttet er begge lukket for gammel status done", () => {
    expect(laneMatchesLegacyStatus("done", "done")).toBe(true);
    expect(laneMatchesLegacyStatus("cancelled", "done")).toBe(true);
    expect(laneMatchesLegacyStatus("in_progress", "done")).toBe(false);
    expect(laneMatchesLegacyStatus("not_started", "backlog")).toBe(true);
    expect(laneMatchesLegacyStatus("not_started", "todo")).toBe(true);
  });

  it("kategorien for de gamle statusser", () => {
    expect(categoryForLegacyStatus("backlog")).toBe("not_started");
    expect(categoryForLegacyStatus("todo")).toBe("not_started");
    expect(categoryForLegacyStatus("in_progress")).toBe("in_progress");
    expect(categoryForLegacyStatus("done")).toBe("done");
  });

  it("afviser ukendte kategorier", () => {
    expect(isLaneCategory("done")).toBe(true);
    expect(isLaneCategory("backlog")).toBe(false);
    expect(isLaneCategory(null)).toBe(false);
  });
});

describe("isCompletedTask", () => {
  it("done i en afsluttet kolonne eller uden kolonne er afsluttet", () => {
    expect(isCompletedTask("done", "done")).toBe(true);
    expect(isCompletedTask("done", null)).toBe(true);
  });
  it("done i en annulleret kolonne er ikke afsluttet", () => {
    expect(isCompletedTask("done", "cancelled")).toBe(false);
  });
  it("åbne statusser er ikke afsluttet", () => {
    expect(isCompletedTask("in_progress", "done")).toBe(false);
    expect(isCompletedTask("todo", null)).toBe(false);
  });
});

describe("completedAtChange", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  it("sætter tidspunktet, når opgaven afsluttes", () => {
    expect(completedAtChange(false, true, now)).toEqual({
      completedAt: now,
    });
  });
  it("rydder det, når opgaven genåbnes eller annulleres", () => {
    expect(completedAtChange(true, false, now)).toEqual({
      completedAt: null,
    });
  });
  it("rører det ikke inden for åben eller afsluttet", () => {
    expect(completedAtChange(false, false, now)).toEqual({});
    expect(completedAtChange(true, true, now)).toEqual({});
  });
});

describe("resolveTaskLaneId", () => {
  it("statusId vinder, når kolonnen passer med status", () => {
    expect(
      resolveTaskLaneId({ statusId: "tilbud", status: "backlog" }, CUSTOM),
    ).toBe("tilbud");
    expect(
      resolveTaskLaneId({ statusId: "pause", status: "done" }, CUSTOM),
    ).toBe("pause");
  });

  it("status ændret andetsteds (desktop/API) flytter kortet til første kolonne i kategorien", () => {
    // Kortet stod i "Tilbud", desktop satte det i gang.
    expect(
      resolveTaskLaneId({ statusId: "tilbud", status: "in_progress" }, CUSTOM),
    ).toBe("haster");
    // ... og markerede det færdigt: første lukkede kolonne efter
    // rækkefølge er done-kolonnen, ikke den annullerede.
    expect(
      resolveTaskLaneId({ statusId: "igang", status: "done" }, CUSTOM),
    ).toBe("fakt");
  });

  it("opgaver uden kolonne forsvinder ikke, når Backlog er omdøbt", () => {
    expect(
      resolveTaskLaneId({ statusId: null, status: "backlog" }, CUSTOM),
    ).toBe("tilbud");
  });

  it("en kolonne fra et andet board (projektkolonne) løses via status", () => {
    expect(
      resolveTaskLaneId({ statusId: "projekt-lane", status: "todo" }, DEFAULTS),
    ).toBe("Todo");
  });

  it("uden en kolonne i kategorien bliver kortet stående", () => {
    const noDone = CUSTOM.filter(
      (l) => l.category !== "done" && l.category !== "cancelled",
    );
    expect(
      resolveTaskLaneId({ statusId: "tilbud", status: "done" }, noDone),
    ).toBe("tilbud");
    expect(resolveTaskLaneId({ statusId: null, status: "done" }, noDone)).toBe(
      "haster",
    );
  });

  it("ingen kolonner giver null", () => {
    expect(
      resolveTaskLaneId({ statusId: null, status: "todo" }, []),
    ).toBeNull();
  });

  it("bruger kolonnernes rækkefølge, ikke arrayets", () => {
    const reversed = [...CUSTOM].reverse();
    expect(
      resolveTaskLaneId({ statusId: null, status: "in_progress" }, reversed),
    ).toBe("haster");
  });
});

describe("sortering", () => {
  it("moveItem flytter op og ned og står stille ved kanten", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("insertAt flytter inden for kolonnen", () => {
    expect(insertAt(["a", "b", "c", "d"], "a", 2)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(insertAt(["a", "b", "c", "d"], "d", 0)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  it("insertAt indsætter et kort fra en anden kolonne og klemmer indeks", () => {
    expect(insertAt(["a", "b"], "x", 1)).toEqual(["a", "x", "b"]);
    expect(insertAt(["a", "b"], "x", 99)).toEqual(["a", "b", "x"]);
    expect(insertAt([], "x", -3)).toEqual(["x"]);
  });

  const tasks = [
    { id: "1", priority: "low", deadline: null, client: { name: "Øst" } },
    {
      id: "2",
      priority: "urgent",
      deadline: "2026-11-10",
      client: null,
    },
    {
      id: "3",
      priority: "medium",
      deadline: "2026-11-05",
      client: { name: "Bager" },
    },
    { id: "4", priority: "urgent", deadline: null, client: { name: "Ane" } },
  ];
  const ids = (list: { id: string }[]) => list.map((t) => t.id);

  it("manuel bevarer den gemte rækkefølge", () => {
    expect(ids(sortLaneTasks(tasks, "manual"))).toEqual(["1", "2", "3", "4"]);
  });
  it("deadline: tidligste først, uden deadline sidst og stabilt", () => {
    expect(ids(sortLaneTasks(tasks, "deadline"))).toEqual(["3", "2", "1", "4"]);
  });
  it("prioritet: kritisk først, stabilt inden for samme prioritet", () => {
    expect(ids(sortLaneTasks(tasks, "priority"))).toEqual(["2", "4", "3", "1"]);
  });
  it("kunde: alfabetisk på dansk (Ø efter B), uden kunde sidst", () => {
    expect(ids(sortLaneTasks(tasks, "client"))).toEqual(["4", "3", "1", "2"]);
  });
});

describe("formLaneId", () => {
  const lanes: LaneForResolve[] = [
    { id: "haster", name: "Haster", category: "not_started", order: 0 },
    { id: "igang", name: "Opgave igang", category: "in_progress", order: 1 },
    {
      id: "korrektur",
      name: "Afventer korrektur",
      category: "in_progress",
      order: 2,
    },
    { id: "faktureres", name: "Faktureres", category: "done", order: 3 },
  ];
  it("en opgave, der rettes, starter i sin egen kolonne", () => {
    expect(
      formLaneId(lanes, { statusId: "korrektur", status: "in_progress" }),
    ).toBe("korrektur");
  });
  it("en opgave uden kolonne starter i den første, der passer", () => {
    expect(formLaneId(lanes, { statusId: null, status: "done" })).toBe(
      "faktureres",
    );
  });
  it("tavlens + giver kolonnens id", () => {
    expect(formLaneId(lanes, null, "korrektur")).toBe("korrektur");
  });
  it("en ny opgave uden kolonne starter i en ikke-startet kolonne", () => {
    expect(formLaneId(lanes, null)).toBe("haster");
    expect(formLaneId(lanes, null, "in_progress")).toBe("igang");
  });
});
