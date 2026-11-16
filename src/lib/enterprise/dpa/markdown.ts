/**
 * Minimal, deterministisk markdown-parser til juridiske tekster (DPA).
 * Delt mellem web-visningen (SimpleMarkdown) og PDF'en, så de to aldrig viser
 * forskellig tekst. Understøtter overskrifter (#–###), afsnit, punktlister,
 * tabeller, hr, **fed**, *kursiv* og `kode`. Ingen HTML-passthrough.
 */

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string };

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[] | null; rows: string[][] }
  | { kind: "hr" };

export function parseInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", text: text.slice(last, idx) });
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push({ kind: "bold", text: tok.slice(2, -2) });
    } else if (tok.startsWith("`")) {
      out.push({ kind: "code", text: tok.slice(1, -1) });
    } else {
      out.push({ kind: "italic", text: tok.slice(1, -1) });
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isHr = (t: string) => /^---+$/.test(t);
const isListItem = (t: string) => /^[-*]\s+/.test(t);
const isHeading = (t: string) => /^(#{1,3})\s/.test(t);

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed === "") {
      i++;
      continue;
    }
    if (isHr(trimmed)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
      i++;
      continue;
    }
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = splitTableRow(lines[i]);
        if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push({ kind: "table", head: head ?? null, rows: body });
      continue;
    }
    if (isListItem(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "list", items });
      continue;
    }
    // Afsnit: saml linjer indtil blank linje eller blok-start
    const para: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (
        t === "" ||
        isHeading(t) ||
        t.startsWith("|") ||
        isListItem(t) ||
        isHr(t)
      ) {
        break;
      }
      para.push(t);
      i++;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }

  return blocks;
}
