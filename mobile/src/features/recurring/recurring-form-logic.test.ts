import type { Created, RecurringFormValues } from './recurring-form-logic';
import i18n from '~/lib/i18n';
import {
  createdBlock,
  emptyRecurring,
  normalizeHours,
  recurringFromTemplate,
  toCreateInput,
  toUpdateInput,
  validateRecurring,
  wantsPackage,
} from './recurring-form-logic';

beforeEach(async () => {
  await i18n.changeLanguage('da');
});

function values(partial: Partial<RecurringFormValues> = {}): RecurringFormValues {
  return {
    ...emptyRecurring(),
    name: 'Mandag support',
    description: 'Support hos Acme',
    hours: '6',
    clientId: 'c1',
    frequency: 'weekly',
    dayOfWeek: 1,
    startDate: '2026-10-05',
    ...partial,
  };
}

/** Serverens `recurringTemplateInput` (web, routers/recurring.ts:17-40). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('validateRecurring', () => {
  it('accepterer en ugentlig skabelon med kunde, timer og startdato', () => {
    expect(validateRecurring(values())).toEqual({});
  });

  it('kræver navn på mindst to tegn, en beskrivelse og en reel varighed', () => {
    const errors = validateRecurring(values({ name: 'A', description: '  ', hours: '0' }));

    expect(errors.name).toBeDefined();
    expect(errors.description).toBeDefined();
    expect(errors.hours).toBeDefined();
  });

  /**
   * `create` kaster «Startdato er påkrævet for gentagende skabeloner»
   * (routeren:382), så en ugentlig skabelon uden startdato ville være en rød
   * toast efter et kald i stedet for en markering på feltet.
   */
  it('kræver startdato på en gentagende skabelon', () => {
    const errors = validateRecurring(values({ startDate: '' }));

    expect(errors.startDate).toBeDefined();
  });

  it('kræver ingen startdato på en engangsklage', () => {
    expect(validateRecurring(values({ frequency: null, startDate: '', dayOfWeek: null }))).toEqual({});
  });

  /** `generate` skriver på `template.clientId` og ellers intet (routeren:723). */
  it('kræver en kunde eller et projekt, når den gentager sig', () => {
    expect(validateRecurring(values({ clientId: null, projectId: null })).clientId).toBeDefined();
    expect(validateRecurring(values({ clientId: null, projectId: 'p1' })).clientId).toBeUndefined();
  });

  it('kræver en ugedag ved ugentlig og en dag i måneden ved månedlig', () => {
    expect(validateRecurring(values({ dayOfWeek: null })).dayOfWeek).toBeDefined();
    expect(validateRecurring(values({ frequency: 'monthly', dayOfMonth: null })).dayOfMonth).toBeDefined();
  });

  it('afviser en slutdato før startdatoen og en dato der ikke findes', () => {
    expect(validateRecurring(values({ endDate: '2026-10-01' })).endDate).toBe('Slutdatoen skal være efter startdatoen.');
    expect(validateRecurring(values({ endDate: '2026-02-31' })).endDate).toBe('Skriv datoen som ÅÅ-MM-DD.');
    expect(validateRecurring(values({ startDate: '05-10-2026' })).startDate).toBe('Skriv datoen som ÅÅ-MM-DD.');
  });
});

describe('normalizeHours', () => {
  /**
   * `hours` er `z.string()` og lægges i en numerisk kolonne (routeren:22 og 744),
   * så «1,5» med komma ville være ugyldig numerik i Postgres. Web sender
   * punktum — appen skal gøre det samme, uanset at feltet står dansk.
   */
  it('sender timer med punktum, også når brugeren skriver dansk', () => {
    expect(normalizeHours('1,5')).toBe('1.5');
    expect(normalizeHours('1:30')).toBe('1.5');
    expect(normalizeHours('90m')).toBe('1.5');
    expect(normalizeHours('6')).toBe('6');
    expect(normalizeHours('slap')).toBe('');
  });
});

describe('toCreateInput', () => {
  it('sender præcis det input-schemaen tillader', () => {
    const input = toCreateInput(values());

    expect(input.name).toBe('Mandag support');
    expect(input.hours).toBe('6');
    expect(input.frequency).toBe('weekly');
    expect(input.dayOfWeek).toBe(1);
    expect(input.dayOfMonth).toBeUndefined();
    expect(input.startDate).toBe('2026-10-05');
    expect(input.isActive).toBe(true);
    expect(input.prepaidPackageId).toBeUndefined();
  });

  it('sender ikke ugedag og dag-i-måneden, de hører til andre hyppigheder', () => {
    const ugentlig = toCreateInput(values({ dayOfWeek: 1, dayOfMonth: 12 }));
    const daglig = toCreateInput(values({ frequency: 'daily', dayOfWeek: 3, dayOfMonth: 12 }));
    const maanedlig = toCreateInput(values({ frequency: 'monthly', dayOfWeek: 3, dayOfMonth: 12 }));

    expect(ugentlig.dayOfMonth).toBeUndefined();
    expect(daglig.dayOfWeek).toBeUndefined();
    expect(daglig.dayOfMonth).toBeUndefined();
    expect(maanedlig.dayOfWeek).toBeUndefined();
    expect(maanedlig.dayOfMonth).toBe(12);
  });

  it('sender klippekort-pakken kun når klippekort er slået til', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const med = toCreateInput(values({ isPrepaid: true, prepaidPackageId: id }));
    const uden = toCreateInput(values({ isPrepaid: false, prepaidPackageId: id }));

    expect(wantsPackage(values({ isPrepaid: true, prepaidPackageId: id }))).toBe(true);
    expect(med.prepaidPackageId).toBe(id);
    expect(uden.prepaidPackageId).toBeUndefined();
  });

  it('sender hverken dag eller dato for en engangsklage', () => {
    const input = toCreateInput(values({ frequency: null, dayOfWeek: 1, dayOfMonth: 4, endDate: '2026-12-01' }));

    expect(input.frequency).toBeNull();
    expect(input.dayOfWeek).toBeUndefined();
    expect(input.dayOfMonth).toBeUndefined();
    expect(input.startDate).toBeUndefined();
    expect(input.endDate).toBeUndefined();
  });
});

describe('toUpdateInput', () => {
  /**
   * Serveren rører `recurringTemplateClients` kun når `clientIds` er sendt
   * (routeren:595). Skal telefonen redigere en flerkunde-skabelon uden at
   * tømme den, må feltet derfor aldrig sendes.
   */
  it('sender aldrig clientIds, så en flerkunde-skabelon beholder sine kunder', () => {
    const input = toUpdateInput('t1', values());

    expect('clientIds' in input).toBe(false);
  });

  it('sender klippekort-pakken som null, når valget fjernes', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const ryddet = toUpdateInput('t1', values({ isPrepaid: true, prepaidPackageId: null }));

    expect(toUpdateInput('t1', values({ isPrepaid: true, prepaidPackageId: id })).prepaidPackageId).toBe(id);
    expect(ryddet.prepaidPackageId).toBeNull();
  });

  it('nulstiller kunde og projekt, når de tømmes', () => {
    const input = toUpdateInput('t1', values({ clientId: null, projectId: null }));

    expect(input.clientId).toBeNull();
    expect(input.projectId).toBeNull();
  });

  it('sender altid gyldige uuids i de felter der skal nulstilles', () => {
    const input = toUpdateInput('11111111-1111-1111-1111-111111111111', values());

    expect(input.id).toMatch(UUID);
    expect(input.name).toBe('Mandag support');
  });

  it('rydder gentagelsesfelterne for en skabelon der laves til engangsklage', () => {
    const input = toUpdateInput('t1', values({ frequency: null }));

    expect(input.frequency).toBeNull();
    expect('startDate' in input).toBe(false);
    expect('dayOfWeek' in input).toBe(false);
  });

  /**
   * `isActive` og `isPaused` er to statusser, og `getPending` kræver begge
   * (routeren:272-273). Uden `isActive` i opdateringen kunne formen ikke slå en
   * skabelon fra, og den ville stå som aktiv uden at køre.
   */
  it('sender isActive, så en skabelon kan slås fra og til igen', () => {
    expect(toUpdateInput('t1', values()).isActive).toBe(true);
    expect(toUpdateInput('t1', values({ isActive: false })).isActive).toBe(false);
  });
});

describe('recurringFromTemplate', () => {
  const gemt = {
    id: 't1',
    name: 'Tirsdag rapport',
    description: 'Rapport',
    hours: '1.5',
    clientId: 'c1',
    projectId: null,
    prepaidPackageId: null,
    isPrepaid: false,
    templateType: 'task',
    frequency: 'monthly',
    dayOfWeek: null,
    dayOfMonth: 15,
    startDate: new Date('2026-01-15T00:00:00.000Z'),
    endDate: new Date('2026-12-15T00:00:00.000Z'),
    isActive: false,
    client: null,
    project: null,
    prepaidPackage: null,
  } as unknown as Parameters<typeof recurringFromTemplate>[0];

  it('hæfter UTC-midnat fra serveren på som ISO-dage, så et gemt klokkeslæt ikke gentages', () => {
    const values = recurringFromTemplate(gemt);

    expect(values.startDate).toBe('2026-01-15');
    expect(values.endDate).toBe('2026-12-15');
    expect(values.dayOfMonth).toBe(15);
    expect(values.isActive).toBe(false);
    expect(values.templateType).toBe('task');
  });

  it('falder tilbage på dagens dato, når serveren ingen startdato har', () => {
    const values = recurringFromTemplate({ ...gemt, startDate: null, endDate: null }, new Date('2026-10-01T09:00:00'));

    expect(values.startDate).toBe('2026-10-01');
    expect(values.endDate).toBe('');
  });

  it('tager kunden fra projektet, når skabelonen ikke har sin egen', () => {
    const values = recurringFromTemplate({
      ...gemt,
      clientId: null,
      projectId: 'p1',
      project: { clientId: 'c9' },
    } as unknown as Parameters<typeof recurringFromTemplate>[0]);

    expect(values.clientId).toBe('c9');
  });
});
/**
 * `getById` svarer med DB-kolonnernes brede typer (`templateType: string`,
 * `frequency: string | null`, `isActive: boolean | null`). En ukendt værdi må
 * ikke komme ind i formularen og sendes videre: `frequency: null` er præcis
 * «engangsklage» for både cron'en og `getPending`, så det er den forsvarlige
 * standard.
 */
describe('recurringFromTemplate — kun serverens egne værdier', () => {
  const gemt = {
    name: 'Uge',
    description: 'Ugentlig',
    hours: '2',
    clientId: 'c1',
    projectId: null,
    prepaidPackageId: null,
    startDate: new Date('2026-01-05T00:00:00.000Z'),
    endDate: null,
    client: null,
    project: null,
    prepaidPackage: null,
  } as unknown as Parameters<typeof recurringFromTemplate>[0];

  it('gør en ukendt hyppighed og type forsvarligt forsvarlig: engangsklage og kun tid', () => {
    const values = recurringFromTemplate({
      ...gemt,
      frequency: 'hver_uge',
      templateType: 'opgave',
      isActive: null,
      isPrepaid: null,
    } as unknown as Parameters<typeof recurringFromTemplate>[0]);

    expect(values.frequency).toBeNull();
    expect(values.templateType).toBe('time_entry');
    expect(values.isActive).toBe(true);
    expect(values.isPrepaid).toBe(false);
  });

  it('beholder de hyppigheder og typer serveren kender', () => {
    for (const day of ['daily', 'weekly', 'monthly'])
      expect(recurringFromTemplate({ ...gemt, frequency: day } as never).frequency).toBe(day);
    for (const type of ['task', 'both'])
      expect(recurringFromTemplate({ ...gemt, templateType: type } as never).templateType).toBe(type);
  });
});

/**
 * `recurring.generate` er cron'ens *simple søskende*: den laver én tidspost og
 * ingenting mere. Uden den her gate ville knappen på den gemte skabelon skrive
 * præcis den del, serveren kan, og lade resten ligge — en opgave der aldrig
 * kommer, et klippekort der ikke er trukket af, eller kun den første kunde.
 */
describe('createdBlock', () => {
  function gemt(partial: Partial<Created> = {}): Created {
    return { id: 't1', name: 'Mandag support', hours: '6', templateType: 'time_entry', isPrepaid: false, ...partial } as unknown as Created;
  }

  it('lader en ren tidsskabelon blive registreret med ét tryk', () => {
    expect(createdBlock(gemt(), 0)).toBeNull();
  });

  it('blokerer en skabelon der også opretter en opgave', () => {
    expect(createdBlock(gemt({ templateType: 'task' }), 0)).toBe('task');
    expect(createdBlock(gemt({ templateType: 'both' }), 0)).toBe('task');
  });

  it('blokerer en klippekortskabelon, fordi optrækningen er cron’ens', () => {
    expect(createdBlock(gemt({ isPrepaid: true }), 0)).toBe('prepaid');
  });

  it('blokerer en skabelon med flere kunder, fordi generate kun tager den første', () => {
    expect(createdBlock(gemt(), 1)).toBe('multi_client');
    expect(createdBlock(gemt(), 3)).toBe('multi_client');
  });

  it('rammer den grund, der kommer først, når to gange', () => {
    expect(createdBlock(gemt({ templateType: 'both', isPrepaid: true }), 2)).toBe('task');
  });

  it('læser serverens række, ikke formularens værdier', () => {
    // `create` gemte rækken, og `generate` læser den — så en ukendt værdi fra
    // serveren skal give grunden, ikke stille på en knap der gør halv arbejde.
    expect(createdBlock(gemt({ templateType: 'både' }), 0)).toBe('task');
  });
});
