import { Fragment, type ReactNode } from "react";

type Tags = Record<string, (children: string) => ReactNode>;

/**
 * Små inline-markeringer i mailtekster, så en oversat sætning kan indeholde
 * fed tekst og links uden at blive sat sammen af delstrenge:
 *   **fed**            -> <strong>fed</strong>
 *   [help]hjælpen[/help] -> tags.help("hjælpen")
 */
export function mailMarkup(text: string, tags: Tags = {}): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(\w+)\]([\s\S]*?)\[\/\2\]/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    if (m[1] !== undefined) {
      out.push(<strong key={key++}>{m[1]}</strong>);
    } else {
      const render = tags[m[2]];
      out.push(<Fragment key={key++}>{render ? render(m[3]) : m[3]}</Fragment>);
    }
    last = index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
