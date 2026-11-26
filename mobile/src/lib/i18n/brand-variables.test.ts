import type * as I18n from '~/lib/i18n';
import { timewren } from '../../../config/brands';

const mockGetItem = jest.fn();
const mockConstants: { expoConfig: { extra: Record<string, unknown> } } = { expoConfig: { extra: {} } };
jest.mock('expo-constants', () => ({ __esModule: true, default: mockConstants }));
jest.mock('expo-secure-store', () => ({ getItem: (...args: unknown[]) => mockGetItem(...args) }));

afterEach(() => {
  mockConstants.expoConfig.extra = {};
  mockGetItem.mockReset();
});

/** i18n som appen starter den: brandet og serveren læses én gang ved init. */
async function loadI18n(extra: Record<string, unknown>, language: string) {
  mockConstants.expoConfig.extra = extra;
  let i18n!: typeof I18n;
  jest.isolateModules(() => {
    i18n = require('~/lib/i18n') as typeof I18n;
  });
  await i18n.default.changeLanguage(language);
  return (key: I18n.TxKeyPath, options?: Record<string, unknown>) => i18n.default.t(key, options) as string;
}

it('i TimeTrack: navn, website og app.timetrack.dk', async () => {
  const t = await loadI18n({}, 'en');
  expect(t('settings.about.title')).toBe('About TimeTrack');
  expect(t('auth.signup.terms')).toContain('at timetrack.dk.');
  expect(t('settings.security.manage_on_web')).toBe('Managed at app.timetrack.dk');
});

it('i TimeWren cloud: navn, website og app.timewren.com i alle tekster', async () => {
  const t = await loadI18n({ timewren }, 'en');
  expect(t('settings.about.title')).toBe('About TimeWren');
  expect(t('more.about')).toBe('About TimeWren');
  expect(t('settings.about.website')).toBe('timewren.com');
  expect(t('auth.signup.terms')).toContain('at timewren.com.');
  expect(t('settings.profile.email_hint')).toBe('Change email at app.timewren.com');
  expect(t('settings.delete_account.org_transfer', { name: 'Team' })).toContain('Sign in at app.timewren.com,');
});

it('i selvhostet TimeWren: serverens host med port, også på dansk', async () => {
  mockGetItem.mockReturnValue('https://tid.firma.dk:8443');
  const t = await loadI18n({ timewren }, 'da');
  expect(t('settings.security.manage_on_web')).toBe('Administreres på tid.firma.dk:8443');
  expect(t('prepaid.module_disabled_body')).toBe('Slå modulet til under Indstillinger på tid.firma.dk:8443.');
  expect(t('settings.notifications.channels_hint')).toBe('Opsættes på tid.firma.dk:8443');
});
