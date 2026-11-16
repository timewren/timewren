import { visibleSocialProviders } from './social-providers';

const ids = (flags: Parameters<typeof visibleSocialProviders>[0]) => visibleSocialProviders(flags).map(([id]) => id);

describe('visibleSocialProviders', () => {
  it('viser kun de udbydere, serveren har slået til (App Review 2.1: ingen døde knapper)', () => {
    expect(ids({ google: true, github: true, microsoft: false })).toEqual(['google', 'github']);
    expect(ids({ google: true, github: false, microsoft: true })).toEqual(['google', 'microsoft']);
  });

  it('skjuler Microsoft, indtil serveren har bekræftet det', () => {
    expect(ids(undefined)).toEqual(['google', 'github']);
  });

  it('viser Google og GitHub, mens svaret hentes eller fejler', () => {
    expect(ids(undefined)).toContain('google');
    expect(ids(null)).toEqual(['google', 'github']);
  });
});
