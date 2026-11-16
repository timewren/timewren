import { hitHref } from './hit-href';

describe('hitHref', () => {
  it('mapper hver resultattype til en app-rute', () => {
    expect(hitHref({ type: 'client', id: 'c1' })).toBe('/clients/c1');
    expect(hitHref({ type: 'project', id: 'p1' })).toBe('/projects/p1');
    expect(hitHref({ type: 'task', id: 't1' })).toBe('/tasks?taskId=t1');
    expect(hitHref({ type: 'timeEntry', id: 'e1' })).toBe('/entries/e1');
    expect(hitHref({ type: 'invoice', id: 'i1' })).toBe('/invoices/i1');
    expect(hitHref({ type: 'prepaid', id: 'k1' })).toBe('/prepaid');
  });
});
