import type { AbsenceRequest } from './use-absence';
import { endOfMonth, startOfMonth } from 'date-fns';
import { toISODate } from '~/lib/format';

type CalendarRequest = Pick<AbsenceRequest, 'id' | 'userId' | 'startDate' | 'endDate'> & {
  user: Pick<AbsenceRequest['user'], 'name'>;
  absenceType: Pick<AbsenceRequest['absenceType'], 'name' | 'color'>;
};

type Period = {
  id: string;
  firstDay: number;
  lastDay: number;
  type: CalendarRequest['absenceType'];
};

export type EmployeeMonth = {
  id: string;
  name: string;
  periods: Period[];
};

export function groupMonthAbsences(requests: readonly CalendarRequest[], month: Date, today: string): EmployeeMonth[] {
  const first = toISODate(startOfMonth(month));
  const last = toISODate(endOfMonth(month));
  const groups = new Map<string, EmployeeMonth>();

  for (const request of requests) {
    const { id, userId, startDate, endDate } = request;
    // Match web's effectiveEndDate for ongoing registrations.
    const end = endDate ?? (startDate > today ? startDate : today);
    if (startDate > last || end < first)
      continue;

    const group = groups.get(userId) ?? { id: userId, name: request.user.name, periods: [] };
    group.periods.push({
      id,
      firstDay: Number((startDate < first ? first : startDate).slice(-2)),
      lastDay: Number((end > last ? last : end).slice(-2)),
      // The server masks name and color. The other type fields can still identify it.
      type: { name: request.absenceType.name, color: request.absenceType.color },
    });
    groups.set(userId, group);
  }

  return [...groups.values()];
}
