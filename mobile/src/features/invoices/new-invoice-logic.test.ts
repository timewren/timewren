import type { DraftLine } from './invoice-lines-logic';
import type { AppRouter } from '~/api/app-router';
import { TRPCClientError } from '@trpc/client';
import { createPlan, planKey, retryAfterFailure } from './new-invoice-logic';

function line(patch: Partial<DraftLine> = {}): DraftLine {
  return { id: 'temp-1', description: 'Konsulent', quantity: '1', unitPrice: '1000', timeEntryId: null, ...patch };
}

const ISSUE = '2026-09-30';

describe('createPlan', () => {
  it('sender summeringen i create, præcis som saveLines regner den', () => {
    const plan = createPlan('klient-1', ISSUE, [
      line({ id: 'temp-a', description: 'Rådgivning', quantity: '7,5', unitPrice: '1000' }),
      line({ id: 'temp-b', description: 'Ret', quantity: '1', unitPrice: '250' }),
    ]);

    expect(plan).toEqual({
      ok: true,
      create: { clientId: 'klient-1', amount: '7750.00', issueDate: ISSUE, status: 'draft' },
      lines: [
        { id: undefined, description: 'Rådgivning', quantity: '7,5', unitPrice: '1000', amount: '7500.00', timeEntryId: null, sortOrder: 0 },
        { id: undefined, description: 'Ret', quantity: '1', unitPrice: '250', amount: '250.00', timeEntryId: null, sortOrder: 1 },
      ],
    });
  });

  it('kræver en kunde', () => {
    expect(createPlan(undefined, ISSUE, [line()])).toEqual({ ok: false, blocker: 'no_client' });
    expect(createPlan('', ISSUE, [line()])).toEqual({ ok: false, blocker: 'no_client' });
  });

  it('kræver mindst én brugbar linje', () => {
    expect(createPlan('klient-1', ISSUE, [])).toEqual({ ok: false, blocker: 'no_lines' });
    // Helt uberørte felter er ikke en fejl, men de tæller heller ikke.
    expect(createPlan('klient-1', ISSUE, [line({ description: '', quantity: '1', unitPrice: '0' })])).toEqual({ ok: false, blocker: 'no_lines' });
  });

  it('afviser en linje med beløb men uden beskrivelse', () => {
    const plan = createPlan('klient-1', ISSUE, [line(), line({ id: 'temp-2', description: '   ' })]);
    expect(plan).toEqual({ ok: false, blocker: 'line_problem' });
  });

  it('afviser et beløb på 0 — serverens monetaryAmount ville afvise det', () => {
    expect(createPlan('klient-1', ISSUE, [line({ unitPrice: '0' })])).toEqual({ ok: false, blocker: 'bad_total' });
  });

  it('afviser et beløb over serverens grænse på 100 mio.', () => {
    const plan = createPlan('klient-1', ISSUE, [line({ quantity: '1', unitPrice: '100000001' })]);
    expect(plan).toEqual({ ok: false, blocker: 'bad_total' });
  });

  it('sender eksisterende linje-id’er uændret, så en gem ikke indsætter dem igen', () => {
    const plan = createPlan('klient-1', ISSUE, [line({ id: 'linje-7' })]);
    expect(plan.ok && plan.lines[0]?.id).toBe('linje-7');
  });
});

describe('planKey', () => {
  it('skelner to forskellige kladder der ligner hinanden', () => {
    const a = [line({ id: 'temp-a' })];
    const b = [line({ id: 'temp-b', description: 'Andet arbejde' })];
    expect(planKey('klient-1', a)).not.toBe(planKey('klient-2', a));
    expect(planKey('klient-1', a)).not.toBe(planKey('klient-1', b));
  });

  it('er stabil for det samme indhold, så et uafgjort kald kendes igen', () => {
    // temp-id'et sendes ikke med, så to ens linjer er samme krop — og dermed
    // samme nøgle. Det er præcis det vi skal genkende.
    expect(planKey('klient-1', [line({ id: 'temp-a' })])).toBe(planKey('klient-1', [line({ id: 'temp-b' })]));
  });

  it('ændrer sig så snart brugeren rører beløbet', () => {
    expect(planKey('klient-1', [line()])).not.toBe(planKey('klient-1', [line({ unitPrice: '1001' })]));
  });
});

function serverError(message: string, code?: string): TRPCClientError<AppRouter> {
  return new TRPCClientError(message, {
    result: code
      ? { error: { code: -32000, message, data: { code, httpStatus: 500, path: 'x' } } }
      : undefined,
  } as any);
}

describe('retryAfterFailure', () => {
  it('sender brugeren til listen efter et tabt svar — kaldet kan have nået serveren', () => {
    const lost = TRPCClientError.from(new TypeError('Network request failed')) as TRPCClientError<AppRouter>;
    expect(retryAfterFailure(lost)).toBe('open_list');
  });

  it('lader et afgjort kald prøves igen', () => {
    expect(retryAfterFailure(serverError('Vælg en klient', 'BAD_REQUEST'))).toBe('create_again');
    expect(retryAfterFailure(serverError('Database kunne ikke nås', 'INTERNAL_SERVER_ERROR'))).toBe('create_again');
  });
});
