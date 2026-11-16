import * as React from 'react';
import { AccessibilityInfo } from 'react-native';
import i18n from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';
import { ScreenLoad } from '~/lib/notify-load';
import { cleanup, render, screen } from '~/lib/test-utils';
import { ProjectList } from './project-list';

// Deklarationen er hoisted, så den findes når `jest.mock`-fabrikken køres.
function mockRouter() {
  return { push: jest.fn() };
}
jest.mock('expo-router', () => ({ useRouter: mockRouter }));

const spoken = AccessibilityInfo.announceForAccessibility as jest.Mock;
const LOADED = i18n.t('common.loaded');

const PROJECTS = [{ id: 'p1', name: 'Nordahl', status: 'active' }];

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

/** En skærm som de to kaldssteder sidder på: listen *og* et søskenderegion. */
function Region({ isLoading }: { isLoading: boolean }) {
  useReportLoad({ isLoading, isError: false }, LOADED);
  return null;
}

function Screen({ list, sibling, message = LOADED }: { list: boolean; sibling: boolean; message?: string }) {
  return (
    <ScreenLoad message={message}>
      <Region isLoading={sibling} />
      <ProjectList projects={list ? undefined : PROJECTS} isLoading={list} />
    </ScreenLoad>
  );
}

/**
 * 6.23 rettede dobbeltlæsningen ved at lade `ProjectList` *melde* sit kald
 * (`useReportLoad`) i stedet for at tale selv. Porten i `notify.test.ts` dømmer
 * det ved at læse kilderne — den tæller stemmer i importene, ikke i den der
 * renderer. Reviewen 29/9 sagde det råt: «Ingen test renderer de to skærme […]
 * porten er grøn fordi den ikke kigger.»
 *
 * Her løber den ægte kæde i stedet: `ProjectList` → `useReportLoad` →
 * `ScreenLoad` → `useLoadAnnounce` → `announceForAccessibility`, og der tælles
 * hvor mange gange skærmlæseren faktisk ville høre det. Det er den fejlform,
 * ingen kilde-læsning kan finde: to hooks kan begge være kilde-richtige og
 * alligevel give to højttalerede beskeder for ét og samme kald.
 *
 * Grænsen er bevidst: skærmens egen ledning — ét `ScreenLoad` pr. skærm —
 * dømmes stadig i `notify.test.ts`, fordi `ProjectsListScreen` kræver
 * trpc-provider og capabilities. Her renderer den komponent, der gjorde fejlen.
 */
describe('projektlistens stemme', () => {
  it('læser "indlæst" ÉN gang for ét kald under skærmens stop', () => {
    const view = render(<Screen list sibling />);

    view.rerender(<Screen list={false} sibling={false} />);

    // Før 6.23 læste både `useAnnounceLoaded` i listen OG `useLoadAnnounce` i
    // skærmens `ScreenLoad` — to ens beskeder i træk for ét kald.
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith(LOADED);
  });

  it('læser skærmens besked, ikke listens egen', () => {
    const view = render(<Screen list sibling message="Projekter for Nordahl indlæst" />);

    view.rerender(<Screen list={false} sibling={false} message="Projekter for Nordahl indlæst" />);

    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith('Projekter for Nordahl indlæst');
  });

  it('tier mens et søskenderegion stadig summerer — listen må ikke tale først', () => {
    // Formen fra `client-detail-screen`: listen blev færdig før nøgletal,
    // seneste tider og klippekort, så skærmlæseren hørte "Indhold indlæst"
    // mens fire andre regioner stadig ventede.
    const view = render(<Screen list sibling />);
    expect(spoken).not.toHaveBeenCalled();

    view.rerender(<Screen list={false} sibling />);
    expect(spoken).not.toHaveBeenCalled();

    view.rerender(<Screen list={false} sibling={false} />);
    expect(spoken).toHaveBeenCalledTimes(1);
  });

  it('taler selv uden en skærm ovenover, så listen er sikker at genbruge', () => {
    const view = render(<ProjectList projects={undefined} isLoading />);

    view.rerender(<ProjectList projects={PROJECTS} isLoading={false} />);

    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith(LOADED);
  });

  it('siger intet om et kald der fejlede — "indlæst" er en påstand om data der ikke kom', () => {
    const view = render(<ProjectList projects={undefined} isLoading />);

    view.rerender(<ProjectList projects={[]} isLoading={false} isError errorMessage="Serveren svarer 500" onRetry={() => {}} />);

    expect(spoken).not.toHaveBeenCalled();
  });

  it('viser fejlen i stedet for den tomme tilstand', () => {
    render(<ProjectList projects={[]} isLoading={false} isError errorMessage="Serveren svarer 500" onRetry={() => {}} />);

    expect(screen.queryByText(i18n.t('projects.empty_title'))).toBeNull();
    expect(screen.getByText(i18n.t('common.error_generic'))).toBeTruthy();
  });
});
