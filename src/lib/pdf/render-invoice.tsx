import { render } from "takumi-pdf";
import { PageNumber, TotalPages } from "takumi-pdf/primitives";
import {
  InvoiceDocument,
  type InvoiceDocumentProps,
} from "@/components/pdf/InvoiceDocument";
import { BRAND_LIGHT } from "@/lib/brand/tokens";
import { TT_IKON_PNG_BASE64 } from "@/lib/pdf/brand-icon";
import { PDF_FONT_FAMILY, pdfFonts } from "@/lib/pdf/fonts";

const LOGO_FETCH_TIMEOUT_MS = 4_000;
const TT_IKON_SRC = "timetrack-ikon.png";
let ikonCache: Uint8Array | null = null;
const ikonBytes = () =>
  (ikonCache ??= new Uint8Array(Buffer.from(TT_IKON_PNG_BASE64, "base64")));

/**
 * Takumi henter ikke selv billeder — logoet hentes her med kort timeout, og
 * fakturaen renderes uden logo hvis det fejler (frem for at blokere sending).
 */
async function fetchLogo(
  url: string | null | undefined,
): Promise<{ src: string; data: Uint8Array }[]> {
  if (!url || !/^https?:\/\//.test(url)) return [];
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return [{ src: url, data: new Uint8Array(await res.arrayBuffer()) }];
  } catch {
    return [];
  }
}

export async function renderInvoicePdfTakumi(
  props: InvoiceDocumentProps,
): Promise<Buffer> {
  const logoUrl = props.template?.logoUrl || props.companyProfile?.logoUrl;
  const images = await fetchLogo(logoUrl);
  // Uden bytes ville takumi fejle på <img> — drop logoet i stedet
  const safeProps: InvoiceDocumentProps =
    images.length > 0
      ? props
      : {
          ...props,
          template: props.template
            ? { ...props.template, logoUrl: null }
            : props.template,
          companyProfile: props.companyProfile
            ? { ...props.companyProfile, logoUrl: null }
            : props.companyProfile,
        };

  const pdf = await render(<InvoiceDocument {...safeProps} />, {
    size: "a4",
    margin: { top: 40, right: 40, bottom: 44, left: 40 },
    fonts: pdfFonts(),
    fontFamilies: [PDF_FONT_FAMILY, "sans-serif"],
    images: [...images, { src: TT_IKON_SRC, data: ikonBytes() }],
    footer: (
      <div
        style={{
          alignItems: "center",
          color: BRAND_LIGHT.graa,
          display: "flex",
          fontFamily: PDF_FONT_FAMILY,
          fontSize: 8,
          justifyContent: "space-between",
          // Footer-feltet går kant til kant; ryk teksten ind til sidemargen.
          padding: "0 40px",
          width: "100%",
        }}
      >
        <span style={{ alignItems: "center", display: "flex", gap: 4 }}>
          {/* biome-ignore lint/performance/noImgElement: takumi renderer PDF, ikke en webside */}
          <img src={TT_IKON_SRC} width={9} height={9} alt="" />
          Genereret af TimeTrack
        </span>
        <span>
          Side <PageNumber /> af <TotalPages />
        </span>
      </div>
    ),
  });
  return Buffer.from(pdf);
}
