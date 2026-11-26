import type { TRPCLink } from '@trpc/client';
import type { AppRouter } from '~/api/app-router';
import { httpLink, TRPCClientError } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';
import { getSessionCookie } from '~/lib/auth/client';
import { clientVersionHeaders } from './client-version';
import { readKey } from './offline-read-data';
import { denyReadAccess, offlineReads } from './offline-read-runtime';
import { cookieProof } from './offline-read-storage';

export function offlineReadLink(url: string): TRPCLink<AppRouter> {
  return (runtime) => {
    const scoped = httpLink<AppRouter>({
      url,
      transformer: superjson,
      headers: ({ op }) => op.context.offlineReadHeaders as Record<string, string>,
    })(runtime);

    return ({ next, op }) => {
      const key = op.type === 'query' ? readKey(op.path, op.input) : undefined;
      const owner = offlineReads.current();
      if (!owner)
        return next(op);
      const accessOwner = offlineReads.accessOwner();
      if (!key) {
        return observable(observer => next(op).subscribe({
          next: value => observer.next(value),
          error: (error) => {
            if (error.data?.code === 'UNAUTHORIZED')
              denyReadAccess(accessOwner, 'UNAUTHORIZED');
            observer.error(error);
          },
          complete: () => observer.complete(),
        }));
      }

      return observable((observer) => {
        let stopped = false;
        let sub: { unsubscribe: () => void } | undefined;
        const start = async () => {
          const cookie = await getSessionCookie();
          const proof = await cookieProof(cookie);
          if (stopped)
            return;
          if (owner !== offlineReads.current() || proof !== owner.session)
            throw new Error('Session changed');
          sub = scoped({
            next,
            op: { ...op, context: { ...op.context, offlineReadHeaders: { ...clientVersionHeaders(), 'Cookie': cookie, 'x-timetrack-org-id': owner.organization } } },
          }).subscribe({
            next: (value) => {
              if (owner !== offlineReads.current()) {
                observer.error(TRPCClientError.from(new Error('Read scope changed')));
                return;
              }
              if ('data' in value.result) {
                try {
                  offlineReads.save(owner, key, value.result.data);
                }
                catch {
                  // Fejl ved lokal serialisering må ikke ændre svaret fra serveren.
                }
              }
              observer.next(value);
            },
            error: (error) => {
              const code = error.data?.code;
              if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN')
                denyReadAccess(accessOwner, code);
              observer.error(error);
            },
            complete: () => observer.complete(),
          });
        };
        void start().catch(error => observer.error(TRPCClientError.from(error)));
        return () => {
          stopped = true;
          sub?.unsubscribe();
        };
      });
    };
  };
}
