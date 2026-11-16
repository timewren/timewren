const MARKDOWN_RE = /[#*_`>]+/g;
const WHITESPACE_RE = /\s+/g;

/** Første del af en markdown-tekst som ren tekst — til en kort teaser. */
export function teaser(markdown: string, max = 140): string {
  const text = markdown.replace(MARKDOWN_RE, '').replace(WHITESPACE_RE, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
