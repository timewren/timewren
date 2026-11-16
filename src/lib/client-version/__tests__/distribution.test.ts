import { describe, expect, it } from "vitest";
import { summarizeClientVersions } from "../distribution";

const at = new Date("2026-10-03T10:00:00Z");

describe("summarizeClientVersions", () => {
  it("samler pr. type+version og markerer status mod minimum", () => {
    const rows = summarizeClientVersions(
      [
        {
          clientHint: "extension@2.5.2 extension/chrome",
          source: "extension",
          writes: 10,
          rejected: 0,
          users: 3,
          lastAt: at,
        },
        {
          clientHint: "extension@2.5.2 extension/firefox",
          source: "extension",
          writes: 2,
          rejected: 0,
          users: 1,
          lastAt: at,
        },
        {
          clientHint: "extension/chrome",
          source: "extension",
          writes: 4,
          rejected: 1,
          users: 2,
          lastAt: at,
        },
        {
          clientHint: "chrome/windows",
          source: "web",
          writes: 7,
          rejected: 0,
          users: 2,
          lastAt: at,
        },
        {
          clientHint: "web@e64648eaabcd chrome/mac",
          source: "web",
          writes: 5,
          rejected: 0,
          users: 1,
          lastAt: at,
        },
      ],
      { extension: "2.5.2" },
    );
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "extension",
        version: "2.5.2",
        status: "ok",
        writes: 12,
        users: 3,
      }),
      expect.objectContaining({
        kind: "extension",
        version: null,
        status: "below",
        writes: 4,
        rejected: 1,
      }),
      expect.objectContaining({
        kind: "web",
        version: "e64648eaabcd",
        status: "ok",
      }),
      expect.objectContaining({
        kind: "web",
        version: null,
        status: "unknown",
      }),
    ]);
  });

  it("uden minimum er versionerede klienter ok og gamle extensions ukendte", () => {
    const rows = summarizeClientVersions(
      [
        {
          clientHint: "mobile@1.0.0+5 mobilapp/ios",
          source: "mobile",
          writes: 1,
          rejected: 0,
          users: 1,
          lastAt: null,
        },
        {
          clientHint: "extension/chrome",
          source: "extension",
          writes: 1,
          rejected: 0,
          users: 1,
          lastAt: null,
        },
      ],
      {},
    );
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ["extension", "unknown"],
      ["mobile", "ok"],
    ]);
  });
});
