import { Buffer } from 'node:buffer';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRedactor, main, parseArgs, readReleaseNotes, versionCodesOnTrack } from './upload-play.mjs';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const ACCESS_TOKEN = 'ya29.a0TESTTOKENVALUE1234567890';
const PKG = 'dk.timetrack.app';
const BASE = 'https://androidpublisher.googleapis.com';

type Call = { method: string; url: string; body?: unknown; headers: Record<string, string> };

let dir: string;
let keyFile: string;
let aabFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'upload-play-'));
  keyFile = join(dir, 'key.json');
  writeFileSync(keyFile, JSON.stringify({
    type: 'service_account',
    client_email: 'play-upload@example.iam.gserviceaccount.com',
    private_key: privateKey,
    token_uri: 'https://oauth2.googleapis.com/token',
  }), { mode: 0o600 });
  aabFile = join(dir, 'app.aab');
  writeFileSync(aabFile, Buffer.from('not-a-real-aab'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Mock af Google: token, edits og tracks. Returnerer fetch + optagne kald. */
function mockGoogle({ trackReleases = [] as { versionCodes: string[] }[], uploadVersion = 12, failUpload, failCommit, trackMissing }: {
  trackReleases?: { versionCodes: string[] }[];
  uploadVersion?: number;
  failUpload?: Response;
  failCommit?: Response;
  trackMissing?: boolean;
} = {}) {
  const calls: Call[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' && headers['Content-Type'] === 'application/json' ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, body, headers });
    if (url === 'https://oauth2.googleapis.com/token')
      return json({ access_token: ACCESS_TOKEN, expires_in: 3600 });
    if (url.endsWith('/edits') && method === 'POST')
      return json({ id: 'edit-1', expiryTimeSeconds: '9999999999' });
    if (url.endsWith(':commit') && failCommit)
      return failCommit;
    if (url.includes('/tracks/') && method === 'GET')
      return trackMissing ? json({ error: { message: 'Track not found' } }, 404) : json({ track: 'internal', releases: trackReleases });
    if (url.includes('/bundles'))
      return failUpload ?? json({ versionCode: uploadVersion, sha256: 'abc' });
    if (url.includes('/tracks/') && method === 'PUT')
      return json(body);
    return json({});
  });
  return { fetchImpl, calls };
}

async function run(argv: string[], google = mockGoogle(), env: Record<string, string | undefined> = { PLAY_SERVICE_ACCOUNT_JSON: keyFile }) {
  const lines: string[] = [];
  const code = await main(argv, env, {
    fetchImpl: google.fetchImpl as unknown as typeof fetch,
    out: l => lines.push(String(l)),
    err: l => lines.push(String(l)),
  });
  return { code, lines, text: lines.join('\n'), calls: google.calls };
}

const baseArgs = ['--package', PKG, '--aab', 'x.aab'];

describe('parseArgs', () => {
  it('bruger spor internal og status completed som default', () => {
    expect(parseArgs(baseArgs)).toMatchObject({ package: PKG, aab: 'x.aab', track: 'internal', status: 'completed', dryRun: false });
  });

  it('læser alle flag', () => {
    const opts = parseArgs([...baseArgs, '--track', 'beta', '--status', 'inProgress', '--rollout', '0.2', '--version-code', '12', '--release-notes-dir', 'n', '--dry-run']);
    expect(opts).toMatchObject({ track: 'beta', status: 'inProgress', rollout: 0.2, versionCode: 12, releaseNotesDir: 'n', dryRun: true });
  });

  it('gør --rollout til inProgress, når status ikke er angivet', () => {
    expect(parseArgs([...baseArgs, '--rollout', '0.5']).status).toBe('inProgress');
  });

  it.each([
    [['--aab', 'x.aab'], '--package er påkrævet'],
    [['--package', PKG], '--aab er påkrævet'],
    [[...baseArgs, '--track', 'gamma'], '--track skal være'],
    [[...baseArgs, '--status', 'live'], '--status skal være'],
    [[...baseArgs, '--rollout', '1.5'], '--rollout skal være'],
    [[...baseArgs, '--rollout', '0'], '--rollout skal være'],
    [[...baseArgs, '--status', 'completed', '--rollout', '0.5'], 'kun sammen med --status inProgress'],
    [[...baseArgs, '--status', 'inProgress'], 'kræver --rollout'],
    [[...baseArgs, '--version-code', 'abc'], '--version-code skal være'],
    [[...baseArgs, '--bogus'], 'Ukendt argument'],
    [[...baseArgs, '--track'], 'mangler en værdi'],
    [['--package', '../evil', '--aab', 'x'], 'Ugyldigt pakkenavn'],
  ])('afviser %j', (argv, message) => {
    expect(() => parseArgs(argv as string[])).toThrow(message);
  });
});

describe('readReleaseNotes', () => {
  it('læser de sprog, der findes, og springer resten over', () => {
    const d = mkdtempSync(join(dir, 'n-'));
    writeFileSync(join(d, 'da-DK.txt'), 'Ny version\n');
    writeFileSync(join(d, 'en-US.txt'), 'New version');
    expect(readReleaseNotes(d)).toEqual([{ language: 'da-DK', text: 'Ny version' }, { language: 'en-US', text: 'New version' }]);
  });

  it('afviser tekster over 500 tegn og tomme mapper', () => {
    const d = mkdtempSync(join(dir, 'n-'));
    expect(() => readReleaseNotes(d)).toThrow('Ingen udgivelsesnoter');
    writeFileSync(join(d, 'de-DE.txt'), 'x'.repeat(501));
    expect(() => readReleaseNotes(d)).toThrow('de-DE.txt er 501 tegn');
  });
});

describe('versionCodesOnTrack', () => {
  it('samler versionCodes fra alle udgivelser som tal', () => {
    expect(versionCodesOnTrack({ releases: [{ versionCodes: ['10', '11'] }, { versionCodes: ['9'] }] })).toEqual(new Set([9, 10, 11]));
    expect(versionCodesOnTrack({})).toEqual(new Set());
  });
});

describe('upload', () => {
  it('kører edits.insert -> bundles.upload -> tracks.update -> commit', async () => {
    const { code, calls } = await run([...baseArgs, '--aab', aabFile, '--track', 'alpha', '--version-code', '12']);
    expect(code).toBe(0);
    const steps = calls.map(c => `${c.method} ${c.url.replace(`${BASE}/upload/androidpublisher/v3/applications/${PKG}`, '/upload').replace(`${BASE}/androidpublisher/v3/applications/${PKG}`, '')}`);
    expect(steps).toEqual([
      'POST https://oauth2.googleapis.com/token',
      'POST /edits',
      'GET /edits/edit-1/tracks/alpha',
      'POST /upload/edits/edit-1/bundles?uploadType=media',
      'PUT /edits/edit-1/tracks/alpha',
      'POST /edits/edit-1:commit',
    ]);
    const update = calls.find(c => c.method === 'PUT')!;
    expect(update.body).toEqual({ track: 'alpha', releases: [{ versionCodes: ['12'], status: 'completed' }] });
    expect(update.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('sender udgivelsesnoter og userFraction ved trinvis udrulning', async () => {
    const notesDir = mkdtempSync(join(dir, 'n-'));
    writeFileSync(join(notesDir, 'da-DK.txt'), 'Rettelser');
    const { code, calls } = await run([...baseArgs, '--aab', aabFile, '--track', 'production', '--rollout', '0.1', '--release-notes-dir', notesDir]);
    expect(code).toBe(0);
    expect(calls.find(c => c.method === 'PUT')!.body).toEqual({
      track: 'production',
      releases: [{ versionCodes: ['12'], status: 'inProgress', userFraction: 0.1, releaseNotes: [{ language: 'da-DK', text: 'Rettelser' }] }],
    });
  });

  it('afviser en versionCode, sporet allerede har, før noget uploades', async () => {
    const google = mockGoogle({ trackReleases: [{ versionCodes: ['11', '12'] }] });
    const { code, text, calls } = await run([...baseArgs, '--aab', aabFile, '--version-code', '12'], google);
    expect(code).toBe(1);
    expect(text).toContain('versionCode 12 findes allerede på sporet \'internal\'');
    expect(text).toContain('APP_BUILD_NUMBER');
    expect(calls.some(c => c.url.includes('/bundles'))).toBe(false);
    expect(calls.some(c => c.url.endsWith(':commit'))).toBe(false);
    expect(calls.some(c => c.method === 'DELETE')).toBe(true);
  });

  it('afviser også en duplet, der først kendes efter upload (uden --version-code)', async () => {
    const google = mockGoogle({ trackReleases: [{ versionCodes: ['12'] }], uploadVersion: 12 });
    const { code, text, calls } = await run([...baseArgs, '--aab', aabFile], google);
    expect(code).toBe(1);
    expect(text).toContain('versionCode 12 findes allerede');
    expect(calls.some(c => c.url.endsWith(':commit'))).toBe(false);
  });

  it('afviser en AAB, hvis versionCode ikke er den forventede', async () => {
    const { code, text } = await run([...baseArgs, '--aab', aabFile, '--version-code', '13']);
    expect(code).toBe(1);
    expect(text).toContain('versionCode 12, men --version-code var 13');
  });

  it('--dry-run validerer editen, committer ikke og rydder editen op', async () => {
    const { code, text, calls } = await run([...baseArgs, '--aab', aabFile, '--dry-run']);
    expect(code).toBe(0);
    expect(calls.some(c => c.url.endsWith('/edits/edit-1:validate') && c.method === 'POST')).toBe(true);
    expect(calls.some(c => c.url.endsWith(':commit'))).toBe(false);
    expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/edits/edit-1'))).toBe(true);
    expect(text).toContain('DRY-RUN');
  });

  it('behandler et spor, der aldrig har været brugt (404), som tomt', async () => {
    const { code, calls } = await run([...baseArgs, '--aab', aabFile], mockGoogle({ trackMissing: true }));
    expect(code).toBe(0);
    expect(calls.some(c => c.url.endsWith(':commit'))).toBe(true);
  });

  it('sletter editen igen, når bundles.upload fejler', async () => {
    const { code, calls } = await run([...baseArgs, '--aab', aabFile], mockGoogle({ failUpload: json({ error: { message: 'bad bundle' } }, 400) }));
    expect(code).toBe(1);
    expect(calls.some(c => c.url.endsWith(':commit'))).toBe(false);
    expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/edits/edit-1'))).toBe(true);
  });

  it('sletter editen igen, når commit fejler', async () => {
    const { code, calls } = await run([...baseArgs, '--aab', aabFile], mockGoogle({ failCommit: json({ error: { message: 'nope' } }, 400) }));
    expect(code).toBe(1);
    expect(calls.some(c => c.method === 'DELETE' && c.url.endsWith('/edits/edit-1'))).toBe(true);
  });

  it('logger en afrundet udrulningsandel uden flydende-tal-støj', async () => {
    const { text } = await run([...baseArgs, '--aab', aabFile, '--rollout', '0.07']);
    expect(text).toContain('(7%)');
  });

  it('--check-key validerer kun nøglefilen og laver ingen kald', async () => {
    const google = mockGoogle();
    const ok = await run(['--check-key'], google);
    expect(ok.code).toBe(0);
    expect(google.fetchImpl).not.toHaveBeenCalled();
    const empty = join(dir, 'tom.json');
    writeFileSync(empty, '');
    const bad = await run(['--check-key'], mockGoogle(), { PLAY_SERVICE_ACCOUNT_JSON: empty });
    expect(bad.code).toBe(1);
    expect(bad.text).toContain('ikke gyldig JSON');
  });

  it('kræver PLAY_SERVICE_ACCOUNT_JSON og laver ingen kald uden', async () => {
    const google = mockGoogle();
    const { code, text, calls } = await run([...baseArgs, '--aab', aabFile], google, {});
    expect(code).toBe(1);
    expect(text).toContain('PLAY_SERVICE_ACCOUNT_JSON er ikke sat');
    expect(calls).toHaveLength(0);
  });
});

describe('hemmeligheder i output', () => {
  const SECRET_BODY = privateKey.split('\n').filter(l => l && !l.startsWith('-----'))[1];

  function expectClean(text: string) {
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain(SECRET_BODY);
    expect(text).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
    expect(text).not.toMatch(/Bearer\s+(?!\[fjernet\])\S/);
  }

  it('lægger hverken nøgle, JWT eller token i loggen ved succes', async () => {
    const { text } = await run([...baseArgs, '--aab', aabFile]);
    expect(text.length).toBeGreaterThan(0);
    expectClean(text);
  });

  it('holder fejlbeskeder rene, selv når Google ekkoer hemmeligheder tilbage', async () => {
    const leak = json({ error: { message: `bad assertion ${ACCESS_TOKEN} key ${privateKey} Bearer ${ACCESS_TOKEN}` } }, 403);
    const { code, text } = await run([...baseArgs, '--aab', aabFile], mockGoogle({ failUpload: leak }));
    expect(code).toBe(1);
    expect(text).toContain('HTTP 403');
    expectClean(text);
  });

  it('holder netværksfejl og ugyldig nøglefil rene', async () => {
    const failing = {
      calls: [] as Call[],
      fetchImpl: jest.fn(async () => { throw new Error(`connect failed with ${ACCESS_TOKEN}`); }),
    };
    const net = await run([...baseArgs, '--aab', aabFile], failing as unknown as ReturnType<typeof mockGoogle>);
    expect(net.code).toBe(1);
    expectClean(net.text);

    const badKey = join(dir, 'bad.json');
    writeFileSync(badKey, `{"private_key": "${privateKey.replace(/\n/g, '\\n')}"`);
    const bad = await run([...baseArgs, '--aab', aabFile], mockGoogle(), { PLAY_SERVICE_ACCOUNT_JSON: badKey });
    expect(bad.code).toBe(1);
    expect(bad.text).toContain('ikke gyldig JSON');
    expectClean(bad.text);
  });

  it('createRedactor fjerner registrerede værdier og kendte mønstre', () => {
    const { add, redact } = createRedactor(['hemmelig-streng-1234']);
    add('anden-hemmelighed-5678');
    expect(redact('a hemmelig-streng-1234 b anden-hemmelighed-5678 c')).toBe('a [fjernet] b [fjernet] c');
    expect(redact('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer [fjernet]');
  });
});
