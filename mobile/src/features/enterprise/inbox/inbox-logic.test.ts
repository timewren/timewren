import { inboxRouteFor } from './inbox-logic';

describe('inboxRouteFor', () => {
  it('mapper fraværs-stier til fanen', () => {
    expect(inboxRouteFor('/dashboard/enterprise/absence')).toBe('/absence');
    expect(inboxRouteFor('/dashboard/enterprise/absence?tab=approve')).toBe('/absence');
    expect(inboxRouteFor('https://app.timetrack.dk/dashboard/enterprise/absence/123')).toBe('/absence');
  });

  it('mapper flex og overtid', () => {
    expect(inboxRouteFor('/dashboard/enterprise/flex')).toBe('/enterprise/flex');
    expect(inboxRouteFor('/dashboard/enterprise/overtime')).toBe('/enterprise/overtime');
  });

  it('ukendt → null', () => {
    expect(inboxRouteFor('/dashboard/enterprise/timesheet')).toBeNull();
    expect(inboxRouteFor('/dashboard/enterprise/absence-report')).toBeNull();
    expect(inboxRouteFor(null)).toBeNull();
    expect(inboxRouteFor('')).toBeNull();
  });
});
