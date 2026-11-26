import { spokenElapsed } from './timer-a11y';

// Testmiljøet kører på engelsk (expo-localization-mocken); flertal følger i18next.
describe('spokenElapsed', () => {
  it('siger tiden i ord, med status først', () => {
    expect(spokenElapsed(3600 + 5 * 60 + 34, true)).toBe('Timer running, 1 hour, 5 minutes');
    expect(spokenElapsed(2 * 3600 + 60, true)).toBe('Timer running, 2 hours, 1 minute');
  });

  it('udelader timer under en time', () => {
    expect(spokenElapsed(12 * 60 + 34, true)).toBe('Timer running, 12 minutes');
    expect(spokenElapsed(20, true)).toBe('Timer running, 0 minutes');
  });

  it('siger kun status, når stopuret står på nul', () => {
    expect(spokenElapsed(0, false)).toBe('Timer not running');
  });
});
