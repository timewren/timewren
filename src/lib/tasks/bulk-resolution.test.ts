import { describe, expect, it } from "vitest";
import {
  assertTaskBulkResolutionHash,
  buildTaskBulkResolutionPreview,
} from "./bulk-resolution";

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";

const rows = [
  {
    id: FIRST_ID,
    title: "Eksempel ordre-eksport 01-08-2026",
    status: "backlog",
    statusId: null,
    sourceType: "email",
    emailRelevanceFeedback: null,
    completedAt: null,
    updatedAt: new Date("2026-08-01T08:00:00.000Z"),
  },
  {
    id: SECOND_ID,
    title: "Svar kunden om leverancen",
    status: "todo",
    statusId: null,
    sourceType: "email",
    emailRelevanceFeedback: "relevant",
    completedAt: null,
    updatedAt: new Date("2026-08-01T09:00:00.000Z"),
  },
] as const;

describe("buildTaskBulkResolutionPreview", () => {
  it("builds the same hash regardless of input order", () => {
    const requested = [
      { id: SECOND_ID, expectedStatus: "todo" },
      { id: FIRST_ID, expectedStatus: "backlog" },
    ] as const;

    const first = buildTaskBulkResolutionPreview({
      requested,
      rows,
      resolution: "irrelevant",
    });
    const second = buildTaskBulkResolutionPreview({
      requested: [...requested].reverse(),
      rows: [...rows].reverse(),
      resolution: "irrelevant",
    });

    expect(first.hash).toBe(second.hash);
    expect(first.items.map((item) => item.id)).toEqual([FIRST_ID, SECOND_ID]);
  });

  it("marks only the explicit rows done and irrelevant", () => {
    const preview = buildTaskBulkResolutionPreview({
      requested: [{ id: FIRST_ID, expectedStatus: "backlog" }],
      rows: [rows[0]],
      resolution: "irrelevant",
    });

    expect(preview.count).toBe(1);
    expect(preview.items[0]).toMatchObject({
      id: FIRST_ID,
      before: { status: "backlog", emailRelevanceFeedback: null },
      after: { status: "done", emailRelevanceFeedback: "irrelevant" },
    });
  });

  it("preserves relevance feedback when a real task is resolved", () => {
    const preview = buildTaskBulkResolutionPreview({
      requested: [{ id: SECOND_ID, expectedStatus: "todo" }],
      rows: [rows[1]],
      resolution: "resolved",
    });

    expect(preview.items[0]?.after.emailRelevanceFeedback).toBe("relevant");
  });

  it("rejects duplicate ids, missing rows, and stale statuses", () => {
    expect(() =>
      buildTaskBulkResolutionPreview({
        requested: [
          { id: FIRST_ID, expectedStatus: "backlog" },
          { id: FIRST_ID, expectedStatus: "backlog" },
        ],
        rows: [rows[0]],
        resolution: "irrelevant",
      }),
    ).toThrow("dublerede UUID'er");

    expect(() =>
      buildTaskBulkResolutionPreview({
        requested: [{ id: SECOND_ID, expectedStatus: "todo" }],
        rows: [],
        resolution: "resolved",
      }),
    ).toThrow("mangler eller er uden for dit arbejdsområde");

    expect(() =>
      buildTaskBulkResolutionPreview({
        requested: [{ id: FIRST_ID, expectedStatus: "todo" }],
        rows: [rows[0]],
        resolution: "resolved",
      }),
    ).toThrow("forventet status");
  });

  it("rejects non-email tasks and tasks using custom lanes", () => {
    expect(() =>
      buildTaskBulkResolutionPreview({
        requested: [{ id: FIRST_ID, expectedStatus: "backlog" }],
        rows: [{ ...rows[0], sourceType: "manual" }],
        resolution: "resolved",
      }),
    ).toThrow("ikke en mailopgave");

    expect(() =>
      buildTaskBulkResolutionPreview({
        requested: [{ id: FIRST_ID, expectedStatus: "backlog" }],
        rows: [
          {
            ...rows[0],
            statusId: "33333333-3333-4333-8333-333333333333",
          },
        ],
        resolution: "resolved",
      }),
    ).toThrow("bruger en brugerdefineret bane");
  });
});

describe("assertTaskBulkResolutionHash", () => {
  it("rejects an apply request built from a stale preview", () => {
    const preview = buildTaskBulkResolutionPreview({
      requested: [{ id: FIRST_ID, expectedStatus: "backlog" }],
      rows: [rows[0]],
      resolution: "irrelevant",
    });

    expect(() => assertTaskBulkResolutionHash(preview, "0".repeat(64))).toThrow(
      "Dry-run er forældet",
    );
    expect(() =>
      assertTaskBulkResolutionHash(preview, preview.hash),
    ).not.toThrow();
  });
});
