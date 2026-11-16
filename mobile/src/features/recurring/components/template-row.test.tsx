import type { Row } from '../recurring-logic';
import { format as dfFormat } from 'date-fns';
import { da } from 'date-fns/locale';
import * as React from 'react';
import i18n from '~/lib/i18n';
import { cleanup, fireEvent, render, screen } from '~/lib/test-utils';
import { TemplateRow } from './template-row';

/** `ListRow`-labels skjuler børnene for skærmlæseren; her skal vi se teksten. */
const SKJULT = { includeHiddenElements: true } as const;

function row(partial: Partial<Row>): Row {
  return {
    id: 't1',
    name: 'Mandag support',
    description: 'Support',
    hours: '6.00',
    client: { name: 'Acme' },
    project: null,
    frequency: 'weekly',
    dayOfWeek: 1,
    dayOfMonth: null,
    nextDue: new Date('2026-10-05T00:00:00.000Z'),
    isActive: true,
    isPaused: false,
    isPrepaid: false,
    templateType: 'time_entry',
    templateClients: [],
    ...partial,
  } as unknown as Row;
}

beforeEach(async () => {
  await i18n.changeLanguage('da');
});

afterEach(cleanup);

describe('templateRow', () => {
  it('læser navn, kunde, timer og gentagelse som ét stop for skærmlæseren', () => {
    render(<TemplateRow row={row({})} />);

    expect(screen.getByLabelText('Mandag support, Acme, 6 t, Hver mandag')).toBeTruthy();
  });

  it('lader rækker med en knap stå som flere stop, så knappen kan trykkes med stemmen', () => {
    render(<TemplateRow row={row({})} onGenerate={jest.fn()} />);

    expect(screen.queryByLabelText(/^Mandag support,/)).toBeNull();
    expect(screen.getByTestId('recurring-row-generate')).toBeTruthy();
  });

  /**
   * `nextDue` er skrevet af `calculateNextDue` ud fra UTC-midnat og af cron'en
   * ud fra klokkeslættet den kørte. Det er en dag i begge tilfælde, så vises
   * datoen — «for 3 dage siden» ville være en påstand om et klokkeslæt, feltet
   * ikke har (samme regel som review-fund F3a).
   */
  it('viser næste gang som en dato, ikke som et klokkeslæt', () => {
    const today = dfFormat(new Date(), 'd. MMM', { locale: da });
    render(<TemplateRow row={row({ nextDue: new Date() })} />);

    expect(screen.getByText(`Næste gang: ${today}`, SKJULT)).toBeTruthy();
    expect(screen.queryByText(/siden/, SKJULT)).toBeNull();
  });

  it('tilbyder at registrere en ren tidsskabelon', () => {
    const onGenerate = jest.fn();
    render(<TemplateRow row={row({})} onGenerate={onGenerate} />);

    fireEvent.press(screen.getByTestId('recurring-row-generate'));

    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('lader en klippekortskabelon være: `generate` trækker ikke timer af pakken', () => {
    render(<TemplateRow row={row({ isPrepaid: true })} onGenerate={jest.fn()} />);

    expect(screen.queryByTestId('recurring-row-generate')).toBeNull();
    expect(screen.getByText(/Klippekort trækkes kun af/, SKJULT)).toBeTruthy();
  });

  it('lader en skabelon med flere kunder være, fordi serveren kun skriver én post', () => {
    render(<TemplateRow row={row({ templateClients: [{ clientId: 'c1' }] as Row['templateClients'] })} onGenerate={jest.fn()} />);

    expect(screen.queryByTestId('recurring-row-generate')).toBeNull();
    expect(screen.getByText(/kun web kan lægge dem ind alle sammen/, SKJULT)).toBeTruthy();
  });

  it('lader en pauset skabelon være, selv om serverens liste ikke kan vise den', () => {
    render(<TemplateRow row={row({ isPaused: true })} onGenerate={jest.fn()} />);

    expect(screen.queryByTestId('recurring-row-generate')).toBeNull();
    expect(screen.getByText('Sat på pause', SKJULT)).toBeTruthy();
  });

  it('viser ingen knap i katalogen, hvor der ikke er noget at registrere', () => {
    render(<TemplateRow row={row({})} />);

    expect(screen.queryByTestId('recurring-row-generate')).toBeNull();
  });
});

describe('templateRow — pause', () => {
  it('tilbyder at sætte en løbende skabelon på pause', () => {
    const onPark = jest.fn();
    render(<TemplateRow row={row({})} onPark={onPark} />);

    fireEvent.press(screen.getByTestId('recurring-row-park'));

    expect(onPark).toHaveBeenCalledWith('pause');
  });

  it('tilbyder at genoptage en pauset skabelon', () => {
    const onPark = jest.fn();
    render(<TemplateRow row={row({ isPaused: true })} onPark={onPark} />);

    fireEvent.press(screen.getByTestId('recurring-row-park'));

    expect(onPark).toHaveBeenCalledWith('resume');
  });

  /**
   * `resume` rører ikke `isActive` (routeren:886-895 sætter `isPaused`,
   * `pausedUntil`, `pauseReason` og `nextDue` — ikke `isActive`). Trykker man
   * «Genoptag» på en skabelon der også er slået fra, får brugeren en grøn
   * kvittering og en skabelon der stadig ikke løber. Derfor skal knappen her
   * være «Slå til».
   */
  it('slår en skabelon til igen, der både er pauset og slået fra', () => {
    const onPark = jest.fn();
    render(<TemplateRow row={row({ isPaused: true, isActive: false })} onPark={onPark} />);

    fireEvent.press(screen.getByTestId('recurring-row-park'));

    expect(onPark).toHaveBeenCalledWith('resume');
    expect(screen.getByText('Genoptag', SKJULT)).toBeTruthy();
  });

  it('slår en slået fra skabelon til frem for at pause den oveni', () => {
    const onPark = jest.fn();
    render(<TemplateRow row={row({ isActive: false })} onPark={onPark} />);

    fireEvent.press(screen.getByTestId('recurring-row-park'));

    expect(onPark).toHaveBeenCalledWith('activate');
  });

  /**
   * `pause` kaster «Kan ikke pause en ikke-gentagende skabelon» (routeren:839)
   * og `resume` kaster tilsvarende (routeren:875). Uden porten får brugeren en
   * knap, der kun kan fejle, og så en rød fejl om noget der aldrig kunne gøres.
   */
  it('lader en engangsskabelon være, fordi serveren ville kaster', () => {
    render(<TemplateRow row={row({ frequency: null })} onPark={jest.fn()} />);

    expect(screen.queryByTestId('recurring-row-park')).toBeNull();
  });

  it('siger hvor en pauset engangsskabelon genoptages i stedet for at lade den stå', () => {
    render(<TemplateRow row={row({ frequency: null, isPaused: true })} onPark={jest.fn()} />);

    expect(screen.queryByTestId('recurring-row-park')).toBeNull();
    expect(screen.getByText(/Genoptagelse kan kun laves på web/, SKJULT)).toBeTruthy();
  });

  /**
   * `resume` regner `nextDue` fra `new Date()` (routeren:879), ikke fra den
   * dato den var pauset. Uden denne linje tror brugeren at ferien bliver
   * registreret, da de genoptager.
   */
  it('sager at pausen ikke lægges ind bagefter', () => {
    render(<TemplateRow row={row({ isPaused: true })} onPark={jest.fn()} />);

    expect(screen.getByText(/ikke lagt ind bagefter/, SKJULT)).toBeTruthy();
  });
});

describe('templateRow — pauseknappens læsning', () => {
  it('lader rækker uden handler stå som ét stop for skærmlæseren', () => {
    render(<TemplateRow row={row({})} />);

    expect(screen.getByLabelText('Mandag support, Acme, 6 t, Hver mandag')).toBeTruthy();
  });

  it('lader en række med pauseknap stå som flere stop, så knappen kan trykkes med stemmen', () => {
    render(<TemplateRow row={row({})} onPark={jest.fn()} />);

    expect(screen.queryByLabelText(/^Mandag support,/)).toBeNull();
    expect(screen.getByTestId('recurring-row-park')).toBeTruthy();
  });

  it('viser knappen som travl, mens kaldet er i vej, så et dobbelttryk kan ses', () => {
    render(<TemplateRow row={row({})} onPark={jest.fn()} parkBusy />);

    expect(screen.getByTestId('recurring-row-park-activity-indicator')).toBeTruthy();
  });

  it('lader både registrere og pause stå på samme række, fordi det er to opgaver', () => {
    const onGenerate = jest.fn();
    const onPark = jest.fn();
    render(<TemplateRow row={row({})} onGenerate={onGenerate} onPark={onPark} />);

    fireEvent.press(screen.getByTestId('recurring-row-generate'));
    fireEvent.press(screen.getByTestId('recurring-row-park'));

    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onPark).toHaveBeenCalledWith('pause');
  });

  it('lader en klippekortskabelon pauses, selv om den ikke må registreres', () => {
    const onPark = jest.fn();
    render(<TemplateRow row={row({ isPrepaid: true })} onPark={onPark} />);

    expect(screen.queryByTestId('recurring-row-generate')).toBeNull();
    fireEvent.press(screen.getByTestId('recurring-row-park'));

    expect(onPark).toHaveBeenCalledWith('pause');
  });
});
