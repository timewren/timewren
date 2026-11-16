import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DPA_MARKDOWN } from "./content";
import { formatDanishDateTime } from "./format";
import { parseMarkdownBlocks } from "./markdown";
import { DPA_SHA256, DPA_SHA256_SHORT, dpaBodyMarkdown } from "./meta";
import { renderDpaPdf } from "./pdf";

// Sæt DPA_PDF_OUT=<mappe> for at gemme PDF'erne til visuel kontrol.
function save(name: string, buf: Buffer) {
  const dir = process.env.DPA_PDF_OUT;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), buf);
}

function pageCount(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

describe("DPA-PDF", () => {
  it("sha256 i footeren er af hele aftaleteksten", () => {
    const expected = createHash("sha256").update(DPA_MARKDOWN).digest("hex");
    expect(DPA_SHA256).toBe(expected);
    expect(DPA_SHA256_SHORT).toBe(expected.slice(0, 16));
  });

  it("parseren finder bilag C's tabeller", () => {
    const blocks = parseMarkdownBlocks(dpaBodyMarkdown());
    const idx = blocks.findIndex(
      (b) => b.kind === "heading" && b.text.startsWith("Bilag C"),
    );
    expect(idx).toBeGreaterThan(0);
    const tables = blocks
      .slice(idx)
      .filter((b) => b.kind === "table") as Extract<
      (typeof blocks)[number],
      { kind: "table" }
    >[];
    expect(tables.length).toBeGreaterThanOrEqual(2);
    expect(tables[0].head).toEqual([
      "Underdatabehandler",
      "Ydelse",
      "Lokation",
      "Overførselsgrundlag",
    ]);
  });

  it("brødteksten har hverken titel eller versionslinje", () => {
    const body = dpaBodyMarkdown();
    expect(body.startsWith("# ")).toBe(false);
    expect(body).not.toMatch(/^\*\*Version/);
  });

  it("formaterer acceptens tidspunkt i dansk tid", () => {
    // 11/10-2026 12:05 UTC = 14.05 i dansk sommertid
    expect(formatDanishDateTime(new Date("2026-10-11T12:05:00Z"))).toBe(
      "11. oktober 2026 kl. 14.05",
    );
    // Vintertid: 1/12 08:30 UTC = 09.30
    expect(formatDanishDateTime(new Date("2026-12-01T08:30:00Z"))).toBe(
      "1. december 2026 kl. 09.30",
    );
  });

  it("renderer den generelle og den udfyldte PDF uden manglende tegn", async () => {
    const general = await renderDpaPdf(null, { strictGlyphs: true });
    expect(general.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(general)).toBeGreaterThanOrEqual(5);
    save("dpa-generel.pdf", general);

    const filled = await renderDpaPdf(
      {
        customerName: "Testfirma Ærø ApS",
        cvr: "12345678",
        acceptance: {
          name: "Test Ejer",
          acceptedAt: new Date("2026-10-11T12:05:00Z"),
          version: "1.1",
        },
      },
      { strictGlyphs: true },
    );
    expect(filled.subarray(0, 5).toString()).toBe("%PDF-");
    save("dpa-udfyldt.pdf", filled);
  }, 60_000);
});
