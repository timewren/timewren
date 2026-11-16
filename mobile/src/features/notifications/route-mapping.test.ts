import { routeForNotification } from './route-mapping';

describe('routeForNotification', () => {
  it('mapper web-stier til app-ruter', () => {
    expect(routeForNotification({ url: '/dashboard/enterprise/absence' })).toBe('/absence');
    expect(routeForNotification({ url: 'https://app.timetrack.dk/dashboard/enterprise/absence/abc?x=1' })).toBe('/absence');
    expect(routeForNotification({ url: '/dashboard/time' })).toBe('/time');
    expect(routeForNotification({ url: '/dashboard/time/entries/123' })).toBe('/time');
    expect(routeForNotification({ url: '/dashboard/invoices/inv-1' })).toBe('/invoices');
    expect(routeForNotification({ url: '/dashboard/team' })).toBe('/team');
  });

  it('matcher hele segmenter — ikke "/dashboard/timer" som "/dashboard/time"', () => {
    expect(routeForNotification({ url: '/dashboard/timer' })).toBe('/');
  });

  it('falder tilbage til type når url mangler eller er ukendt', () => {
    expect(routeForNotification({ type: 'absence_request' })).toBe('/absence');
    expect(routeForNotification({ type: 'invoice_paid' })).toBe('/invoices');
    expect(routeForNotification({ url: '/dashboard/unknown', type: 'time_entry' })).toBe('/time');
  });

  it('den lokale ugeafslutningspåmindelse åbner ugen', () => {
    expect(routeForNotification({ type: 'week_review' })).toBe('/week-review');
  });

  it('ukendt/tom data → Hjem', () => {
    expect(routeForNotification(undefined)).toBe('/');
    expect(routeForNotification({})).toBe('/');
    expect(routeForNotification({ url: 42, type: 'nope' })).toBe('/');
    expect(routeForNotification({ url: '/dashboard/settings' })).toBe('/');
  });
});
