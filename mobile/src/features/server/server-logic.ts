function isLocal(host: string): boolean {
  if (host === 'localhost' || host === '[::1]')
    return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  return parts[0] === 127 || parts[0] === 10
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

export function normalizeServerUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
      throw new Error('url');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname)))
      throw new Error('url');
    return url.origin;
  }
  catch {
    throw new Error('url');
  }
}

export async function checkServer(input: string, fetcher: typeof fetch = fetch): Promise<string> {
  const origin = normalizeServerUrl(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(`${origin}/api/health`, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error('health');
    const data = await response.json();
    if (!['timetrack', 'timewren'].includes(data.service) || data.status !== 'healthy'
      || data.checks?.database?.status !== 'ok' || data.checks?.auth?.status !== 'ok') {
      throw new Error('health');
    }
    return origin;
  }
  catch {
    throw new Error('health');
  }
  finally {
    clearTimeout(timeout);
  }
}
