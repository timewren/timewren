import type { ActivityInvoice } from './client-activity-logic';
import { clientActivity, hasOverdue, isEmptyActivity, lastInvoice } from './client-activity-logic';

const NOW = new Date('2026-10-01T10:00:00+02:00');

function inv(partial: Partial<ActivityInvoice> & { id: string }): ActivityInvoice {
  return { status: 'sent', amount: 0, createdAt: '2026-09-01T09:00:00.000Z', dueDate: null, ...partial };
}

describe('lastInvoice', () => {
  it('tager den nyeste, ikke den første i rækken', () => {
    const invoices = [
      inv({ id: 'gammel', invoiceNumber: '1001', createdAt: '2026-01-01T09:00:00.000Z', amount: 500 }),
      inv({ id: 'ny', invoiceNumber: '1042', createdAt: '2026-09-30T09:00:00.000Z', amount: 1200 }),
    ];
    expect(lastInvoice(invoices, NOW)?.id).toBe('ny');
  });

  it('sorterer selv om rækken kommer i modsat rækkefølge', () => {
    const invoices = [
      inv({ id: 'ny', createdAt: '2026-09-30T09:00:00.000Z' }),
      inv({ id: 'gammel', createdAt: '2026-01-01T09:00:00.000Z' }),
    ];
    expect(lastInvoice(invoices, NOW)?.id).toBe('ny');
  });

  it('lader en kladde være den seneste — den er stadig et ærligt svar', () => {
    const invoices = [
      inv({ id: 'k', status: 'draft', invoiceNumber: '1043', createdAt: '2026-09-30T09:00:00.000Z' }),
      inv({ id: 's', status: 'sent', invoiceNumber: '1042', createdAt: '2026-09-01T09:00:00.000Z' }),
    ];
    expect(lastInvoice(invoices, NOW)?.status).toBe('draft');
  });

  it('viser en sendt faktura med overskredet forfaldsdato som forfalden', () => {
    const invoices = [inv({ id: 's', status: 'sent', dueDate: '2026-09-20', createdAt: '2026-09-01T09:00:00.000Z' })];
    expect(lastInvoice(invoices, NOW)?.status).toBe('overdue');
  });

  it('beholder «sendt», når forfaldsdatoen ligger i dag', () => {
    const invoices = [inv({ id: 's', status: 'sent', dueDate: '2026-10-01', createdAt: '2026-09-01T09:00:00.000Z' })];
    expect(lastInvoice(invoices, NOW)?.status).toBe('sent');
  });

  it('læser beløb fra serverens decimal-streng', () => {
    const invoices = [inv({ id: 's', amount: '1234.50' })];
    expect(lastInvoice(invoices, NOW)?.amount).toBe(1234.5);
  });

  it('giver 0 for et beløb der ikke kan læses', () => {
    const invoices = [inv({ id: 's', amount: 'ikke-et-tal' })];
    expect(lastInvoice(invoices, NOW)?.amount).toBe(0);
  });

  it('er null for en tom liste', () => {
    expect(lastInvoice([], NOW)).toBeNull();
  });
});

describe('clientActivity', () => {
  it('læser de tre linjer fra de to kald', () => {
    const activity = clientActivity(
      { lastActivityDate: '2026-09-28', overdueCount: 2, overdueAmount: '3400.00' },
      [inv({ id: 'a', invoiceNumber: '1042', amount: '3400.00' })],
      NOW,
    );
    expect(activity.lastEntryDate).toBe('2026-09-28');
    expect(activity.overdueCount).toBe(2);
    expect(activity.overdueAmount).toBe(3400);
    expect(activity.lastInvoice?.number).toBe('1042');
  });

  it('overlever at stats-kaldet endnu ikke er svaret', () => {
    const activity = clientActivity(undefined, [], NOW);
    expect(activity.lastEntryDate).toBeNull();
    expect(activity.overdueCount).toBe(0);
    expect(activity.lastInvoice).toBeNull();
  });

  it('beholder 0 uanset at beløbet kommer som streng', () => {
    expect(clientActivity({ overdueAmount: '0.00', overdueCount: 0 }, [], NOW).overdueAmount).toBe(0);
  });

  /**
   * Badgen på «Seneste faktura» bruger `effectiveStatus`, mens linjen
   * «Forfalde fakturaer» fik serverens tal — der kun tæller status `overdue`,
   * altså dem cron'en kl. 06.15 har flyttet. Kl. 09.00 den 1. oktober sagde
   * kortet «Forfalden» på 1.500 kr. og «Ingen forfaldne» på linjen under: to
   * sandheder om den samme kunde i samme skærmbillede.
   */
  it('lægger en sendt faktura med overskredet forfaldsdato oveni serverens tal', () => {
    const activity = clientActivity(
      { overdueCount: 0, overdueAmount: '0.00' },
      [inv({ id: 'a', status: 'sent', dueDate: '2026-09-29', amount: '1500.00', createdAt: '2026-09-20T09:00:00.000Z' })],
      NOW,
    );
    expect(hasOverdue(activity)).toBe(true);
    expect(activity.overdueCount).toBe(1);
    expect(activity.overdueAmount).toBe(1500);
  });

  it('tæller ikke en faktura, serveren allerede har markeret forfalden', () => {
    const activity = clientActivity(
      { overdueCount: 1, overdueAmount: '1500.00' },
      [inv({ id: 'a', status: 'overdue', dueDate: '2026-09-29', amount: '1500.00' })],
      NOW,
    );
    expect(activity.overdueCount).toBe(1);
    expect(activity.overdueAmount).toBe(1500);
  });

  it('lader betalte og kladde-fakturaer ude, uanset forfaldsdato', () => {
    const activity = clientActivity(
      { overdueCount: 0, overdueAmount: '0.00' },
      [
        inv({ id: 'p', status: 'paid', dueDate: '2026-09-01', amount: '900.00' }),
        inv({ id: 'd', status: 'draft', dueDate: '2026-09-01', amount: '400.00' }),
        inv({ id: 's', status: 'sent', dueDate: '2026-09-01', amount: '100.00' }),
      ],
      NOW,
    );
    expect(activity.overdueCount).toBe(1);
    expect(activity.overdueAmount).toBe(100);
  });
});

describe('isEmptyActivity', () => {
  it('er sand for en kunde uden tid, faktura og forfald', () => {
    expect(isEmptyActivity(clientActivity({ lastActivityDate: null, overdueCount: 0 }, [], NOW))).toBe(true);
  });

  it('er falsk så snart der er en tid', () => {
    expect(isEmptyActivity(clientActivity({ lastActivityDate: '2026-09-28' }, [], NOW))).toBe(false);
  });

  it('er falsk så snart der er en faktura', () => {
    expect(isEmptyActivity(clientActivity({ lastActivityDate: null }, [inv({ id: 'a' })], NOW))).toBe(false);
  });

  it('er falsk når der er et forfaldsbeløb uden synlige forfalde fakturaer', () => {
    expect(isEmptyActivity(clientActivity({ overdueCount: 1, overdueAmount: '500.00' }, [], NOW))).toBe(false);
  });

  it('er falsk på et forfaldsbeløb alene, uden antal', () => {
    expect(isEmptyActivity(clientActivity({ overdueCount: 0, overdueAmount: '500.00' }, [], NOW))).toBe(false);
  });
});

describe('hasOverdue', () => {
  it('kræver antal *eller* beløb', () => {
    expect(hasOverdue(clientActivity({ overdueCount: 0, overdueAmount: '0.00' }, [], NOW))).toBe(false);
    expect(hasOverdue(clientActivity({ overdueCount: 2, overdueAmount: '0.00' }, [], NOW))).toBe(true);
    expect(hasOverdue(clientActivity({ overdueCount: 0, overdueAmount: '1.00' }, [], NOW))).toBe(true);
  });
});
