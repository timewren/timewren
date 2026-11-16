import type { Employee } from './employees-logic';
import { employmentTypeKey, filterEmployees, formatWorkingDays, roleKey } from './employees-logic';

function emp(over: Partial<Employee> & { name: string }): Employee {
  const { name, ...rest } = over;
  return {
    id: name,
    userId: name,
    departmentId: null,
    isActive: true,
    role: 'member',
    user: { id: name, name, email: `${name.toLowerCase()}@x.dk`, image: null },
    ...rest,
  } as unknown as Employee;
}

describe('employees-logic', () => {
  it('nøgler med fallback', () => {
    expect(roleKey('hr')).toBe('hr');
    expect(roleKey('weird')).toBe('member');
    expect(roleKey(null)).toBe('member');
    expect(employmentTypeKey('part_time')).toBe('part_time');
    expect(employmentTypeKey(undefined)).toBe('full_time');
  });

  it('filterEmployees: aktive, afdeling, søgning, sortering', () => {
    const list = [
      emp({ name: 'Bo', departmentId: 'd1' }),
      emp({ name: 'Anna', departmentId: 'd2' }),
      emp({ name: 'Carl', isActive: false }),
    ];
    expect(filterEmployees(list, { query: '', departmentId: null }).map(e => e.user?.name)).toEqual(['Anna', 'Bo']);
    expect(filterEmployees(list, { query: '', departmentId: null, includeInactive: true })).toHaveLength(3);
    expect(filterEmployees(list, { query: 'bo@', departmentId: null }).map(e => e.user?.name)).toEqual(['Bo']);
    expect(filterEmployees(list, { query: '', departmentId: 'd2' }).map(e => e.user?.name)).toEqual(['Anna']);
  });

  it('formatWorkingDays', () => {
    expect(formatWorkingDays(['1', '2', '5'])).toBe('Man, Tir, Fre');
    expect(formatWorkingDays(null)).toBe('—');
    expect(formatWorkingDays([])).toBe('—');
  });
});
