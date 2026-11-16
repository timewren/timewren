import { applyCvr, canLookupCvr, EMPTY_CLIENT, normalizeCvr, toClientInput, validateClient } from './client-form-logic';

const COMPANY = {
  cvrNumber: '12345678',
  name: 'Mahope ApS',
  address: 'Testvej 1',
  city: 'Aarhus',
  postalCode: '8000',
  country: 'Danmark',
  status: 'Aktiv',
  phoneNumber: '12345678',
  email: 'info@mahope.dk',
};

describe('client-form-logic', () => {
  it('validateClient: navn, e-mail og timepris som backend', () => {
    expect(validateClient(EMPTY_CLIENT)).toHaveProperty('name');
    expect(validateClient({ ...EMPTY_CLIENT, name: 'Ab' })).toEqual({});
    expect(validateClient({ ...EMPTY_CLIENT, name: 'Abc', email: 'ikke-en-mail' })).toHaveProperty('email');
    expect(validateClient({ ...EMPTY_CLIENT, name: 'Abc', email: 'a@b.dk' })).toEqual({});
    expect(validateClient({ ...EMPTY_CLIENT, name: 'Abc', defaultHourlyRate: 'abc' })).toHaveProperty('defaultHourlyRate');
    expect(validateClient({ ...EMPTY_CLIENT, name: 'Abc', defaultHourlyRate: '850,50' })).toEqual({});
  });

  it('toClientInput: tomme felter bliver undefined, komma bliver punktum', () => {
    const input = toClientInput({ ...EMPTY_CLIENT, name: ' Kunde ', defaultHourlyRate: '850,5', color: '#2563EB', phone: ' ' });
    expect(input.name).toBe('Kunde');
    expect(input.defaultHourlyRate).toBe('850.5');
    expect(input.color).toBe('#2563EB');
    expect(input.phone).toBeUndefined();
    expect(input.company).toBeUndefined();
    expect(input.email).toBe('');
  });

  it('cvr: normalisering og opslagsgrænser', () => {
    expect(normalizeCvr('12 34 56 78')).toBe('12345678');
    expect(canLookupCvr('1234567')).toBe(false);
    expect(canLookupCvr('12 34 56 78')).toBe(true);
    expect(canLookupCvr('12345678901')).toBe(false);
  });

  it.each([
    EMPTY_CLIENT,
    { ...EMPTY_CLIENT, name: 'Existing client', city: 'Existing city', cvrNumber: '12345678' },
  ])('applyCvr preserves the form when the lookup returns null: %j', (values) => {
    const original = { ...values };
    const patch = applyCvr(values, null);
    expect(patch).toEqual({});
    expect({ ...values, ...patch }).toEqual(original);
    expect(values).toEqual(original);
  });

  it('applyCvr overskriver aldrig brugerens egne felter', () => {
    const patch = applyCvr({ ...EMPTY_CLIENT, name: 'Mit navn', city: 'København' }, COMPANY);
    expect(patch.name).toBe('Mit navn');
    expect(patch.company).toBe('Mahope ApS');
    expect(patch.city).toBe('København');
    expect(patch.postalCode).toBe('8000');
    expect(patch.phone).toBe('12345678');
    expect(patch.email).toBe('info@mahope.dk');
  });
});
