import type { Query, QueryClient } from "@tanstack/react-query";

/**
 * Ét domænekort for data-friskhed — delt af klient og server.
 *
 * Et "domæne" er navnet på en tRPC-router (første segment i query-nøglen,
 * `[["time","list"], {...}]`). Når noget ændrer en tidspost, et klippekort
 * eller en faktura, er det disse domæner der kan vise forældede tal.
 *
 * Bruges af:
 *  - fjern-stop/-start i useTimerSync (timer gemt på en anden enhed)
 *  - offline-afspilning og fakturaafsendelse (går uden om MutationCache)
 *  - krydsfane-beskeder (BroadcastChannel "tt-data")
 *  - krydsenheds-events over SSE (`data_changed`), som serveren publicerer
 *    efter skrivninger fra web, extension, mobil, desktop og API.
 *
 * Filen må ikke importere React eller server-moduler: serverens tRPC-
 * middleware bruger `domainsForMutationPath` herfra.
 */

/** Alt hvad en gemt/rettet/slettet tidspost kan ændre. */
export const TIME_ENTRY_DOMAINS: readonly string[] = [
  "time",
  "prepaid",
  "clients",
  "projects",
  "dashboard",
  "coverage",
  "invoices",
  "reports",
  "logbook",
  "team",
  // Opgaver viser registreret tid mod estimat (#749)
  "tasks.list",
  "tasks.listByStatus",
  "tasks.listForTime",
  // Kun de enterprise-queries der viser saldi/anmodninger — ikke hele
  // routeren, hvis indstillingssider spejler query-data ind i formularer.
  "enterprise.getBalance",
  "enterprise.getVacationBalance",
  "enterprise.listRequests",
  "enterprise.getTimesheetWeek",
  "enterprise.getTeamWeekOverview",
  "enterprise.getTeamWeekBalances",
  "enterprise.getMyOvertime",
  "enterprise.getOvertimeOverview",
];

/** Klippekortsændringer: saldi pr. kunde/projekt og tidsposternes træk. */
export const PREPAID_DOMAINS: readonly string[] = [
  "prepaid",
  "clients",
  "projects",
  "time",
  "dashboard",
  "reports",
  "invoices",
];

/** Fakturaer: status, ufaktureret tid og likviditet/moms. */
export const INVOICE_DOMAINS: readonly string[] = [
  "invoices",
  "time",
  "clients",
  "projects",
  "dashboard",
  "reports",
  "cashflow",
  "vat",
];

/**
 * Domæner der er delt i organisationen. Org-kanalen får kun dem, så en
 * kollegas tidspost ikke refetcher hele din tidsliste og dit dashboard.
 */
const ORG_SHARED_DOMAINS: ReadonlySet<string> = new Set([
  "prepaid",
  "clients",
  "projects",
  "team",
]);

/**
 * Kunder og projekter vises i hinandens lister (kundenavn på projektet,
 * projekter under kunden). Publiceres, så desktop/udvidelse/andre faner ser
 * en oprettelse, rettelse eller arkivering uden at polle.
 */
export const CLIENT_PROJECT_DOMAINS: readonly string[] = [
  "clients",
  "projects",
];

/** Opgaver (desktop 1.0 viser opgavelisten). */
export const TASK_DOMAINS: readonly string[] = ["tasks"];

const MUTATION_ROUTER_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  time: TIME_ENTRY_DOMAINS,
  prepaid: PREPAID_DOMAINS,
  invoices: INVOICE_DOMAINS,
  clients: CLIENT_PROJECT_DOMAINS,
  projects: CLIENT_PROJECT_DOMAINS,
  tasks: TASK_DOMAINS,
};

/**
 * Hvilke domæner skal andre enheder invalidere efter denne mutation?
 * `null` = mutationen skal ikke publiceres (fx timer-heartbeats, som har
 * deres egen timer-kanal, og alt uden for tid, klippekort, fakturaer,
 * kunder, projekter og opgaver).
 */
export function domainsForMutationPath(path: string): readonly string[] | null {
  const router = path.split(".")[0] ?? "";
  return MUTATION_ROUTER_DOMAINS[router] ?? null;
}

/** Den del af domænerne der giver mening for andre i organisationen. */
export function orgSharedDomains(domains: readonly string[]): string[] {
  return domains.filter((d) => ORG_SHARED_DOMAINS.has(d));
}

/** Første segment af en tRPC query-nøgle (`[["time","list"], …]` → "time"). */
export function queryKeyRouter(queryKey: unknown): string | null {
  if (!Array.isArray(queryKey) || queryKey.length === 0) return null;
  const path = queryKey[0];
  if (Array.isArray(path) && typeof path[0] === "string") return path[0];
  return null;
}

/** "router.procedure" for en tRPC query-nøgle; null hvis ukendt. */
export function queryKeyPath(queryKey: unknown): string | null {
  if (!Array.isArray(queryKey) || queryKey.length === 0) return null;
  const path = queryKey[0];
  if (!Array.isArray(path) || path.length < 2) return null;
  return path.every((p) => typeof p === "string") ? path.join(".") : null;
}

/**
 * Et domæne er enten en hel router ("time") eller én procedure
 * ("enterprise.getBalance").
 */
export function queryMatchesDomains(
  queryKey: unknown,
  domains: readonly string[] | "all",
): boolean {
  if (domains === "all") return true;
  const router = queryKeyRouter(queryKey);
  if (router !== null && domains.includes(router)) return true;
  const path = queryKeyPath(queryKey);
  return path !== null && domains.includes(path);
}

/**
 * Detalje-/indstillingsqueries som redigeringssider spejler ind i lokal
 * formular-state (TimeEntryEditModal, kunde-redigering, enterprise-
 * indstillinger). Et signal udefra må ikke hente dem igen, mens brugeren
 * skriver — de markeres kun forældede og hentes ved næste mount.
 */
const FORM_MIRRORED_PROCEDURE =
  /^(get|getById|getProfile\w*|get\w*Settings|get\w*Preferences)$/;

export function isFormMirroredQuery(queryKey: unknown): boolean {
  const path = queryKeyPath(queryKey);
  if (!path) return false;
  const procedure = path.slice(path.lastIndexOf(".") + 1);
  return FORM_MIRRORED_PROCEDURE.test(procedure);
}

/**
 * Invalidér alle queries i de givne domæner. `"all"` svarer til den globale
 * MutationCache-invalidering.
 *
 * `cancelRefetch: false` bruges for signaler udefra (anden fane, SSE): er
 * samme query allerede ved at hente, genbruges den hentning i stedet for at
 * starte forfra — så en ændring der både kommer fra fanens egen mutation og
 * som SSE-event ikke henter alt to gange.
 */
export function invalidateDomains(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  domains: readonly string[] | "all",
  opts?: { cancelRefetch?: boolean },
): Promise<void> {
  const options =
    opts?.cancelRefetch === undefined
      ? undefined
      : { cancelRefetch: opts.cancelRefetch };
  if (domains !== "all" && domains.length === 0) return Promise.resolve();
  const inDomains = (key: unknown) => queryMatchesDomains(key, domains);
  return Promise.all([
    queryClient.invalidateQueries(
      {
        predicate: (q) =>
          inDomains(q.queryKey) && !isFormMirroredQuery(q.queryKey),
      },
      options,
    ),
    // Formular-queries: kun markeret forældede — ingen refetch under brugeren.
    queryClient.invalidateQueries({
      predicate: (q) =>
        inDomains(q.queryKey) && isFormMirroredQuery(q.queryKey),
      refetchType: "none",
    }),
  ]).then(() => undefined);
}

// ─── Fokus-refetch for visninger der skal være friske ──────────────────────

/**
 * Queries der hentes igen når fanen får fokus — dem brugerne forventer er
 * friske efter et skift fra extension/mobil: tidslisten, klippekort,
 * kundesiden og dashboard-widgets. Det er reservekanalen når SSE er nede.
 *
 * Bevidst en liste og ikke hele routere: `time.previewRate` kører pr. række,
 * og `time.getById` spejles ind i redigeringsformularen.
 */
const FOCUS_REFRESH_PATHS: ReadonlySet<string> = new Set([
  "time.list",
  "time.getRecent",
  "time.todayTotal",
  "time.monthlyHours",
  "time.monthlyRevenue",
  "time.unbilledStats",
  "time.weeklyGoalProgress",
  "time.weeklyComparison",
  "time.getProfitability",
  "time.revenueForecast",
  "time.getRoundingBonus",
  "time.productivityHeatmap",
  "time.getWeekReview",
  "prepaid.list",
  "prepaid.listForTime",
  "prepaid.getActiveForClient",
  "prepaid.getLowBalance",
  "prepaid.getExpiring",
  "clients.listWithStats",
  "clients.getPeriodHours",
  "clients.getTopClients",
  "clients.getAtRiskClients",
  "projects.getByClient",
  "projects.healthStatus",
  "projects.getBudgetAlerts",
  "invoices.getStats",
  "reports.getReportData",
]);

/** Undgå en refetch-storm ved hurtige alt-tab: data yngre end dette er ok. */
export const FOCUS_REFRESH_MIN_AGE_MS = 15_000;

/**
 * Værdi til QueryClient'ens `refetchOnWindowFocus`. Globalt er fokus-refetch
 * slået fra (formularer spejler query-data); kun listen ovenfor hentes igen,
 * og kun når data er mere end 15 s gamle. "always" fordi 5 min staleTime
 * ellers ville gøre fokus-refetch virkningsløs.
 */
export function focusRefetchFor(
  query: Pick<Query, "queryKey" | "state">,
  now: number = Date.now(),
): boolean | "always" {
  const path = queryKeyPath(query.queryKey);
  if (!path || !FOCUS_REFRESH_PATHS.has(path)) return false;
  return now - query.state.dataUpdatedAt >= FOCUS_REFRESH_MIN_AGE_MS
    ? "always"
    : false;
}

// ─── Samling af signaler udefra ────────────────────────────────────────────

/**
 * Samler invalideringer der kommer tæt (samme event på bruger- og org-
 * kanalen, flere faner der gemmer lige efter hinanden) til én runde efter
 * `delayMs`. Bruges kun til signaler udefra — fanens egne mutationer
 * invaliderer stadig med det samme.
 */
export function createCoalescedInvalidator(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  delayMs = 300,
): {
  push: (domains: readonly string[] | "all") => void;
  cancel: () => void;
} {
  let pending: Set<string> | "all" | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const domains = pending;
    pending = null;
    if (!domains) return;
    void invalidateDomains(
      queryClient,
      domains === "all" ? "all" : [...domains],
      { cancelRefetch: false },
    );
  };

  return {
    push(domains) {
      if (domains === "all" || pending === "all") {
        pending = "all";
      } else {
        pending ??= new Set();
        for (const d of domains) pending.add(d);
      }
      timer ??= setTimeout(flush, delayMs);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

/**
 * Vindue for at samle samme ændring fra BroadcastChannel (straks) og SSE
 * (lidt senere) til én refetch.
 */
export const REMOTE_COALESCE_MS = 1000;

const remoteInvalidators = new WeakMap<
  object,
  ReturnType<typeof createCoalescedInvalidator>
>();

/**
 * Én fælles samler pr. QueryClient for alle signaler udefra — så samme
 * ændring, der både kommer som krydsfane-besked og som SSE-event, kun
 * henter én gang i den modtagende fane.
 */
export function remoteInvalidatorFor(
  queryClient: Pick<QueryClient, "invalidateQueries">,
): ReturnType<typeof createCoalescedInvalidator> {
  let inv = remoteInvalidators.get(queryClient);
  if (!inv) {
    inv = createCoalescedInvalidator(queryClient, REMOTE_COALESCE_MS);
    remoteInvalidators.set(queryClient, inv);
  }
  return inv;
}
