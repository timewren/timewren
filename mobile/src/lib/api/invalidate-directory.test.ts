import type { DirectoryUtils, NameCarryingRouter } from './invalidate-directory';
import { invalidateDirectory, NAME_CARRYING_ROUTERS } from './invalidate-directory';

function fakeUtils() {
  const calls: NameCarryingRouter[] = [];
  const utils = Object.fromEntries(
    NAME_CARRYING_ROUTERS.map(router => [router, { invalidate: () => calls.push(router) }]),
  ) as DirectoryUtils;
  return { calls, utils };
}

/**
 * Målingen 1/10 fandt at en omnavngivning kun ryddede `clients`/`projects`,
 * mens navnet ligger indskrevet i svaret fra en halv snes andre procedures
 * (`time.list` medtager `project.client.name`, `invoices.list` kundenavnet,
 * `logbook.dayDetail` dem begge i hver pause, `search.global` dem som
 * denormaliserede strenge …). Resultatet var det gamle navn på tidsskærmen,
 * klippekort, fakturaer, opgaver, skabeloner, logbog, rapporter og søgning i op
 * til fem minutter.
 */
describe('invalidateDirectory', () => {
  it('rydder hver procedure der kan bære et kunde- eller projektnavn', () => {
    const { calls, utils } = fakeUtils();

    invalidateDirectory(utils);

    expect(calls.sort()).toEqual([...NAME_CARRYING_ROUTERS].sort());
  });

  it('dækker de procedures målingen læste navnet i koden', () => {
    // Bevis mod den gamle kode: listen var `clients` + `projects` (+ `time` og
    // `prepaid` via `useInvalidateEntries`, som ingen navnemutation kalder).
    expect(NAME_CARRYING_ROUTERS).toEqual(expect.arrayContaining([
      'clients',
      'projects',
      'time',
      'prepaid',
      'invoices',
      'tasks',
      'team',
      'logbook',
      'reports',
      'search',
      'timerTemplates',
      'enterprise',
    ]));
  });
});
