import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { PressableProps } from 'react-native';
import type { SvgProps } from 'react-native-svg';
import {
  BottomSheetFlatList,

} from '@gorhom/bottom-sheet';
import { FlashList } from '@shopify/flash-list';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Path } from 'react-native-svg';
import { tv } from 'tailwind-variants';

import { useUniwind } from 'uniwind';
import colors from '~/components/ui/colors';

import { CaretDown } from '~/components/ui/icons';
import { Modal, useModal } from './modal';
import { StyledSvg } from './svg';
import { Text } from './text';

const selectTv = tv({
  slots: {
    container: 'mb-4',
    label: 'mb-1 text-lg text-foreground',
    input:
      'mt-0 flex-row items-center justify-center rounded-xl border-[0.5px] border-input bg-muted p-3',
    inputValue: 'text-foreground',
  },

  variants: {
    focused: {
      true: {
        input: 'border-ring',
      },
    },
    error: {
      true: {
        input: 'border-danger-600',
        label: 'text-danger-600 dark:text-danger-400',
        inputValue: 'text-danger-600 dark:text-danger-400',
      },
    },
    disabled: {
      true: {
        input: 'bg-neutral-200 dark:bg-neutral-700',
      },
    },
  },
  defaultVariants: {
    error: false,
    disabled: false,
  },
});

const List = Platform.OS === 'web' ? FlashList : BottomSheetFlatList;

export type OptionType = { label: string; value: string | number };

type OptionsProps = {
  options: OptionType[];
  onSelect: (option: OptionType) => void;
  onDismiss?: () => void;
  value?: string | number;
  testID?: string;
};

function keyExtractor(item: OptionType) {
  return `select-item-${item.value}`;
}

export function Options({ ref, options, onSelect, onDismiss, value, testID }: OptionsProps & { ref?: React.RefObject<BottomSheetModal | null> }) {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';

  const renderSelectItem = React.useCallback(
    ({ item }: { item: OptionType }) => (
      <Option
        key={`select-item-${item.value}`}
        label={item.label}
        selected={value === item.value}
        onPress={() => onSelect(item)}
        testID={testID ? `${testID}-item-${item.value}` : undefined}
      />
    ),
    [onSelect, value, testID],
  );

  return (
    <Modal
      ref={ref}
      onDismiss={onDismiss}
      snapPoints={['70%']}
      backgroundStyle={{
        backgroundColor: isDark ? colors.theme.dark.card : colors.theme.light.card,
      }}
    >
      <List
        accessibilityRole="list"
        data={options}
        keyExtractor={keyExtractor}
        renderItem={renderSelectItem}
        testID={testID ? `${testID}-modal` : undefined}
      />
    </Modal>
  );
}

const Option = React.memo(
  ({
    label,
    selected = false,
    ...props
  }: PressableProps & {
    selected?: boolean;
    label: string;
  }) => {
    return (
      <Pressable
        className="min-h-12 flex-row items-center border-b border-neutral-300 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        {...props}
      >
        <Text className="flex-1 dark:text-neutral-100">{label}</Text>
        {selected && <Check />}
      </Pressable>
    );
  },
);

export type SelectProps = {
  value?: string | number;
  label?: string;
  disabled?: boolean;
  error?: string;
  options?: OptionType[];
  onSelect?: (value: string | number) => void;
  placeholder?: string;
  testID?: string;
};

export function Select(props: SelectProps) {
  const {
    label,
    value,
    error,
    options = [],
    placeholder = 'select...',
    disabled = false,
    onSelect,
    testID,
  } = props;
  const modal = useModal();
  const triggerRef = React.useRef<View>(null);

  const onSelectOption = React.useCallback(
    (option: OptionType) => {
      onSelect?.(option.value);
      modal.dismiss();
    },
    [modal, onSelect],
  );

  const styles = React.useMemo(
    () =>
      selectTv({
        error: Boolean(error),
        disabled,
      }),
    [error, disabled],
  );

  const textValue = React.useMemo(
    () =>
      value !== undefined
        ? (options?.filter(t => t.value === value)?.[0]?.label ?? placeholder)
        : placeholder,
    [value, options, placeholder],
  );

  return (
    <>
      <View className={styles.container()}>
        {label && (
          <Text
            testID={testID ? `${testID}-label` : undefined}
            className={styles.label()}
            accessible={false}
          >
            {label}
          </Text>
        )}
        <Pressable
          className={styles.input()}
          disabled={disabled}
          ref={triggerRef}
          onPress={() => modal.presentFrom(() => triggerRef.current)}
          testID={testID ? `${testID}-trigger` : undefined}
          accessibilityRole="button"
          accessibilityLabel={label ?? placeholder}
          accessibilityHint={error}
          accessibilityValue={{ text: textValue }}
          accessibilityState={{ disabled }}
        >
          <View className="flex-1">
            <Text className={styles.inputValue()}>{textValue}</Text>
          </View>
          <CaretDown />
        </Pressable>
        {error && (
          <Text
            testID={`${testID}-error`}
            className="text-sm text-danger-600 dark:text-danger-400"
            accessible={false}
          >
            {error}
          </Text>
        )}
      </View>
      <Options
        testID={testID}
        ref={modal.ref}
        options={options}
        value={value}
        onSelect={onSelectOption}
        onDismiss={modal.restoreFocus}
      />
    </>
  );
}

function Check({ ...props }: SvgProps) {
  return (
    <StyledSvg
      width={25}
      height={24}
      fill="none"
      viewBox="0 0 25 24"
      {...props}
      className="stroke-black dark:stroke-white"
    >
      <Path
        d="m20.256 6.75-10.5 10.5L4.506 12"
        strokeWidth={2.438}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </StyledSvg>
  );
}
