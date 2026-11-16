import { overtimeTypeTone, parseOvertimeHours } from './overtime-logic';

describe('overtime-logic', () => {
  it('parseOvertimeHours accepterer komma og afviser 0/negativ for used', () => {
    expect(parseOvertimeHours('2,5', 'used')).toBe(2.5);
    expect(parseOvertimeHours('0', 'used')).toBeNull();
    expect(parseOvertimeHours('-1', 'payout')).toBeNull();
    expect(parseOvertimeHours('-1.25', 'adjustment')).toBe(-1.25);
    expect(parseOvertimeHours('abc', 'used')).toBeNull();
    expect(parseOvertimeHours('501', 'adjustment')).toBeNull();
  });

  it('type → tone', () => {
    expect(overtimeTypeTone('earned')).toBe('success');
    expect(overtimeTypeTone('used')).toBe('violet');
    expect(overtimeTypeTone('nope')).toBe('default');
  });
});
