import { timesheetStatus } from './timesheet-status';

describe('timesheetStatus', () => {
  it('null/ukendt er kladde', () => {
    expect(timesheetStatus(null)).toBe('draft');
    expect(timesheetStatus(undefined)).toBe('draft');
    expect(timesheetStatus('weird')).toBe('draft');
  });
  it('kendte statusser passerer igennem', () => {
    expect(timesheetStatus('submitted')).toBe('submitted');
    expect(timesheetStatus('approved')).toBe('approved');
    expect(timesheetStatus('rejected')).toBe('rejected');
  });
});
