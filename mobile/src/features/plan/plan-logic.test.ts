import { canAddClient, canUse, clientLimit, FREE_CLIENT_LIMIT, isPrivateFeature, resolveTier } from './plan-logic';

describe('plan-logic', () => {
  it('uden konto = gratis, med konto = erhverv', () => {
    expect(resolveTier(false)).toBe('free');
    expect(resolveTier(true)).toBe('business');
  });

  it('gratis får beta-funktioner, men ikke sync eller ubegrænsede kunder', () => {
    expect(canUse('free', 'yearStats')).toBe(true);
    expect(canUse('free', 'export')).toBe(true);
    expect(canUse('free', 'sync')).toBe(false);
    expect(canUse('free', 'unlimitedClients')).toBe(false);
  });

  it('uden beta er Privat-funktioner låst i gratis', () => {
    expect(canUse('free', 'yearStats', false)).toBe(false);
    expect(canUse('private', 'yearStats', false)).toBe(true);
    expect(canUse('business', 'sync', false)).toBe(true);
  });

  it('kundegrænse på 3 i gratis', () => {
    expect(clientLimit('free')).toBe(FREE_CLIENT_LIMIT);
    expect(canAddClient('free', 2)).toBe(true);
    expect(canAddClient('free', 3)).toBe(false);
    expect(canAddClient('private', 50)).toBe(true);
  });

  it('privat-mærke kun i gratis', () => {
    expect(isPrivateFeature('free', 'yearStats')).toBe(true);
    expect(isPrivateFeature('business', 'yearStats')).toBe(false);
  });
});
