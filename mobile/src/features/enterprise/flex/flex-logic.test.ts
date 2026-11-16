import { deltaTone, flexRange, formatDelta, shiftAnchor, sumDelta } from './flex-logic';

describe('flex-logic', () => {
  it('formatDelta med fortegn', () => {
    expect(formatDelta(2.5)).toBe('+2,5 t');
    expect(formatDelta('-1.00')).toBe('−1 t');
    expect(formatDelta(0)).toBe('±0 t');
    expect(formatDelta(null)).toBe('±0 t');
  });

  it('deltaTone', () => {
    expect(deltaTone(1)).toBe('success');
    expect(deltaTone('-0.25')).toBe('danger');
    expect(deltaTone(0)).toBe('default');
    expect(deltaTone('abc')).toBe('default');
  });

  it('flexRange uge starter mandag', () => {
    const r = flexRange(new Date(2026, 8, 6), 'week');
    expect(r.start).toBe('2026-08-31');
    expect(r.end).toBe('2026-09-06');
    expect(r.label).toContain('Uge 36');
  });

  it('flexRange måned', () => {
    const r = flexRange(new Date(2026, 8, 15), 'month');
    expect(r.start).toBe('2026-09-01');
    expect(r.end).toBe('2026-09-30');
    expect(r.label).toBe('September 2026');
  });

  it('shiftAnchor', () => {
    expect(shiftAnchor(new Date(2026, 8, 6), 'week', 1).getDate()).toBe(13);
    expect(shiftAnchor(new Date(2026, 8, 6), 'month', -1).getMonth()).toBe(7);
  });

  it('sumDelta', () => {
    expect(sumDelta([{ delta: '1.5' }, { delta: -0.5 }, { delta: 'x' }])).toBe(1);
  });
});
