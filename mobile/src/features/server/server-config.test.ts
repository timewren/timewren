import type * as ServerConfig from './server-config';

const mockGetItem = jest.fn();
const mockConstants: { expoConfig: { extra: Record<string, unknown> } } = { expoConfig: { extra: {} } };
jest.mock('expo-constants', () => ({ __esModule: true, default: mockConstants }));
jest.mock('expo-secure-store', () => ({ getItem: (...args: unknown[]) => mockGetItem(...args) }));
const mockEnv = { EXPO_PUBLIC_API_URL: 'https://app.timetrack.dk' };
jest.mock('env', () => ({ __esModule: true, default: mockEnv }));

beforeEach(() => {
  jest.resetModules();
  mockGetItem.mockReset();
  mockConstants.expoConfig.extra = {};
  mockEnv.EXPO_PUBLIC_API_URL = 'https://app.timetrack.dk';
});

it('preserves TimeTrack origin and cookie prefix without reading the server setting', () => {
  const config = require('./server-config') as typeof ServerConfig;
  expect(config.getApiUrl()).toBe('https://app.timetrack.dk');
  expect(config.authStoragePrefix()).toBe('timetrack');
  expect(mockGetItem).not.toHaveBeenCalled();
});

it('defaults TimeWren to Cloud and restores a selected server on next launch', () => {
  mockConstants.expoConfig.extra.timewren = { cloudUrl: 'https://app.timewren.com' };
  const cloud = require('./server-config') as typeof ServerConfig;
  expect(cloud.getApiUrl()).toBe('https://app.timewren.com');
  mockGetItem.mockReturnValue('https://my.example');
  // An existing client never changes origin before restart.
  expect(cloud.getApiUrl()).toBe('https://app.timewren.com');
  jest.resetModules();
  const selected = require('./server-config') as typeof ServerConfig;
  expect(selected.getApiUrl()).toBe('https://my.example');
  expect(mockGetItem).toHaveBeenCalledWith('timewren-server');
  expect(selected.authStoragePrefix()).not.toBe(cloud.authStoragePrefix());
});

it('fails closed on invalid persisted URLs', () => {
  mockConstants.expoConfig.extra.timewren = { cloudUrl: 'https://app.timewren.com' };
  mockGetItem.mockReturnValue('http://public.example');
  expect(() => require('./server-config')).toThrow('url');
});

describe('getWebHost', () => {
  const timewren = { name: 'TimeWren', cloudUrl: 'https://app.timewren.com' };

  it('for TimeTrack: host fra API-adressen', () => {
    const config = require('./server-config') as typeof ServerConfig;
    expect(config.getWebHost()).toBe('app.timetrack.dk');
    expect(config.brand.name).toBe('TimeTrack');
  });

  it('for TimeWren cloud: brandets cloud-host', () => {
    mockConstants.expoConfig.extra.timewren = timewren;
    const config = require('./server-config') as typeof ServerConfig;
    expect(config.getWebHost()).toBe('app.timewren.com');
    expect(config.brand.name).toBe('TimeWren');
  });

  it('selvhostet server: host med port', () => {
    mockConstants.expoConfig.extra.timewren = timewren;
    mockGetItem.mockReturnValue('https://tid.firma.dk:8443');
    expect((require('./server-config') as typeof ServerConfig).getWebHost()).toBe('tid.firma.dk:8443');
  });

  it('uden API-URL: brandets cloud-host', () => {
    mockEnv.EXPO_PUBLIC_API_URL = '';
    expect((require('./server-config') as typeof ServerConfig).getWebHost()).toBe('app.timetrack.dk');
  });
});
