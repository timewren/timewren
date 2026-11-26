import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { resources } from '../src/lib/i18n/resources';

const app = join(__dirname, '../src/app');
const files = readdirSync(app, { encoding: 'utf8', recursive: true }).filter(file => file.endsWith('.tsx'));

function navigatorFor(file: string) {
  let directory = dirname(file);
  while (!existsSync(join(app, directory, '_layout.tsx'))) {
    directory = dirname(directory);
  }
  return directory;
}

function translation(locale: unknown, key: string) {
  return key.split('.').reduce<unknown>((value, segment) => {
    return (value as Record<string, unknown> | undefined)?.[segment];
  }, locale);
}

// Brandvariablerne sættes for alle tekster (src/lib/i18n/brand-variables.ts); andre {{…}} får ingen værdi i en titel.
const BRAND_VARIABLES = /\{\{(?:appName|site|webHost)\}\}/g;

const routes = files
  .filter(file => !file.startsWith('+'))
  .map(file => file.split(sep).join('/').replace(/(?:\/_layout)?\.tsx$/, ''))
  .filter(route => route !== '_layout');

it('har en oversat navigationsoverskrift for alle appens ruter', () => {
  const problems = [];

  for (const route of routes) {
    const directory = navigatorFor(route);
    const layout = readFileSync(join(app, directory, '_layout.tsx'), 'utf8');
    const screenName = relative(directory, route).split(sep).join('/');
    const screen = Array.from(layout.matchAll(/<(?:Stack|Tabs)\.Screen\b[^>]*>/g))
      .find(([tag]) => tag.includes(`name="${screenName}"`));
    const key = screen?.[0].match(/title: translate\('([^']+)'\)/)?.[1];

    if (!key || !Object.values(resources).every(({ translation: locale }) => {
      const title = translation(locale, key);
      return typeof title === 'string' && title.trim() && !title.replace(BRAND_VARIABLES, '').includes('{{');
    })) {
      problems.push(route);
    }
  }

  expect(problems).toEqual([]);
});
