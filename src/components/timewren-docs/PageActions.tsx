"use client";

import { Check, ClipboardCopy, FileText } from "lucide-react";
import { useState } from "react";

/*
 * Knapperne øverst på hver docs-side: kopiér siden som Markdown, og åbn
 * ChatGPT eller Claude med en forudfyldt prompt, der peger på sidens
 * .md-URL. Teksterne og URL'erne beregnes på serveren (ui.ts).
 */

export interface PageActionsProps {
  markdownUrl: string;
  chatGptUrl: string;
  claudeUrl: string;
  labels: {
    copyMarkdown: string;
    copied: string;
    copyFailed: string;
    openChatGpt: string;
    openClaude: string;
    viewMarkdown: string;
  };
}

const button =
  "inline-flex items-center gap-1.5 rounded-md border border-fd-border bg-fd-secondary px-2.5 py-1.5 text-sm font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring";

export function PageActions({
  markdownUrl,
  chatGptUrl,
  claudeUrl,
  labels,
}: PageActionsProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      const res = await fetch(markdownUrl, {
        headers: { accept: "text/markdown" },
      });
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <div className="not-prose flex flex-wrap items-center gap-2 border-b border-fd-border pb-6">
      <button type="button" className={button} onClick={copy}>
        {state === "copied" ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <ClipboardCopy className="size-4" aria-hidden="true" />
        )}
        <span aria-live="polite">
          {state === "copied"
            ? labels.copied
            : state === "failed"
              ? labels.copyFailed
              : labels.copyMarkdown}
        </span>
      </button>
      <a className={button} href={chatGptUrl} target="_blank" rel="noreferrer">
        {labels.openChatGpt}
      </a>
      <a className={button} href={claudeUrl} target="_blank" rel="noreferrer">
        {labels.openClaude}
      </a>
      <a className={button} href={markdownUrl}>
        <FileText className="size-4" aria-hidden="true" />
        {labels.viewMarkdown}
      </a>
    </div>
  );
}
