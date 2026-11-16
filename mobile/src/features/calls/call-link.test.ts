import { parseHoursInput } from '~/features/entries/duration';
import { buildPayload } from '~/features/entries/form-state';
import { callEntryState, DEFAULT_CALL_MINUTES, minutesToHoursText, parseCallLink, parseMinutes } from './call-link';

describe('parseMinutes', () => {
  it.each([
    ['12', 12],
    [' 7 ', 7],
    ['12,5', 13],
    ['0.2', 1],
    ['1440', 1440],
  ])('%s → %d', (raw, expected) => {
    expect(parseMinutes(raw)).toBe(expected);
  });

  it.each([[undefined], [''], ['0'], ['-5'], ['abc'], ['1441']])('afviser %j', (raw) => {
    expect(parseMinutes(raw)).toBeNull();
  });
});

describe('parseCallLink', () => {
  it('læser minutter og telefon fra deep linket', () => {
    expect(parseCallLink({ minutter: '12', telefon: '+45 12 34 56 78' })).toEqual({ minutes: 12, phone: '+45 12 34 56 78' });
  });

  it('tager første værdi ved gentagne parametre', () => {
    expect(parseCallLink({ minutter: ['5', '9'], telefon: ['11', '22'] })).toEqual({ minutes: 5, phone: '11' });
  });

  it('tåler et link uden parametre', () => {
    expect(parseCallLink({})).toEqual({ minutes: null, phone: null });
    expect(parseCallLink({ telefon: '  ' })).toEqual({ minutes: null, phone: null });
  });
});

describe('callEntryState', () => {
  const base = { description: 'Telefonopkald', recentClientId: 'recent', date: '2026-09-30' };

  it('forvælger den matchede kunde frem for den seneste', () => {
    expect(callEntryState({ ...base, minutes: 12, matchedClientId: 'match' }).clientId).toBe('match');
  });

  it('falder tilbage til seneste kunde', () => {
    expect(callEntryState({ ...base, minutes: 12, matchedClientId: null }).clientId).toBe('recent');
  });

  it('er ikke fakturerbar som standard og bruger standardvarighed uden minutter', () => {
    const state = callEntryState({ ...base, minutes: null, matchedClientId: null });
    expect(state.isBillable).toBe(false);
    expect(parseHoursInput(state.hoursText)).toBeCloseTo(DEFAULT_CALL_MINUTES / 60, 2);
  });

  it('bygger en gyldig time.create uden projekt og uden telefonnummer', () => {
    const state = callEntryState({ ...base, minutes: 12, matchedClientId: 'match' });
    const result = buildPayload(state, { klippekort: false });
    expect(result.ok).toBe(true);
    if (!result.ok)
      return;
    expect(result.payload).toMatchObject({ clientId: 'match', hours: 0.2, isBillable: false, date: '2026-09-30', description: 'Telefonopkald' });
    expect(JSON.stringify(result.payload)).not.toContain('4512');
  });

  it('skriver minutter så tidsfeltet forstår dem', () => {
    expect(parseHoursInput(minutesToHoursText(90))).toBe(1.5);
  });
});
