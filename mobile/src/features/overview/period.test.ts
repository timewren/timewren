import { billableShare, estimateRevenue, periodRange } from './period';

describe('periodRange', () => {
  // Onsdag 9. september 2026
  const now = new Date(2026, 8, 9, 13, 30);

  it('uge starter mandag og slutter søndag', () => {
    const { from, to } = periodRange('week', now);
    expect(from.getDay()).toBe(1);
    expect(from.getDate()).toBe(7);
    expect(to.getDay()).toBe(0);
    expect(to.getDate()).toBe(13);
    expect(to.getHours()).toBe(23);
  });

  it('måned dækker hele september', () => {
    const { from, to } = periodRange('month', now);
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(8);
    expect(to.getDate()).toBe(30);
    expect(to.getMonth()).toBe(8);
  });

  it('år dækker 1/1–31/12', () => {
    const { from, to } = periodRange('year', now);
    expect([from.getMonth(), from.getDate()]).toEqual([0, 1]);
    expect([to.getMonth(), to.getDate()]).toEqual([11, 31]);
    expect(from.getFullYear()).toBe(2026);
  });
});

describe('estimateRevenue', () => {
  it('ganger fakturerbare timer med sats', () => {
    expect(estimateRevenue(10.5, 900)).toBe(9450);
  });
  it('null uden sats', () => {
    expect(estimateRevenue(10, null)).toBeNull();
  });
  it('negative timer giver 0', () => {
    expect(estimateRevenue(-3, 500)).toBe(0);
  });
});

describe('billableShare', () => {
  it('0 uden timer', () => {
    expect(billableShare(0, 0)).toBe(0);
  });
  it('andel klemmes til 0..1', () => {
    expect(billableShare(10, 5)).toBe(0.5);
    expect(billableShare(10, 12)).toBe(1);
  });
});
