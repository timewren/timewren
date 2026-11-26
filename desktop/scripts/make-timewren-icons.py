#!/usr/bin/env python3
"""Genererer TimeWrens app-ikoner og UI-mærke fra webmærket.

Masteren er `public/brand/timewren/mark.svg` i web-repoet (mahope/timetrack):
en flad SVG med en cirkel (kroppen/urskiven), en trekant (næbbet) og
en kapsel (halen/viseren), hvor viseren er klippet ud af kroppen med en maske.
En kopi ligger i `crates/tt-app/assets/brand/timewren/mark.svg`; udskift den og
kør scriptet igen, så følger alle billederne med:

    python3 scripts/make-timewren-icons.py            # skriv filerne
    python3 scripts/make-timewren-icons.py --previews /sti/til/mappe

Scriptet LÆSER SVG'en (viewBox, maske, cirkler, linjer og stier med M/L/Z) og
tegner den selv med kantudjævning, så det ikke skal bruge andet end Python 3.
Kender det ikke et element, stopper det frem for at gætte.

Skrevne filer:
  crates/tt-app/bundle/macos/TimeWren.icns      afrundet Lichen-flade med margen (som macOS-ikoner)
  crates/tt-app/bundle/windows/TimeWren.ico     16, 24, 32, 48, 64, 128 og 256 px
  crates/tt-app/assets/icons/tt-maerke-timewren.svg   mærket i `currentColor` til appens UI

Farverne er brandkittets: mærket i Wren (#8A5A2B) på en flade i Lichen
(#E8EDE3), som webbets egne app-ikoner (`icon-512.png`). `mark-light.svg`
(Lichen) og `mark-mono.svg` (Ink) bruges ikke her; de ligger i kopien, fordi
`scripts/check-brand.mjs` tjekker, at farverne i dem er de rigtige.
"""
import math
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND_DIR = ROOT / "crates/tt-app/assets/brand/timewren"
MASTER = BRAND_DIR / "mark.svg"
ICNS = ROOT / "crates/tt-app/bundle/macos/TimeWren.icns"
ICO = ROOT / "crates/tt-app/bundle/windows/TimeWren.ico"
UI_MARK = ROOT / "crates/tt-app/assets/icons/tt-maerke-timewren.svg"

SVG_NS = "{http://www.w3.org/2000/svg}"


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


# Brandkittets farver (samme som `colors` i scripts/brands.json).
LICHEN = hex_rgb("#E8EDE3")


# ---------- SVG-masteren ----------


class Shape:
    """En figur med fortegnet afstand (negativ indeni), i SVG'ens enheder."""

    def __init__(self, bbox):
        self.bbox = bbox  # (x0, y0, x1, y1)

    def sd(self, x, y):
        raise NotImplementedError


class Circle(Shape):
    def __init__(self, cx, cy, r):
        super().__init__((cx - r, cy - r, cx + r, cy + r))
        self.cx, self.cy, self.r = cx, cy, r

    def sd(self, x, y):
        return math.hypot(x - self.cx, y - self.cy) - self.r


class Capsule(Shape):
    """En linje med runde ender (`stroke-linecap="round"`)."""

    def __init__(self, x1, y1, x2, y2, width):
        r = width / 2
        super().__init__((min(x1, x2) - r, min(y1, y2) - r, max(x1, x2) + r, max(y1, y2) + r))
        self.x1, self.y1, self.x2, self.y2, self.r = x1, y1, x2, y2, r
        self.dx, self.dy = x2 - x1, y2 - y1
        self.len2 = self.dx * self.dx + self.dy * self.dy

    def sd(self, x, y):
        t = ((x - self.x1) * self.dx + (y - self.y1) * self.dy) / self.len2 if self.len2 else 0.0
        t = max(0.0, min(1.0, t))
        return math.hypot(x - (self.x1 + t * self.dx), y - (self.y1 + t * self.dy)) - self.r


class Polygon(Shape):
    def __init__(self, pts):
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        super().__init__((min(xs), min(ys), max(xs), max(ys)))
        self.pts = pts

    def sd(self, x, y):
        pts = self.pts
        d = (x - pts[0][0]) ** 2 + (y - pts[0][1]) ** 2
        s = 1.0
        j = len(pts) - 1
        for i in range(len(pts)):
            ax, ay = pts[i]
            bx, by = pts[j]
            ex, ey = bx - ax, by - ay
            wx, wy = x - ax, y - ay
            t = max(0.0, min(1.0, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
            d = min(d, (wx - ex * t) ** 2 + (wy - ey * t) ** 2)
            # Indeni/udenfor: kryds-tal (stråle mod +x).
            if (ay <= y) != (by <= y):
                xi = ax + (y - ay) * (bx - ax) / (by - ay)
                if xi > x:
                    s = -s
            j = i
        return s * math.sqrt(d)


def num(v):
    return float(v)


def parse_path(d):
    """Kun `M x y L x y … Z` (store bogstaver), som masteren bruger."""
    tokens = re.findall(r"[MLZ]|-?\d*\.?\d+", d)
    pts, i = [], 0
    while i < len(tokens):
        t = tokens[i]
        if t in "ML":
            pts.append((num(tokens[i + 1]), num(tokens[i + 2])))
            i += 3
        elif t == "Z":
            i += 1
        else:
            raise SystemExit(f"Ukendt stikommando i masteren: {d!r}")
    return Polygon(pts)


def shape_of(el):
    tag = el.tag.replace(SVG_NS, "")
    a = el.attrib
    if tag == "circle":
        return Circle(num(a["cx"]), num(a["cy"]), num(a["r"]))
    if tag == "line":
        if a.get("stroke-linecap") != "round":
            raise SystemExit("Masterens linjer skal have runde ender")
        return Capsule(num(a["x1"]), num(a["y1"]), num(a["x2"]), num(a["y2"]), num(a["stroke-width"]))
    if tag == "path":
        return parse_path(a["d"])
    raise SystemExit(f"Ukendt element i masteren: <{tag}>")


class Mark:
    """Masterens mærke: `body` (fyldte figurer minus maskens huller) og `tail`."""

    def __init__(self, svg_text):
        root = ET.fromstring(svg_text)
        vb = [num(v) for v in root.attrib["viewBox"].replace(",", " ").split()]
        self.vb = vb
        masks = {}
        for m in root.iter(SVG_NS + "mask"):
            holes = []
            for ch in m:
                tag = ch.tag.replace(SVG_NS, "")
                if tag == "rect":  # den hvide baggrund: hele fladen er synlig
                    continue
                if ch.attrib.get("fill") == "#000" or ch.attrib.get("stroke") == "#000":
                    holes.append(shape_of(ch))
                else:
                    raise SystemExit("Masken må kun have sorte huller")
            masks[m.attrib["id"]] = holes
        self.body, self.holes, self.tails, self.colours = [], [], [], set()
        for ch in root:
            tag = ch.tag.replace(SVG_NS, "")
            if tag == "g":
                mid = re.fullmatch(r"url\(#(.+)\)", ch.attrib["mask"]).group(1)
                self.holes = masks[mid]
                self.colours.add(ch.attrib["fill"].upper())
                self.body = [shape_of(c) for c in ch]
            elif tag == "line":
                self.tails.append(shape_of(ch))
                self.colours.add(ch.attrib["stroke"].upper())
        if not self.body or len(self.colours) != 1:
            raise SystemExit("Masteren skal have én farve og en maskeret gruppe")
        self.colour = next(iter(self.colours))
        boxes = [s.bbox for s in self.body + self.tails]
        self.bbox = (
            min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes),
        )

    def sd(self, x, y):
        d = min(s.sd(x, y) for s in self.body)
        for h in self.holes:
            d = max(d, -h.sd(x, y))
        for t in self.tails:
            d = min(d, t.sd(x, y))
        return d


# ---------- Tegning ----------


def box_sd(x, y, lo, hi, r):
    """Afrundet kvadrat [lo, hi]² med hjørneradius r."""
    c = (lo + hi) / 2
    h = (hi - lo) / 2 - r
    qx, qy = abs(x - c) - h, abs(y - c) - h
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def cover(sd):
    return max(0.0, min(1.0, 0.5 - sd))


def render(mark, n, inset, radius, fill, mark_rgb):
    """RGBA for et n x n-ikon: Lichen-flade (margen `inset`, radius `radius`, begge i
    1024-enheder) med mærket i midten; mærkets viewBox fylder `fill` af fladen."""
    s = 1024.0 / n  # 1024-enheder pr. pixel
    lo, hi = inset, 1024.0 - inset
    body = hi - lo
    vb_w, vb_h = mark.vb[2], mark.vb[3]
    scale = fill * body / max(vb_w, vb_h)  # 1024-enheder pr. SVG-enhed
    ox = 512.0 - (mark.vb[0] + vb_w / 2) * scale
    oy = 512.0 - (mark.vb[1] + vb_h / 2) * scale
    bx0, by0 = ox + mark.bbox[0] * scale, oy + mark.bbox[1] * scale
    bx1, by1 = ox + mark.bbox[2] * scale, oy + mark.bbox[3] * scale
    rows = bytearray()
    for py in range(n):
        rows.append(0)  # PNG-filter: ingen
        y = (py + 0.5) * s
        for px in range(n):
            x = (px + 0.5) * s
            a = cover(box_sd(x, y, lo, hi, radius) / s)
            if a <= 0:
                rows += b"\x00\x00\x00\x00"
                continue
            m = 0.0
            if bx0 - s <= x <= bx1 + s and by0 - s <= y <= by1 + s:
                m = cover(mark.sd((x - ox) / scale, (y - oy) / scale) * scale / s)
            col = tuple(round(LICHEN[c] * (1 - m) + mark_rgb[c] * m) for c in range(3))
            rows += bytes(col) + bytes([round(255 * a)])
    return bytes(rows)


def png(raw, n):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


# macOS (Big Sur-skabelonen): kroppen fylder 824 af 1024, hjørneradius 185,
# mærket fylder 70 % af kroppen (web: icon-512.png bruger 72 %).
MAC = dict(inset=100.0, radius=185.0, fill=0.70)
# Windows: næsten fuld flade (Stifinder og proceslinjen skærer ikke selv); et
# lidt større mærke, så det kan ses ved 16 px.
WIN = dict(inset=48.0, radius=200.0, fill=0.78)


def icns(mark):
    rgb = hex_rgb(mark.colour)
    # (type, pixels): de fælles PNG-baserede typer.
    kinds = [
        (b"icp4", 16), (b"icp5", 32), (b"icp6", 64),
        (b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024),
        (b"ic11", 32), (b"ic12", 64), (b"ic13", 256), (b"ic14", 512),
    ]
    cache = {}
    body = b""
    for kind, px in kinds:
        if px not in cache:
            cache[px] = png(render(mark, px, mark_rgb=rgb, **MAC), px)
        data = cache[px]
        body += kind + struct.pack(">I", 8 + len(data)) + data
    return b"icns" + struct.pack(">I", 8 + len(body)) + body


def ico(mark):
    rgb = hex_rgb(mark.colour)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [png(render(mark, s, mark_rgb=rgb, **WIN), s) for s in sizes]
    head = struct.pack("<HHH", 0, 1, len(sizes))
    off = 6 + 16 * len(sizes)
    entries = b""
    for s, data in zip(sizes, images):
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), off)
        off += len(data)
    return head + entries + b"".join(images)


def ui_mark(svg_text, colour):
    """Masteren med mærkets farve som `currentColor` (appen farver det selv) og
    et eget maske-id, så det ikke støder på andre SVG'er."""
    out = svg_text.replace(f'"{colour}"', '"currentColor"')
    out = out.replace('id="tw"', 'id="tw-maerke-m"').replace("url(#tw)", "url(#tw-maerke-m)")
    assert colour not in out.upper() and "currentColor" in out
    return out if out.endswith("\n") else out + "\n"


def main(argv):
    svg_text = MASTER.read_text(encoding="utf-8")
    mark = Mark(svg_text)
    if mark.colour != "#8A5A2B":
        raise SystemExit(f"Masteren skal være i Wren (#8A5A2B), ikke {mark.colour}")
    out = {ICNS: icns(mark), ICO: ico(mark), UI_MARK: ui_mark(svg_text, mark.colour).encode("utf-8")}
    for p, data in out.items():
        p.write_bytes(data)
        print(f"{p.relative_to(ROOT)}: {len(data)} bytes")
    if "--previews" in argv:
        d = Path(argv[argv.index("--previews") + 1])
        d.mkdir(parents=True, exist_ok=True)
        rgb = hex_rgb(mark.colour)
        for name, cfg, n in [("mac-512", MAC, 512), ("win-256", WIN, 256), ("win-48", WIN, 48), ("win-16", WIN, 16)]:
            (d / f"{name}.png").write_bytes(png(render(mark, n, mark_rgb=rgb, **cfg), n))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
