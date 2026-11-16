import type { MenuCaps } from './menu';
import type { ModuleKey } from '~/features/capabilities/use-capabilities';
import da from '~/translations/da.json';
import en from '~/translations/en.json';
import { buildMoreMenu } from './menu';

function caps(overrides: Partial<MenuCaps> & { modules?: ModuleKey[] } = {}): MenuCaps {
  const modules = new Set<ModuleKey>(overrides.modules ?? ['invoicing', 'tasks', 'klippekort', 'reports', 'projects', 'clients']);
  return {
    isEnabled: key => modules.has(key),
    isEnterprise: overrides.isEnterprise ?? false,
    isManager: overrides.isManager ?? false,
    isAdmin: overrides.isAdmin ?? false,
    hasOrg: overrides.hasOrg ?? false,
  };
}

function keys(sections: ReturnType<typeof buildMoreMenu>, section: string) {
  return sections.find(s => s.key === section)?.items.map(i => i.key) ?? [];
}

describe('buildMoreMenu', () => {
  it('freelancer: fuldt arbejdsafsnit, intet enterprise, altid konto', () => {
    const menu = buildMoreMenu(caps());
    expect(menu.map(s => s.key)).toEqual(['work', 'account']);
    expect(keys(menu, 'work')).toEqual(['week_review', 'logbook', 'projects', 'project_health', 'tasks', 'prepaid', 'invoices', 'cashflow', 'recurring', 'reports']);
    expect(keys(menu, 'account')).toContain('profile');
    expect(keys(menu, 'account').at(-1)).toBe('feedback');
  });

  it('skjuler moduler der ikke er slået til', () => {
    const menu = buildMoreMenu(caps({ modules: ['projects'] }));
    expect(keys(menu, 'work')).toEqual(['week_review', 'logbook', 'projects', 'project_health']);
  });

  it('ugens afslutning og logbog er ikke modul-gated — de er de eneste i sit afsnit', () => {
    // Både `time.getWeekReview` og `logbook.weekOverview` er
    // protectedProcedure, så de virker for alle. Derfor er arbejdsafsnittet
    // aldrig tomt, og det skal testen sige til.
    const menu = buildMoreMenu(caps({ modules: [] }));
    expect(menu.map(s => s.key)).toEqual(['work', 'account']);
    expect(keys(menu, 'work')).toEqual(['week_review', 'logbook']);
  });

  it('spildtid kræver org + admin — `logbook.wasteLog` er orgAdminProcedure', () => {
    expect(keys(buildMoreMenu(caps({ hasOrg: true, isAdmin: true })), 'work')).toContain('waste');
    // Solo (ingen org) og menigt medlem ville begge få en rå 403.
    expect(keys(buildMoreMenu(caps({ isAdmin: true })), 'work')).not.toContain('waste');
    expect(keys(buildMoreMenu(caps({ hasOrg: true, isManager: true })), 'work')).not.toContain('waste');
    expect(keys(buildMoreMenu(caps({ hasOrg: true })), 'work')).not.toContain('waste');
  });

  it('enterprise-medarbejder: enterprise-afsnit uden team, arbejde efter moduler inkl. kunder', () => {
    const menu = buildMoreMenu(caps({ isEnterprise: true, hasOrg: true }));
    expect(menu.map(s => s.key)).toEqual(['work', 'enterprise', 'account']);
    expect(keys(menu, 'work')[0]).toBe('week_review');
    expect(keys(menu, 'work')[1]).toBe('logbook');
    expect(keys(menu, 'work')[2]).toBe('clients');
    expect(keys(menu, 'enterprise')).toEqual(['timesheet', 'absence', 'flex', 'overtime', 'inbox']);
  });

  it('enterprise uden arbejdsmoduler har kun ugens afslutning i arbejdsafsnittet', () => {
    const menu = buildMoreMenu(caps({ isEnterprise: true, hasOrg: true, modules: ['enterprise'] }));
    expect(keys(menu, 'work')).toEqual(['week_review', 'logbook']);
  });

  it('enterprise-leder får team-punktet', () => {
    const menu = buildMoreMenu(caps({ isEnterprise: true, hasOrg: true, isManager: true }));
    expect(keys(menu, 'enterprise')).toContain('team');
  });

  it('moms og cashflow følger fakturering — uden fakturaer er skærmen tom', () => {
    expect(keys(buildMoreMenu(caps()), 'work')).toContain('cashflow');
    expect(keys(buildMoreMenu(caps({ modules: ['projects'] })), 'work')).not.toContain('cashflow');
  });

  it('gentagne registreringer følger fakturering — `recurring` er guardedRouter("invoicing")', () => {
    expect(keys(buildMoreMenu(caps()), 'work')).toContain('recurring');
    expect(keys(buildMoreMenu(caps({ modules: ['projects'] })), 'work')).not.toContain('recurring');
  });

  it('alle links peger på absolutte ruter', () => {
    const menu = buildMoreMenu(caps({ isEnterprise: true, isManager: true }));
    for (const section of menu) {
      for (const item of section.items)
        expect(item.href.startsWith('/')).toBe(true);
    }
  });

  it('virksomhedsprofilen ligger lige under profil for solo og for org-admin', () => {
    expect(keys(buildMoreMenu(caps()), 'account').slice(0, 2)).toEqual(['profile', 'company']);
    expect(keys(buildMoreMenu(caps({ hasOrg: true, isAdmin: true })), 'account').slice(0, 2)).toEqual(['profile', 'company']);
  });

  it('org-medlem uden admin-rollen får ikke virksomhedsprofilen (web ville give 403)', () => {
    expect(keys(buildMoreMenu(caps({ hasOrg: true, isManager: true })), 'account')).not.toContain('company');
  });
  it('"Log opkald" vises kun når den lokale indstilling er slået til; Opkald-indstillingen altid', () => {
    expect(keys(buildMoreMenu(caps()), 'work')).not.toContain('log_call');
    expect(keys(buildMoreMenu(caps(), { callLogging: true }), 'work')).toContain('log_call');
    expect(keys(buildMoreMenu(caps()), 'account')).toContain('calls');
  });
});

describe('menuens tekster', () => {
  it('har en oversættelse til hvert punkt på dansk og engelsk (ellers vises nøglen rå)', () => {
    const all = ['invoicing', 'tasks', 'klippekort', 'reports', 'projects', 'clients', 'enterprise', 'absence', 'flex', 'overtime', 'timesheet'] as ModuleKey[];
    const menu = buildMoreMenu(caps({ modules: all, isEnterprise: true, isManager: true, isAdmin: true, hasOrg: true }), { callLogging: true });
    const labels = menu.flatMap(s => s.items.map(i => i.labelKey));
    expect(labels.length).toBeGreaterThan(10);
    const missing = labels.filter(k => !(k in da.more) || !(k in en.more));
    expect(missing).toEqual([]);
  });
});
