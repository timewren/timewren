import { healthFromPercentage, healthTone, projectBudget, resolveRate, statusTone } from './project-logic';

describe('project-logic', () => {
  it('resolveRate: projekt vinder over kunde og global', () => {
    expect(resolveRate({ projectRate: '900', clientRate: '800', globalRate: '700' })).toEqual({ rate: 900, source: 'project' });
    expect(resolveRate({ projectRate: '', clientRate: '800', globalRate: '700' })).toEqual({ rate: 800, source: 'client' });
    expect(resolveRate({ projectRate: null, clientRate: null, globalRate: '700' })).toEqual({ rate: 700, source: 'global' });
    expect(resolveRate({})).toEqual({ rate: null, source: 'none' });
    expect(resolveRate({ projectRate: 'abc', clientRate: 650 })).toEqual({ rate: 650, source: 'client' });
  });

  it('healthFromPercentage', () => {
    expect(healthFromPercentage(0)).toBe('green');
    expect(healthFromPercentage(74.9)).toBe('green');
    expect(healthFromPercentage(75)).toBe('yellow');
    expect(healthFromPercentage(90)).toBe('red');
    expect(healthFromPercentage(150)).toBe('red');
  });

  it('projectBudget: fastpris / timepris', () => {
    const b = projectBudget({ fixedPrice: '10000', hourlyRate: '1000', usedHours: 8 });
    expect(b.budgetHours).toBe(10);
    expect(b.percentage).toBe(80);
    expect(b.health).toBe('yellow');
  });

  it('projectBudget: intet budget uden fastpris', () => {
    const b = projectBudget({ fixedPrice: null, hourlyRate: '1000', usedHours: 8 });
    expect(b.budgetHours).toBeNull();
    expect(b.percentage).toBeNull();
    expect(b.health).toBeNull();
    expect(projectBudget({ fixedPrice: '1000', hourlyRate: '0', usedHours: 1 }).budgetHours).toBeNull();
  });

  it('toner', () => {
    expect(healthTone('green')).toBe('success');
    expect(healthTone('red')).toBe('danger');
    expect(healthTone(null)).toBe('default');
    expect(statusTone('active')).toBe('success');
    expect(statusTone('on_hold')).toBe('warning');
    expect(statusTone('completed')).toBe('primary');
    expect(statusTone('archived')).toBe('default');
  });
});
