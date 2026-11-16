import type * as ServerConfig from './server-config';

const mockGetItem = jest.fn();
const mockConstants: { expoConfig: { extra: Record<string, unknown> } } = { expoConfig: { extra: {} } };
jest.mock('expo-constants', () => ({ __esModule: true, default: mockConstants }));
jest.mock('expo-secure-store', () => ({ getItem: (...args: unknown[]) => mockGetItem(...args) }));
jest.mock('env', () => ({ __esModule: true, default: { EXPO_PUBLIC_API_URL: 'https://app.timetrack.dk' } }));

beforeEach(() => {
  jest.resetModules();
  mockGetItem.mockReset();
  mockConstants.expoConfig.extra = {};
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
