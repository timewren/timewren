// src/lib/start-page.ts
//
// Whitelist af sider en bruger kan vælge som landingsside efter login
// (#startside). Delt af Indstillinger-selecten, "Gør til startside"-handlingen,
// gem-mutationen (zod) og server-redirecten i /dashboard/start — ét sted, så
// en ny nav-side aldrig bliver valgbar uden en bevidst beslutning her.

import {
  isNavItemVisible,
  mainNavGroups,
  type NavItem,
} from "@/components/dashboard-nav/navigation-config";

export const START_PAGE_OPTIONS = [
  { href: "/dashboard", label: "Overblik" },
  { href: "/dashboard/time", label: "Tidsregistrering" },
  { href: "/dashboard/tasks", label: "Opgaver" },
  { href: "/dashboard/calendar", label: "Kalender" },
  { href: "/dashboard/clients", label: "Kunder" },
  { href: "/dashboard/projects", label: "Projekter" },
  { href: "/dashboard/klippekort", label: "Klippekort" },
  { href: "/dashboard/invoices", label: "Fakturaer" },
] as const;

export type StartPageHref = (typeof START_PAGE_OPTIONS)[number]["href"];

export const START_PAGE_HREFS = START_PAGE_OPTIONS.map(
  (o) => o.href,
) as StartPageHref[];

/** Ukendt eller null startside betyder altid dette. */
export const DEFAULT_START_PAGE: StartPageHref = "/dashboard";

export function isKnownStartPage(
  value: string | null | undefined,
): value is StartPageHref {
  return !!value && (START_PAGE_HREFS as readonly string[]).includes(value);
}

export function findStartPageNavItem(href: string): NavItem | undefined {
  for (const group of mainNavGroups) {
    const item = group.items.find((i) => i.href === href);
    if (item) return item;
  }
  return undefined;
}

type NavVisibilityContext = Parameters<typeof isNavItemVisible>[1];

/**
 * Er `href` en valgbar startside lige nu? Genbruger nav'ens egen
 * isNavItemVisible (modul/rolle/feature-flag), så en startside aldrig er
 * mere tilgængelig end det tilsvarende menupunkt. `/dashboard` er altid
 * tilgængelig — det er selve fallback-destinationen.
 */
export function isStartPageVisible(
  href: string,
  opts: NavVisibilityContext,
): boolean {
  if (href === DEFAULT_START_PAGE) return true;
  const item = findStartPageNavItem(href);
  if (!item) return false;
  return isNavItemVisible(item, opts);
}
