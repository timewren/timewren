import { describeUserAgent } from './user-agent';

describe('describeUserAgent', () => {
  it('fallback uden user-agent', () => {
    expect(describeUserAgent(null, 'Ukendt')).toBe('Ukendt');
  });
  it('iPhone Safari', () => {
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
  });
  it('windows Edge (Edge før Chrome)', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('Windows · Edge');
  });
  it('appens egen fetch på Android', () => {
    expect(describeUserAgent('okhttp/4.9 Android')).toBe('Android · TimeTrack-app');
  });
  it('appens egen fetch får brandets navn (TimeWren)', () => {
    expect(describeUserAgent('okhttp/4.9 Android', 'Ukendt', 'TimeWren')).toBe('Android · TimeWren-app');
    expect(describeUserAgent('TimeWren/1.0 CFNetwork Darwin iPhone', 'Ukendt', 'TimeWren')).toBe('iPhone · TimeWren-app');
  });
});
