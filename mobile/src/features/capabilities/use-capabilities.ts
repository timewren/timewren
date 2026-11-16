import type { RouterOutputs } from '~/api/app-router';
import * as React from 'react';
import { trpc } from '~/lib/api/trpc';

export type Capabilities = RouterOutputs['mobile']['getCapabilities'];
export type Tier = 'solo' | 'team' | 'enterprise';

/** Modul-nøgler som i web's `src/lib/modules/constants.ts`. */
export type ModuleKey
  = | 'projects'
    | 'reports'
    | 'clients'
    | 'invoicing'
    | 'klippekort'
    | 'integrations'
    | 'tasks'
    | 'enterprise'
    | 'public_api'
    | 'browser_extension';

/** Uden org gælder freelance-bundtet (alt undtagen enterprise). */
const FREELANCE_MODULES: readonly ModuleKey[] = [
  'projects',
  'reports',
  'clients',
  'invoicing',
  'klippekort',
  'integrations',
  'tasks',
  'public_api',
  'browser_extension',
];

/** Web giver nye orgs navnet "<navn>'s workspace" — det er støj i UI'et og skjules. */
const DEFAULT_ORG_NAME = /'s workspace$/i;
export function isDefaultOrgName(name: string | null | undefined): boolean {
  return !!name && DEFAULT_ORG_NAME.test(name);
}

const ADMIN_ROLES = new Set(['owner', 'admin']);
const MANAGER_ROLES = new Set(['owner', 'admin', 'manager']);

export type CapabilityHelpers = {
  tier: Tier;
  role: string;
  orgName: string | null;
  /** Aktiv orgs id — null i solo. Bruges til at org-scope offline-køen. */
  orgId: string | null;
  hasOrg: boolean;
  isEnabled: (key: ModuleKey) => boolean;
  /** owner/admin */
  isAdmin: boolean;
  /** owner/admin/manager — kan godkende og se team */
  isManager: boolean;
  /** hr er læse-rolle: ser alt, godkender intet */
  isHr: boolean;
  isEnterprise: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

export function deriveCapabilities(data: Capabilities | undefined): Omit<CapabilityHelpers, 'isLoading' | 'isError' | 'refetch'> {
  const role = data?.role ?? 'member';
  const modules = data?.modules ?? {};
  const hasOrg = !!data?.org;
  const enterprise = modules.enterprise?.enabled === true;
  const isEnabled = (key: ModuleKey) => {
    if (!hasOrg)
      return FREELANCE_MODULES.includes(key);
    return modules[key]?.enabled === true;
  };
  const tier: Tier = enterprise ? 'enterprise' : ((data?.tier as Tier | undefined) ?? 'solo');
  return {
    tier,
    role,
    orgName: data?.org?.name ?? null,
    orgId: data?.org?.id ?? null,
    hasOrg,
    isEnabled,
    isAdmin: ADMIN_ROLES.has(role),
    isManager: MANAGER_ROLES.has(role),
    isHr: role === 'hr',
    isEnterprise: enterprise,
  };
}

export function useCapabilities(): CapabilityHelpers {
  // Destructured, ikke hele `query`: query-objektet får ny identitet hvert
  // render, så som afhængighed ville memoen aldrig holde (exhaustive-deps-fundet).
  const { data, isLoading, isError, refetch } = trpc.mobile.getCapabilities.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  return React.useMemo(
    () => ({
      ...deriveCapabilities(data),
      isLoading,
      isError,
      refetch: () => void refetch(),
    }),
    [data, isLoading, isError, refetch],
  );
}
