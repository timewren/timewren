import type { Pending, Row, Template } from './recurring-logic';
import { canPause, clientLabel, frequency, generateBlock, isParked, mergePending, parkAction, weekdayName } from './recurring-logic';

type PartialRow = Partial<Row>;

/**
 * `Row` er routerens egen type fra drizzle's relationelle forespørgsel, så en
 * håndlavet fixture kan ikke ramme den præcist. Her dømmes *logikken*, så
 * feltværdierne sættes eksplicit — en test der læser et tilfældigt `undefined`
 * ville være grøn uden at sige noget.
 */
function row(partial: PartialRow): Row {
  return {
    id: partial.id ?? 't1',
    name: 'Mandag support',
    description: 'Support',
    hours: '6.00',
    clientId: null,
    projectId: null,
    client: null,
    project: null,
    prepaidPackage: null,
    frequency: 'weekly',
    dayOfWeek: 1,
    dayOfMonth: null,
    startDate: null,
    endDate: null,
    isActive: true,
    isPaused: false,
    lastGenerated: null,
    nextDue: new Date('2026-10-05T00:00:00.000Z'),
    isPrepaid: false,
    prepaidPackageId: null,
    templateType: 'time_entry',
    templateClients: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...partial,
  } as Row;
}

function client(name: string): NonNullable<Row['client']> {
  return { name } as NonNullable<Row['client']>;
}

describe('mergePending', () => {
  it('hæfter katalogens kunder på den forfaldede række', () => {
    const all = [{ id: 't1', templateClients: [{ clientId: 'c1' }] }] as unknown as Template[];

    const merged = mergePending([{ id: 't1' }] as unknown as Pending[], all);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.templateClients).toHaveLength(1);
  });

  it('gætter ikke: en pending-række uden katalogsvar får tom kundeliste', () => {
    const merged = mergePending([{ id: 't9' }] as unknown as Pending[], []);

    expect(merged[0]!.templateClients).toEqual([]);
  });
});

describe('clientLabel', () => {
  it('læser kunden, der står på skabelonen', () => {
    expect(clientLabel(row({ client: client('Acme') }))).toBe('Acme');
  });

  it('falder tilbage til projektets kunde, som `generate` også gør', () => {
    const r = row({ project: { name: 'Drift', client: client('Beta') } as NonNullable<Row['project']> });

    expect(clientLabel(r)).toBe('Beta');
  });

  it('viser projektets navn, når hverken kunde eller projektkunde findes', () => {
    const r = row({ project: { name: 'Drift' } as NonNullable<Row['project']> });

    expect(clientLabel(r)).toBe('Drift');
  });

  it('siger ingenting frem for et tomt navn', () => {
    expect(clientLabel(row({}))).toBeNull();
  });
});

describe('weekdayName', () => {
  it('læser dagen fra kalenderen, så 0 er søndag og ikke mandag', () => {
    expect(weekdayName(0)).toBe('søndag');
    expect(weekdayName(1)).toBe('mandag');
    expect(weekdayName(6)).toBe('lørdag');
  });

  it('afviser en ugedag uden for kalenderen frem for at gætte', () => {
    expect(weekdayName(7)).toBeNull();
    expect(weekdayName(-1)).toBeNull();
    expect(weekdayName(null)).toBeNull();
  });
});

describe('frequency', () => {
  it('siger «hver dag» uden en ugedag', () => {
    expect(frequency(row({ frequency: 'daily' })).key).toBe('recurring.frequency_daily');
  });

  it('siger «hver mandag» med den ugedag serveren har gemt', () => {
    expect(frequency(row({ frequency: 'weekly', dayOfWeek: 1 }))).toEqual({ key: 'recurring.frequency_weekly_day', vars: { day: 'mandag' } });
  });

  it('falder tilbage til «hver uge», når der ikke står en ugedag', () => {
    expect(frequency(row({ frequency: 'weekly', dayOfWeek: null })).key).toBe('recurring.frequency_weekly');
  });

  it('siger «den 15. hver måned» med dag i måneden', () => {
    expect(frequency(row({ frequency: 'monthly', dayOfMonth: 15 }))).toEqual({ key: 'recurring.frequency_monthly_day', vars: { day: '15' } });
  });

  it('afviser en dag i måneden uden for kalenderen', () => {
    expect(frequency(row({ frequency: 'monthly', dayOfMonth: 32 })).key).toBe('recurring.frequency_monthly');
  });

  it('kalder en skabelon uden gentagelse for engangsklage', () => {
    expect(frequency(row({ frequency: null })).key).toBe('recurring.frequency_none');
  });
});

describe('generateBlock', () => {
  it('lader en ren tidsskabelon gå', () => {
    expect(generateBlock(row({}))).toBeNull();
  });

  it('blokerer en skabelon, der også opretter en opgave', () => {
    expect(generateBlock(row({ templateType: 'task' }))).toBe('task');
    expect(generateBlock(row({ templateType: 'both' }))).toBe('task');
  });

  it('blokerer en klippekortskabelon, fordi saldoen ikke trækkes', () => {
    expect(generateBlock(row({ isPrepaid: true }))).toBe('prepaid');
  });

  it('blokerer en skabelon med flere kunder, fordi serveren kun skriver én post', () => {
    expect(generateBlock(row({ templateClients: [{ clientId: 'c1' }] as Row['templateClients'] }))).toBe('multi_client');
  });
});

describe('isParked', () => {
  it('kender en pause frem for en slået fra', () => {
    expect(isParked(row({}))).toBeNull();
    expect(isParked(row({ isPaused: true }))).toBe('paused');
    expect(isParked(row({ isPaused: true, isActive: false }))).toBe('paused');
    expect(isParked(row({ isActive: false }))).toBe('inactive');
  });
});

describe('canPause', () => {
  /**
   * `recurring.pause` kaster «Kan ikke pause en ikke-gentagende skabelon»
   * (routeren:839), og `resume` kaster den tilsvarende (routeren:875). Uden
   * porten ville appen tilbyde en handling, der **aldrig** kan lade sig gøre,
   * og så vise en rød fejl om den.
   */
  it('følger serverens egen regel: kun en skabelon med hyppighed kan pauses', () => {
    expect(canPause(row({ frequency: 'daily' }))).toBe(true);
    expect(canPause(row({ frequency: 'weekly' }))).toBe(true);
    expect(canPause(row({ frequency: 'monthly' }))).toBe(true);
    expect(canPause(row({ frequency: null }))).toBe(false);
  });
});

describe('parkAction', () => {
  it('tilbyder at sætte en løbende skabelon på pause', () => {
    expect(parkAction(row({}))).toBe('pause');
  });

  it('tilbyder at genoptage en pauset skabelon', () => {
    expect(parkAction(row({ isPaused: true }))).toBe('resume');
  });

  /**
   * `resume` rører ikke `isActive`, og `toggleActive` rører ikke `isPaused`
   * (routeren:858-899 hhv. 791-814). Så en skabelon der er **begge dele** kan
   * ikke genoptages ved at trykke én knap to gange — den skal have den ene
   * handling ad gangen. Vælger vi forkert, får brugeren en grøn kvittering og
   * en skabelon der stadig ikke løber.
   */
  it('genoptager en pauset skabelon, selv om den også er slået fra', () => {
    expect(parkAction(row({ isPaused: true, isActive: false }))).toBe('resume');
  });

  it('slår en slået fra skabelon til igen frem for at pause den oveni', () => {
    expect(parkAction(row({ isActive: false }))).toBe('activate');
  });

  it('lader en pauset engangsskabelon være, fordi serveren ville kaster', () => {
    expect(parkAction(row({ isPaused: true, frequency: null }))).toBeNull();
  });

  it('tilbyder intet på en engangsskabelon, der ikke er slået fra', () => {
    expect(parkAction(row({ frequency: null }))).toBeNull();
  });
});
