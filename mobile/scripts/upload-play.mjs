#!/usr/bin/env node
/**
 * Uploader en signeret AAB til Google Play med Android Publisher API v3 (edits-flowet):
 * edits.insert -> edits.bundles.upload -> edits.tracks.update -> edits.commit.
 *
 * Brug:
 *   PLAY_SERVICE_ACCOUNT_JSON=/sti/til/noegle.json node scripts/upload-play.mjs \
 *     --package dk.timetrack.app --aab dist/release/timetrack-1.0.0-12.aab \
 *     --track internal [--status draft|completed|inProgress] [--rollout 0.2] \
 *     [--version-code 12] [--release-notes-dir dir] [--dry-run]
 *
 * Servicekontonøglen læses fra filen i PLAY_SERVICE_ACCOUNT_JSON. Indholdet, JWT'en og
 * adgangstokenet skrives aldrig til log eller fejlbeskeder (se createRedactor).
 * Ingen afhængigheder: JWT signeres med node:crypto, HTTP med indbygget fetch.
 */
// @ts-nocheck: ren Node-script uden typer; dækkes af scripts/upload-play.test.ts
import { Buffer } from 'node:buffer';
import { createSign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export const TRACKS = ['internal', 'alpha', 'beta', 'production'];
export const STATUSES = ['draft', 'completed', 'inProgress'];
export const LOCALES = ['da-DK', 'en-US', 'de-DE', 'es-ES'];
export const RELEASE_NOTES_MAX_CHARS = 500;
export const TOKEN_URI = 'https://oauth2.googleapis.com/token';
// Rigelig tid til en stor AAB, men en hængende forbindelse må ikke blokere releasen for evigt.
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const UPLOAD_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications';

export class UploadError extends Error {}

const USAGE = `Brug: node scripts/upload-play.mjs --package <pakke> --aab <fil> [--track internal|alpha|beta|production]
  [--status draft|completed|inProgress] [--rollout <0-1>] [--version-code <n>]
  [--release-notes-dir <mappe>] [--dry-run]
Nøglefilens sti står i miljøvariablen PLAY_SERVICE_ACCOUNT_JSON.`;

export function parseArgs(argv) {
  const opts = { track: 'internal', status: undefined, dryRun: false };
  const valueFlags = {
    '--package': 'package',
    '--aab': 'aab',
    '--track': 'track',
    '--status': 'status',
    '--rollout': 'rollout',
    '--version-code': 'versionCode',
    '--release-notes-dir': 'releaseNotesDir',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
    }
    else if (arg in valueFlags) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--'))
        throw new UploadError(`${arg} mangler en værdi.\n${USAGE}`);
      opts[valueFlags[arg]] = value;
    }
    else {
      throw new UploadError(`Ukendt argument: ${arg}\n${USAGE}`);
    }
  }

  if (!opts.package)
    throw new UploadError(`--package er påkrævet.\n${USAGE}`);
  if (!/^[A-Z]\w*(\.[A-Z]\w*)+$/i.test(opts.package))
    throw new UploadError(`Ugyldigt pakkenavn: ${opts.package}`);
  if (!opts.aab)
    throw new UploadError(`--aab er påkrævet.\n${USAGE}`);
  if (!TRACKS.includes(opts.track))
    throw new UploadError(`--track skal være en af ${TRACKS.join(', ')} (fik '${opts.track}').`);
  if (opts.status !== undefined && !STATUSES.includes(opts.status))
    throw new UploadError(`--status skal være en af ${STATUSES.join(', ')} (fik '${opts.status}').`);

  if (opts.rollout !== undefined) {
    const rollout = Number(opts.rollout);
    if (!/^\d*\.?\d+$/.test(opts.rollout) || !(rollout > 0 && rollout < 1))
      throw new UploadError(`--rollout skal være et tal mellem 0 og 1, ikke inklusive (fik '${opts.rollout}'). 1 = alle: brug --status completed.`);
    opts.rollout = rollout;
    if (opts.status === undefined)
      opts.status = 'inProgress';
    if (opts.status !== 'inProgress')
      throw new UploadError('--rollout hører kun sammen med --status inProgress.');
  }
  opts.status ??= 'completed';
  if (opts.status === 'inProgress' && opts.rollout === undefined)
    throw new UploadError('--status inProgress kræver --rollout.');

  if (opts.versionCode !== undefined) {
    if (!/^[1-9]\d*$/.test(opts.versionCode))
      throw new UploadError(`--version-code skal være et positivt heltal (fik '${opts.versionCode}').`);
    opts.versionCode = Number(opts.versionCode);
  }
  return opts;
}

/** Læser <mappe>/<sprog>.txt for de understøttede sprog. Manglende filer springes over. */
export function readReleaseNotes(dir) {
  const notes = [];
  for (const language of LOCALES) {
    let text;
    try {
      text = readFileSync(join(dir, `${language}.txt`), 'utf8').trim();
    }
    catch (error) {
      if (error.code === 'ENOENT')
        continue;
      throw new UploadError(`Kunne ikke læse ${language}.txt i ${dir}: ${error.code ?? 'ukendt fejl'}`);
    }
    if (!text)
      continue;
    if ([...text].length > RELEASE_NOTES_MAX_CHARS)
      throw new UploadError(`${language}.txt er ${[...text].length} tegn; Play tillader højst ${RELEASE_NOTES_MAX_CHARS}.`);
    notes.push({ language, text });
  }
  if (notes.length === 0)
    throw new UploadError(`Ingen udgivelsesnoter fundet i ${dir} (forventer ${LOCALES.map(l => `${l}.txt`).join(', ')}).`);
  return notes;
}

export function loadServiceAccount(path) {
  if (!path)
    throw new UploadError('PLAY_SERVICE_ACCOUNT_JSON er ikke sat. Peg den på servicekontonøglens fil (se docs/RELEASE.md).');
  let raw;
  let mode;
  try {
    raw = readFileSync(path, 'utf8');
    mode = statSync(path).mode;
  }
  catch (error) {
    throw new UploadError(`Kunne ikke læse nøglefilen (${error.code ?? 'ukendt fejl'}): ${path}`);
  }
  let key;
  try {
    key = JSON.parse(raw);
  }
  catch {
    throw new UploadError(`Nøglefilen er ikke gyldig JSON: ${path}`);
  }
  if (typeof key.client_email !== 'string' || typeof key.private_key !== 'string')
    throw new UploadError('Nøglefilen mangler client_email eller private_key. Er det en servicekontonøgle?');
  if (key.token_uri !== undefined && key.token_uri !== TOKEN_URI)
    throw new UploadError(`Uventet token_uri i nøglefilen; forventer ${TOKEN_URI}.`);
  return { key, looseMode: process.platform !== 'win32' && (mode & 0o077) !== 0 };
}

/** Fjerner kendte hemmeligheder og alt, der ligner en privat nøgle, JWT eller Google-token, fra tekst. */
export function createRedactor(initialSecrets = []) {
  const secrets = new Set();
  const add = (value) => {
    if (typeof value !== 'string')
      return;
    for (const part of value.split(/\r?\n|\\n/)) {
      const trimmed = part.trim();
      if (trimmed.length >= 8)
        secrets.add(trimmed);
    }
    if (value.length >= 8)
      secrets.add(value);
  };
  initialSecrets.forEach(add);
  const redact = (text) => {
    let out = String(text);
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(secret).join('[fjernet]');
    return out
      .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[fjernet]')
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[fjernet]')
      .replace(/ya29\.[\w.-]+/g, '[fjernet]')
      .replace(/(Bearer\s+)[\w.~+/=-]+/gi, '$1[fjernet]');
  };
  return { add, redact };
}

const b64url = input => Buffer.from(input).toString('base64url');

export function signJwt(key, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key, 'base64url');
  return `${header}.${claims}.${signature}`;
}

/** Kort, hemmelighedsfri beskrivelse af et fejlsvar fra Google. */
async function describeFailure(response, redact) {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message ?? body?.error_description ?? (typeof body?.error === 'string' ? body.error : '');
  }
  catch {
    // Svaret var ikke JSON; HTTP-statussen må række.
  }
  return redact(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
}

export function createClient({ key, fetchImpl = globalThis.fetch, redactor }) {
  const { add, redact } = redactor;
  add(key.private_key);
  let token;

  async function request(label, url, init = {}) {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    }
    catch (error) {
      throw new UploadError(redact(`${label} fejlede: ${error?.cause?.code ?? error?.message ?? 'netværksfejl'}`));
    }
    if (!response.ok)
      throw new UploadError(`${label} fejlede (${await describeFailure(response, redact)})`);
    return response;
  }

  async function authenticate() {
    const assertion = signJwt(key);
    add(assertion);
    const response = await request('Hentning af adgangstoken', TOKEN_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const body = await response.json();
    if (typeof body?.access_token !== 'string')
      throw new UploadError('Svaret fra Google indeholdt intet adgangstoken.');
    token = body.access_token;
    add(token);
  }

  async function call(label, url, { method = 'GET', json, raw } = {}) {
    if (!token)
      await authenticate();
    const headers = { Authorization: `Bearer ${token}` };
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    else if (raw !== undefined) {
      headers['Content-Type'] = 'application/octet-stream';
      body = raw;
    }
    const response = await request(label, url, { method, headers, body });
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  return { call };
}

/** versionCodes, som sporet allerede har (alle udgivelser, uanset status). */
export function versionCodesOnTrack(track) {
  return new Set((track?.releases ?? []).flatMap(release => (release.versionCodes ?? []).map(Number)));
}

function duplicateMessage(versionCode, track) {
  return `versionCode ${versionCode} findes allerede på sporet '${track}'. Bump APP_BUILD_NUMBER (eas.json -> build.production.env.APP_BUILD_NUMBER, for TimeWren build.timewren-production.env.APP_BUILD_NUMBER), byg igen og upload den nye AAB.`;
}

export async function uploadToPlay(opts, { key, fetchImpl, log = () => {}, redactor = createRedactor() }) {
  const client = createClient({ key, fetchImpl, redactor });
  const pkg = encodeURIComponent(opts.package);
  const releaseNotes = opts.releaseNotesDir ? readReleaseNotes(opts.releaseNotesDir) : undefined;
  let aab;
  try {
    aab = readFileSync(opts.aab);
  }
  catch (error) {
    throw new UploadError(`Kunne ikke læse AAB'en (${error.code ?? 'ukendt fejl'}): ${opts.aab}`);
  }

  log(`Opretter edit for ${opts.package}${opts.dryRun ? ' (dry-run)' : ''}`);
  const edit = await client.call('edits.insert', `${API}/${pkg}/edits`, { method: 'POST', json: {} });
  const editUrl = `${API}/${pkg}/edits/${encodeURIComponent(edit.id)}`;

  try {
    const current = await client.call(
      'edits.tracks.get',
      `${editUrl}/tracks/${opts.track}`,
    ).catch((error) => {
      // Et spor, der aldrig har været brugt, giver 404 og er tomt.
      if (/HTTP 404/.test(error.message))
        return { releases: [] };
      throw error;
    });
    const existing = versionCodesOnTrack(current);
    if (opts.versionCode !== undefined && existing.has(opts.versionCode))
      throw new UploadError(duplicateMessage(opts.versionCode, opts.track));

    log(`Uploader ${basename(opts.aab)} (${(aab.length / 1048576).toFixed(1)} MB)`);
    const bundle = await client.call(
      'edits.bundles.upload',
      `${UPLOAD_API}/${pkg}/edits/${encodeURIComponent(edit.id)}/bundles?uploadType=media`,
      { method: 'POST', raw: aab },
    );
    const versionCode = Number(bundle.versionCode);
    if (!Number.isInteger(versionCode))
      throw new UploadError('Play returnerede ingen versionCode for AAB\'en.');
    if (opts.versionCode !== undefined && opts.versionCode !== versionCode)
      throw new UploadError(`AAB'en har versionCode ${versionCode}, men --version-code var ${opts.versionCode}.`);
    if (existing.has(versionCode))
      throw new UploadError(duplicateMessage(versionCode, opts.track));

    const release = { versionCodes: [String(versionCode)], status: opts.status };
    if (opts.status === 'inProgress')
      release.userFraction = opts.rollout;
    if (releaseNotes)
      release.releaseNotes = releaseNotes;
    await client.call('edits.tracks.update', `${editUrl}/tracks/${opts.track}`, {
      method: 'PUT',
      json: { track: opts.track, releases: [release] },
    });
    log(`versionCode ${versionCode} sat på '${opts.track}' som ${opts.status}${release.userFraction ? ` (${Math.round(release.userFraction * 10000) / 100}%)` : ''}`);

    if (opts.dryRun) {
      await client.call('edits.validate', `${editUrl}:validate`, { method: 'POST' });
      log('DRY-RUN: editen er gyldig og blev ikke committet. Intet er udgivet.');
    }
    else {
      await client.call('edits.commit', `${editUrl}:commit`, { method: 'POST' });
      log(`Committet: ${opts.package} versionCode ${versionCode} ligger nu på '${opts.track}'.`);
    }
    if (opts.dryRun)
      await client.call('edits.delete', editUrl, { method: 'DELETE' }).catch(() => {});
    return { versionCode, committed: !opts.dryRun };
  }
  catch (error) {
    // Ryd op, så der ikke ligger en halv edit; en fejl her må ikke skjule den oprindelige.
    await client.call('edits.delete', editUrl, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
}

export async function main(argv, env, { fetchImpl = globalThis.fetch, out = console.log, err = console.error } = {}) {
  const redactor = createRedactor();
  const log = line => out(redactor.redact(`> ${line}`));
  try {
    // Bruges af release-android.sh før buildet: kun nøglefilen valideres, ingen kald til Google.
    if (argv.length === 1 && argv[0] === '--check-key') {
      loadServiceAccount(env.PLAY_SERVICE_ACCOUNT_JSON);
      return 0;
    }
    const opts = parseArgs(argv);
    const { key, looseMode } = loadServiceAccount(env.PLAY_SERVICE_ACCOUNT_JSON);
    redactor.add(key.private_key);
    if (looseMode)
      log('Advarsel: nøglefilen er læsbar for andre end dig. Brug chmod 600 (se docs/RELEASE.md).');
    await uploadToPlay(opts, { key, fetchImpl, log, redactor });
    return 0;
  }
  catch (error) {
    err(redactor.redact(`FEJL ${error instanceof UploadError ? error.message : `uventet fejl: ${error?.message ?? error}`}`));
    return 1;
  }
}

if (process.argv[1]?.endsWith('upload-play.mjs'))
  main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; });
