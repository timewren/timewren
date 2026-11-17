// Babel-plugin: omskriver navngivne imports fra lucide-react-native og date-fns
// til direkte filer, fordi Metro ikke tree-shaker. Ét `import { Clock } from
// 'lucide-react-native'` trak ellers alle ~3.700 ikoner med i bundlen, og
// `import { da } from 'date-fns/locale'` alle sprog.
//
//   import { Clock as C } from 'lucide-react-native' → import C from 'lucide-react-native/icons/clock'
//   import { format } from 'date-fns'                → import { format } from 'date-fns/format'
//   import { da } from 'date-fns/locale'             → import { da } from 'date-fns/locale/da'
//
// Kan et navn ikke slås op (fx `Icon` eller et date-fns-alias), røres hele
// import-sætningen ikke, så den virker som før.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** @typedef {import('@babel/types').ImportDeclaration} ImportDeclaration */
/** @typedef {{ source: string, imported: string }} Target */
/** @typedef {(name: string) => Target | null} Resolver */

/**
 * @param {string} name
 * @param {string[]} up
 */
function packageRoot(name, ...up) {
  return path.resolve(path.dirname(require.resolve(name)), ...up);
}

function lucideIcons() {
  // require.resolve giver dist/cjs/lucide-react-native.js; ESM-indekset har én linje pr. ikonfil.
  const index = fs.readFileSync(path.join(packageRoot('lucide-react-native', '../..'), 'dist/esm/lucide-react-native.mjs'), 'utf8');
  /** @type {Map<string, string>} */
  const icons = new Map();
  for (const [, names, file] of index.matchAll(/export \{([^}]+)\} from '\.\/icons\/([^']+)\.mjs'/g)) {
    for (const name of names.split(','))
      icons.set(name.trim().replace(/^default as /, ''), `lucide-react-native/icons/${file}`);
  }
  return icons;
}

/**
 * @param {string} subdir
 * @returns {Resolver} Slår et eksportnavn op som fil i date-fns (eller date-fns/<subdir>).
 */
function dateFnsResolver(subdir) {
  const dir = path.join(packageRoot('date-fns'), subdir);
  const prefix = subdir ? `date-fns/${subdir}` : 'date-fns';
  return name => fs.existsSync(path.join(dir, `${name}.js`)) ? { source: `${prefix}/${name}`, imported: name } : null;
}

/** @returns {Record<string, Resolver>} Resolver pr. importkilde. */
function createResolvers() {
  const icons = lucideIcons();
  return {
    'lucide-react-native': (name) => {
      const source = icons.get(name);
      return source ? { source, imported: 'default' } : null;
    },
    'date-fns': dateFnsResolver(''),
    'date-fns/locale': dateFnsResolver('locale'),
  };
}

/** @type {Record<string, Resolver> | undefined} */
let resolvers;

// Metro og jest cacher transformerede filer uden at kende pluginet. Nøglen indgår i
// deres cache (metro.config.js, jest.config.js), så en ændring her eller en ny
// version af lucide/date-fns ikke giver gamle omskrivninger.
const cacheKey = crypto.createHash('sha256')
  .update(fs.readFileSync(__filename))
  .update(fs.readFileSync(path.join(packageRoot('lucide-react-native', '../..'), 'package.json')))
  .update(fs.readFileSync(path.join(packageRoot('date-fns'), 'package.json')))
  .digest('hex')
  .slice(0, 12);

/** @param {{ types: typeof import('@babel/types') }} babel */
function directImports({ types: t }) {
  const byPackage = resolvers ??= createResolvers();

  /**
   * @param {ImportDeclaration} node
   * @returns {ImportDeclaration[] | null} Erstatningen, eller null hvis sætningen skal stå.
   */
  function rewrite(node) {
    const resolve = byPackage[node.source.value];
    if (!resolve || node.importKind === 'type')
      return null;
    const specifiers = node.specifiers.filter(s => t.isImportSpecifier(s));
    if (specifiers.length !== node.specifiers.length)
      return null;
    const valueSpecifiers = specifiers.filter(s => s.importKind !== 'type');
    const targets = valueSpecifiers.map(s => resolve(t.isIdentifier(s.imported) ? s.imported.name : s.imported.value));
    if (valueSpecifiers.length === 0 || targets.includes(null))
      return null;

    const imports = valueSpecifiers.map((s, i) => {
      const target = /** @type {Target} */ (targets[i]);
      const local = t.identifier(s.local.name);
      return t.importDeclaration(
        [target.imported === 'default' ? t.importDefaultSpecifier(local) : t.importSpecifier(local, t.identifier(target.imported))],
        t.stringLiteral(target.source),
      );
    });
    const typeSpecifiers = specifiers.filter(s => s.importKind === 'type');
    if (typeSpecifiers.length > 0)
      imports.push(t.importDeclaration(typeSpecifiers, node.source));
    return imports;
  }

  return {
    name: 'direct-imports',
    visitor: {
      // I Program-enter, så omskrivningen sker før TypeScript-pluginet fjerner type-imports.
      /** @param {import('@babel/core').NodePath<import('@babel/types').Program>} programPath */
      Program(programPath) {
        let changed = false;
        const body = programPath.node.body.flatMap((statement) => {
          const imports = t.isImportDeclaration(statement) ? rewrite(statement) : null;
          changed ||= imports !== null;
          return imports ?? [statement];
        });
        if (changed) {
          programPath.node.body = body;
          programPath.scope.crawl();
        }
      },
    },
  };
}

directImports.cacheKey = cacheKey;
module.exports = directImports;
