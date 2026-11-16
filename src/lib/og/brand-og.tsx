import {
  SCHIBSTED_BOLD_BASE64,
  SCHIBSTED_REGULAR_BASE64,
} from "@/lib/pdf/fonts/schibsted-grotesk";

/**
 * Fælles byggeklodser til OG-billeder (docs/BRAND.md → Klippekortet som
 * motiv; mockup docs/brand/flader.html → "Delingsbillede (OG)"). Schibsted
 * Grotesk indlejres fra samme base64-TTF som PDF'erne, så intet hentes over
 * nettet ved render.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

const C = {
  papir: "#FFFFFF",
  flade: "#F2F3F0",
  streg: "#DFE2DE",
  blaek: "#1A1D1C",
  graa: "#5F6663",
  gran: "#1E5B47",
};

function toArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

let fontCache: { name: string; data: ArrayBuffer; weight: 400 | 700 }[] | null =
  null;

export function ogFonts() {
  if (!fontCache) {
    fontCache = [
      {
        name: "Schibsted Grotesk",
        data: toArrayBuffer(SCHIBSTED_REGULAR_BASE64),
        weight: 400,
      },
      {
        name: "Schibsted Grotesk",
        data: toArrayBuffer(SCHIBSTED_BOLD_BASE64),
        weight: 700,
      },
    ];
  }
  return fontCache.map((f) => ({ ...f, style: "normal" as const }));
}

// tt-ikon.svg (docs/brand/logo) som data-URI; resvg tegner masken.
const IKON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64"><rect width="32" height="32" rx="7" fill="#1E5B47"/><defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect x="3" y="8" width="26" height="16" rx="2.5" fill="#fff"/><g fill="#000"><circle cx="3" cy="16" r="3"/><circle cx="29" cy="16" r="3"/><circle cx="17" cy="16" r="5.6"/></g></mask></defs><rect width="32" height="32" fill="#FFFFFF" mask="url(#m)"/><rect x="16.2" y="12" width="1.6" height="4.8" rx=".8" fill="#FFFFFF"/><rect x="16.2" y="15.2" width="4" height="1.8" rx=".8" fill="#FFFFFF"/></svg>`;
const IKON_SRC = `data:image/svg+xml;base64,${btoa(IKON_SVG)}`;

function Ordmaerke() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      {/* biome-ignore lint/performance/noImgElement: satori kræver <img> */}
      <img src={IKON_SRC} width={44} height={44} alt="" />
      <div
        style={{
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: C.blaek,
        }}
      >
        TimeTrack
      </div>
    </div>
  );
}

/** Mini-klippekort: 20 huller, 13 brugt = 7 t tilbage (samme eksempel som forsiden). */
function MiniKlippekort() {
  const total = 20;
  const brugt = 13;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 400,
        padding: 30,
        background: C.papir,
        border: `2px solid ${C.streg}`,
        borderRadius: 20,
        boxShadow: "0 24px 48px -30px rgba(26,29,28,0.55)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 20,
        }}
      >
        <div style={{ fontWeight: 700, color: C.blaek }}>
          Bageriet på hjørnet
        </div>
        <div style={{ color: C.graa }}>20 timer</div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 22,
          width: 330,
        }}
      >
        {Array.from({ length: total }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fast rækkefølge
            key={i}
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              border: `2px solid ${C.gran}`,
              background: i < brugt ? C.gran : C.papir,
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginTop: 24,
          paddingTop: 16,
          borderTop: `2px dashed ${C.streg}`,
        }}
      >
        <div
          style={{
            fontSize: 52,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: C.blaek,
          }}
        >
          7 t
        </div>
        <div style={{ fontSize: 22, color: C.graa }}>tilbage af 20</div>
      </div>
    </div>
  );
}

/**
 * Hele billedet: ordmærke og overskrift til venstre, mini-klippekort til
 * højre. `score` erstatter klippekortet med en score (Freelance Health Check).
 */
export function BrandOg({
  title,
  subtitle,
  badge,
  score,
  showKlippekort = true,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  score?: number | null;
  showKlippekort?: boolean;
}) {
  const long = title.length > 48;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 48,
        padding: "64px 72px",
        background: C.papir,
        fontFamily: "Schibsted Grotesk",
        color: C.blaek,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 28,
          flex: 1,
          minWidth: 0,
        }}
      >
        <Ordmaerke />
        {badge ? (
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              fontSize: 22,
              color: C.gran,
              background: "#E2EDE8",
              padding: "8px 18px",
              borderRadius: 999,
            }}
          >
            {badge}
          </div>
        ) : null}
        <div
          style={{
            fontSize: long ? 56 : 68,
            fontWeight: 700,
            lineHeight: 1.04,
            letterSpacing: "-0.035em",
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div style={{ fontSize: 28, lineHeight: 1.3, color: C.graa }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {typeof score === "number" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 260,
            height: 260,
            borderRadius: 999,
            border: `14px solid ${C.gran}`,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 96,
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {score}
          </div>
          <div style={{ display: "flex", fontSize: 26, color: C.graa }}>
            af 100
          </div>
        </div>
      ) : showKlippekort ? (
        <MiniKlippekort />
      ) : null}
    </div>
  );
}
