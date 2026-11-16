import { emptyProject, toProjectInput, validateProject } from './project-form-logic';

describe('project-form-logic', () => {
  it('validateProject', () => {
    expect(validateProject(emptyProject(null))).toHaveProperty('name');
    expect(validateProject({ ...emptyProject('c1'), name: 'Projekt' })).toEqual({});
    expect(validateProject({ ...emptyProject('c1'), name: 'Projekt', hourlyRate: 'x' })).toHaveProperty('hourlyRate');
    expect(validateProject({ ...emptyProject('c1'), name: 'Projekt', fixedPrice: '10.000' })).toHaveProperty('fixedPrice');
    expect(validateProject({ ...emptyProject('c1'), name: 'Projekt', monthlyBudgetHours: '12,5' })).toEqual({});
  });

  it('toProjectInput: intern projekt uden kunde, tal normaliseres', () => {
    const input = toProjectInput({ ...emptyProject(null), name: ' P ', hourlyRate: '900,5', description: '' });
    expect(input.clientId).toBeNull();
    expect(input.name).toBe('P');
    expect(input.hourlyRate).toBe('900.5');
    expect(input.fixedPrice).toBeUndefined();
    expect(input.description).toBeUndefined();
    expect(input.status).toBe('active');
  });
});
