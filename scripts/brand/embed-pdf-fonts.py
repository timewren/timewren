"""Indlejrer Schibsted Grotesk i PDF-motorerne som base64.

    python scripts/brand/embed-pdf-fonts.py <SchibstedGrotesk[wght].ttf>

Kilden er den variable font fra Google Fonts
(https://github.com/google/fonts/tree/main/ofl/schibstedgrotesk, SIL OFL 1.1).
Scriptet laver statiske instanser i vægtene 400, 600 og 700, subsætter dem
til latin og latin-ext (æøå, €, typografiske tegn) og skriver
src/lib/pdf/fonts/schibsted-grotesk.ts. TTF bruges, fordi både react-pdf
(fontkit, via data-URI) og takumi læser det, og intet hentes over nettet
ved render. Kræver fonttools (pip install fonttools).
"""

import base64
import io
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

WEIGHTS = {"REGULAR": 400, "SEMIBOLD": 600, "BOLD": 700}
UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x250))  # Latin-1 + Latin Extended-A/B
    + list(range(0x2000, 0x2070))  # mellemrum, bindestreger, anførselstegn
    + [0x20AC, 0x2122, 0x2212, 0x2190, 0x2192]
)
OUT = Path(__file__).resolve().parents[2] / "src/lib/pdf/fonts/schibsted-grotesk.ts"


def build(src: Path, weight: int) -> bytes:
    font = TTFont(src)
    static = instancer.instantiateVariableFont(font, {"wght": weight})
    opts = subset.Options()
    opts.layout_features = ["kern", "liga", "tnum", "lnum", "case"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(static)
    buf = io.BytesIO()
    static.save(buf)
    return buf.getvalue()


def main() -> None:
    src = Path(sys.argv[1])
    lines = [
        "/**",
        " * Schibsted Grotesk (SIL Open Font License 1.1,",
        " * https://github.com/schibsted/schibsted-grotesk) som base64-TTF.",
        " * Indlejres i PDF'er af react-pdf (data-URI) og takumi-pdf, så intet",
        " * hentes over nettet ved render. Statiske instanser af den variable",
        " * font, subsat til latin og latin-ext.",
        " * Genereres af scripts/brand/embed-pdf-fonts.py; redigér ikke i hånden.",
        " */",
        "",
    ]
    for name, weight in WEIGHTS.items():
        data = build(src, weight)
        b64 = base64.b64encode(data).decode("ascii")
        lines.append(f"export const SCHIBSTED_{name}_WEIGHT = {weight};")
        lines.append(f"export const SCHIBSTED_{name}_BASE64 =\n  \"{b64}\";")
        lines.append("")
        print(f"{name} {weight}: {len(data)} bytes")
    OUT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"skrevet {OUT}")


if __name__ == "__main__":
    main()
