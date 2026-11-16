import {
  allowedTransitions,
  canTransition,
  computeTotals,
  effectiveStatus,
  listStats,
  matchesFilter,
  statusTone,
  summarizeUnbilled,
} from './invoice-logic';

const NOW = new Date(2026, 8, 6, 12); // 6. sep. 2026

describe('invoice-logic', () => {
  it('spejler backendens tilladte overgange', () => {
    expect(allowedTransitions('draft')).toEqual(['sent', 'deleted']);
    expect(allowedTransitions('sent')).toEqual(['paid', 'overdue']);
    expect(allowedTransitions('overdue')).toEqual(['paid', 'sent']);
    expect(allowedTransitions('paid')).toEqual([]);
    expect(canTransition('sent', 'draft')).toBe(false);
    expect(canTransition(null, 'sent')).toBe(true);
  });

  it('viser sendt med overskredet forfald som forfalden', () => {
    expect(effectiveStatus({ status: 'sent', dueDate: new Date(2026, 8, 1), amount: '1' }, NOW)).toBe('overdue');
    expect(effectiveStatus({ status: 'sent', dueDate: new Date(2026, 8, 6), amount: '1' }, NOW)).toBe('sent');
    expect(effectiveStatus({ status: 'sent', dueDate: null, amount: '1' }, NOW)).toBe('sent');
    expect(effectiveStatus({ status: 'paid', dueDate: new Date(2026, 0, 1), amount: '1' }, NOW)).toBe('paid');
  });

  it('status → tone', () => {
    expect(statusTone('overdue')).toBe('danger');
    expect(statusTone('paid')).toBe('success');
    expect(statusTone('sent')).toBe('primary');
    expect(statusTone('draft')).toBe('default');
  });

  it('filter skjuler slettede og matcher effektiv status', () => {
    const overdue = { status: 'sent', dueDate: new Date(2026, 7, 1), amount: '100' };
    expect(matchesFilter(overdue, 'overdue', NOW)).toBe(true);
    expect(matchesFilter(overdue, 'sent', NOW)).toBe(false);
    expect(matchesFilter({ status: 'deleted', dueDate: null, amount: '1' }, 'all', NOW)).toBe(false);
  });

  it('listStats summerer forfaldent og betalt i måneden', () => {
    const stats = listStats([
      { status: 'sent', dueDate: new Date(2026, 7, 1), amount: '1000' },
      { status: 'overdue', dueDate: new Date(2026, 7, 1), amount: '500.50' },
      { status: 'paid', dueDate: null, paidDate: new Date(2026, 8, 2), amount: '2000' },
      { status: 'paid', dueDate: null, paidDate: new Date(2026, 7, 30), amount: '999' },
    ], NOW);
    expect(stats.overdueAmount).toBe(1500.5);
    expect(stats.paidThisMonth).toBe(2000);
  });

  it('computeTotals regner moms af linjerne, ellers af fakturabeløbet', () => {
    expect(computeTotals([{ amount: '100' }, { amount: '50.5' }], '999', '25.00')).toEqual({ net: 150.5, vat: 37.63, gross: 188.13, vatRate: 25 });
    expect(computeTotals([], '200', null)).toEqual({ net: 200, vat: 50, gross: 250, vatRate: 25 });
    expect(computeTotals([], '200', '0').vat).toBe(0);
  });

  it('summarizeUnbilled filtrerer på periode', () => {
    const entries = [
      { id: 'a', date: new Date(2026, 8, 3), hours: '2', billableRate: '800' },
      { id: 'b', date: new Date(2026, 7, 20), hours: '1.5', billableRate: '1000' },
      { id: 'c', date: new Date(2026, 5, 1), hours: '1', billableRate: null },
    ];
    expect(summarizeUnbilled(entries, 'thisMonth', NOW)).toEqual({ ids: ['a'], hours: 2, value: 1600 });
    expect(summarizeUnbilled(entries, 'lastMonth', NOW)).toEqual({ ids: ['b'], hours: 1.5, value: 1500 });
    expect(summarizeUnbilled(entries, 'all', NOW)).toEqual({ ids: ['a', 'b', 'c'], hours: 4.5, value: 3100 });
  });
});
