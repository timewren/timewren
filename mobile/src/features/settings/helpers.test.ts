import { normalizeDecimal } from './normalize-decimal';
import { teaser } from './teaser';

describe('normalizeDecimal', () => {
  it('tom → undefined', () => {
    expect(normalizeDecimal('')).toBeUndefined();
    expect(normalizeDecimal('  ')).toBeUndefined();
  });
  it('komma som decimal', () => {
    expect(normalizeDecimal('850,5')).toBe('850.5');
  });
  it('negative og tekst afvises', () => {
    expect(normalizeDecimal('-5')).toBeUndefined();
    expect(normalizeDecimal('abc')).toBeUndefined();
  });
});

describe('teaser', () => {
  it('fjerner markdown og klipper med ellipse', () => {
    expect(teaser('## Ny **funktion**\n- punkt')).toBe('Ny funktion - punkt');
    expect(teaser('a'.repeat(200), 20)).toHaveLength(20);
    expect(teaser('a'.repeat(200), 20).endsWith('…')).toBe(true);
  });
});
