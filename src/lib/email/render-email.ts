import { render, type toPlainText } from "@react-email/render";
import type { ReactElement } from "react";

type HtmlToTextOptions = NonNullable<Parameters<typeof toPlainText>[1]>;

// html-to-text har ingen typer i projektet — kun det vi bruger.
interface TextBuilder {
  addInline(str: string): void;
}
type Walk = (nodes: unknown, builder: TextBuilder) => void;

/** "Tidspunkt: 5. oktober 2026 kl. 09.42" i stedet for "Tidspunkt5. oktober…" */
const keyValueLabel = (
  elem: { children: unknown },
  walk: Walk,
  builder: TextBuilder,
) => {
  walk(elem.children, builder);
  builder.addInline(": ");
};

const htmlToTextOptions: HtmlToTextOptions = {
  formatters: { keyValueLabel },
  selectors: [
    { selector: "h1", options: { uppercase: false } },
    { selector: "tr.tt-kv-row", format: "block" },
    { selector: "td.tt-kv-label", format: "keyValueLabel" },
  ],
};

/**
 * Renderer en mail til både HTML og en læsbar tekstversion. Send begge til
 * Resend (`html` + `text`), så klienter og spamfiltre der kigger på
 * tekstdelen får en ordentlig mail i stedet for en auto-konvertering.
 */
export async function renderEmail(element: ReactElement) {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true, htmlToTextOptions }),
  ]);
  return { html, text };
}
