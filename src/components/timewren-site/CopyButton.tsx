"use client";

import { useEffect, useState } from "react";

/**
 * Kopiér-knap til kommandoer. Uden JS (eller uden clipboard-adgang) står
 * kommandoen stadig i <pre> og kan markeres og kopieres som tekst.
 */
export function CopyButton({
  text,
  label,
  done,
}: {
  text: string;
  label: string;
  done: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      className="copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Ingen adgang til udklipsholderen: teksten kan stadig markeres.
        }
      }}
    >
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}
