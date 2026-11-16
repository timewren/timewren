import { Plus } from 'lucide-react-native';
import * as React from 'react';
import { Pressable } from 'react-native';
import { colors } from '~/components/ui';

type FabProps = {
  onPress: () => void;
  label: string;
  testID?: string;
};

/** Rund primær handlingsknap nederst til højre. Skærmen skal være `relative` (Screen scroll=false). */
export function Fab({ onPress, label, testID }: FabProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="absolute right-5 bottom-6 size-14 items-center justify-center rounded-full bg-primary-600 shadow-lg active:bg-primary-700"
      testID={testID}
    >
      <Plus color={colors.white} size={28} strokeWidth={2.5} />
    </Pressable>
  );
}
