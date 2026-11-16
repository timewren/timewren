/**
 * Oversæt web-stier i indbakke-beskeder til app-ruter. Ukendte stier giver
 * null = ingen navigation (beskeden markeres blot som læst).
 */
const ROUTE_MAP: ReadonlyArray<[prefix: string, route: string]> = [
  ['/dashboard/enterprise/absence', '/absence'],
  ['/dashboard/enterprise/flex', '/enterprise/flex'],
  ['/dashboard/enterprise/overtime', '/enterprise/overtime'],
];

const ABSOLUTE_URL_RE = /^https?:\/\//;
const QUERY_OR_HASH_RE = /[?#]/;

export function inboxRouteFor(url: string | null | undefined): string | null {
  if (!url)
    return null;
  let path = url;
  if (ABSOLUTE_URL_RE.test(url)) {
    try {
      path = new URL(url).pathname;
    }
    catch {
      return null;
    }
  }
  const clean = path.split(QUERY_OR_HASH_RE)[0] ?? '';
  for (const [prefix, route] of ROUTE_MAP) {
    if (clean === prefix || clean.startsWith(`${prefix}/`))
      return route;
  }
  return null;
}
