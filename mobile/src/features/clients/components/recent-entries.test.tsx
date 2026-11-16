import * as React from 'react';

import i18n from '~/lib/i18n';
import { cleanup, render, screen } from '~/lib/test-utils';
import { RecentEntries } from './recent-entries';

afterEach(cleanup);

// Deklarationen er hoisted, så den findes når `jest.mock`-fabrikken køres.
function mockRouter() {
  return { push: jest.fn() };
}
jest.mock('expo-router', () => ({ useRouter: mockRouter }));

const EMPTY = i18n.t('clients.no_time');

/**
 * Et kald der svarer 500 er ikke det samme som "kunden har ingen registrerede
 * tider". Før dette faldt `isError`-kaldet gennem til
 * `!entries || entries.length === 0`, så skærmen sagde den tomme tekst mens
 * den i virkeligheden ikke vidste det — og `screenLoad` læste "Indhold
 * indlæst" oveni, fordi kunden selv var kommet.
 */
describe('recentEntries', () => {
  it('viser fejlen, ikke "ingen tider", når kallet fejlede', () => {
    render(
      <RecentEntries
        entries={undefined}
        isLoading={false}
        isError
        errorMessage="Serveren svarer 500"
        onRetry={() => {}}
        emptyTitle={EMPTY}
      />,
    );

    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getByText(i18n.t('common.error_generic'))).toBeTruthy();
  });

  it('tilbyder "Prøv igen" på fejlen, så brugeren ikke skal trække for at prøve igen', () => {
    const onRetry = jest.fn();
    render(
      <RecentEntries
        entries={undefined}
        isLoading={false}
        isError
        errorMessage="Serveren svarer 500"
        onRetry={onRetry}
        emptyTitle={EMPTY}
      />,
    );

    screen.getByTestId('retry').props.onClick?.();
    expect(onRetry).toHaveBeenCalled();
  });

  it('siger stadig "ingen tider" når kallet virkelig kom tomt', () => {
    render(<RecentEntries entries={[]} isLoading={false} emptyTitle={EMPTY} />);

    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByText(i18n.t('common.error_generic'))).toBeNull();
  });
});
