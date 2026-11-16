"use client";

import { useState } from "react";

const SIZE_CLASSES = {
  xs: "h-6 w-6 text-[10px]",
  s: "h-7 w-7 text-xs",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
} as const;

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return (
    name
      .split(" ")
      // [...w] i stedet for w[0]: undgår at splitte surrogatpar (emoji m.m.)
      .map((w) => [...w][0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?"
  );
}

/**
 * Avatar med robust fallback: viser initialer når billedet mangler ELLER
 * fejler ved indlæsning (fx udløbne/blokerede OAuth-URL'er). Bruger en rå
 * <img> fordi OAuth-avatarer ligger på vilkårlige eksterne domæner som
 * next/image kræver whitelisting af.
 */
export function UserAvatar({
  name,
  image,
  size = "md",
  className = "",
  fallbackClassName = "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  alt,
}: {
  name: string | null | undefined;
  image?: string | null;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
  /** Farveklasser for initial-fallbacken (baggrund + tekst) */
  fallbackClassName?: string;
  /** Overstyr alt-tekst — brug "" når navnet allerede står ved siden af */
  alt?: string;
}) {
  // Husk hvilken URL der fejlede — skifter URL'en, prøver vi igen
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const px = SIZE_CLASSES[size];

  if (image && failedSrc !== image) {
    return (
      // biome-ignore lint/performance/noImgElement: external avatar URLs from OAuth providers
      <img
        src={image}
        alt={alt ?? name ?? ""}
        // Google/GitHub kan 403'e ved hotlinking med Referer — send ingen
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        className={`${px} shrink-0 rounded-full bg-gray-200 object-cover dark:bg-gray-700 ${className}`}
        onError={() => setFailedSrc(image)}
      />
    );
  }

  return (
    <div
      className={`${px} flex shrink-0 items-center justify-center rounded-full font-medium ${fallbackClassName} ${className}`}
    >
      {getInitials(name)}
    </div>
  );
}
