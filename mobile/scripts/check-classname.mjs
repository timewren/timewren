#!/usr/bin/env node
// @ts-nocheck — Node-script uden typer; testes via scripts/check-classname.test.ts
/**
 * Finder JSX-tags der får `className`, men som uniwind IKKE styler:
 * hverken RN-kernekomponenter, lokalt definerede komponenter eller vores egne
 * komponenter under `src/`. Tredjeparts-komponenter (reanimated, moti, expo-router
 * `Link`, gorhom, svg …) skal wrappes med `withUniwind` eller bruge `style`.
 *
 * Kør: `pnpm check:classname` — exit 1 ved fund.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

/** RN-kernekomponenter hvor uniwind understøtter className direkte. */
export const RN_CORE = new Set([
  'View',
  'Text',
  'Pressable',
  'ScrollView',
  'TextInput',
  'Image',
  'ImageBackground',
  'FlatList',
  'SectionList',
  'VirtualizedList',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'KeyboardAvoidingView',
  'Switch',
  'Modal',
  'RefreshControl',
  'ActivityIndicator',
  'SafeAreaView',
]);

const IMPORT_RE = /import\s+(?:type\s+)?([^'";]+?)\s+from\s+['"]([^'"]+)['"]/g;
const NAMED_RE = /\{([^}]*)\}/;
const NAMESPACE_RE = /^\*\s+as\s+/;
const TYPE_PREFIX_RE = /^type\s+/;
const AS_RE = /\s+as\s+/;
const LOCAL_DEF_RE = /(?:function|const|let|class)\s+([A-Z]\w*)/g;
const TAG_RE = /<([A-Z][\w.]*)(?=[\s/>])/g;
const CLASSNAME_RE = /(?:^|\s)className=/;
const TSX_RE = /\.tsx$/;
const TEST_RE = /\.test\.tsx$/;
const SELF_RE = /check-classname\.mjs$/;

/** Kilder der regnes som "vores egen kode" (antages at forwarde className korrekt). */
function isOwnSource(source) {
  return source.startsWith('~/') || source.startsWith('./') || source.startsWith('../');
}

/** Parser import-erklæringer → Map<lokalt navn, { source, imported }>. */
export function parseImports(code) {
  const map = new Map();
  const re = new RegExp(IMPORT_RE.source, 'g');
  let m;
  while ((m = re.exec(code))) {
    const [, clause, source] = m;
    const named = clause.match(NAMED_RE);
    const outside = clause.replace(NAMED_RE, '');
    for (const part of outside.split(',')) {
      const name = part.replace(NAMESPACE_RE, '').trim();
      if (name)
        map.set(name, { source, imported: name });
    }
    if (named) {
      for (const part of named[1].split(',')) {
        const spec = part.trim().replace(TYPE_PREFIX_RE, '');
        if (!spec)
          continue;
        const [imported, local = imported] = spec.split(AS_RE).map(s => s.trim());
        map.set(local, { source, imported });
      }
    }
  }
  return map;
}

/** Navne der er defineret lokalt i filen (function/const/let/class). */
function localDefinitions(code) {
  const names = new Set();
  const re = new RegExp(LOCAL_DEF_RE.source, 'g');
  let m;
  while ((m = re.exec(code)))
    names.add(m[1]);
  return names;
}

/** Scanner frem til tag'ets afsluttende `>` (ignorerer `>` i strenge og {}-udtryk). */
function findTagEnd(code, start) {
  let i = start;
  let depth = 0;
  let quote = null;
  while (i < code.length) {
    const ch = code[i];
    if (quote) {
      if (ch === quote)
        quote = null;
    }
    else if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
    }
    else if (ch === '{') {
      depth++;
    }
    else if (ch === '}') {
      depth--;
    }
    else if (ch === '>' && depth === 0) {
      break;
    }
    i++;
  }
  return i;
}

/** Fjerner {}-udtryk og strenge, så kun tag'ets egne attributnavne står tilbage. */
export function topLevelAttrs(attrs) {
  let out = '';
  let depth = 0;
  let quote = null;
  for (const ch of attrs) {
    if (quote) {
      if (ch === quote)
        quote = null;
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      continue;
    }
    if (depth === 0)
      out += ch;
  }
  return out;
}

/**
 * Finder åbne JSX-tags med stort begyndelsesbogstav og returnerer
 * { name, attrs, line }. Håndterer flerlinje-tags og `>` inde i {}-udtryk.
 */
export function findJsxTags(code) {
  const tags = [];
  const re = new RegExp(TAG_RE.source, 'g');
  let m;
  while ((m = re.exec(code))) {
    const attrStart = m.index + m[0].length;
    const end = findTagEnd(code, attrStart);
    const attrs = code.slice(attrStart, end);
    const line = code.slice(0, m.index).split('\n').length;
    tags.push({ name: m[1], attrs, line });
  }
  return tags;
}

/** Returnerer liste af fund for én fil ({ line, name, source }). */
export function checkFile(code) {
  const imports = parseImports(code);
  const locals = localDefinitions(code);
  const findings = [];
  for (const tag of findJsxTags(code)) {
    if (!CLASSNAME_RE.test(topLevelAttrs(tag.attrs)))
      continue;
    const base = tag.name.split('.')[0];
    if (locals.has(base))
      continue;
    const imp = imports.get(base);
    if (!imp)
      continue; // globalt/ukendt — lad TS/ESLint fange det
    const { source, imported } = imp;
    if (isOwnSource(source))
      continue;
    if (source === 'react-native' && RN_CORE.has(imported))
      continue;
    findings.push({ line: tag.line, name: tag.name, source });
  }
  return findings;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory())
      walk(full, out);
    else if (TSX_RE.test(entry) && !TEST_RE.test(entry))
      out.push(full);
  }
  return out;
}

function main() {
  const root = process.cwd();
  const files = walk(join(root, 'src'));
  let total = 0;
  for (const file of files) {
    const findings = checkFile(readFileSync(file, 'utf8'));
    for (const f of findings) {
      total++;
      console.log(`${relative(root, file)}:${f.line}  <${f.name}> fra '${f.source}' får className — wrap med withUniwind eller brug style`);
    }
  }
  if (total > 0) {
    console.error(`\n${total} className-fund på tredjeparts-komponenter.`);
    process.exit(1);
  }
  console.log(`check:classname OK (${files.length} filer)`);
}

if (process.argv[1] && SELF_RE.test(process.argv[1]))
  main();
