import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createCacheStore } from './metro-cache-store';

describe('metro-cache-store', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'metro-cache-store-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const key = Buffer.from('0123456789abcdef', 'hex');

  it('does not store transforms uniwind marks with skipCache (global.css)', async () => {
    const store = createCacheStore(root);
    await store.set(key, { output: [{ data: { css: { skipCache: true } } }] });

    expect(await store.get(key)).toBeNull();
  });

  it('stores ordinary transforms', async () => {
    const store = createCacheStore(root);
    const value = { output: [{ data: { code: 'x' } }] };
    await store.set(key, value);

    expect(await store.get(key)).toEqual(value);
  });

  it('is the store metro.config.js uses, rooted in the project', () => {
    // Indlæses i en ren node-proces; jest-expos RN-miljø kan ikke indlæse Metros config.
    const projectRoot = path.join(__dirname, '..');
    const out = execFileSync(process.execPath, ['-e', `
      const { cacheStores } = require('./metro.config');
      console.log(JSON.stringify(cacheStores.map(s => ({ name: s.constructor.name, root: s.root }))));
    `], { cwd: projectRoot, encoding: 'utf8' });

    expect(JSON.parse(out.trim().split('\n').pop()!)).toEqual([
      { name: 'UniwindSafeFileStore', root: path.join(projectRoot, 'node_modules/.cache/metro') },
    ]);
  });
});
