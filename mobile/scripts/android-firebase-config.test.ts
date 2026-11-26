import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('android Firebase config', () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'android-firebase-'));
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it.each([
    { variant: 'timetrack', stage: 'production', variable: 'GOOGLE_SERVICES_JSON', fileVariant: 'timetrack', packageName: 'dk.timetrack.app' },
    { variant: 'timetrack', stage: 'preview', variable: 'GOOGLE_SERVICES_JSON', fileVariant: 'preview', packageName: 'dk.timetrack.app.preview' },
    { variant: 'timewren', stage: 'production', variable: 'GOOGLE_SERVICES_JSON_TIMEWREN', fileVariant: 'timewren', packageName: 'com.timewren.app' },
  ])('selects Firebase config for $variant $stage', ({ variant, stage, variable, fileVariant, packageName }) => {
    const easFile = join(fixtureDir, 'uploaded.json');
    const localFile = `./credentials/google-services.${fileVariant}.json`;
    writeFileSync(easFile, '{}');
    mkdirSync(join(fixtureDir, 'credentials'));
    writeFileSync(join(fixtureDir, localFile), '{}');
    for (const [envFile, expectedFile] of [[easFile, easFile], ['uploaded.json', 'uploaded.json'], ['', localFile], ['missing.json', localFile]]) {
      const result = readConfig({ variant, stage, fixtureDir, variables: { [variable]: envFile } });
      expect(result.android).toMatchObject({ package: packageName, googleServicesFile: expectedFile });
      expect(result.warnings).toEqual([]);
    }
  });

  it('omits a missing file and warns without exposing the supplied path', () => {
    const result = readConfig({
      variant: 'timewren',
      stage: 'preview',
      fixtureDir,
      variables: { GOOGLE_SERVICES_JSON: __filename, GOOGLE_SERVICES_JSON_TIMEWREN: 'missing.json' },
    });
    expect(result.android).toMatchObject({ package: 'com.timewren.app' });
    expect(result.android).not.toHaveProperty('googleServicesFile');
    expect(result.warnings).toEqual([expect.stringContaining('GOOGLE_SERVICES_JSON_TIMEWREN')]);
    expect(result.warnings[0]).not.toContain('missing.json');
  });
});

function readConfig({ variant, stage, fixtureDir, variables }: {
  variant: string;
  stage: string;
  fixtureDir: string;
  variables: Record<string, string>;
}) {
  const result = execFileSync(process.execPath, ['--require', 'tsx/cjs', '-e', `
    process.chdir(${JSON.stringify(tmpdir())});
    console.log = () => {};
    const warnings = [];
    console.warn = (message) => warnings.push(message);
    const { android } = require(${JSON.stringify(join(__dirname, '../app.config.ts'))}).default({
      config: {},
      projectRoot: ${JSON.stringify(fixtureDir)},
    });
    process.stdout.write(JSON.stringify({ android, warnings }));
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GOOGLE_SERVICES_JSON: '',
      GOOGLE_SERVICES_JSON_TIMEWREN: '',
      ...variables,
      APP_VARIANT: variant,
      APP_BUILD_NUMBER: '1',
      EXPO_PUBLIC_API_URL: 'https://example.com',
      EXPO_PUBLIC_APP_ENV: stage,
    },
  });
  return JSON.parse(result) as { android: { package: string; googleServicesFile?: string }; warnings: string[] };
}
