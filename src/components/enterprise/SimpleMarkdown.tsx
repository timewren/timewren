import type { ReactNode } from "react";
import {
  parseInline,
  parseMarkdownBlocks,
} from "@/lib/enterprise/dpa/markdown";

/**
 * Minimal, deterministisk markdown-visning til juridiske tekster (DPA).
 * Parseren er delt med PDF'en (src/lib/enterprise/dpa/markdown.ts), så web
 * og PDF viser samme tekst. Ingen HTML-passthrough og ingen eksterne libs.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  return parseInline(text).map((tok, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (tok.kind) {
      case "bold":
        return <strong key={key}>{tok.text}</strong>;
      case "italic":
        return <em key={key}>{tok.text}</em>;
      case "code":
        return (
          <code key={key} className="rounded bg-gray-100 px-1 dark:bg-gray-700">
            {tok.text}
          </code>
        );
      default:
        return tok.text;
    }
  });
}

export function SimpleMarkdown({
  markdown,
  lightOnly = false,
}: {
  markdown: string;
  /** Offentlige marketingsider er altid lyse; undgå lys tekst i .dark. */
  lightOnly?: boolean;
}) {
  // Teksten er statisk, så blokkens position er en stabil nøgle mellem renders.
  const blocks = parseMarkdownBlocks(markdown).map((block, key) => {
    switch (block.kind) {
      case "hr":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
          <hr key={key} className="my-6 border-gray-200 dark:border-gray-700" />
        );
      case "heading": {
        const content = inline(block.text, `h${key}`);
        if (block.level === 1) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
            <h1 key={key} className="mb-4 text-2xl font-bold">
              {content}
            </h1>
          );
        }
        if (block.level === 2) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
            <h2 key={key} className="mt-8 mb-3 text-lg font-semibold">
              {content}
            </h2>
          );
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
          <h3 key={key} className="mt-6 mb-2 text-base font-semibold">
            {content}
          </h3>
        );
      }
      case "table":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
          <div key={key} className="my-4 overflow-x-auto">
            <table className="w-full text-sm">
              {block.head && (
                <thead>
                  <tr className="border-b border-gray-300 dark:border-gray-600">
                    {block.head.map((c, ci) => (
                      <th
                        // biome-ignore lint/suspicious/noArrayIndexKey: statisk tekst
                        key={ci}
                        className="px-2 py-1 text-left font-semibold"
                      >
                        {inline(c, `th${key}-${ci}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: statisk tekst
                    key={ri}
                    className="border-b border-gray-100 align-top dark:border-gray-700"
                  >
                    {row.map((c, ci) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: statisk tekst
                      <td key={ci} className="px-2 py-1">
                        {inline(c, `td${key}-${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "list":
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
          <ul key={key} className="my-3 list-disc space-y-1 pl-6 text-sm">
            {block.items.map((it, ii) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: statisk tekst
              <li key={ii}>{inline(it, `li${key}-${ii}`)}</li>
            ))}
          </ul>
        );
      default:
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
          <p key={key} className="my-3 text-sm leading-relaxed">
            {inline(block.text, `p${key}`)}
          </p>
        );
    }
  });

  return (
    <div
      className={
        lightOnly ? "text-gray-800" : "text-gray-800 dark:text-gray-200"
      }
    >
      {blocks}
    </div>
  );
}
