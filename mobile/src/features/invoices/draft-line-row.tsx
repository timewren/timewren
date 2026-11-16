import type { DraftLine } from './invoice-lines-logic';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Card, IconButton, Input, Text } from '~/components/ui';
import { formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { lineAmount } from './invoice-lines-logic';

export type DraftLineRowProps = {
  line: DraftLine;
  /** Beskrivelsen mangler, men linjen har indhold — serveren ville afvise den. */
  problem: boolean;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
};

/**
 * Én fakturalinje med beskrivelse, antal, pris og beløb. Delt mellem
 * redigeringen af en eksisterende kladde (`InvoiceLinesEditor`) og oprettelse
 * af en ny med egne linjer, så de to steder ikke kan komme til at se
 * forskellige ud.
 */
export function DraftLineRow({ line, problem, first, last, onChange, onRemove, onMove }: DraftLineRowProps) {
  return (
    <Card className="mb-2">
      <View className="mb-2 flex-row items-center gap-1">
        <View className="flex-1">
          <Input
            label={translate('invoices.line_description')}
            value={line.description}
            onChangeText={v => onChange({ description: v })}
            placeholder={translate('invoices.line_description')}
            error={problem ? translate('invoices.line_description_required') : undefined}
            testID={`line-desc-${line.id}`}
          />
        </View>
        <View className="flex-row">
          <IconButton icon={ArrowUp} label={translate('invoices.lines_move_up')} size={18} disabled={first} onPress={() => onMove(-1)} />
          <IconButton icon={ArrowDown} label={translate('invoices.lines_move_down')} size={18} disabled={last} onPress={() => onMove(1)} />
          <IconButton icon={Trash2} label={translate('invoices.lines_remove')} onPress={onRemove} testID={`line-remove-${line.id}`} />
        </View>
      </View>
      <View className="flex-row items-end gap-2">
        <View className="flex-1">
          <Input
            label={translate('invoices.line_quantity')}
            value={line.quantity}
            onChangeText={v => onChange({ quantity: v })}
            keyboardType="decimal-pad"
            testID={`line-qty-${line.id}`}
          />
        </View>
        <View className="flex-1">
          <Input
            label={translate('invoices.line_unit_price')}
            value={line.unitPrice}
            onChangeText={v => onChange({ unitPrice: v })}
            keyboardType="decimal-pad"
            testID={`line-price-${line.id}`}
          />
        </View>
        <View className="items-end pb-3">
          <Text className="mb-1 text-sm font-medium text-muted-foreground" tx="invoices.line_amount" />
          <Text className="text-base font-semibold text-foreground">{formatMoney(lineAmount(line.quantity, line.unitPrice), { decimals: 2 })}</Text>
        </View>
      </View>
      {line.timeEntryId
        ? <Text className="text-xs text-muted-foreground" tx="invoices.line_from_entry" />
        : null}
    </Card>
  );
}
