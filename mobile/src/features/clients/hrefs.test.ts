import { entriesNewHref, prepaidNewHref, projectNewHref } from './hrefs';

describe('hrefs', () => {
  it('entriesNewHref bygger aftalte query-params', () => {
    expect(entriesNewHref({})).toBe('/entries/new');
    expect(entriesNewHref({ clientId: 'c1' })).toBe('/entries/new?clientId=c1');
    expect(entriesNewHref({ clientId: 'c1', projectId: 'p1' })).toBe('/entries/new?clientId=c1&projectId=p1');
    expect(entriesNewHref({ clientId: null, projectId: 'p1' })).toBe('/entries/new?projectId=p1');
  });

  it('new-hrefs med valgfri kunde', () => {
    expect(projectNewHref()).toBe('/projects/new');
    expect(projectNewHref('c1')).toBe('/projects/new?clientId=c1');
    expect(prepaidNewHref('c1')).toBe('/prepaid/new?clientId=c1');
  });
});
