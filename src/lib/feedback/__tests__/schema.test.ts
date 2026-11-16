/**
 * Feltnavnene i fixturet følger `bugbottle/report.schema.json` (BugReport) —
 * det er formen panelet poster til `/api/feedback`.
 */

import { describe, expect, it } from "vitest";
import { parseBugbottleReport } from "../report";
import { feedbackSubmitSchema } from "../schema";

/** Kører rapporten gennem rutens oversættelse og giver input'et tilbage. */
function parse(report: Record<string, unknown>) {
  const result = parseBugbottleReport(report);
  if (!result.ok) throw new Error(result.error);
  return result.input;
}

const bugbottleReport = {
  type: "bug",
  message: "Timeren stoppede ikke da jeg lukkede fanen",
  context: {
    url: "/dashboard/timer?tab=uge",
    viewport: "1440x900",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    language: "da-DK",
    timezone: "Europe/Copenhagen",
    screen: "2560x1440@2",
    colorScheme: "dark",
    online: true,
    connection: "4g",
  },
  console: [
    {
      ts: "2026-09-16T10:00:00.000Z",
      level: "error",
      message: "Uncaught TypeError: cannot read properties of null",
      stack: [
        { file: "/_next/static/chunk.js", line: 12, col: 34, fn: "stopTimer" },
        { file: "/_next/static/chunk.js", line: 99, col: 1 },
      ],
    },
  ],
  notes: ["Billedet ville ikke passe og blev droppet"],
  // extra fra TimeTracks egen boble — buildReport lægger det på øverste niveau
  appVersion: "1.2.3",
  timer: {
    isRunning: true,
    projectId: "proj-1",
    clientId: null,
    startTime: 1_757_000_000_000,
  },
};

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("parseBugbottleReport", () => {
  it("accepterer et bugbottle-payload med stack frames og ny kontekst", () => {
    const input = parse(bugbottleReport);
    expect(input.type).toBe("bug");
    expect(input.context.language).toBe("da-DK");
    expect(input.context.colorScheme).toBe("dark");
    expect(input.context.notes).toHaveLength(1);
    expect(input.context.console?.[0].stack?.[0]).toMatchObject({
      file: "/_next/static/chunk.js",
      line: 12,
      col: 34,
      fn: "stopTimer",
    });
    expect(input.context.timer?.projectId).toBe("proj-1");
  });

  it("oversætter idea til feature og other til feedback", () => {
    expect(parse({ ...bugbottleReport, type: "idea" }).type).toBe("feature");
    expect(parse({ ...bugbottleReport, type: "other" }).type).toBe("feedback");
  });

  it("afviser en tom besked og en ukendt type med rutens fejltekst", () => {
    expect(
      parseBugbottleReport({ ...bugbottleReport, message: "   " }),
    ).toEqual({ ok: false, error: "Skriv en besked" });
    expect(parseBugbottleReport({ ...bugbottleReport, type: "ros" })).toEqual({
      ok: false,
      error: "Ukendt rapporttype",
    });
    expect(parseBugbottleReport(null)).toEqual({
      ok: false,
      error: "Ugyldig rapport",
    });
  });

  it("gemmer breadcrumbs som de kom, de nyeste 30", () => {
    const crumbs = Array.from({ length: 35 }, (_, i) => ({
      ts: `2026-10-25T10:00:${String(i % 60).padStart(2, "0")}.000Z`,
      kind: "click",
      target: `button:nth-of-type(${i})`,
      text: "Gem",
    }));
    crumbs.push({
      ts: "2026-10-25T10:01:00.000Z",
      kind: "navigation",
      // @ts-expect-error navigation har from/to i stedet for target
      from: "/dashboard",
      to: "/dashboard/timer",
    });
    const input = parse({ ...bugbottleReport, breadcrumbs: crumbs });
    expect(input.context.breadcrumbs).toHaveLength(30);
    expect(input.context.breadcrumbs?.at(-1)).toEqual({
      ts: "2026-10-25T10:01:00.000Z",
      kind: "navigation",
      from: "/dashboard",
      to: "/dashboard/timer",
    });
  });

  it("dropper breadcrumbs af ukendt art og klipper teksten til 40 tegn", () => {
    const input = parse({
      ...bugbottleReport,
      breadcrumbs: [
        { ts: "2026-10-25T10:00:00.000Z", kind: "keypress", target: "x" },
        {
          ts: "2026-10-25T10:00:01.000Z",
          kind: "click",
          text: "a".repeat(100),
        },
      ],
    });
    expect(input.context.breadcrumbs).toHaveLength(1);
    expect(input.context.breadcrumbs?.[0].text).toHaveLength(40);
  });

  it("gemmer screenshotRegion, når der er et billede", () => {
    const region = {
      mode: "area",
      rect: { x: 10, y: 1200, width: 300, height: 200 },
      viewport: { x: 10, y: 200, width: 300, height: 200 },
    };
    const input = parse({
      ...bugbottleReport,
      screenshotDataUrl: PNG,
      screenshotRegion: region,
    });
    expect(input.context.screenshotRegion).toEqual(region);
  });

  it("dropper screenshotRegion uden billede og et område med ugyldig størrelse", () => {
    const region = {
      mode: "element",
      rect: { x: 0, y: 0, width: 50, height: 20 },
      viewport: { x: 0, y: 0, width: 50, height: 20 },
      selector: "#gem",
    };
    expect(
      parse({ ...bugbottleReport, screenshotRegion: region }).context
        .screenshotRegion,
    ).toBeUndefined();
    expect(
      parse({
        ...bugbottleReport,
        screenshotDataUrl: PNG,
        screenshotRegion: {
          ...region,
          rect: { x: 0, y: 0, width: 0, height: 0 },
        },
      }).context.screenshotRegion,
    ).toBeUndefined();
  });

  it("holder et elements koordinater inden for loftet", () => {
    const input = parse({
      ...bugbottleReport,
      elements: [
        {
          selector: "#gem",
          tag: "button",
          text: "Gem",
          rect: { x: 1e12, y: -1e12, width: 40, height: 20 },
          attributes: { id: "gem" },
        },
      ],
    });
    expect(input.context.elements?.[0].rect).toEqual({
      x: 1_000_000,
      y: -1_000_000,
      width: 40,
      height: 20,
    });
  });
});

describe("feedbackSubmitSchema", () => {
  it("afviser en rapport uden kontekst-grundfelter", () => {
    const parsed = feedbackSubmitSchema.safeParse({
      type: "bug",
      message: "noget gik galt",
      context: { appVersion: "1.0.0" },
    });
    expect(parsed.success).toBe(false);
  });

  it("afviser flere end 30 breadcrumbs og for lange felter", () => {
    const base = parse(bugbottleReport);
    const crumb = { ts: "2026-10-25T10:00:00.000Z", kind: "click" as const };
    expect(
      feedbackSubmitSchema.safeParse({
        ...base,
        context: { ...base.context, breadcrumbs: Array(31).fill(crumb) },
      }).success,
    ).toBe(false);
    expect(
      feedbackSubmitSchema.safeParse({
        ...base,
        context: {
          ...base.context,
          breadcrumbs: [{ ...crumb, text: "x".repeat(41) }],
        },
      }).success,
    ).toBe(false);
    expect(
      feedbackSubmitSchema.safeParse({
        ...base,
        context: {
          ...base.context,
          screenshotRegion: {
            mode: "area",
            rect: { x: 0, y: 0, width: 2_000_000, height: 1 },
            viewport: { x: 0, y: 0, width: 1, height: 1 },
          },
        },
      }).success,
    ).toBe(false);
  });
});
