import type * as Links from './links';
import { timetrack, timewren } from '../../../config/brands';

const mockConstants: { expoConfig: { extra: Record<string, unknown> } } = { expoConfig: { extra: {} } };
jest.mock('expo-constants', () => ({ __esModule: true, default: mockConstants }));
jest.mock('expo-secure-store', () => ({ getItem: () => null }));

afterEach(() => {
  mockConstants.expoConfig.extra = {};
});

function loadLinks(extra: Record<string, unknown>): typeof Links {
  mockConstants.expoConfig.extra = extra;
  let links!: typeof Links;
  jest.isolateModules(() => {
    links = require('./links') as typeof Links;
  });
  return links;
}

describe('brandLinks', () => {
  // Importeres efter jest.mock, så expo-constants-mocken findes, når links indlæses.
  const { brandLinks } = loadLinks({});

  it('for TimeTrack: timetrack.dk og TimeTracks butikssider', () => {
    expect(brandLinks(timetrack)).toEqual({
      privacy: 'https://timetrack.dk/privacy',
      terms: 'https://timetrack.dk/terms',
      website: 'https://timetrack.dk',
      appStore: 'https://apps.apple.com/app/id6812371822',
      playStore: 'https://play.google.com/store/apps/details?id=dk.timetrack.app',
    });
  });

  it('for TimeWren: timewren.com og TimeWrens butikssider', () => {
    expect(brandLinks(timewren)).toEqual({
      privacy: 'https://timewren.com/privacy',
      terms: 'https://timewren.com/terms',
      website: 'https://timewren.com',
      appStore: 'https://apps.apple.com/app/id6832757501',
      playStore: 'https://play.google.com/store/apps/details?id=com.timewren.app',
    });
  });
});

describe('links i et build', () => {
  it('et TimeTrack-build linker til TimeTrack', () => {
    const links = loadLinks({});
    expect(links.PRIVACY_URL).toBe('https://timetrack.dk/privacy');
    expect(links.storeUrl('ios')).toBe('https://apps.apple.com/app/id6812371822');
  });

  it('et TimeWren-build (extra.timewren fra app.config.ts) linker til TimeWren', () => {
    const links = loadLinks({ timewren });
    expect(links.PRIVACY_URL).toBe('https://timewren.com/privacy');
    expect(links.TERMS_URL).toBe('https://timewren.com/terms');
    expect(links.WEBSITE_URL).toBe('https://timewren.com');
    expect(links.storeUrl('ios')).toBe('https://apps.apple.com/app/id6832757501');
    expect(links.storeUrl('android')).toBe('https://play.google.com/store/apps/details?id=com.timewren.app');
  });
});
