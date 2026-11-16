import type { StatTone } from '~/components/ui/stat-tile';
import type { TxKeyPath } from '~/lib/i18n';
import { isSameMonth, startOfDay } from 'date-fns';

/** Statusser som backendens `invoices.transition` kender (spejler INVOICE_TRANSITIONS). */
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'deleted';
export type InvoiceFilter = 'all' | 'draft' | 'sent' | 'paid' | 'overdue';

export const INVOICE_FILTERS: readonly InvoiceFilter[] = ['all', 'draft', 'sent', 'paid', 'overdue'];

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['sent', 'deleted'],
  sent: ['paid', 'overdue'],
  overdue: ['paid', 'sent'],
  paid: [],
  deleted: [],
};

export function allowedTransitions(from: string | null | undefined): InvoiceStatus[] {
  return TRANSITIONS[(from ?? 'draft') as InvoiceStatus] ?? [];
}

export function canTransition(from: string | null | undefined, to: InvoiceStatus): boolean {
  return allowedTransitions(from).includes(to);
}

export type InvoiceLike = {
  status: string | null;
  dueDate: Date | string | null;
  paidDate?: Date | string | null;
  amount: string | number;
  kind?: string | null;
};

/**
 * Visningsstatus: en sendt faktura med overskredet forfaldsdato vises som
 * forfalden, selv om cron'en endnu ikke har flyttet den.
 */
export function effectiveStatus(inv: InvoiceLike, now = new Date()): InvoiceStatus {
  const status = (inv.status ?? 'draft') as InvoiceStatus;
  if (status === 'sent' && inv.dueDate) {
    const due = startOfDay(new Date(inv.dueDate));
    if (due < startOfDay(now))
      return 'overdue';
  }
  return status;
}

export function statusTone(status: InvoiceStatus): StatTone {
  switch (status) {
    case 'paid': return 'success';
    case 'sent': return 'primary';
    case 'overdue': return 'danger';
    case 'deleted': return 'danger';
    default: return 'default';
  }
}

export function statusTx(status: InvoiceStatus): TxKeyPath {
  return `invoices.status.${status}`;
}

export function matchesFilter(inv: InvoiceLike, filter: InvoiceFilter, now = new Date()): boolean {
  const status = effectiveStatus(inv, now);
  if (status === 'deleted')
    return false;
  if (filter === 'all')
    return true;
  return status === filter;
}

function toNumber(v: string | number | null | undefined): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Nøgletal til toppen af listen: forfaldent beløb og betalt i indeværende måned. */
export function listStats(invoices: InvoiceLike[], now = new Date()): { overdueAmount: number; paidThisMonth: number } {
  let overdueAmount = 0;
  let paidThisMonth = 0;
  for (const inv of invoices) {
    const status = effectiveStatus(inv, now);
    if (status === 'overdue')
      overdueAmount += toNumber(inv.amount);
    if (status === 'paid' && inv.paidDate && isSameMonth(new Date(inv.paidDate), now))
      paidThisMonth += toNumber(inv.amount);
  }
  return { overdueAmount, paidThisMonth };
}

export type LineLike = { amount: string | number };

/** Netto/moms/brutto ud fra linjer (fald tilbage til fakturabeløbet når der ingen linjer er). */
export function computeTotals(lines: LineLike[], fallbackAmount: string | number, vatRate: string | number | null | undefined): { net: number; vat: number; gross: number; vatRate: number } {
  const rate = toNumber(vatRate ?? 25);
  const net = lines.length > 0
    ? lines.reduce((sum, l) => sum + toNumber(l.amount), 0)
    : toNumber(fallbackAmount);
  const vat = Math.round(net * rate) / 100;
  return { net, vat, gross: net + vat, vatRate: rate };
}

export type UnbilledPeriod = 'thisMonth' | 'lastMonth' | 'all';

export type UnbilledEntryLike = { id: string; date: Date | string; hours: string | null; billableRate: string | null };

/** Filtrér ufakturerede poster på periode og summér timer/værdi. */
export function summarizeUnbilled(entries: UnbilledEntryLike[], period: UnbilledPeriod, now = new Date()): { ids: string[]; hours: number; value: number } {
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ids: string[] = [];
  let hours = 0;
  let value = 0;
  for (const e of entries) {
    const d = new Date(e.date);
    if (period === 'thisMonth' && !isSameMonth(d, now))
      continue;
    if (period === 'lastMonth' && !isSameMonth(d, lastMonth))
      continue;
    const h = toNumber(e.hours);
    ids.push(e.id);
    hours += h;
    value += h * toNumber(e.billableRate);
  }
  return { ids, hours: Math.round(hours * 100) / 100, value: Math.round(value) };
}
