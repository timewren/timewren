import type { CSSProperties, ReactNode } from "react";
import { render } from "takumi-pdf";
import { PageNumber, TotalPages } from "takumi-pdf/primitives";
import { PDF_FONT_FAMILY, pdfFonts } from "@/lib/pdf/fonts";
import type { FilledDpaData } from "./filled";
import { formatDanishDateTime } from "./format";
import {
  type MarkdownBlock,
  parseInline,
  parseMarkdownBlocks,
} from "./markdown";
import {
  DPA_PROCESSOR_SIGNATURE,
  DPA_SHA256_SHORT,
  DPA_VERSION,
  DPA_VERSION_DATE,
  dpaBodyMarkdown,
} from "./meta";

/**
 * Databehandleraftalen som A4-PDF (takumi-pdf, samme motor som fakturaerne).
 * Brand efter docs/BRAND.md: sort tekst, granskov kun til overskriftslinjen,
 * Schibsted Grotesk indlejret via src/lib/pdf/fonts (intet hentes ved render).
 * Ingen billeder, heller ikke af en underskrift.
 */

const C = {
  ink: "#1A1D1C",
  grey: "#5F6663",
  line: "#DFE2DE",
  edge: "#8A918D",
  surface: "#F2F3F0",
  gran: "#1E5B47",
};
const FONT = PDF_FONT_FAMILY;

const col: CSSProperties = { display: "flex", flexDirection: "column" };
const row: CSSProperties = { display: "flex", flexDirection: "row" };

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((tok, i) => {
        const key = `${i}-${tok.kind}`;
        if (tok.kind === "bold") {
          return (
            <span key={key} style={{ fontWeight: 600 }}>
              {tok.text}
            </span>
          );
        }
        // Kursiv vises som almindelig tekst: der er ikke indlejret en
        // kursiv Schibsted, og takumis syntetiske skråtekst æder mellemrum.
        return <span key={key}>{tok.text}</span>;
      })}
    </>
  );
}

function Block({ b }: { b: MarkdownBlock }) {
  switch (b.kind) {
    case "hr":
      return (
        <div
          style={{
            borderTop: `1px solid ${C.line}`,
            marginTop: 14,
            marginBottom: 6,
          }}
        />
      );
    case "heading": {
      const Tag = b.level === 2 ? "h2" : "h3";
      return (
        <Tag
          style={{
            display: "block",
            fontSize: b.level === 2 ? 14 : 12,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            lineHeight: 1.25,
            marginTop: 16,
            marginBottom: 6,
          }}
        >
          <Inline text={b.text} />
        </Tag>
      );
    }
    case "list":
      return (
        <div style={{ ...col, gap: 3, marginBottom: 6 }}>
          {b.items.map((it, ii) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: statisk aftaletekst
            <div key={ii} style={{ ...row, gap: 6, breakInside: "avoid" }}>
              <span style={{ width: 8, flexShrink: 0 }}>•</span>
              <div style={{ display: "block", flex: 1 }}>
                <Inline text={it} />
              </div>
            </div>
          ))}
        </div>
      );
    case "table":
      return <Table head={b.head} rows={b.rows} />;
    default:
      return (
        <div style={{ display: "block", marginBottom: 7 }}>
          <Inline text={b.text} />
        </div>
      );
  }
}

/**
 * Takumi kender ikke break-after: avoid. En overskrift holdes derfor sammen
 * med det afsnit eller den liste, der følger, så den aldrig står alene nederst
 * på en side. Tabeller må gerne starte på samme side og fortsætte på næste.
 */
function groupBlocks(blocks: MarkdownBlock[]): MarkdownBlock[][] {
  const groups: MarkdownBlock[][] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const next = blocks[i + 1];
    if (
      b.kind === "heading" &&
      next &&
      (next.kind === "paragraph" || next.kind === "list")
    ) {
      groups.push([b, next]);
      i++;
    } else {
      groups.push([b]);
    }
  }
  return groups;
}

function Body({ markdown }: { markdown: string }) {
  const groups = groupBlocks(parseMarkdownBlocks(markdown));
  return (
    <div style={col}>
      {groups.map((g, gi) =>
        g.length === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: statisk aftaletekst
          <Block key={gi} b={g[0]} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: statisk aftaletekst
          <div key={gi} style={{ ...col, breakInside: "avoid" }}>
            <Block b={g[0]} />
            <Block b={g[1]} />
          </div>
        ),
      )}
    </div>
  );
}

function Table({ head, rows }: { head: string[] | null; rows: string[][] }) {
  const n = head?.length ?? rows[0]?.length ?? 1;
  // Første kolonne (navn/emne) lidt smallere end de beskrivende kolonner.
  const widths = n === 2 ? [28, 72] : n === 4 ? [24, 32, 20, 24] : [];
  const cell = (ci: number): CSSProperties => ({
    display: "block",
    width: widths[ci] ? `${widths[ci]}%` : undefined,
    flex: widths[ci] ? undefined : 1,
    paddingTop: 4,
    paddingBottom: 4,
    paddingRight: 8,
  });
  return (
    <div style={{ ...col, fontSize: 8.5, marginTop: 4, marginBottom: 10 }}>
      {head && (
        <div
          style={{
            ...row,
            fontWeight: 600,
            borderBottom: `1px solid ${C.edge}`,
          }}
        >
          {head.map((h, ci) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: statisk aftaletekst
            <div key={ci} style={cell(ci)}>
              <Inline text={h} />
            </div>
          ))}
        </div>
      )}
      {rows.map((r, ri) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: statisk aftaletekst
          key={ri}
          style={{
            ...row,
            borderBottom: `1px solid ${C.line}`,
            breakInside: "avoid",
          }}
        >
          {r.map((c, ci) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: statisk aftaletekst
            <div key={ci} style={cell(ci)}>
              <Inline text={c} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: 8, fontWeight: 600, color: C.grey }}>
      {children}
    </span>
  );
}

/** Et felt med værdi, eller en tom linje til udfyldning i hånden. */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ ...col, gap: 2, marginTop: 8 }}>
      <Label>{label}</Label>
      {value ? (
        <span style={{ fontSize: 10.5 }}>{value}</span>
      ) : (
        <div
          style={{
            borderBottom: `1px solid ${C.edge}`,
            height: 18,
            width: "100%",
          }}
        />
      )}
    </div>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        ...col,
        flex: 1,
        border: `1px solid ${C.line}`,
        borderRadius: 6,
        padding: 12,
      }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 700 }}>{title}</span>
      {children}
    </div>
  );
}

function Parties({ data }: { data: FilledDpaData | null }) {
  return (
    <div style={{ ...row, gap: 12, marginTop: 18, marginBottom: 16 }}>
      <Box title="Den dataansvarlige (Kunden)">
        <Field label="Navn" value={data?.customerName ?? null} />
        <Field label="CVR" value={data?.cvr ?? null} />
      </Box>
      <Box title="Databehandleren">
        <Field label="Navn" value="Mahope (Mahoje) v/ Mads Holst Jensen" />
        <Field label="CVR" value="39413892" />
      </Box>
    </div>
  );
}

function Signatures({ data }: { data: FilledDpaData | null }) {
  const acc = data?.acceptance ?? null;
  return (
    <div style={{ ...col, breakInside: "avoid", marginTop: 18 }}>
      <div
        style={{
          display: "block",
          fontSize: 14,
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Underskrifter
      </div>
      <div style={{ ...row, gap: 12 }}>
        <Box title="For Kunden">
          {acc ? (
            <>
              <div style={{ display: "block", fontSize: 10, marginTop: 8 }}>
                Accepteret elektronisk i TimeTrack af {acc.name} den{" "}
                {formatDanishDateTime(acc.acceptedAt)} (dansk tid).
              </div>
              <Field label="Version" value={acc.version} />
            </>
          ) : (
            <>
              <Field label="Dato" value={null} />
              <Field label="Navn" value={null} />
              <Field label="Underskrift" value={null} />
            </>
          )}
        </Box>
        <Box title="For Databehandleren">
          <div style={{ display: "block", fontSize: 10, marginTop: 8 }}>
            {DPA_PROCESSOR_SIGNATURE}.
          </div>
          <Field label="Version" value={DPA_VERSION} />
          <Field label="Offentliggjort" value={DPA_VERSION_DATE} />
        </Box>
      </div>
    </div>
  );
}

export function DpaDocument({ data }: { data: FilledDpaData | null }) {
  return (
    <div
      style={{
        ...col,
        color: C.ink,
        fontFamily: FONT,
        fontSize: 10,
        lineHeight: 1.5,
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "-0.02em" }}>
        TimeTrack
      </span>
      <div
        style={{
          display: "block",
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-0.035em",
          lineHeight: 1.1,
          marginTop: 18,
        }}
      >
        Databehandleraftale
      </div>
      <div
        style={{
          borderTop: `2px solid ${C.gran}`,
          width: 56,
          marginTop: 10,
          marginBottom: 10,
        }}
      />
      <span style={{ color: C.grey, fontSize: 10.5 }}>
        Efter GDPR artikel 28. Version {DPA_VERSION}, offentliggjort{" "}
        {DPA_VERSION_DATE}.
      </span>
      <Parties data={data} />
      <Body markdown={dpaBodyMarkdown()} />
      <Signatures data={data} />
    </div>
  );
}

/** data = null giver den generelle aftale med tomme felter til Kunden. */
export async function renderDpaPdf(
  data: FilledDpaData | null,
  opts: { strictGlyphs?: boolean } = {},
): Promise<Buffer> {
  const pdf = await render(<DpaDocument data={data} />, {
    size: "a4",
    margin: { top: 48, right: 52, bottom: 52, left: 52 },
    fonts: pdfFonts(),
    fontFamilies: [FONT],
    lang: "da",
    metadata: {
      title: `Databehandleraftale for TimeTrack, version ${DPA_VERSION}`,
      authors: ["Mahope (Mahoje) v/ Mads Holst Jensen"],
      creator: "TimeTrack",
    },
    outline: true,
    uncoveredText: opts.strictGlyphs ? "error" : "placeholder",
    footer: (
      <div
        style={{
          ...row,
          color: C.grey,
          fontFamily: FONT,
          fontSize: 7.5,
          justifyContent: "space-between",
          paddingLeft: 52,
          paddingRight: 52,
          width: "100%",
        }}
      >
        <span>
          Databehandleraftale version {DPA_VERSION}, tekstens sha256{" "}
          {DPA_SHA256_SHORT}
        </span>
        <span>
          Side <PageNumber /> af <TotalPages />
        </span>
      </div>
    ),
  });
  return Buffer.from(pdf);
}
