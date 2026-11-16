import type { HistoryLog } from '../client-history-logic';
import * as React from 'react';
import i18n from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';
import { ClientHistory } from './client-history';

/**
 * `ListRow` pakker titel og undertitel i ét label med
 * `accessibilityElementsHidden`, fordi rækken er ét stop. RNTL springer skjulte
 * elementer over ved opslag, så UDEN dette ville alle taltjek være grønne fordi
 * de intet fandt.
 */
const SKJULT = { includeHiddenElements: true } as const;

beforeEach(async () => {
  await i18n.changeLanguage('da');
});

afterEach(cleanup);

/**
 * Et tidspunkt på **dagens** dato. «I dag» er et spørgsmål om dagens kalenderdag,
 * så et fastsat klokkeslæt som `'2026-10-01T12:32:00.000Z'` var en tidbombe:
 * testen passede den dag den blev skrevet og fejlede dagen efter.
 */
function iDag(time: [number, number] = [12, 32]): string {
  const d = new Date();
  d.setHours(time[0], time[1], 0, 0);
  return d.toISOString();
}

function log(partial: Partial<HistoryLog> & { id: string }): HistoryLog {
  return { action: 'update', changes: [], createdAt: iDag(), user: { id: 'u1', name: 'Mads Holst Jensen' }, ...partial };
}

function renderHistory(logs: HistoryLog[] | undefined, over?: { isLoading?: boolean; isError?: boolean }) {
  return render(
    <ClientHistory
      logs={logs}
      isLoading={over?.isLoading ?? false}
      isError={over?.isError ?? false}
      errorMessage="Serveren svarer 500"
      onRetry={jest.fn()}
    />,
  );
}

/**
 * R5's regel: et kald der fejler må ikke male et nul. Uden `isError` ville et
 * 500 fra `activity.list` ramme `logs`-tjekket og vise «Ingen registreringer
 * endnu» — en påstand om kunden, der er lige så forkert som de nullere R5
 * fjernede fra `ClientStats`.
 */
describe('fejltilstand', () => {
  it('viser fejlen og ikke tom-tilstanden, når kallet fejler', () => {
    renderHistory([], { isError: true });

    expect(screen.getByText('Serveren svarer 500', SKJULT)).toBeTruthy();
    expect(screen.queryByText(i18n.t('clients.history_empty'), SKJULT)).toBeNull();
  });
});

describe('tom-tilstand', () => {
  it('siger hvad der mangler, og hvorfor den er tom', () => {
    renderHistory([]);

    expect(screen.getByText(i18n.t('clients.history_empty'), SKJULT)).toBeTruthy();
    expect(screen.getByText(i18n.t('clients.history_empty_body'), SKJULT)).toBeTruthy();
  });
});

/**
 * `changes` er `jsonb` og helt utypet. Serveren skriver i dag en række af
 * `FieldChange`, men intet sikrer det — og web's `tasks.ts` skriver et objekt
 * i samme kolonne. Uden filtrering ville den skærm vise `[object Object]` som
 * en ændring.
 */
describe('udokumenterede ændringsformer', () => {
  it('maler aldrig [object Object], selv når serveren sender en anden form', () => {
    renderHistory([log({ id: 'a', changes: { status: { from: 'todo', to: 'done' } } })]);

    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });

  it('viser rækken stadig, selv når dens ændringer ikke kan læses', () => {
    renderHistory([log({ id: 'a', changes: 'navn' })]);

    expect(screen.getByTestId('client-history-a')).toBeTruthy();
  });
});

describe('en hændelse', () => {
  it('viser handlingen, hvem og hvornår', () => {
    renderHistory([log({ id: 'a', action: 'update' })]);

    const label = String(screen.getByTestId('client-history-a').props.accessibilityLabel ?? '');
    expect(label).toContain('Opdateret');
    expect(label).toContain('Mads Holst Jensen');
    expect(label).toMatch(/I dag \d{2}:\d{2}/);
  });

  it('viser «fra» og «til» for hvert ændret felt', () => {
    renderHistory([log({
      id: 'a',
      changes: [{ field: 'defaultHourlyRate', fieldLabel: 'Timesats', before: '850.00', after: '950.00' }],
    })]);

    expect(screen.getByText('850 kr.', SKJULT)).toBeTruthy();
    expect(screen.getByText('950 kr.', SKJULT)).toBeTruthy();
    expect(screen.getAllByText(i18n.t('clients.history_field_from')).length).toBe(1);
    expect(screen.getAllByText(i18n.t('clients.history_field_to')).length).toBe(1);
  });

  it('viser en ryddet værdi som «—» og ikke som «null»', () => {
    renderHistory([log({
      id: 'a',
      changes: [{ field: 'email', fieldLabel: 'E-mail', before: 'a@acme.dk', after: null }],
    })]);

    expect(screen.getByText('a@acme.dk', SKJULT)).toBeTruthy();
    expect(screen.getByText('—', SKJULT)).toBeTruthy();
    expect(screen.queryByText('null')).toBeNull();
  });

  it('lader navnet være, når serveren ikke gav et navn med', () => {
    renderHistory([log({ id: 'a', user: null })]);

    const label = String(screen.getByTestId('client-history-a').props.accessibilityLabel ?? '');
    expect(label).not.toContain(i18n.t('clients.history_who'));
    expect(label).toMatch(/I dag \d{2}:\d{2}/);
  });

  it('er ikke trykbar, fordi der ingen handling er bag den', () => {
    renderHistory([log({ id: 'a' })]);

    expect(screen.getByTestId('client-history-a').props.onPress).toBeUndefined();
  });
});

/**
 * Listen er klippet af serverens `limit`. Uden en note viste en kunde med 60
 * hændelser de 20 seneste, som om de var alle — den påstand uden dækning, F3's
 * revision af tallene på kundekortet blev skrevet for at lukke.
 */
describe('afkortningen', () => {
  function mange(tal: number): HistoryLog[] {
    return Array.from({ length: tal }, (_, i) => log({ id: `l${i}` }));
  }

  it('sager at listen er klippet, når serveren fyldte grænsen', () => {
    renderHistory(mange(20));

    expect(screen.getByTestId('client-history-truncated')).toBeTruthy();
    expect(screen.getByText('Viser kun de seneste 20 hændelser', SKJULT)).toBeTruthy();
  });

  it('siger intet om afkortning, når der er plads tilbage', () => {
    renderHistory(mange(19));

    expect(screen.queryByTestId('client-history-truncated')).toBeNull();
  });

  it('tæller på det antal serveren svarede, ikke på det der blev vist', () => {
    // Ét element i `changes` pr. række ville give flere linjer end rækker.
    renderHistory(mange(20));

    expect(screen.queryAllByTestId(/^client-history-l\d+$/).length).toBe(20);
  });
});
