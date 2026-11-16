/**
 * Et ur som "01:24:08" (BRAND.md → Tal, priser og tid). Cifrene står med
 * tabular-nums, så uret ikke hopper, mens kolonerne står i egne spans uden,
 * fordi Schibsted Grotesk ellers giver kolon fast bredde og store huller.
 */
export function ClockText({ value }: { value: string }) {
  // Del på ":" og "." (da-DK skriver klokkeslæt som 10.30), behold skilletegnet
  const parts = value.split(/([:.])/);
  return (
    <>
      {parts.map((part, i) =>
        part === ":" || part === "." ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: fast rækkefølge
          <span key={i}>{part}</span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: fast rækkefølge
          <span key={i} className="tabular-nums">
            {part}
          </span>
        ),
      )}
    </>
  );
}
