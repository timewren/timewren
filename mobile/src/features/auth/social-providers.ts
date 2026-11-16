import type { Provider } from './use-login';
import { useQuery } from '@tanstack/react-query';
import { getApiUrl } from '~/features/server/server-config';

/** Svaret fra web's `/api/auth/providers` (de felter appen bruger). */
export type ProviderFlags = Partial<Record<'google' | 'github' | 'microsoft', boolean>>;

const ALL: Array<[Provider, string]> = [
  ['google', 'Google'],
  ['microsoft', 'Microsoft'],
  ['github', 'GitHub'],
];

/**
 * De sociale login-knapper, appen viser (Apple har sin egen knap). En udbyder, som serveren
 * ikke har konfigureret, giver en knap der kun fejler, og det er en afvisning i App Review
 * (2.1). Microsoft vises derfor først, når serveren har sagt ja; Google og GitHub vises også,
 * mens svaret hentes eller ikke kan hentes, medmindre serveren har sagt nej.
 */
export function visibleSocialProviders(flags: ProviderFlags | null | undefined): Array<[Provider, string]> {
  return ALL.filter(([id]) => {
    if (id === 'microsoft')
      return flags?.microsoft === true;
    const flag = flags?.[id as 'google' | 'github'];
    return flag !== false;
  });
}

async function fetchProviderFlags(): Promise<ProviderFlags> {
  const res = await fetch(`${getApiUrl()}/api/auth/providers`);
  if (!res.ok)
    throw new Error(`providers ${res.status}`);
  return res.json() as Promise<ProviderFlags>;
}

export function useSocialProviders(): Array<[Provider, string]> {
  const flags = useQuery({ queryKey: ['auth', 'providers'], queryFn: fetchProviderFlags, staleTime: 60 * 60 * 1000, retry: 1 });
  return visibleSocialProviders(flags.data);
}
