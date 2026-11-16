import { describe, expect, it } from "vitest";
import { type QuickStartRow, rankQuickStart } from "./quick-start";

const row = (over: Partial<QuickStartRow>): QuickStartRow => ({
  projectId: null,
  projectName: null,
  projectStatus: "active",
  projectClientId: null,
  entryClientId: null,
  clientName: null,
  clientArchived: false,
  createdAt: new Date("2026-10-01T08:00:00Z"),
  ...over,
});

describe("rankQuickStart", () => {
  it("sorterer efter antal poster og derefter senest brugt", () => {
    const rows = [
      row({
        projectId: "p1",
        projectClientId: "c1",
        createdAt: new Date("2026-09-01"),
      }),
      row({
        projectId: "p2",
        projectClientId: "c1",
        createdAt: new Date("2026-09-30"),
      }),
      row({
        projectId: "p1",
        projectClientId: "c1",
        createdAt: new Date("2026-09-02"),
      }),
      row({
        projectId: "p3",
        projectClientId: "c2",
        createdAt: new Date("2026-10-01"),
      }),
    ];
    const result = rankQuickStart(rows);
    expect(result.map((r) => r.projectId)).toEqual(["p1", "p3", "p2"]);
    expect(result[0].count).toBe(2);
    expect(result[0].lastUsed).toEqual(new Date("2026-09-02"));
  });

  it("bruger projektets kunde når posten ikke selv har en", () => {
    const [item] = rankQuickStart([
      row({ projectId: "p1", projectClientId: "c9", clientName: "Acme" }),
    ]);
    expect(item.clientId).toBe("c9");
    expect(item.clientName).toBe("Acme");
  });

  it("springer intern tid, arkiverede kunder og afsluttede projekter over", () => {
    const result = rankQuickStart([
      row({}),
      row({ entryClientId: "c1", clientArchived: true }),
      row({ projectId: "p1", projectStatus: "archived" }),
      row({ projectId: "p2", projectStatus: "completed" }),
      row({ entryClientId: "c2" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].clientId).toBe("c2");
    expect(result[0].projectId).toBeNull();
  });

  it("skelner mellem kun-kunde og projekt hos samme kunde", () => {
    const result = rankQuickStart([
      row({ entryClientId: "c1" }),
      row({ projectId: "p1", projectClientId: "c1" }),
    ]);
    expect(result).toHaveLength(2);
  });

  it("respekterer grænsen", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ projectId: `p${i}` }),
    );
    expect(rankQuickStart(rows, 4)).toHaveLength(4);
    expect(rankQuickStart(rows, 0)).toHaveLength(0);
  });
});
