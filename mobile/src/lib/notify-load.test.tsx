import type { LoadSource } from './notify';
import { render, screen } from '@testing-library/react-native';
import * as React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { useAnnounceVisible, useReportLoad } from './notify';
import { ScreenLoad } from './notify-load';

const spoken = AccessibilityInfo.announceForAccessibility as jest.Mock;

afterEach(() => {
  jest.clearAllMocks();
});

function load(props: Partial<LoadSource>): LoadSource {
  return { isLoading: false, isError: false, ...props };
}

function Region({ source, message = 'Indhold indlæst' }: { source: LoadSource; message?: string }) {
  useReportLoad(source, message);
  return <Text>{source.isLoading ? 'indlæser' : 'indlæst'}</Text>;
}

describe('useReportLoad under en ScreenLoad', () => {
  it('gør tre kort på hemskærmen til ét stop, ikke tre', () => {
    const { rerender } = render(<ScreenLoad message="Indhold indlæst"><Region source={load({ isLoading: true })} /></ScreenLoad>);
    rerender(<ScreenLoad message="Indhold indlæst"><Region source={load({ isLoading: true })} /></ScreenLoad>);
    expect(spoken).not.toHaveBeenCalled();
  });

  it('læser først, når den SIDSTE region er færdig', () => {
    const view = render(
      <ScreenLoad message="Indhold indlæst">
        <Region source={load({ isLoading: true })} />
        <Region source={load({ isLoading: true })} />
      </ScreenLoad>,
    );
    view.rerender(
      <ScreenLoad message="Indhold indlæst">
        <Region source={load({})} />
        <Region source={load({ isLoading: true })} />
      </ScreenLoad>,
    );
    expect(spoken).not.toHaveBeenCalled();
    view.rerender(
      <ScreenLoad message="Indhold indlæst">
        <Region source={load({})} />
        <Region source={load({})} />
      </ScreenLoad>,
    );
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith('Indhold indlæst');
  });

  it('fejler ALLE regioner, tier skærmen — den skal ikke lyde "indlæst" for nul data', () => {
    const view = render(
      <ScreenLoad message="Indhold indlæst">
        <Region source={load({ isLoading: true })} />
        <Region source={load({ isLoading: true })} />
      </ScreenLoad>,
    );
    view.rerender(
      <ScreenLoad message="Indhold indlæst">
        <Region source={load({ isError: true })} />
        <Region source={load({ isError: true })} />
      </ScreenLoad>,
    );
    expect(spoken).not.toHaveBeenCalled();
  });

  it('ét fejlet hjørne gør ikke hele skærmen lydløs — resten kom', () => {
    const view = render(
      <ScreenLoad message="Indhold indlæst">
        <Region source={load({ isLoading: true })} />
        <Region source={load({ isLoading: true })} />
      </ScreenLoad>,
    );
    view.rerender(
      <ScreenLoad message="Indhold indlæst">
        <Region source={load({ isError: true })} />
        <Region source={load({})} />
      </ScreenLoad>,
    );
    expect(spoken).toHaveBeenCalledTimes(1);
  });

  it('læser skærmens besked, ikke komponentens egen', () => {
    const view = render(
      <ScreenLoad message="Ugen indlæst">
        <Region source={load({ isLoading: true })} message="Kort indlæst" />
      </ScreenLoad>,
    );
    view.rerender(
      <ScreenLoad message="Ugen indlæst">
        <Region source={load({})} message="Kort indlæst" />
      </ScreenLoad>,
    );
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith('Ugen indlæst');
  });

  it('lader en region der forsvinder ikke låse skærmen i "indlæser"', () => {
    const view = render(
      <ScreenLoad message="Indhold indlæst">
        <Region source={load({ isLoading: true })} />
        <Region source={load({ isLoading: true })} />
      </ScreenLoad>,
    );
    // Det gatede hjørne forsvinder (fx en klippekort-række der lukkes af kapabiliteter)
    view.rerender(
      <ScreenLoad message="Indhold indlæst">
        <Region source={load({ isLoading: true })} />
      </ScreenLoad>,
    );
    view.rerender(
      <ScreenLoad message="Indhold indlæst">
        <Region source={load({})} />
      </ScreenLoad>,
    );
    expect(spoken).toHaveBeenCalledTimes(1);
  });
});

/**
 * Et ark der bytter trin: `project-picker-modal` viser kunder, og tryk på en
 * kunde bytter regionen til kundens projekter. Den lå ét `ScreenLoad` med ÉN
 * besked om begge trin, hvilket er præcis den fejl `useLoadAnnounce`s egen
 * docblock forbyder («to regioner på én skærm skal have hver sin `message`,
 * ellers hører brugeren "Indhold indlæst" to gange og ved ikke hvad der kom»).
 *
 * Den anden halvdel af fejlen var værre. `useLoadAnnounce` siger intet om et
 * kald der aldrig ventede, så når `projects.list` lå i cache (staleTime 5 min —
 * brugeren havde netop været på projektsiden) monterede trin to med
 * `isLoading: false` og **sagde ingenting**. Samme tryk læste altså "Indhold
 * indlæst" det ene øjeblik og intet det næste, alt efter cache.
 */
describe('en region der bliver synlig', () => {
  function Step({ source, message }: { source: LoadSource; message: string }) {
    useAnnounceVisible(source, message);
    return <Text>{source.isLoading ? 'indlæser' : 'indlæst'}</Text>;
  }

  it('siger noget for et kald der lå i cache — ellers afhænger det af cache', () => {
    render(<Step source={load({})} message="Projekter for Nordahl indlæst" />);
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith('Projekter for Nordahl indlæst');
  });

  it('siger først, når kallet er færdigt', () => {
    const view = render(<Step source={load({ isLoading: true })} message="Projekter indlæst" />);
    expect(spoken).not.toHaveBeenCalled();
    view.rerender(<Step source={load({})} message="Projekter indlæst" />);
    expect(spoken).toHaveBeenCalledTimes(1);
  });

  it('siger det kun én gang pr. region, selv om kallet genindlæses', () => {
    const view = render(<Step source={load({ isLoading: true })} message="Projekter indlæst" />);
    view.rerender(<Step source={load({})} message="Projekter indlæst" />);
    view.rerender(<Step source={load({ isLoading: true })} message="Projekter indlæst" />);
    view.rerender(<Step source={load({})} message="Projekter indlæst" />);
    expect(spoken).toHaveBeenCalledTimes(1);
  });

  it('tier om et kald der fejlede — "indlæst" er en påstand om data der ikke kom', () => {
    render(<Step source={load({ isError: true })} message="Projekter indlæst" />);
    expect(spoken).not.toHaveBeenCalled();
  });

  it('giver hvert trin sin egen besked, så det ikke er det samme ord to gange', () => {
    const view = render(
      <>
        <Step source={load({ isLoading: true })} message="Kunder indlæst" />
        <Step source={load({ isLoading: true })} message="Projekter for Nordahl indlæst" />
      </>,
    );
    view.rerender(
      <>
        <Step source={load({})} message="Kunder indlæst" />
        <Step source={load({ isLoading: true })} message="Projekter for Nordahl indlæst" />
      </>,
    );
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith('Kunder indlæst');

    view.rerender(
      <>
        <Step source={load({})} message="Kunder indlæst" />
        <Step source={load({})} message="Projekter for Nordahl indlæst" />
      </>,
    );
    expect(spoken).toHaveBeenCalledTimes(2);
    expect(spoken).toHaveBeenLastCalledWith('Projekter for Nordahl indlæst');
  });
});

describe('useReportLoad uden en ScreenLoad', () => {
  it('taler selv, så komponenten er sikker at genbruge hvor som helst', () => {
    const view = render(<Region source={load({ isLoading: true })} message="Kort indlæst" />);
    view.rerender(<Region source={load({})} message="Kort indlæst" />);
    expect(spoken).toHaveBeenCalledTimes(1);
    expect(spoken).toHaveBeenCalledWith('Kort indlæst');
  });

  it('siger intet om et kald der aldrig ventede', () => {
    render(<Region source={load({})} message="Kort indlæst" />);
    expect(spoken).not.toHaveBeenCalled();
  });
});

describe('skærmens tekst er synlig for skærmlæseren', () => {
  it('renderer børnene, så provideren ikke sluger indholdet', () => {
    render(<ScreenLoad message="Indhold indlæst"><Region source={load({ isLoading: true })} /></ScreenLoad>);
    expect(screen.getByText('indlæser')).toBeTruthy();
  });
});
