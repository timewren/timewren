import { buildContext, formatConsoleArgs, isValidOptionalEmail, MAX_SCREENSHOT_BASE64, pushEntry, screenshotDataUrl } from './feedback-logic';

describe('feedback-logic', () => {
  it('formatConsoleArgs samler og kapper', () => {
    expect(formatConsoleArgs(['Fejl:', new TypeError('x er undefined'), { a: 1 }])).toBe('Fejl: TypeError: x er undefined {"a":1}');
    expect(formatConsoleArgs(['a'.repeat(1000)])).toHaveLength(600);
  });

  it('pushEntry beholder kun de nyeste', () => {
    let buf: ReturnType<typeof pushEntry> = [];
    for (let i = 0; i < 5; i++)
      buf = pushEntry(buf, { ts: String(i), level: 'error', message: `m${i}` }, 3);
    expect(buf.map(e => e.message)).toEqual(['m2', 'm3', 'm4']);
  });

  it('buildContext matcher web-formatet', () => {
    const ctx = buildContext({
      route: '/local/stats',
      width: 411.4,
      height: 890.2,
      platform: 'android',
      osVersion: 34,
      appVersion: '1.0.0',
      colorScheme: 'dark',
      online: true,
      console: [],
      notes: ['uden konto: 3 poster'],
    });
    expect(ctx).toMatchObject({
      url: 'timetrack://local/stats',
      viewport: '411x890',
      userAgent: 'TimeTrack-app android 34',
      appVersion: '1.0.0',
      console: undefined,
      notes: ['uden konto: 3 poster'],
    });
  });

  it('screenshotDataUrl afviser for store billeder', () => {
    expect(screenshotDataUrl('iVBOR')).toBe('data:image/png;base64,iVBOR');
    expect(screenshotDataUrl('a'.repeat(MAX_SCREENSHOT_BASE64 + 1))).toBeNull();
    expect(screenshotDataUrl(null)).toBeNull();
  });

  it('isValidOptionalEmail', () => {
    expect(isValidOptionalEmail('')).toBe(true);
    expect(isValidOptionalEmail(' ven@example.com ')).toBe(true);
    expect(isValidOptionalEmail('ven@')).toBe(false);
  });
});
