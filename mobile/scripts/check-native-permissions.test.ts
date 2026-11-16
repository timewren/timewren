import { findProblems } from './check-native-permissions.mjs';

function config(plist: Record<string, unknown>, permissions: Array<Record<string, string>>) {
  return {
    _internal: {
      modResults: {
        ios: { infoPlist: plist },
        android: { manifest: { manifest: { 'uses-permission': permissions.map(p => ({ $: p })) } } },
      },
    },
  };
}

const PHOTOS = { NSPhotoLibraryUsageDescription: 'Vælg et billede fra dit fotobibliotek for at vedhæfte det på en opgave.' };

describe('check-native-permissions', () => {
  it('godkender fotobiblioteket og blokerede tilladelser', () => {
    expect(findProblems(config(PHOTOS, [
      { 'android:name': 'android.permission.INTERNET' },
      { 'android:name': 'android.permission.CAMERA', 'tools:node': 'remove' },
    ]))).toEqual([]);
  });

  it('finder en ubrugt formålstekst med Expos standardtekst', () => {
    const problems = findProblems(config({ ...PHOTOS, NSCameraUsageDescription: 'Allow $(PRODUCT_NAME) to access your camera' }, []));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('NSCameraUsageDescription');
  });

  it('finder en generisk tekst på en tilladt nøgle', () => {
    expect(findProblems(config({ NSPhotoLibraryUsageDescription: 'Allow $(PRODUCT_NAME) to access your photos' }, []))).toHaveLength(1);
  });

  it('finder en forbudt Android-tilladelse, der ikke er fjernet', () => {
    const problems = findProblems(config(PHOTOS, [{ 'android:name': 'android.permission.SYSTEM_ALERT_WINDOW' }]));
    expect(problems[0]).toContain('SYSTEM_ALERT_WINDOW');
  });

  it('fejler lukket, når introspektionen ikke har modResults', () => {
    expect(findProblems({})).toHaveLength(1);
  });
});
