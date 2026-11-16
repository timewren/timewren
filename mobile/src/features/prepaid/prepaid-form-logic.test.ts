import { emptyPrepaid, toPrepaidInput, validatePrepaid } from './prepaid-form-logic';

const VALID = { ...emptyPrepaid('c1'), name: '10 timer', totalHours: '10', hourlyRate: '850' };

describe('prepaid-form-logic', () => {
  it('validatePrepaid spejler backendens grænser', () => {
    const errors = validatePrepaid(emptyPrepaid(null));
    expect(errors).toHaveProperty('name');
    expect(errors).toHaveProperty('clientId');
    expect(errors).toHaveProperty('totalHours');
    expect(errors).toHaveProperty('hourlyRate');
    expect(validatePrepaid(VALID)).toEqual({});
    expect(validatePrepaid({ ...VALID, totalHours: '0' })).toHaveProperty('totalHours');
    expect(validatePrepaid({ ...VALID, hourlyRate: '0' })).toEqual({});
    expect(validatePrepaid({ ...VALID, hourlyRate: '-1' })).toHaveProperty('hourlyRate');
    expect(validatePrepaid({ ...VALID, expiryDate: '06-12-2026' })).toHaveProperty('expiryDate');
    expect(validatePrepaid({ ...VALID, expiryDate: '2026-12-06' })).toEqual({});
  });

  it('toPrepaidInput: tal som numbers, købsdato = i dag', () => {
    const input = toPrepaidInput({ ...VALID, totalHours: '7,5', expiryDate: '', autoDeduct: false }, new Date('2026-09-06T10:00:00'));
    expect(input.totalHours).toBe(7.5);
    expect(input.hourlyRate).toBe(850);
    expect(input.purchaseDate).toBe('2026-09-06');
    expect(input.expiryDate).toBeUndefined();
    expect(input.autoDeduct).toBe(false);
    expect(input.clientId).toBe('c1');
  });
});
