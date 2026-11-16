"use client";

import { trpc } from "@/providers/trpc-provider";

// Bor i sin egen fil (ikke i ChangelogModal), så dashboard-skallen kan vise
// prikken uden at trække modalens markdown-rendering og sanitize-html med i
// det fælles bundt.

/** Om brugeren har ulæste changelogs — deler query med ChangelogModal. */
export function useHasUnseenChangelog(): boolean {
  const { data: unseen } = trpc.changelog.getUnseen.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  return !!unseen && unseen.length > 0;
}

/**
 * Small dot indicator for the user menu. Shows when there are unseen changelogs.
 */
export function ChangelogDot() {
  if (!useHasUnseenChangelog()) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-white dark:ring-gray-900" />
  );
}
