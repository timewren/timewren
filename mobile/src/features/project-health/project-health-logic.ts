import type { RouterOutputs } from '~/api/app-router';
import type { StatTone } from '~/components/ui/stat-tile';
import { healthTone } from '~/features/projects/project-logic';
import { formatDateShort, formatMoney } from '~/lib/format';

export type ProjectHealth = RouterOutputs['projects']['healthStatus'][number];
export type BudgetAlert = RouterOutputs['projects']['getBudgetAlerts'][number];
export type AlertSeverity = BudgetAlert['severity'];
export type RateChange = RouterOutputs['rateHistory']['getHistory'][number];
export type MemberRate = RouterOutputs['memberRates']['listForProject'][number];

/** Samme tærskler som web's `getBudgetAlerts`: 80 / 90 / 100 %. */
export const ALERT_WARN = 80;
export const ALERT_CRITICAL = 90;
export const ALERT_EXCEEDED = 100;

/**
 * Web rækker kun alarmen ind, når et fastprisprojekt er brugt 80 % af sit
 * budget. Under det er der intet at advare om, så vi returnerer `null` i stedet
 * for en severity, skærmen ikke må vise.
 */
export function alertSeverity(percentage: number | null | undefined): AlertSeverity | null {
  if (typeof percentage !== 'number' || !Number.isFinite(percentage))
    return null;
  if (percentage >= ALERT_EXCEEDED)
    return 'exceeded';
  if (percentage >= ALERT_CRITICAL)
    return 'critical';
  if (percentage >= ALERT_WARN)
    return 'warning';
  return null;
}

/**
 * Tonen følger den samme 75/90-grænse som projektets egen health-score
 * (`healthFromPercentage`), så et projekt ikke er gult i oversigten og rødt
 * på sin egen side. `critical` og `exceeded` deler rød med vilje — forskellen
 * står i teksten, ikke i to nye farver.
 */
export function alertTone(severity: AlertSeverity | null | undefined): StatTone {
  if (severity === 'exceeded')
    return healthTone('red');
  if (severity === 'critical')
    return healthTone('red');
  if (severity === 'warning')
    return healthTone('yellow');
  return 'default';
}

export type AlertLabelKey
  = | 'project_health.alert_exceeded'
    | 'project_health.alert_critical'
    | 'project_health.alert_warning';

export function alertLabelKey(severity: AlertSeverity | null | undefined): AlertLabelKey | null {
  switch (severity) {
    case 'exceeded': return 'project_health.alert_exceeded';
    case 'critical': return 'project_health.alert_critical';
    case 'warning': return 'project_health.alert_warning';
    default: return null;
  }
}

/** Et projekt uden fastpris har intet budget at blive målt imod. */
export function hasBudget(project: ProjectHealth | null | undefined): boolean {
  return typeof project?.estimatedBudget === 'number' && Number.isFinite(project.estimatedBudget) && project.estimatedBudget > 0;
}

/**
 * Uden budget er forbruget en tankestreg, ikke "0 %". Serveren sætter
 * `budgetPercentage: 0` for et projekt uden fastpris, og en rød "0 %" ville
 * være en påstand om et budget, der ikke findes.
 */
export function usageText(project: ProjectHealth | null | undefined): string {
  if (!hasBudget(project))
    return '—';
  const pct = project!.budgetPercentage;
  return typeof pct === 'number' && Number.isFinite(pct) ? `${pct} %` : '—';
}

/** 0–1 til budget-bjælken; over 100 % låses på 1, så bjælken ikke løber ud. */
export function barFraction(project: ProjectHealth | null | undefined): number {
  if (!hasBudget(project))
    return 0;
  const pct = project!.budgetPercentage;
  if (typeof pct !== 'number' || !Number.isFinite(pct))
    return 0;
  return Math.min(Math.max(pct / 100, 0), 1);
}

/**
 * Antal projekter der kræver handling. Tælles på rækken, ikke på alarmerne:
 * serveren sorterer rød først, så et antal i toppen er det brugeren skal se.
 */
export function attentionCount(projects: readonly ProjectHealth[] | null | undefined): number {
  return (projects ?? []).filter(p => p.healthStatus === 'red').length;
}

export function needsAttention(project: ProjectHealth | null | undefined): boolean {
  return project?.healthStatus === 'red';
}

export type AttentionCaptionKey
  = | 'project_health.needs_attention_one'
    | 'project_health.needs_attention_other';

export function attentionCaptionKey(count: number): AttentionCaptionKey {
  return count === 1 ? 'project_health.needs_attention_one' : 'project_health.needs_attention_other';
}

/** Kunden vises kun når der er en — ellers er "Intern" det samme som ingenting. */
export function clientLine(project: { clientName?: string | null } | null | undefined): string | null {
  const name = project?.clientName?.trim();
  if (!name)
    return null;
  return name;
}

/** "4,5 t af 10 t" — timerne brugeren kan genkende, ikke kun procent. */
export function budgetUsageLine(project: ProjectHealth | null | undefined, formatHours: (h: number) => string): string | null {
  if (!hasBudget(project) || typeof project!.hoursUsed !== 'number')
    return null;
  return `${formatHours(project!.hoursUsed)} af ${formatHours(project!.estimatedBudget!)}`;
}

export function hasRateHistory(changes: readonly RateChange[] | null | undefined): boolean {
  return (changes ?? []).length > 0;
}

/**
 * `effectiveDate` kommer fra serverens tidsstempel (superjson giver en rigtig
 * `Date`). `formatDateShort` kan godt finde ud af at skjule en ugyldig dato bag
 * en tankestreg, men i en liste hvor alle andre rækker HAR en dato er en
 * tankestreg bare støj — derfor returnerer vi `null`, så rækken kan springes
 * over. Samme streng som logbogens `isWeekStart`.
 */
export function rateEffectiveDate(change: RateChange | null | undefined): string | null {
  const raw = change?.effectiveDate;
  if (raw === null || raw === undefined)
    return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime()))
    return null;
  return formatDateShort(date);
}

function rate(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '')
    return null;
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * En prisændring er "750 kr." første gang og "600 → 750 kr." siden. Uden
 * `oldRate` må vi ikke finde på en forrige pris, så den udelades.
 */
export function rateChangeText(change: RateChange | null | undefined): string {
  const next = rate(change?.newRate);
  if (next === null)
    return '—';
  const previous = rate(change?.oldRate);
  return previous === null ? formatMoney(next) : `${formatMoney(previous)} → ${formatMoney(next)}`;
}

/** Stiger prisen, falder den — bruges til pilen ved siden af beløbet. */
export function rateDirection(change: RateChange | null | undefined): 'up' | 'down' | 'flat' | null {
  const next = rate(change?.newRate);
  if (next === null)
    return null;
  const previous = rate(change?.oldRate);
  if (previous === null)
    return 'up';
  if (next > previous)
    return 'up';
  return next < previous ? 'down' : 'flat';
}

/**
 * En medarbejder kan have sin egen sats på projektet eller arve sin
 * standardpris. Uden egen sats vises standardprisen med en mærkning, så tallet
 * ikke ligner en aftale om dette projekt.
 */
export function memberRate(row: MemberRate | null | undefined): { amount: number | null; inherited: boolean } {
  const own = rate(row?.projectRate);
  if (own !== null)
    return { amount: own, inherited: false };
  return { amount: rate(row?.userDefaultRate), inherited: true };
}

export function memberRateText(row: MemberRate | null | undefined): string {
  const { amount } = memberRate(row);
  return amount === null ? '—' : formatMoney(amount);
}

/**
 * `memberRates.listForProject` er `orgAdminProcedure` og svarer med alle
 * orgens medlemmer — også dem uden sats. En matematisk sand påstand om
 * " alle har samme pris" ville være en løgn, så vi tæller kun dem der har en.
 */
export function memberRateCount(rows: readonly MemberRate[] | null | undefined): number {
  return (rows ?? []).filter(r => memberRate(r).amount !== null).length;
}
