/**
 * Oversæt en push-notifikations `data` (web-stier fra backenden) til en app-rute.
 * Ren funktion — testes uden expo.
 */

export type NotificationData = {
  url?: unknown;
  type?: unknown;
  [key: string]: unknown;
};

export const HOME_ROUTE = '/';

/** Web-sti (prefix) → app-rute. Rækkefølgen betyder noget: mest specifikke først. */
const PATH_RULES: readonly [prefix: string, route: string][] = [
  ['/dashboard/enterprise/absence', '/absence'],
  ['/dashboard/absence', '/absence'],
  ['/dashboard/invoices', '/invoices'],
  ['/dashboard/time', '/time'],
  ['/dashboard/timer', '/'],
  ['/dashboard/team', '/team'],
  ['/dashboard/clients', '/clients'],
  ['/dashboard/tasks', '/tasks'],
  ['/dashboard/enterprise/inbox', '/enterprise/inbox'],
];

const TYPE_RULES: Record<string, string> = {
  absence: '/absence',
  absence_request: '/absence',
  absence_approved: '/absence',
  absence_rejected: '/absence',
  invoice: '/invoices',
  invoice_paid: '/invoices',
  invoice_overdue: '/invoices',
  time: '/time',
  time_entry: '/time',
  timesheet: '/time',
  approval: '/team',
  timer: '/',
  timer_stopped: '/',
  /** Lokal påmindelse: et tryk på notifikationen (ikke knappen) viser ugen. */
  week_review: '/week-review',
};

const ORIGIN_RE = /^[a-z]+:\/\/[^/]+/i;
const QUERY_OR_HASH_RE = /[?#]/;

function pathOf(url: string): string {
  // Absolut URL (https://app.timetrack.dk/dashboard/time?x=1) eller relativ sti.
  const withoutOrigin = url.replace(ORIGIN_RE, '');
  return withoutOrigin.split(QUERY_OR_HASH_RE)[0] ?? '';
}

export function routeForNotification(data: NotificationData | null | undefined): string {
  if (!data)
    return HOME_ROUTE;
  if (typeof data.url === 'string' && data.url.length > 0) {
    const path = pathOf(data.url);
    for (const [prefix, route] of PATH_RULES) {
      if (path === prefix || path.startsWith(`${prefix}/`))
        return route;
    }
  }
  if (typeof data.type === 'string') {
    const route = TYPE_RULES[data.type];
    if (route)
      return route;
  }
  return HOME_ROUTE;
}
