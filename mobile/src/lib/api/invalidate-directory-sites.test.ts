import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NAME_CARRYING_ROUTERS } from './invalidate-directory';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** `trpc.clients.update.useMutation` → `clients.update`. */
function mutationNames(source: string): string[] {
  return [...source.matchAll(/trpc\.([a-zA-Z]+)\.([a-zA-Z]+)\.useMutation/g)].map(m => `${m[1]}.${m[2]}`);
}

/**
 * Mutationer der ændrer et navn. Listen er navnet på den *ændrede ting*, ikke
 * på den kaldte procedure: det er disse mutationer der gør det gamle navn synligt
 * andre steder, fordi serveren har skrevet navnet ind i andre payloads.
 */
const NAVNEMUTATIONER = [
  'clients.create',
  'clients.update',
  'clients.archive',
  'clients.unarchive',
  'projects.create',
  'projects.update',
  'projects.updateStatus',
];

describe('navnemutationer rydder hele navne-kredsen', () => {
  const rodf = join(__dirname, '..', '..');
  const filer = sourceFiles(rodf);

  // Bevis mod den gamle kode: `projects.updateStatus` i `StatusCard`
  // (`project-detail-screen.tsx:132`) invaliderede kun `projects`, så en
  // statusændring efterlod `clients`-cachen med det gamle navn.
  it('finder alle syv navnemutationer i koden — porten skal ikke dømme det tomme', () => {
    const fundne = new Set(filer.flatMap(f => mutationNames(readFileSync(f, 'utf8'))));
    const mangler = NAVNEMUTATIONER.filter(m => !fundne.has(m));
    expect(mangler).toEqual([]);
  });

  it('kalder invalidateDirectory i hver fil der muterer et navn', () => {
    const domte: string[] = [];
    for (const fil of filer) {
      const kilde = readFileSync(fil, 'utf8');
      if (!NAVNEMUTATIONER.some(m => mutationNames(kilde).includes(m)))
        continue;
      if (kilde.includes('useInvalidateDirectory'))
        continue;
      domte.push(`${fil.replace(`${rodf}/`, '')}: ${mutationNames(kilde).filter(m => NAVNEMUTATIONER.includes(m)).join(', ')}`);
    }
    expect(domte).toEqual([]);
  });

  it('lader ikke en fil invalide kun sin egen router ved siden af', () => {
    // Den del af fejlen der så ud som en mindre fejl: `client-detail-screen`
    // skrev `utils.clients.invalidate()` *og* `utils.projects.invalidate()`,
    // altså to håndskrevne linjer der ligner en færdig løsning.
    const delvise: string[] = [];
    for (const fil of filer) {
      const kilde = readFileSync(fil, 'utf8');
      const harNavneKreds = kilde.includes('useInvalidateDirectory');
      const delvis = [...kilde.matchAll(/utils\.([a-zA-Z]+)\.invalidate\(\)/g)]
        .map(m => m[1])
        .filter(router => NAME_CARRYING_ROUTERS.includes(router as never));
      if (harNavneKreds && delvis.length > 0)
        delvise.push(`${fil.replace(`${rodf}/`, '')}: ${[...new Set(delvis)].join(', ')}`);
    }
    expect(delvise).toEqual([]);
  });
});
