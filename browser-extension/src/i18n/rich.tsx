import { Fragment, type ReactNode } from "react";

/**
 * Gør `<b>…</b>` i en oversat tekst til fremhævede spans. Bruges til sætninger,
 * hvor et navn skal stå fremhævet midt i teksten, så oversættere kan flytte
 * det. Alt andet er ren tekst (aldrig HTML).
 */
export function renderRich(text: string, className = "font-medium"): ReactNode {
  const parts = text.split(/<b>(.*?)<\/b>/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: statisk opdeling af én tekst
      <span key={i} className={className}>
        {part}
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: statisk opdeling af én tekst
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
