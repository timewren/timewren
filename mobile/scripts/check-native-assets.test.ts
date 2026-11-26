import type { ExpoConfig } from '@expo/config';

import type { Buffer } from 'node:buffer';

import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PNG } from 'pngjs';

import { findProblems } from './check-native-assets.mjs';

function config(icon = './assets/icon.png', androidDarkImage?: string): Pick<ExpoConfig, 'icon' | 'android' | 'plugins'> {
  return {
    icon,
    android: { adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png' } },
    plugins: [
      ['expo-notifications', { icon: './assets/notification-icon.png' }],
      ['expo-splash-screen', { image: './assets/splash-icon.png', dark: { backgroundColor: '#123456' }, android: { dark: { image: androidDarkImage } } }],
    ],
  };
}

describe('check-native-assets', () => {
  it('godkender et uigennemsigtigt ikon og splash med mørk baggrundsfarve', () => {
    expect(findProblems(config(), process.cwd(), 'timetrack')).toEqual([]);
  });

  it('finder forkert størrelse på iOS-ikonet', () => {
    expect(findProblems(config('./assets/favicon.png'), process.cwd(), 'timetrack'))
      .toEqual([expect.stringContaining('1024×1024')]);
  });

  it('finder gennemsigtige pixels i et iOS-ikon med korrekt størrelse', () => {
    expect(findProblems(config('./assets/adaptive-icon.png'), process.cwd(), 'timetrack'))
      .toEqual([expect.stringContaining('gennemsigtige pixels')]);
  });

  it('finder en manglende fil', () => {
    expect(findProblems(config('./assets/mangler.png'), process.cwd(), 'timetrack'))
      .toEqual(['ios.icon (./assets/mangler.png): filen findes ikke']);
  });

  it('finder et ikon fra TimeWren i TimeTrack-konfigurationen', () => {
    expect(findProblems(config('./assets/timewren/icon.png'), process.cwd(), 'timetrack'))
      .toEqual([expect.stringContaining('tilhører ikke timetrack')]);
  });

  it.each([
    ['uigennemsigtigt', () => {}, 'transparent baggrund'],
    ['farvet', (data: Buffer) => {
      data[3] = 0;
      data[4] = 0;
    }, 'hvide'],
    ['helt gennemsigtigt', (data: Buffer) => { data.fill(0); }, 'synlige'],
  ] as const)('afviser et %s notifikationsikon', (_name, modifyPixels, message) => {
    const root = mkdtempSync(join(tmpdir(), 'native-assets-'));
    try {
      const assets = join(root, 'assets');
      mkdirSync(assets);
      for (const file of ['icon.png', 'adaptive-icon.png', 'splash-icon.png'])
        copyFileSync(join('assets', file), join(assets, file));

      const icon = new PNG({ width: 96, height: 96 });
      icon.data.fill(255);
      modifyPixels(icon.data);
      writeFileSync(join(assets, 'notification-icon.png'), PNG.sync.write(icon));
      expect(findProblems(config(), root, 'timetrack'))
        .toEqual([expect.stringContaining(message)]);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('afviser et favicon som splash', () => {
    const resolved = config();
    resolved.plugins = [
      ['expo-notifications', { icon: './assets/notification-icon.png' }],
      ['expo-splash-screen', { image: './assets/favicon.png' }],
    ];
    expect(findProblems(resolved, process.cwd(), 'timetrack'))
      .toEqual([expect.stringContaining('forventede 600×600, fik 64×64')]);
  });

  it('finder en manglende platformspecifik mørk splash', () => {
    const resolved = config('./assets/icon.png', './assets/mangler.png');
    expect(findProblems(resolved, process.cwd(), 'timetrack'))
      .toContainEqual(expect.stringContaining('android.dark.image'));
  });
});
