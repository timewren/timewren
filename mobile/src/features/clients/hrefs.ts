import type { Href } from 'expo-router';

/**
 * Links ind i tid-featuren (ejes af en anden agent). Param-navnene `clientId`
 * og `projectId` er aftalt, så registreringsformularen kan forudfylde.
 */
export function entriesNewHref(params: { clientId?: string | null; projectId?: string | null }): Href {
  const query = Object.entries(params)
    .filter((kv): kv is [string, string] => typeof kv[1] === 'string' && kv[1].length > 0)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return (query ? `/entries/new?${query}` : '/entries/new') as Href;
}

export function entryHref(id: string): Href {
  return `/entries/${id}` as Href;
}

export function clientHref(id: string): Href {
  return `/clients/${id}` as Href;
}

export function clientEditHref(id: string): Href {
  return `/clients/${id}/edit` as Href;
}

export function projectHref(id: string): Href {
  return `/projects/${id}` as Href;
}

export function projectEditHref(id: string): Href {
  return `/projects/${id}/edit` as Href;
}

export function projectNewHref(clientId?: string | null): Href {
  return (clientId ? `/projects/new?clientId=${clientId}` : '/projects/new') as Href;
}

export function prepaidHref(id: string): Href {
  return `/prepaid/${id}` as Href;
}

export function prepaidNewHref(clientId?: string | null): Href {
  return (clientId ? `/prepaid/new?clientId=${clientId}` : '/prepaid/new') as Href;
}
