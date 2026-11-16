import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { DraftLine, SentSave } from './invoice-lines-logic';
import type { RouterOutputs } from '~/api/app-router';
import * as React from 'react';
import { Alert, View } from 'react-native';
import { Button, Modal, Text } from '~/components/ui';
import { BottomSheetView } from '~/components/ui/bottom-sheet';
import { requiresConnection } from '~/features/entries/use-entries';
import { errorMessage, isTRPCClientError, trpc } from '~/lib/api';
import { formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { DraftLineRow } from './draft-line-row';
import {
  findProblems,
  mayHaveLanded,
  movedLines,
  newLine,
  payloadKey,
  removedEntryIds,
  removeLine,
  sameLines,
  savedLines,
  saveIsLocked,
  totalOf,
  updateLine,
} from './invoice-lines-logic';

type Props = {
  ref: React.RefObject<BottomSheetModal | null>;
  invoiceId: string;
  lines: RouterOutputs['invoices']['getLines'];
  onSaved: () => void;
};

function toDraft(lines: RouterOutputs['invoices']['getLines']): DraftLine[] {
  return lines.map(l => ({
    id: l.id,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    timeEntryId: l.timeEntryId,
  }));
}

/**
 * Redigering af en kladde-fakturas linjer. Serverens `saveLines` *erstatter*
 * hele listen, så vi sender altid den fulde liste, og vi spørger før vi
 * frigiver en registrering — en frigivet tidspost kan faktureres igen.
 */
export function InvoiceLinesEditor({ ref, invoiceId, lines, onSaved }: Props) {
  const [draft, setDraft] = React.useState<DraftLine[]>([]);
  const [original, setOriginal] = React.useState<DraftLine[]>([]);
  const [syncedFrom, setSyncedFrom] = React.useState(lines);
  const utils = trpc.useUtils();

  // Genindlæs fra serverens svar, så et gemt temp-id bliver til et rigtigt id.
  // Uden det ville et gentaget gem indsætte den nye linje endnu en gang.
  // Gøres under render (ikke i en effekt) — det er den dokumenterede måde at
  // nulstille tilstand på et ændret prop på, og det undgår et kaskaderende render.
  if (syncedFrom !== lines) {
    setSyncedFrom(lines);
    setDraft(toDraft(lines));
    setOriginal(toDraft(lines));
  }

  const problems = React.useMemo(() => findProblems(draft), [draft]);
  const dirty = !sameLines(draft, original);
  // Nøglen af det vi sendte sidst, og om serveren kan have gemt det. Et gem der
  // er identisk med et der kan have landet, ville indsætte de nye linjer igen,
  // så det låser knappen — men kun indtil vi ved hvad serveren svarede.
  const [sent, setSent] = React.useState<SentSave | null>(null);
  const locked = saveIsLocked(payloadKey(draft), sent);

  const save = trpc.invoices.saveLines.useMutation({
    onSuccess: () => {
      void utils.invoices.invalidate();
      void utils.time.invalidate();
      showMessage({ message: translate('invoices.lines_saved'), type: 'success' });
      onSaved();
    },
    onError: (error) => {
      // Et 4xx er serverens afvisning, og `saveLines` har rullet hele
      // transaktionen tilbage — så låsen skal gives fri igen, ellers dør
      // knappen efter det første afviste gem. Alt uden svar (5xx, tabt net)
      // beholder låsen, fordi serveren kan have gemt. Se `mayHaveLanded`.
      if (!mayHaveLanded(isTRPCClientError(error) ? error.data?.httpStatus : undefined))
        setSent(null);
      showMessage({ message: errorMessage(error), type: 'danger' });
    },
  });

  const doSave = React.useCallback(() => {
    if (requiresConnection(translate('invoices.actions.edit_lines')))
      return;
    // Sæt låsen inden mutationen, så to tryk i samme hændelsesrække ikke begge
    // kommer ud — `isPending` dækker først efter at re-renderen er sket.
    setSent({ key: payloadKey(draft), mayHaveLanded: true });
    save.mutate({ invoiceId, lines: savedLines(draft) });
  }, [draft, invoiceId, save]);

  const confirmAndSave = React.useCallback(() => {
    const released = removedEntryIds(original, draft);
    if (released.length === 0) {
      doSave();
      return;
    }
    Alert.alert(
      translate('invoices.title'),
      translate('invoices.confirm_release_entries', { count: released.length }),
      [
        { text: translate('tasks.cancel'), style: 'cancel' },
        { text: translate('invoices.lines_save'), onPress: doSave },
      ],
    );
  }, [doSave, draft, original]);

  return (
    <Modal ref={ref} snapPoints={['85%']} title={translate('invoices.actions.edit_lines')}>
      <BottomSheetView className="px-4 pb-8">
        {draft.length === 0
          ? <Text className="mb-4 text-sm text-muted-foreground" tx="invoices.no_lines" />
          : draft.map((line, index) => (
              <DraftLineRow
                key={line.id}
                line={line}
                problem={problems.some(p => p.id === line.id)}
                first={index === 0}
                last={index === draft.length - 1}
                onChange={patch => setDraft(cur => updateLine(cur, line.id, patch))}
                onRemove={() => setDraft(cur => removeLine(cur, line.id))}
                onMove={dir => setDraft(cur => movedLines(cur, line.id, dir))}
              />
            ))}
        <Button
          variant="outline"
          label={translate('invoices.lines_add')}
          onPress={() => setDraft(cur => [...cur, newLine()])}
          testID="line-add"
        />
        <View className="mt-4 flex-row items-center justify-between border-t border-border pt-3">
          <Text className="text-sm font-medium text-muted-foreground" tx="invoices.net" />
          <Text className="text-lg font-semibold text-foreground">{formatMoney(totalOf(draft), { decimals: 2 })}</Text>
        </View>
        {problems.length > 0
          ? <Text className="mt-2 text-sm text-danger-600" tx="invoices.lines_problem" />
          : null}
        <Button
          className="mt-4"
          label={translate('invoices.lines_save')}
          disabled={!dirty || problems.length > 0 || locked}
          loading={save.isPending}
          onPress={confirmAndSave}
          testID="line-save"
        />
      </BottomSheetView>
    </Modal>
  );
}
