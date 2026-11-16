import { deriveCapabilities, isDefaultOrgName } from './use-capabilities';

describe('deriveCapabilities', () => {
  it('uden org: freelance-bundt, ingen enterprise, solo', () => {
    const c = deriveCapabilities(undefined);
    expect(c.tier).toBe('solo');
    expect(c.hasOrg).toBe(false);
    expect(c.isEnabled('klippekort')).toBe(true);
    expect(c.isEnabled('enterprise')).toBe(false);
    expect(c.isAdmin).toBe(false);
  });

  it('enterprise-org med manager-rolle', () => {
    const c = deriveCapabilities({
      tier: 'solo',
      role: 'manager',
      org: { id: 'o1', name: 'Acme', slug: 'acme' },
      modules: {
        enterprise: { available: true, enabled: true },
        projects: { available: true, enabled: true },
        clients: { available: true, enabled: false },
      },
    } as never);
    expect(c.tier).toBe('enterprise');
    expect(c.isEnterprise).toBe(true);
    expect(c.isManager).toBe(true);
    expect(c.isAdmin).toBe(false);
    expect(c.isEnabled('clients')).toBe(false);
    expect(c.isEnabled('projects')).toBe(true);
    expect(c.orgName).toBe('Acme');
  });

  it('hr er læse-rolle', () => {
    const c = deriveCapabilities({
      tier: 'enterprise',
      role: 'hr',
      org: { id: 'o1', name: 'X', slug: 'x' },
      modules: { enterprise: { available: true, enabled: true } },
    } as never);
    expect(c.isHr).toBe(true);
    expect(c.isManager).toBe(false);
  });
});

describe('isDefaultOrgName', () => {
  it('genkender web-standardnavnet uanset store/små bogstaver', () => {
    expect(isDefaultOrgName('Mads\'s workspace')).toBe(true);
    expect(isDefaultOrgName('MADS\'S WORKSPACE')).toBe(true);
  });
  it('lader rigtige org-navne passere', () => {
    expect(isDefaultOrgName('Acme Nord')).toBe(false);
    expect(isDefaultOrgName('Workspace ApS')).toBe(false);
    expect(isDefaultOrgName(null)).toBe(false);
    expect(isDefaultOrgName('')).toBe(false);
  });
});
