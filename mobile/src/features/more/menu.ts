import type { CapabilityHelpers } from '~/features/capabilities/use-capabilities';

/** Det udsnit af capabilities menuen afhænger af — gør logikken testbar uden hooks. */
export type MenuCaps = Pick<CapabilityHelpers, 'isEnabled' | 'isEnterprise' | 'isManager' | 'isAdmin' | 'hasOrg'>;

export type MenuItem = {
  key: string;
  /** i18n-nøgle under `more.` */
  labelKey: string;
  href: string;
};

export type MenuSection = {
  key: 'work' | 'enterprise' | 'account';
  items: MenuItem[];
};

/**
 * Mere-fanens menu, filtreret efter moduler/tier/rolle.
 * Rækkefølge og synlighed er bevidst deterministisk så den kan testes.
 */
export function buildMoreMenu(caps: MenuCaps, opts: { callLogging?: boolean } = {}): MenuSection[] {
  // Arbejde styres af moduler — også i enterprise (hvor Kunder-fanen er skjult,
  // så kunder nås herfra).
  const work: MenuItem[] = [];
  // Ugens afslutning ligger først: det er den eneste time-registrering uden et
  // modul-gate, så den skal ikke forsvinde fordi et modul er slået fra.
  work.push({ key: 'week_review', labelKey: 'week_review', href: '/week-review' });
  // Logbogen er også protectedProcedure — den skal overleve slåede moduler.
  work.push({ key: 'logbook', labelKey: 'logbook', href: '/logbook' });
  // "Log opkald" er en lokal indstilling (slået fra som standard) — kun synlig når den er slået til.
  if (opts.callLogging)
    work.push({ key: 'log_call', labelKey: 'log_call', href: '/log-opkald' });
  if (caps.isEnterprise && caps.isEnabled('clients'))
    work.push({ key: 'clients', labelKey: 'clients', href: '/clients' });
  if (caps.isEnabled('projects')) {
    work.push({ key: 'projects', labelKey: 'projects', href: '/projects' });
    // Samme modul-gate: projektsundhed læser de samme projekter som listen.
    work.push({ key: 'project_health', labelKey: 'project_health', href: '/project-health' });
  }
  if (caps.isEnabled('tasks'))
    work.push({ key: 'tasks', labelKey: 'tasks', href: '/tasks' });
  if (caps.isEnabled('klippekort'))
    work.push({ key: 'prepaid', labelKey: 'prepaid', href: '/prepaid' });
  if (caps.isEnabled('invoicing')) {
    work.push({ key: 'invoices', labelKey: 'invoices', href: '/invoices' });
    // Moms og cashflow læser de samme fakturaer som faktura-listen, så de følger
    // samme modul-gate — ellers ville de være to tomme skærme.
    work.push({ key: 'cashflow', labelKey: 'cashflow', href: '/cashflow' });
    // Gentagne registreringer er `guardedRouter('invoicing', …)` i web, så de
    // samme to ting: skærmen er tom uden modulet, og den kalder `invoicing`-ruter.
    work.push({ key: 'recurring', labelKey: 'recurring', href: '/recurring' });
  }
  if (caps.isEnabled('reports'))
    work.push({ key: 'reports', labelKey: 'reports', href: '/reports' });

  // Spildtid er `logbook.wasteLog` = orgAdminProcedure: et lederoverblik over
  // kollegers pauser. Uden adgang ville skærmen bare give 403, så vejen skjules.
  if (caps.hasOrg && caps.isAdmin)
    work.push({ key: 'waste', labelKey: 'waste', href: '/waste' });

  const enterprise: MenuItem[] = [];
  if (caps.isEnterprise) {
    enterprise.push(
      { key: 'timesheet', labelKey: 'timesheet', href: '/enterprise/timesheet' },
      { key: 'absence', labelKey: 'absence', href: '/absence' },
      { key: 'flex', labelKey: 'flex', href: '/enterprise/flex' },
      { key: 'overtime', labelKey: 'overtime', href: '/enterprise/overtime' },
      { key: 'inbox', labelKey: 'inbox', href: '/enterprise/inbox' },
    );
    if (caps.isManager)
      enterprise.push({ key: 'team', labelKey: 'team', href: '/enterprise/team' });
  }

  const account: MenuItem[] = [
    { key: 'profile', labelKey: 'profile', href: '/settings/profile' },
    // Virksomhedsprofilen er `orgAdminProcedure` i web, så en almindelig
    // org-medarbejder får 403 — skjul vejen i stedet for at vise en fejl.
    ...(!caps.hasOrg || caps.isAdmin
      ? [{ key: 'company', labelKey: 'company', href: '/settings/company' } as MenuItem]
      : []),
    { key: 'notifications', labelKey: 'notifications', href: '/settings/notifications' },
    { key: 'calls', labelKey: 'calls', href: '/settings/calls' },
    { key: 'security', labelKey: 'security', href: '/settings/security' },
    { key: 'subscription', labelKey: 'subscription', href: '/settings/subscription' },
    { key: 'organization', labelKey: 'organization', href: '/settings/organization' },
    { key: 'appearance', labelKey: 'appearance', href: '/settings/appearance' },
    { key: 'about', labelKey: 'about', href: '/settings/about' },
    { key: 'feedback', labelKey: 'feedback', href: '/settings/feedback' },
  ];

  const sections: MenuSection[] = [];
  // Arbejde er aldrig tomt: ugens afslutning ligger der uden et modul-gate.
  sections.push({ key: 'work', items: work });
  if (enterprise.length > 0)
    sections.push({ key: 'enterprise', items: enterprise });
  sections.push({ key: 'account', items: account });
  return sections;
}
