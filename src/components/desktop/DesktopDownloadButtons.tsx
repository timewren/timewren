"use client";

import { Apple, Monitor } from "lucide-react";
import { useLatestDesktopRelease } from "./useLatestDesktopRelease";

/**
 * Direct Windows/macOS download buttons that fetch the latest desktop release.
 * The user's detected OS is shown as the primary button. Renders nothing until
 * loaded / when no release is published (caller can show a fallback).
 */
export function DesktopDownloadButtons({
  size = "sm",
  fullWidth = false,
}: {
  size?: "sm" | "md";
  fullWidth?: boolean;
}) {
  const { loaded, os, winUrl, macUrl, hasDownloads } =
    useLatestDesktopRelease();

  if (!loaded || !hasDownloads) return null;

  const base =
    size === "md"
      ? "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
      : "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors";
  const grow = fullWidth ? "flex-1" : "";
  const primary = `${base} ${grow} bg-tt-gran text-tt-paa-gran hover:bg-tt-gran-moerk`;
  const secondary = `${base} ${grow} border border-brand-200 text-brand-700 hover:bg-brand-50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-tt-gran-lys`;

  const win = winUrl ? (
    <a
      key="win"
      href={winUrl}
      className={os === "windows" || os === "other" ? primary : secondary}
    >
      <Monitor className="h-4 w-4" />
      Windows
    </a>
  ) : null;
  const mac = macUrl ? (
    <a key="mac" href={macUrl} className={os === "macos" ? primary : secondary}>
      <Apple className="h-4 w-4" />
      macOS
    </a>
  ) : null;

  // Detected platform first.
  const buttons = os === "macos" ? [mac, win] : [win, mac];

  return (
    <div className={`flex items-center gap-2 ${fullWidth ? "w-full" : ""}`}>
      {buttons}
    </div>
  );
}
