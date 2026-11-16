import type { DraftLine } from './invoice-lines-logic';
import type { Blocker } from './new-invoice-logic';
import type { TxKeyPath } from '~/lib/i18n';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import { Button, Card, Screen, SectionHeader, Select, Text } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { requiresConnection } from '~/features/entries/use-entries';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateLong, formatMoney, toISODate } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { DraftLineRow } from './draft-line-row';
import { findProblems, movedLines, newLine, removeLine, totalOf, updateLine } from './invoice-lines-logic';
import { createPlan, planKey, retryAfterFailure } from './new-invoice-logic';

/** Hvad der mangler, før der kan trykkes — serverens zod ville sige det samme. */
const BLOCKER_TX: Record<Blocker, TxKeyPath> = {
  no_client: 'invoices.new.block_client',
  no_lines: 'invoices.new.block_lines',
  line_problem: 'invoices.lines_problem',
  bad_total: 'invoices.new.block_amount',
};

/**
 * Opret en kladde med egne linjer — fast pris, samarbejde, alt det der ikke
 * kommer fra registreret tid.
 *
 * Ikke offline-købar: serveren danner kladden og tildeler nummeret, så uden
 * net er der ingen ærlig vej — samme behandling som `duplicate`.
 */
export function NewInvoiceScreen() {
  const caps = useCapabilities();
  if (!caps.isEnabled('invoicing')) {
    return (
      <Screen back title={translate('invoices.new.title')}>
        <Card>
          <Text tx="invoices.module_off_body" />
        </Card>
      </Screen>
    );
  }
  return <NewInvoiceForm />;
}

function NewInvoiceForm() {
  const [clientId, setClientId] = React.useState<string | undefined>();
  const [lines, setLines] = React.useState<DraftLine[]>(() => [newLine()]);
  // Udstedelsesdatoen er i dag. Forfaldsdatoen udleder serveren af kundens
  // betalingsbetingelser (skabelonen som næstes, ellers 14 dage) — derfor
  // sender vi ingen med.
  const issueDate = React.useMemo(() => toISODate(new Date()), []);

  const plan = React.useMemo(() => createPlan(clientId, issueDate, lines), [clientId, issueDate, lines]);
  const problems = React.useMemo(() => findProblems(lines), [lines]);
  const create = useCreateDraft(clientId, lines, plan);

  return (
    <Screen
      back
      title={translate('invoices.new.title')}
      scrollProps={{ keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag' }}
    >
      <ClientPicker value={clientId} onSelect={setClientId} />
      <DraftMeta issueDate={issueDate} />
      <SectionHeader title={translate('invoices.lines')} />
      {lines.map((line, index) => (
        <DraftLineRow
          key={line.id}
          line={line}
          problem={problems.some(p => p.id === line.id)}
          first={index === 0}
          last={index === lines.length - 1}
          onChange={patch => setLines(cur => updateLine(cur, line.id, patch))}
          onRemove={() => setLines(cur => removeLine(cur, line.id))}
          onMove={dir => setLines(cur => movedLines(cur, line.id, dir))}
        />
      ))}
      <Button
        variant="outline"
        label={translate('invoices.lines_add')}
        onPress={() => setLines(cur => [...cur, newLine()])}
        testID="new-invoice-add-line"
      />
      <View className="mt-4 flex-row items-center justify-between border-t border-border pt-3">
        <Text className="text-sm font-medium text-muted-foreground" tx="invoices.net" />
        <Text className="text-lg font-semibold text-foreground">{formatMoney(totalOf(lines), { decimals: 2 })}</Text>
      </View>
      <CreateFooter
        plan={plan}
        clientId={clientId}
        unconfirmed={create.unconfirmed}
        busy={create.busy}
        onCreate={create.create}
        onOpenList={create.openList}
      />
    </Screen>
  );
}

function ClientPicker({ value, onSelect }: { value: string | undefined; onSelect: (id: string) => void }) {
  const clients = trpc.clients.list.useQuery();
  const options = React.useMemo(
    () => (clients.data ?? []).map(c => ({ label: c.company || c.name, value: c.id })),
    [clients.data],
  );
  return (
    <Select
      label={translate('invoices.client')}
      placeholder={translate('invoices.new.pick_client')}
      options={options}
      value={value}
      error={clients.isError ? translate('common.error_load') : undefined}
      onSelect={v => onSelect(String(v))}
      testID="new-invoice-client"
    />
  );
}

type FooterProps = {
  plan: ReturnType<typeof createPlan>;
  clientId: string | undefined;
  unconfirmed: boolean;
  busy: boolean;
  onCreate: () => void;
  onOpenList: () => void;
};

function CreateFooter({ plan, clientId, unconfirmed, busy, onCreate, onOpenList }: FooterProps) {
  // Uden en valgt kunde er der intet at fortælle — feltet taler for sig selv.
  const blocker = !plan.ok && (plan.blocker !== 'no_client' || clientId) ? BLOCKER_TX[plan.blocker] : undefined;
  if (unconfirmed) {
    return (
      <View className="mt-4">
        <Text className="mb-2 text-sm text-warning-600" tx="invoices.new.unconfirmed" />
        <Button label={translate('invoices.new.open_list')} onPress={onOpenList} testID="new-invoice-open-list" />
      </View>
    );
  }
  return (
    <View className="mt-4">
      {blocker ? <Text className="mb-2 text-sm text-danger-600" tx={blocker} /> : null}
      <Button
        label={translate('invoices.new.create')}
        disabled={!plan.ok || busy}
        loading={busy}
        onPress={onCreate}
        testID="new-invoice-create"
      />
    </View>
  );
}

/**
 * Opretter kladden i to kald: `invoices.create` med summeringen og bagefter
 * `invoices.saveLines`, som sætter linjerne og genberegner beløbet.
 *
 * Et *tabt svar* på `create` kan have oprettet kladden, så et nyt tryk ville
 * give to. Derfor følger skærmen brugeren til listen i stedet — men kun så
 * længe formularen stadig ser ud som det kald, der ikke kom svar på. Ét
 * ændret tegn, og det er igen et nyt kald.
 */
function useCreateDraft(clientId: string | undefined, lines: DraftLine[], plan: ReturnType<typeof createPlan>) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [lostKey, setLostKey] = React.useState<string | null>(null);
  const busyRef = React.useRef(false);
  const create = trpc.invoices.create.useMutation();
  const saveLines = trpc.invoices.saveLines.useMutation();
  const busy = create.isPending || saveLines.isPending;

  const run = React.useCallback(async () => {
    // Ét kald ad gangen: to tryk i samme øjeblik må ikke give to kladder.
    if (busyRef.current || !plan.ok || requiresConnection(translate('invoices.new.create')))
      return;
    busyRef.current = true;
    setLostKey(null);
    try {
      const invoice = await create.mutateAsync(plan.create);
      try {
        await saveLines.mutateAsync({ invoiceId: invoice.id, lines: plan.lines });
        showMessage({ message: translate('invoices.new.created'), type: 'success' });
      }
      catch {
        // Kladden findes, men linjerne kom ikke med. Den kan redigeres videre
        // med egen linje-editor, så vi sender brugeren derhen i stedet for at
        // lade det se ud som om intet skete.
        showMessage({ message: translate('invoices.new.lines_failed'), type: 'warning' });
      }
      void utils.invoices.invalidate();
      router.replace(`/invoices/${invoice.id}`);
    }
    catch (error) {
      showMessage({ message: errorMessage(error), type: 'danger' });
      if (retryAfterFailure(error) === 'open_list')
        setLostKey(planKey(clientId, lines));
    }
    finally {
      busyRef.current = false;
    }
  }, [clientId, create, lines, plan, router, saveLines, utils]);

  return {
    busy,
    /** Sandt når det sidste kald kan have nået serveren og formularen er uændret. */
    unconfirmed: plan.ok && lostKey === planKey(clientId, lines),
    create: () => void run(),
    openList: () => router.replace('/invoices'),
  };
}

function DraftMeta({ issueDate }: { issueDate: string }) {
  const nextNumber = trpc.invoices.getNextInvoiceNumber.useQuery();
  return (
    <Card>
      <MetaRow label={translate('invoices.issued')} value={formatDateLong(issueDate)} />
      <MetaRow label={translate('invoices.new.number_label')} value={nextNumber.data ?? '—'} />
      <Text className="mt-1 text-xs text-muted-foreground" tx="invoices.new.number_hint" />
    </Card>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="mb-1 flex-row items-baseline justify-between">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}
