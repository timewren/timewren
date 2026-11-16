import { resources } from './resources';

type Catalog = Record<string, unknown>;

function flatten(obj: Catalog, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object')
      Object.assign(out, flatten(value as Catalog, path));
    else out[path] = String(value);
  }
  return out;
}

const PLACEHOLDER_RE = /\{\{\s*[^}\s]+\s*\}\}/g;
const placeholders = (text: string) => [...text.matchAll(PLACEHOLDER_RE)].map(m => m[0].replace(/\s+/g, '')).sort();

const languages = Object.keys(resources) as (keyof typeof resources)[];
const catalogs = Object.fromEntries(languages.map(l => [l, flatten(resources[l].translation)]));
const reference = catalogs.da!;

describe('translation catalogs', () => {
  it('registers da, en, de and es', () => {
    expect([...languages].sort()).toEqual(['da', 'de', 'en', 'es']);
  });

  it.each(languages.filter(l => l !== 'da'))('%s has exactly the same keys as da', (lang) => {
    const keys = Object.keys(catalogs[lang]!);
    expect(keys.filter(k => !(k in reference))).toEqual([]);
    expect(Object.keys(reference).filter(k => !keys.includes(k))).toEqual([]);
  });

  it.each(languages.filter(l => l !== 'da'))('%s keeps the same {{placeholders}} as da', (lang) => {
    const mismatches = Object.entries(reference)
      .filter(([key, text]) => JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(catalogs[lang]![key] ?? '')))
      .map(([key]) => key);
    expect(mismatches).toEqual([]);
  });

  it.each(languages)('%s has no empty values', (lang) => {
    expect(Object.entries(catalogs[lang]!).filter(([, text]) => text.trim() === '').map(([k]) => k)).toEqual([]);
  });

  it.each(['de', 'es'] as const)('%s has the one/other plural forms that da has', (lang) => {
    const pluralKeys = Object.keys(reference).filter(k => /_(?:one|other)$/.test(k));
    expect(pluralKeys.length).toBeGreaterThan(0);
    expect(pluralKeys.filter(k => !(k in catalogs[lang]!))).toEqual([]);
  });
});
