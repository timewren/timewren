"""Sammenligner PDF'er før og efter et retheme.

    python scripts/brand/compare-pdfs.py <foer-mappe> <efter-mappe> <png-mappe>

For hver PDF, der findes i begge mapper, udtrækkes alle beløb (dansk format,
fx 8.125,00 og -650,00) i læserækkefølge, plus tekstlinjer med "Moms",
"Subtotal", "TOTAL" og fakturanumre. Beløbslisten skal være identisk; en
skrifttype må gerne flytte linjeskift, men ikke ændre tal. Side 1 af hver
PDF gemmes som PNG (foer/efter) til PR'en. Exit-kode 1 ved forskel.
"""

import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

MONEY = re.compile(r"-?\d{1,3}(?:\.\d{3})*,\d{2}")
KEY_LINE = re.compile(r"(moms|subtotal|total|fakturanr|kreditnotanr|kreditering)", re.I)


def extract(pdf: Path):
    doc = fitz.open(pdf)
    text = "\n".join(page.get_text("text") for page in doc)
    money = MONEY.findall(text)
    keys = sorted(
        re.sub(r"\s+", " ", line).strip().rstrip(":").lower()
        for line in text.splitlines()
        if KEY_LINE.search(line)
    )
    return doc, money, keys, text


def main() -> int:
    before, after, png = (Path(a) for a in sys.argv[1:4])
    png.mkdir(parents=True, exist_ok=True)
    failed = False
    for b in sorted(before.glob("*.pdf")):
        a = after / b.name
        if not a.exists():
            print(f"MANGLER efter: {b.name}")
            failed = True
            continue
        bdoc, bmoney, bkeys, _ = extract(b)
        adoc, amoney, akeys, _ = extract(a)
        same_money = sorted(bmoney) == sorted(amoney)
        status = "OK " if same_money else "FEJL"
        print(f"{status} {b.name}: {len(bmoney)} beløb foer, {len(amoney)} efter")
        if not same_money:
            failed = True
            print("   foer: ", bmoney)
            print("   efter:", amoney)
        if bkeys != akeys:
            print("   note: nøglelinjer afviger (tjek manuelt)")
            print("   foer: ", bkeys)
            print("   efter:", akeys)
        stem = b.name.removesuffix(".pdf")
        for label, doc in (("foer", bdoc), ("efter", adoc)):
            pix = doc[0].get_pixmap(dpi=110)
            pix.save(str(png / f"{stem}.{label}.png"))
    for a in sorted(after.glob("*.pdf")):
        if not (before / a.name).exists():
            stem = a.name.removesuffix(".pdf")
            _, amoney, _, _ = extract(a)
            print(f"NY  {a.name}: {len(amoney)} beløb (ingen foer-udgave)")
            fitz.open(a)[0].get_pixmap(dpi=110).save(str(png / f"{stem}.efter.png"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
