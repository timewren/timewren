import i18n from '~/lib/i18n';
import { formatAgo, formatDateLong, formatDateRelative, formatDateShort, formatHours, formatWeek } from './format';

// Lørdag 21. november 2026, midt på dagen så tidszonen ikke flytter dagen.
const SATURDAY = new Date(2026, 10, 21, 12, 0);

afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('datoer følger appens sprog', () => {
  it('engelsk: engelske dage og måneder uden dansk punktum', async () => {
    await i18n.changeLanguage('en');
    expect(formatDateLong(SATURDAY)).toBe('Saturday 21 November');
    expect(formatDateShort(new Date(2025, 8, 6))).toBe('6 Sep 2025');
    expect(formatWeek(SATURDAY)).toBe('Week 47');
    expect(formatDateRelative(new Date())).toBe('Today');
    expect(formatAgo(new Date(Date.now() - 3 * 60_000))).toBe('3 minutes ago');
  });

  it('dansk: uændret dansk format', async () => {
    await i18n.changeLanguage('da');
    expect(formatDateLong(SATURDAY)).toBe('Lørdag 21. november');
    expect(formatDateShort(new Date(2025, 8, 6))).toBe('6. sep. 2025');
    expect(formatWeek(SATURDAY)).toBe('Uge 47');
    expect(formatDateRelative(new Date())).toBe('I dag');
  });

  it('tysk beholder punktum efter dagen', async () => {
    await i18n.changeLanguage('de');
    expect(formatDateLong(SATURDAY)).toBe('Samstag 21. November');
  });

  it('engelsk beholder dansk talformat med engelsk enhed', async () => {
    await i18n.changeLanguage('en');
    expect(formatHours(7.5)).toBe('7,5 h');
  });
});
