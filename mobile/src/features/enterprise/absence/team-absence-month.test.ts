import { groupMonthAbsences } from './team-absence-month';

const month = new Date(2028, 0, 1);

function request(id: string, userId: string, [startDate, endDate]: [string, string | null]) {
  return { id, userId, startDate, endDate, user: { name: userId }, absenceType: { name: 'Fravær', color: '#6b7280' } };
}

it('clips inclusive periods across both month boundaries and keeps overlaps for each employee', () => {
  const requests = [
    request('a1', 'A', ['2026-12-28', '2028-01-04']),
    request('a2', 'A', ['2028-01-04', '2028-02-02']),
    request('b1', 'B', ['2028-01-04', '2028-01-04']),
    request('past', 'C', ['2027-12-01', '2027-12-31']),
    request('future', 'C', ['2028-02-01', '2028-02-01']),
  ];
  const groups = groupMonthAbsences(requests, month, '2028-01-15');
  expect(groups.map(group => [group.name, group.periods.map(p => [p.firstDay, p.lastDay])])).toEqual([
    ['A', [[1, 4], [4, 31]]],
    ['B', [[4, 4]]],
  ]);
});

it('clips open periods through today and shows a future open period only on its start date', () => {
  const requests = [
    request('open', 'A', ['2028-01-20', null]),
    request('future', 'A', ['2028-02-29', null]),
  ];
  const groups = groupMonthAbsences(requests, new Date(2028, 1, 1), '2028-02-03');
  expect(groups[0]?.periods.map(p => [p.id, p.firstDay, p.lastDay])).toEqual([
    ['open', 1, 3],
    ['future', 29, 29],
  ]);
  expect(groupMonthAbsences(requests, new Date(2028, 2, 1), '2028-02-03')).toEqual([]);
});
