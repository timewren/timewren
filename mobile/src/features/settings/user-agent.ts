const DEVICES: [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Macintosh/, 'Mac'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Chrome\//, 'Chrome'],
  [/Firefox\//, 'Firefox'],
  [/Safari\//, 'Safari'],
];

function first(table: [RegExp, string][], ua: string): string | null {
  return table.find(([re]) => re.test(ua))?.[1] ?? null;
}

/**
 * "iPhone · Safari" ud af en user-agent — kort, men nok til at genkende enheden. `fallback` når intet
 * matcher. Appens egne kald (okhttp/Expo) mærkes med brandets navn, fx "TimeWren-app".
 */
export function describeUserAgent(ua: string | null | undefined, fallback = 'Ukendt enhed', appName = 'TimeTrack'): string {
  if (!ua)
    return fallback;
  const browser = first(BROWSERS, ua) ?? (/okhttp|Expo|TimeTrack|TimeWren/i.test(ua) ? `${appName}-app` : null);
  const parts = [first(DEVICES, ua), browser].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : fallback;
}
