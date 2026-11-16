import type { EntryFormState } from './form-state';
import { buildPayload, effectiveHours, manualTagIds, normalizeClock, sameTags, toggleTag, toUpdateData } from './form-state';

const base: EntryFormState = {
  clientId: 'c1',
  projectId: null,
  taskId: null,
  date: '2026-09-05',
  timeMode: 'duration',
  hoursText: '1,5',
  startText: '',
  endText: '',
  description: 'Møde',
  notes: '',
  isBillable: true,
  prepaidPackageId: null,
  tagIds: [],
};

describe('form-state', () => {
  it('normalizeClock indsætter kolon', () => {
    expect(normalizeClock('0900')).toBe('09:00');
    expect(normalizeClock('900')).toBe('9:00');
    expect(normalizeClock('09:00')).toBe('09:00');
    expect(normalizeClock('abc')).toBe('abc');
  });

  it('effectiveHours fra varighed og interval', () => {
    expect(effectiveHours(base)).toBe(1.5);
    expect(effectiveHours({ ...base, timeMode: 'range', startText: '0900', endText: '10:30' })).toBe(1.5);
    expect(effectiveHours({ ...base, hoursText: 'x' })).toBeNull();
  });

  it('buildPayload: varighed uden projekt sender clientId', () => {
    const r = buildPayload(base, { klippekort: true });
    expect(r.ok).toBe(true);
    if (!r.ok)
      return;
    expect(r.payload).toMatchObject({ description: 'Møde', hours: 1.5, date: '2026-09-05', clientId: 'c1', isBillable: true });
    expect(r.payload.projectId).toBeUndefined();
    expect(r.payload.startTime).toBeUndefined();
    expect(r.payload.prepaidPackageId).toBeUndefined();
  });

  it('buildPayload: projekt valgt → clientId udelades (kunden sidder på projektet)', () => {
    const r = buildPayload({ ...base, projectId: 'p1', prepaidPackageId: 'pp1' }, { klippekort: true });
    expect(r.ok && r.payload.projectId).toBe('p1');
    expect(r.ok && r.payload.clientId).toBeUndefined();
    expect(r.ok && r.payload.prepaidPackageId).toBe('pp1');
  });

  it('buildPayload: klippekort ignoreres når modulet er slået fra', () => {
    const r = buildPayload({ ...base, prepaidPackageId: 'pp1' }, { klippekort: false });
    expect(r.ok && r.payload.prepaidPackageId).toBeUndefined();
  });

  it('buildPayload: start/slut giver ISO-tider og udledte timer', () => {
    const r = buildPayload({ ...base, timeMode: 'range', startText: '09:00', endText: '11:15', hoursText: '' }, { klippekort: false });
    expect(r.ok).toBe(true);
    if (!r.ok)
      return;
    expect(r.payload.hours).toBe(2.25);
    expect(new Date(r.payload.endTime!).getTime() - new Date(r.payload.startTime!).getTime()).toBe(2.25 * 3600 * 1000);
  });

  it('buildPayload: fejl som backenden', () => {
    expect(buildPayload({ ...base, description: '  ' }, { klippekort: false })).toMatchObject({ ok: false, error: 'entries.errors.description_required' });
    expect(buildPayload({ ...base, hoursText: 'abc' }, { klippekort: false })).toMatchObject({ ok: false, error: 'entries.errors.hours_invalid' });
    expect(buildPayload({ ...base, hoursText: '0' }, { klippekort: false })).toMatchObject({ ok: false, error: 'entries.errors.hours_min' });
    expect(buildPayload({ ...base, timeMode: 'range', startText: '9', endText: '10:00' }, { klippekort: false })).toMatchObject({ ok: false, error: 'entries.errors.range_invalid' });
    expect(buildPayload({ ...base, date: '5/9-2026' }, { klippekort: false })).toMatchObject({ ok: false, error: 'entries.errors.date_invalid' });
  });

  it('buildPayload trimmer og klipper noter', () => {
    const r = buildPayload({ ...base, notes: '  hej  ' }, { klippekort: false });
    expect(r.ok && r.payload.notes).toBe('hej');
    const r2 = buildPayload({ ...base, notes: '   ' }, { klippekort: false });
    expect(r2.ok && r2.payload.notes).toBeUndefined();
  });

  it('toUpdateData: null fjerner klippekort, undefined når modulet er slået fra', () => {
    const r = buildPayload(base, { klippekort: true });
    if (!r.ok)
      throw new Error('forventede ok');
    expect(toUpdateData(r.payload, base, true).prepaidPackageId).toBeNull();
    expect(toUpdateData(r.payload, { ...base, prepaidPackageId: 'pp1' }, true).prepaidPackageId).toBe('pp1');
    expect(toUpdateData(r.payload, { ...base, prepaidPackageId: 'pp1' }, false).prepaidPackageId).toBeUndefined();
    expect(toUpdateData(r.payload, base, true)).not.toHaveProperty('prepaidHoursOverride');
  });
});

describe('tags på registreringsformen', () => {
  const tag = (id: string, inherited = false) => ({ id, name: id, color: '#ff0000', inherited });

  it('tager kun de manuelt valgte med — nedarvede kan ikke fjernes her', () => {
    // Serveren sætter nedarvede tags, og `setForEntry` sletter dem aldrig, så
    // en bruger der "fjerner" en nedarvet ville få den tilbage ved næste indlæsning.
    expect(manualTagIds({ tags: [tag('t1'), tag('t2', true), tag('t3')] } as never)).toEqual(['t1', 't3']);
  });

  it('en post uden tags giver en tom liste, ikke undefined', () => {
    expect(manualTagIds({ tags: [] } as never)).toEqual([]);
  });

  it('toggleTag tænder og slukker uden at ændre de andre', () => {
    expect(toggleTag(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleTag(['a', 'b'], 'b')).toEqual(['a']);
    expect(toggleTag([], 'a')).toEqual(['a']);
  });

  it('sameTags dømmer rækkefølgen — rækkefølgen er hele forskellen', () => {
    expect(sameTags(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameTags(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameTags([], [])).toBe(true);
    expect(sameTags(['a'], ['a', 'b'])).toBe(false);
  });

  it('buildPayload rører ikke tags — serverens create kender dem ikke', () => {
    const r = buildPayload({ ...base, tagIds: ['t1'] }, { klippekort: false });
    if (!r.ok)
      throw new Error('forventede ok');
    expect(JSON.stringify(r.payload)).not.toContain('t1');
  });
});
