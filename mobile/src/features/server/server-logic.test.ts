import { checkServer, normalizeServerUrl, webHostFromUrl } from './server-logic';

describe('server URL', () => {
  it.each(['https://example.org', 'http://localhost:3000', 'http://192.168.1.4:3000', 'http://10.0.0.1', 'http://172.16.0.1', 'http://127.0.0.1'])('accepts %s', (url) => {
    expect(normalizeServerUrl(`${url}/`)).toBe(url);
  });
  it.each(['http://example.org', 'ftp://example.org', 'https://user:pass@example.org', 'https://example.org/path', 'https://example.org?x=1', 'https://example.org#x', 'example.org', 'http://172.32.0.1', 'http://192.169.1.1'])('rejects %s', (url) => {
    expect(() => normalizeServerUrl(url)).toThrow('url');
  });
});

describe('health probe', () => {
  it('accepts the health contract without sending credentials', async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ service: 'timetrack', status: 'healthy', checks: { database: { status: 'ok' }, auth: { status: 'ok' } } }) });
    await expect(checkServer('https://example.org/', fetcher)).resolves.toBe('https://example.org');
    expect(fetcher).toHaveBeenCalledWith('https://example.org/api/health', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
  });
  it.each([{ ok: false }, { ok: true, json: async () => ({ status: 'healthy' }) }, { ok: true, json: async () => {
    throw new Error('html');
  } }])('rejects incompatible servers', async (response) => {
    await expect(checkServer('https://example.org', jest.fn().mockResolvedValue(response))).rejects.toThrow('health');
  });
});

describe('webHostFromUrl', () => {
  it('giver host med port og dropper protokol og sti', () => {
    expect(webHostFromUrl('https://app.timetrack.dk', 'x')).toBe('app.timetrack.dk');
    expect(webHostFromUrl('https://app.timewren.com/', 'x')).toBe('app.timewren.com');
    expect(webHostFromUrl('http://192.168.1.20:3000', 'x')).toBe('192.168.1.20:3000');
  });

  it('falder tilbage ved tom eller ugyldig URL', () => {
    expect(webHostFromUrl('', 'app.timewren.com')).toBe('app.timewren.com');
    expect(webHostFromUrl(undefined, 'app.timewren.com')).toBe('app.timewren.com');
    expect(webHostFromUrl('ikke en url', 'app.timetrack.dk')).toBe('app.timetrack.dk');
  });
});
