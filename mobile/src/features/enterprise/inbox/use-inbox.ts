import type { RouterOutputs } from '~/api/app-router';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { trpc } from '~/lib/api';

export type InboxItem = RouterOutputs['enterprise']['listInbox'][number];

/**
 * Antal ulæste i indbakken — til badges på andre skærme. 0 uden enterprise
 * (proceduren kaldes ikke, den ville give 403).
 */
export function useInboxUnreadCount(): number {
  const caps = useCapabilities();
  const query = trpc.enterprise.inboxUnreadCount.useQuery(undefined, {
    enabled: caps.isEnterprise,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  return query.data ?? 0;
}

export function useInbox(unreadOnly: boolean) {
  return trpc.enterprise.listInbox.useQuery({ limit: 100, unreadOnly: unreadOnly || undefined });
}

export function useMarkInboxRead() {
  const utils = trpc.useUtils();
  return trpc.enterprise.markInboxRead.useMutation({
    onSuccess: () => {
      void utils.enterprise.listInbox.invalidate();
      void utils.enterprise.inboxUnreadCount.invalidate();
    },
  });
}
