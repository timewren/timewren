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
  [/okhttp|Expo|TimeTrack/i, 'TimeTrack-app'],
];

function first(table: [RegExp, string][], ua: string): string | null {
  return table.find(([re]) => re.test(ua))?.[1] ?? null;
}

/** "iPhone · Safari" ud af en user-agent — kort, men nok til at genkende enheden. `fallback` når intet matcher. */
export function describeUserAgent(ua: string | null | undefined, fallback = 'Ukendt enhed'): string {
  if (!ua)
    return fallback;
  const parts = [first(DEVICES, ua), first(BROWSERS, ua)].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : fallback;
}
