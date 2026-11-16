import type { SavedEntryLike } from './create-dedup';
import { isSameCreate } from './create-dedup';

const payload = { description: 'Web', hours: 1.5, date: '2026-09-29', isBillable: true };

jest.mock('~/lib/api/trpc', () => ({ trpcClient: { time: { list: { query: jest.fn() } } } }));

function entry(partial: Partial<SavedEntryLike> & Pick<SavedEntryLike, 'hours' | 'description'>): SavedEntryLike {
  return { date: '2026-09-29', ...partial };
}

describe('isSameCreate', () => {
  it('uden klokkeslæt matcher den på dato, timer og beskrivelse', () => {
    expect(isSameCreate(payload, entry({ hours: 1.5, description: 'Web' }))).toBe(true);
    expect(isSameCreate(payload, entry({ hours: 2, description: 'Web' }))).toBe(false);
    expect(isSameCreate(payload, entry({ hours: 1.5, description: 'Andet' }))).toBe(false);
    expect(isSameCreate(payload, entry({ hours: 1.5, description: 'Web', date: '2026-09-30' }))).toBe(false);
  });

  it('tolererer at serveren gemmer timer som streng og beskrivelse med mellemrum', () => {
    expect(isSameCreate(payload, entry({ hours: '1.50', description: 'Web  ' }))).toBe(true);
  });

  it('med klokkeslæt matcher den KUN på start/slut — samme nøgle som timer-stop-kæden', () => {
    const timed = {
      ...payload,
      startTime: '2026-09-29T08:00:00.000Z',
      endTime: '2026-09-29T09:00:00.000Z',
    };
    const same = entry({ hours: 99, description: 'Helt andet', startTime: new Date('2026-09-29T08:00:00.000Z'), endTime: new Date('2026-09-29T09:00:00.000Z') });
    expect(isSameCreate(timed, same)).toBe(true);

    const other = entry({ hours: 1.5, description: 'Web', startTime: '2026-09-29T10:00:00.000Z', endTime: '2026-09-29T11:00:00.000Z' });
    expect(isSameCreate(timed, other)).toBe(false);
  });

  it('et klokkeslæt på kun den ene side matcher ikke', () => {
    const timed = { ...payload, startTime: '2026-09-29T08:00:00.000Z', endTime: '2026-09-29T09:00:00.000Z' };
    expect(isSameCreate(timed, entry({ hours: 1.5, description: 'Web', startTime: '2026-09-29T08:00:00.000Z' }))).toBe(false);
  });

  it('serverens UTC-midnat og vores lokale dato er samme dag', () => {
    expect(isSameCreate(payload, entry({ hours: 1.5, description: 'Web', date: new Date('2026-09-29T00:00:00.000Z') }))).toBe(true);
  });
});

describe('isSameCreate — en ægte anden post samme dag', () => {
  // Brugeren har lavet "1 t Support" kl. 9 og logger endnu et "1 t Support"
  // kl. 14. Kaldet dør med tabt svar. Den ægte morgenpost må ikke få spist
  // eftermiddagsposten — tiden skal gemmes, ikke slettet.
  const morning = entry({
    hours: 1,
    description: 'Support',
    date: '2026-09-29',
    createdAt: '2026-09-29T09:00:00.000Z',
  });
  const afternoon = { ...payload, description: 'Support', hours: 1 };
  const attemptedAt = '2026-09-29T14:00:00.000Z';

  it('tæller ikke en post der var oprettet FØR vores første forsøg', () => {
    expect(isSameCreate(afternoon, morning, { firstAttemptAt: attemptedAt })).toBe(false);
  });

  it('tæller en post serveren oprettede EFTER vores første forsøg', () => {
    const ours = { ...morning, createdAt: '2026-09-29T14:00:01.000Z' };
    expect(isSameCreate(afternoon, ours, { firstAttemptAt: attemptedAt })).toBe(true);
  });

  it('tolererer at telefonens ur er lidt foran serverens', () => {
    // Uret kan afvige: serveren svarede 13:58, vi tror det er 14:00.
    const ours = { ...morning, createdAt: '2026-09-29T13:58:00.000Z' };
    expect(isSameCreate(afternoon, ours, { firstAttemptAt: attemptedAt })).toBe(true);
  });

  it('beholder den gamle nøgle for elementer der ikke ved, hvornår de blev sendt', () => {
    // Kø-elementer gemt før markeringen skal stadig finde deres post.
    expect(isSameCreate(afternoon, morning, {})).toBe(true);
  });

  it('uden createdAt på serverposten kan vi ikke afvise på tid — så vi tager ikke risikoen', () => {
    const noStamp = { hours: 1, description: 'Support', date: '2026-09-29' };
    expect(isSameCreate(afternoon, noStamp, { firstAttemptAt: attemptedAt })).toBe(true);
  });
});

describe('isSameCreate — klientens idempotensnøgle', () => {
  const withKey = { ...payload, clientEntryId: 'key-1' };

  it('matcher på nøglen alene, også når beskrivelse og timer afviger', () => {
    const entry = { hours: 99, description: 'Helt andet', date: '2026-09-29', clientEntryId: 'key-1' };
    expect(isSameCreate(withKey, entry)).toBe(true);
  });

  it('afviser en post med en ANDEN nøgle, selvom den ligner i alt andet', () => {
    const entry = { hours: 1.5, description: 'Web', date: '2026-09-29', clientEntryId: 'key-2' };
    expect(isSameCreate(withKey, entry)).toBe(false);
  });

  it('falder tilbage på tidspunktet, når serveren endnu ikke gemmer nøglen', () => {
    const entry = { hours: 1.5, description: 'Web', date: '2026-09-29', clientEntryId: null };
    expect(isSameCreate(withKey, entry)).toBe(true);
  });
});
