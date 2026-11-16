import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_GAP_SECONDS,
  DEFAULT_MAX_INTERRUPTION_SECONDS,
  mergeActivitiesIntoBlocks,
} from "../activityBlocks";
import type { Activity } from "../types";

let nextId = 1;

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  const id = overrides.id ?? nextId++;
  return {
    id,
    app_name: "Code",
    window_title: `title-${id}`,
    url: null,
    git_branch: null,
    git_repo: null,
    context_path: null,
    file_path: null,
    category: null,
    project_id: null,
    client_id: null,
    confidence: null,
    classification_source: null,
    classification_reason: null,
    is_confirmed: false,
    is_idle: false,
    started_at: "2026-06-01T09:00:00",
    ended_at: "2026-06-01T09:10:00",
    duration: 600,
    ...overrides,
  };
}

describe("merge identity uden projekt (misattribuerings-værn)", () => {
  it("splitter naboaktiviteter i samme app med forskellige git-repos", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        git_repo: "kunde-a/web",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        git_repo: "kunde-b/api",
        started_at: "2026-06-01T09:11:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(2);
  });

  it("splitter naboaktiviteter i samme app med forskellige context_paths", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        context_path: "C:\\projects\\kunde-a",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        context_path: "C:\\projects\\kunde-b",
        started_at: "2026-06-01T09:11:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(2);
  });

  it("merger på tværs af branches i SAMME repo (branch er ikke identitet)", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        git_repo: "kunde-a/web",
        git_branch: "main",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        git_repo: "kunde-a/web",
        git_branch: "feature/x",
        started_at: "2026-06-01T09:11:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(1);
  });

  it("merger på tværs af repos når project_id allerede er ens", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        project_id: "proj-1",
        git_repo: "kunde-a/web",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        project_id: "proj-1",
        git_repo: "kunde-a/api",
        started_at: "2026-06-01T09:11:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(1);
  });
});

describe("DEFAULT_MAX_GAP_SECONDS", () => {
  it("is 180 seconds", () => {
    expect(DEFAULT_MAX_GAP_SECONDS).toBe(180);
  });
});

describe("mergeActivitiesIntoBlocks", () => {
  it("returns an empty array for an empty list", () => {
    expect(mergeActivitiesIntoBlocks([])).toEqual([]);
  });

  it("returns one block per single activity", () => {
    const a = makeActivity({
      id: 1,
      started_at: "2026-06-01T09:00:00",
      ended_at: "2026-06-01T09:10:00",
      duration: 600,
    });
    const blocks = mergeActivitiesIntoBlocks([a]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startedAt).toBe("2026-06-01T09:00:00");
    expect(blocks[0].endedAt).toBe("2026-06-01T09:10:00");
    expect(blocks[0].totalDuration).toBe(600);
    expect(blocks[0].activityIds).toEqual([1]);
    expect(blocks[0].activities).toEqual([a]);
  });

  it("merges adjacent activities with same app within the gap threshold", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
        duration: 600,
      }),
      makeActivity({
        id: 2,
        // 2 min gap — under the 180s default
        started_at: "2026-06-01T09:12:00",
        ended_at: "2026-06-01T09:30:00",
        duration: 1080,
      }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].startedAt).toBe("2026-06-01T09:00:00");
    expect(blocks[0].endedAt).toBe("2026-06-01T09:30:00");
    // Sum of durations — the 2 min gap does not count as work
    expect(blocks[0].totalDuration).toBe(600 + 1080);
    expect(blocks[0].activityIds).toEqual([1, 2]);
  });

  it("merges activities that touch exactly (zero gap)", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(1);
  });

  it("splits when the gap exceeds maxGapSeconds", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        // 3 min 1 s gap — just over the 180s default
        started_at: "2026-06-01T09:13:01",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].activityIds).toEqual([1]);
    expect(blocks[1].activityIds).toEqual([2]);
  });

  it("merges at exactly maxGapSeconds (inclusive threshold)", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        started_at: "2026-06-01T09:13:00", // exactly 180s later
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(1);
  });

  it("respects a custom maxGapSeconds", () => {
    const activities = [
      makeActivity({
        id: 1,
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        started_at: "2026-06-01T09:11:00", // 60s gap
        ended_at: "2026-06-01T09:20:00",
      }),
    ];
    expect(
      mergeActivitiesIntoBlocks(activities, { maxGapSeconds: 30 }),
    ).toHaveLength(2);
    expect(
      mergeActivitiesIntoBlocks(activities, { maxGapSeconds: 60 }),
    ).toHaveLength(1);
  });

  it("splits on different apps when no project is set", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        app_name: "Firefox",
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(2);
  });

  it("merges across different apps when project_id matches", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        project_id: "proj-1",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        app_name: "Firefox",
        project_id: "proj-1",
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].projectId).toBe("proj-1");
  });

  it("splits on different projects", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        project_id: "proj-1",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        project_id: "proj-2",
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(2);
  });

  it("does not merge project-less with project-assigned even for the same app", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        project_id: "proj-1",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        app_name: "Code",
        project_id: null,
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(2);
  });

  it("splits on different categories, but merges when both are null", () => {
    const split = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        category: "development",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        category: null,
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(split).toHaveLength(2);

    const merged = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 3,
        category: null,
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 4,
        category: null,
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it("does not mix confirmed and unconfirmed activities", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        is_confirmed: true,
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        is_confirmed: false,
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
      }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].isConfirmed).toBe(true);
    expect(blocks[1].isConfirmed).toBe(false);
  });

  it("picks dominantTitle from the member with the largest duration", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        window_title: "short task",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:05:00",
        duration: 300,
      }),
      makeActivity({
        id: 2,
        window_title: "long task",
        started_at: "2026-06-01T09:05:00",
        ended_at: "2026-06-01T09:30:00",
        duration: 1500,
      }),
      makeActivity({
        id: 3,
        window_title: "medium task",
        started_at: "2026-06-01T09:30:00",
        ended_at: "2026-06-01T09:40:00",
        duration: 600,
      }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].dominantTitle).toBe("long task");
  });

  it("handles unsorted input", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 2,
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
        duration: 600,
      }),
      makeActivity({
        id: 3,
        started_at: "2026-06-01T09:20:00",
        ended_at: "2026-06-01T09:30:00",
        duration: 600,
      }),
      makeActivity({
        id: 1,
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
        duration: 600,
      }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].activityIds).toEqual([1, 2, 3]);
    expect(blocks[0].startedAt).toBe("2026-06-01T09:00:00");
    expect(blocks[0].endedAt).toBe("2026-06-01T09:30:00");
    expect(blocks[0].totalDuration).toBe(1800);
  });

  it("does not mutate the input array", () => {
    const activities = [
      makeActivity({
        id: 2,
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
      }),
      makeActivity({
        id: 1,
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
    ];
    mergeActivitiesIntoBlocks(activities);
    expect(activities.map((a) => a.id)).toEqual([2, 1]);
  });

  it("keeps the latest endedAt when a member is contained in the block (overlap)", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:30:00",
        duration: 1800,
      }),
      makeActivity({
        id: 2,
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:20:00",
        duration: 600,
      }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].endedAt).toBe("2026-06-01T09:30:00");
    expect(blocks[0].totalDuration).toBe(2400);
  });

  it("produces alternating blocks for interleaved apps", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:10:00",
      }),
      makeActivity({
        id: 2,
        app_name: "Slack",
        started_at: "2026-06-01T09:10:00",
        ended_at: "2026-06-01T09:15:00",
      }),
      makeActivity({
        id: 3,
        app_name: "Code",
        started_at: "2026-06-01T09:15:00",
        ended_at: "2026-06-01T09:25:00",
      }),
    ]);
    // The intervening Slack activity breaks the chain — only adjacent
    // activities merge, so the second Code activity starts a new block
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.appName)).toEqual(["Code", "Slack", "Code"]);
  });
});

describe("DEFAULT_MAX_INTERRUPTION_SECONDS", () => {
  it("is 60 seconds", () => {
    expect(DEFAULT_MAX_INTERRUPTION_SECONDS).toBe(60);
  });
});

describe("session-niveau absorption (kort fremmed afbrydelse)", () => {
  it("(a) krydsprojekt-værn: forskellige projekter må ALDRIG kollapse via en fremmed afbrydelse", () => {
    // proj-X → Chrome (30s) → proj-Y. Selv om afbrydelsen er kort må de to
    // FORSKELLIGE projekter ALDRIG ende i samme blok (faktureringsværn).
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:40:00",
        duration: 2400,
      }),
      makeActivity({
        id: 2,
        app_name: "Chrome",
        project_id: null,
        started_at: "2026-06-01T09:40:00",
        ended_at: "2026-06-01T09:40:30",
        duration: 30,
      }),
      makeActivity({
        id: 3,
        app_name: "Code",
        project_id: "proj-Y",
        started_at: "2026-06-01T09:40:30",
        ended_at: "2026-06-01T10:05:30",
        duration: 1500,
      }),
    ]);
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.projectId)).toEqual(["proj-X", null, "proj-Y"]);
  });

  it("(b) absorberer en kort fremmed afbrydelse mellem samme projekt til ÉN blok", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        project_id: "proj-X",
        window_title: "hovedarbejde",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:40:00",
        duration: 2400,
      }),
      makeActivity({
        id: 2,
        app_name: "Chrome",
        project_id: null,
        window_title: "opslag",
        started_at: "2026-06-01T09:40:00",
        ended_at: "2026-06-01T09:40:30",
        duration: 30,
      }),
      makeActivity({
        id: 3,
        app_name: "Code",
        project_id: "proj-X",
        window_title: "mere kode",
        started_at: "2026-06-01T09:40:30",
        ended_at: "2026-06-01T10:05:30",
        duration: 1500,
      }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].projectId).toBe("proj-X");
    // afbrydelsens id og varighed indgår i sessionen
    expect(blocks[0].activityIds).toEqual([1, 2, 3]);
    expect(blocks[0].totalDuration).toBe(2400 + 30 + 1500);
    expect(blocks[0].startedAt).toBe("2026-06-01T09:00:00");
    expect(blocks[0].endedAt).toBe("2026-06-01T10:05:30");
    // dominantTitle = det største Code-segment, ikke afbrydelsen
    expect(blocks[0].dominantTitle).toBe("hovedarbejde");
  });

  it("(b2) faktureringsværn: en afbrydelse med sit EGET kendte projekt absorberes ALDRIG", () => {
    // Chrome er AI-klassificeret til proj-Y (en anden kunde). Selv om den er
    // kort og flankeret af proj-X, må den ikke foldes ind — ellers ville en
    // bekræftelse af sessionen omklassificere proj-Y → proj-X (fejl-fakturering).
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:40:00",
        duration: 2400,
      }),
      makeActivity({
        id: 2,
        app_name: "Chrome",
        project_id: "proj-Y",
        started_at: "2026-06-01T09:40:00",
        ended_at: "2026-06-01T09:40:30",
        duration: 30,
      }),
      makeActivity({
        id: 3,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:40:30",
        ended_at: "2026-06-01T10:05:30",
        duration: 1500,
      }),
    ]);
    // proj-Y bevares som sin egen blok — dens id må aldrig ende i proj-X-sessionen.
    expect(
      blocks.every(
        (b) => !b.activityIds.includes(2) || b.projectId === "proj-Y",
      ),
    ).toBe(true);
    const yBlock = blocks.find((b) => b.projectId === "proj-Y");
    expect(yBlock?.activityIds).toEqual([2]);
  });

  it("(c) en fremmed afbrydelse OVER maxInterruptionSeconds absorberes IKKE", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:40:00",
        duration: 2400,
      }),
      makeActivity({
        id: 2,
        app_name: "Chrome",
        project_id: null,
        // 90s afbrydelse — over default-tærsklen på 60s
        started_at: "2026-06-01T09:40:00",
        ended_at: "2026-06-01T09:41:30",
        duration: 90,
      }),
      makeActivity({
        id: 3,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:41:30",
        ended_at: "2026-06-01T10:05:30",
        duration: 1500,
      }),
    ]);
    expect(blocks).toHaveLength(3);
  });

  it("(d) en afbrydelse flankeret af FORSKELLIGE projekter danner aldrig bro", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:40:00",
        duration: 2400,
      }),
      makeActivity({
        id: 2,
        app_name: "Slack",
        project_id: null,
        started_at: "2026-06-01T09:40:00",
        ended_at: "2026-06-01T09:40:20",
        duration: 20,
      }),
      makeActivity({
        id: 3,
        app_name: "Code",
        project_id: "proj-Y",
        started_at: "2026-06-01T09:40:20",
        ended_at: "2026-06-01T10:05:00",
        duration: 1480,
      }),
    ]);
    expect(blocks).toHaveLength(3);
  });

  it("(e) maxInterruptionSeconds er konfigurerbar og respekteres", () => {
    const activities = [
      makeActivity({
        id: 1,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:40:00",
        duration: 2400,
      }),
      makeActivity({
        id: 2,
        app_name: "Chrome",
        project_id: null,
        // 45s afbrydelse
        started_at: "2026-06-01T09:40:00",
        ended_at: "2026-06-01T09:40:45",
        duration: 45,
      }),
      makeActivity({
        id: 3,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:40:45",
        ended_at: "2026-06-01T10:05:45",
        duration: 1500,
      }),
    ];
    // Under en tærskel på 30s: for lang, ikke absorberet
    expect(
      mergeActivitiesIntoBlocks(activities, { maxInterruptionSeconds: 30 }),
    ).toHaveLength(3);
    // Under en tærskel på 60s: absorberet til én blok
    expect(
      mergeActivitiesIntoBlocks(activities, { maxInterruptionSeconds: 60 }),
    ).toHaveLength(1);
  });

  it("absorberer aldrig to på hinanden følgende fremmede segmenter som én bro", () => {
    // proj-X → Chrome (20s) → Slack (20s) → proj-X. Der er INGEN ægte
    // flankering af ét enkelt fremmed segment, så ingen absorption.
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:40:00",
        duration: 2400,
      }),
      makeActivity({
        id: 2,
        app_name: "Chrome",
        project_id: null,
        started_at: "2026-06-01T09:40:00",
        ended_at: "2026-06-01T09:40:20",
        duration: 20,
      }),
      makeActivity({
        id: 3,
        app_name: "Slack",
        project_id: null,
        started_at: "2026-06-01T09:40:20",
        ended_at: "2026-06-01T09:40:40",
        duration: 20,
      }),
      makeActivity({
        id: 4,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:40:40",
        ended_at: "2026-06-01T10:05:00",
        duration: 1460,
      }),
    ]);
    expect(blocks).toHaveLength(4);
  });

  it("absorberer en kædet afbrydelse på begge sider (A f A f A)", () => {
    const blocks = mergeActivitiesIntoBlocks([
      makeActivity({
        id: 1,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:00:00",
        ended_at: "2026-06-01T09:20:00",
        duration: 1200,
      }),
      makeActivity({
        id: 2,
        app_name: "Chrome",
        project_id: null,
        started_at: "2026-06-01T09:20:00",
        ended_at: "2026-06-01T09:20:30",
        duration: 30,
      }),
      makeActivity({
        id: 3,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:20:30",
        ended_at: "2026-06-01T09:40:00",
        duration: 1170,
      }),
      makeActivity({
        id: 4,
        app_name: "Chrome",
        project_id: null,
        started_at: "2026-06-01T09:40:00",
        ended_at: "2026-06-01T09:40:30",
        duration: 30,
      }),
      makeActivity({
        id: 5,
        app_name: "Code",
        project_id: "proj-X",
        started_at: "2026-06-01T09:40:30",
        ended_at: "2026-06-01T10:00:00",
        duration: 1170,
      }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].activityIds).toEqual([1, 2, 3, 4, 5]);
    expect(blocks[0].totalDuration).toBe(1200 + 30 + 1170 + 30 + 1170);
  });
});
