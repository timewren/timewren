export type SearchHitType = 'client' | 'project' | 'task' | 'timeEntry' | 'invoice' | 'prepaid';

/** Deep-link i appen for et søgeresultat (webbens `url`-felt ignoreres). */
export function hitHref(hit: { type: SearchHitType; id: string }): string {
  switch (hit.type) {
    case 'client': return `/clients/${hit.id}`;
    case 'project': return `/projects/${hit.id}`;
    case 'task': return `/tasks?taskId=${hit.id}`;
    case 'timeEntry': return `/entries/${hit.id}`;
    case 'invoice': return `/invoices/${hit.id}`;
    case 'prepaid': return '/prepaid';
  }
}
