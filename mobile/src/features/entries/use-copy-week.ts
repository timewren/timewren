import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { createInFlight } from '~/lib/in-flight';
import { showMessage } from '~/lib/notify';
import { dateKey, weekRange } from './period';
import { requiresConnection, showApiError, useInvalidateEntries } from './use-entries';

/**
 * Ét kopier-uge-kald pr. måluge ad gangen. `copyWeek` læser kildeugen på
 * serveren og danner nye poster, så to kald er to ugers dobbeltregistrerede
 * timer — og der er ingen genopretning at falde tilbage på, fordi kallet ikke
 * kan ligge i offline-køen. Nøglen er målugen, så en kopiering til en anden uge
 * stadig virker med det samme.
 */
const copyWeekFlight = createInFlight<void>();

/**
 * Kopiér sidste uge → den viste uge (mandag som mål).
 *
 * Kan ikke ligge i offline-køen: serveren læser kildeugen og danner nye
 * poster, så et genforsøg efter tabt svar ville kopiere ugen to gange.
 */
export function useCopyWeek(date: Date) {
  const invalidate = useInvalidateEntries();
  const mutation = trpc.time.copyWeek.useMutation({
    onSuccess: ({ count }: { count: number }) => {
      invalidate();
      showMessage({
        message: count > 0 ? translate('entries.copy_week_done', { count: String(count) }) : translate('entries.copy_week_none'),
        type: count > 0 ? 'success' : 'info',
      });
    },
    onError: showApiError,
  });
  const run = () => {
    const targetWeekStart = dateKey(weekRange(date).start);
    if (requiresConnection(translate('entries.copy_week')))
      return;
    copyWeekFlight(targetWeekStart, async () => {
      await mutation.mutateAsync({ targetWeekStart });
    }).catch(() => {});
  };
  return { run, isPending: mutation.isPending };
}
