/* eslint-disable react-refresh/only-export-components */
/**
 * Modal
 * Dependencies:
 * - @gorhom/bottom-sheet.
 *
 * Props:
 * - All `BottomSheetModalProps` props.
 * - `title` (string | undefined): Optional title for the modal header.
 * - `scrollable`: Scroll the header and children together.
 *
 * Usage Example:
 * import { Modal, useModal } from '@gorhom/bottom-sheet';
 *
 * function DisplayModal() {
 *   const { ref, present, dismiss } = useModal();
 *
 *   return (
 *     <View>
 *       <Modal
 *         snapPoints={['60%']} // optional
 *         title="Modal Title"
 *         ref={ref}
 *       >
 *         Modal Content
 *       </Modal>
 *     </View>
 *   );
 * }
 *
 */

import type {
  BottomSheetBackdropProps,
  BottomSheetModalProps,
} from '@gorhom/bottom-sheet';
import { BottomSheetModal, BottomSheetModalProvider, useBottomSheet, useBottomSheetModal } from '@gorhom/bottom-sheet';
import * as React from 'react';
import { AccessibilityInfo, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Path } from 'react-native-svg';
import { useUniwind } from 'uniwind';
import { translate } from '~/lib/i18n';

import { BottomSheetScrollView } from './bottom-sheet';
import colors from './colors';

import { StyledSvg } from './svg';
import { Text } from './text';

type ModalProps = Omit<BottomSheetModalProps, 'children'> & {
  title?: string;
} & (
  | { scrollable?: false; children: BottomSheetModalProps['children'] }
  | { scrollable: true; children: React.ReactNode }
);

type ModalRef = React.ForwardedRef<BottomSheetModal>;

type ModalHeaderProps = {
  title?: string;
  dismiss: () => void;
  focusRef: React.RefObject<View | null>;
};

function focusSheetControl(view: View | null) {
  if (view)
    AccessibilityInfo.sendAccessibilityEvent(view, 'focus');
}

export function useModal() {
  const ref = React.useRef<BottomSheetModal>(null);
  const returnFocusRef = React.useRef<(() => View | null) | null>(null);
  const presentFrom = React.useCallback((getTrigger: () => View | null) => {
    returnFocusRef.current = getTrigger;
    ref.current?.present();
  }, []);
  const restoreFocus = React.useCallback(() => {
    const getTrigger = returnFocusRef.current;
    returnFocusRef.current = null;
    if (getTrigger) {
      requestAnimationFrame(() => {
        if (!returnFocusRef.current)
          focusSheetControl(getTrigger());
      });
    }
  }, []);
  const present = React.useCallback((data?: any) => {
    returnFocusRef.current = null;
    ref.current?.present(data);
  }, []);
  const dismiss = React.useCallback(() => {
    ref.current?.dismiss();
  }, []);
  const clearReturnFocus = React.useCallback(() => {
    returnFocusRef.current = null;
  }, []);
  return { ref, present, dismiss, presentFrom, restoreFocus, clearReturnFocus };
}

export function Modal({ ref, snapPoints: _snapPoints = ['60%'] as (string | number)[], title, detached = false, onChange, scrollable, children, ...props }: ModalProps & { ref?: ModalRef }) {
  const detachedProps = React.useMemo(
    () => getDetachedProps(detached),
    [detached],
  );
  const modal = useModal();
  const focusRef = React.useRef<View>(null);
  const wasOpenRef = React.useRef(false);
  const snapPoints = React.useMemo(() => _snapPoints, [_snapPoints]);
  const { theme } = useUniwind();
  const backgroundStyle = React.useMemo(
    () => ({ backgroundColor: colors.theme[theme === 'dark' ? 'dark' : 'light'].card }),
    [theme],
  );

  React.useImperativeHandle(
    ref,
    () => (modal.ref.current as BottomSheetModal) || null,
  );

  const renderHandleComponent = React.useCallback(
    () => (
      <>
        <View className="mt-2 h-1 w-12 self-center rounded-lg bg-neutral-300 dark:bg-neutral-600" />
        {!scrollable && <ModalHeader title={title} dismiss={modal.dismiss} focusRef={focusRef} />}
      </>
    ),
    [title, modal.dismiss, scrollable],
  );

  return (
    <BottomSheetModal
      backgroundStyle={backgroundStyle}
      // gorhom sætter accessible + label "Bottom Sheet" på containeren, hvilket
      // skjuler alt indhold for VoiceOver (og Maestro) på iOS.
      {...props}
      accessible={false}
      accessibilityLabel={null}
      accessibilityRole={null}
      containerComponent={props.containerComponent ?? ModalContainer}
      onChange={(index, position, type) => {
        if (index >= 0 && !wasOpenRef.current)
          focusSheetControl(focusRef.current);
        wasOpenRef.current = index >= 0;
        onChange?.(index, position, type);
      }}
      onDismiss={() => {
        wasOpenRef.current = false;
        props.onDismiss?.();
      }}
      {...detachedProps}
      ref={modal.ref}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={props.backdropComponent || renderBackdrop}
      enableDynamicSizing={false}
      handleComponent={renderHandleComponent}
    >
      {scrollable
        ? (
            <BottomSheetScrollView>
              <ModalHeader title={title} dismiss={modal.dismiss} focusRef={focusRef} />
              {children}
            </BottomSheetScrollView>
          )
        : children}
    </BottomSheetModal>
  );
}

const SheetCountContext = React.createContext<React.Dispatch<React.SetStateAction<number>> | null>(null);

export function AccessibleSheetProvider({ children }: React.PropsWithChildren) {
  const [sheetCount, setSheetCount] = React.useState(0);
  return (
    <SheetCountContext value={setSheetCount}>
      <BottomSheetModalProvider>
        <View
          style={styles.screen}
          importantForAccessibility={sheetCount > 0 ? 'no-hide-descendants' : 'auto'}
          accessibilityElementsHidden={sheetCount > 0}
        >
          {children}
        </View>
      </BottomSheetModalProvider>
    </SheetCountContext>
  );
}

const styles = StyleSheet.create({ screen: { flex: 1 } });

function ModalContainer({ children }: React.PropsWithChildren) {
  const setSheetCount = React.use(SheetCountContext);
  const { dismiss } = useBottomSheetModal();
  React.useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => dismiss());
    return () => subscription.remove();
  }, [dismiss]);
  React.useLayoutEffect(() => {
    setSheetCount?.(count => count + 1);
    return () => setSheetCount?.(count => count - 1);
  }, [setSheetCount]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal onAccessibilityEscape={() => dismiss()}>
      {children}
    </View>
  );
}

/**
 * Custom Backdrop
 */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function CustomBackdrop({ style }: BottomSheetBackdropProps) {
  const { close } = useBottomSheet();
  return (
    <AnimatedPressable
      onPress={() => close()}
      entering={FadeIn.duration(50)}
      exiting={FadeOut.duration(20)}
      // Tap-og-luk er en bonusbevægelse; som selvstændigt element læser skærmlæseren
      // den som en tom knap, og den dækker hele arket bag arket.
      accessible={false}
      importantForAccessibility="no"
      style={[style, { backgroundColor: 'rgba(0, 0, 0, 0.4)' }]}
    />
  );
}

export function renderBackdrop(props: BottomSheetBackdropProps) {
  return <CustomBackdrop {...props} />;
}

/**
 *
 * @param detached
 * @returns
 *
 * @description
 * In case the modal is detached, we need to add some extra props to the modal to make it look like a detached modal.
 */

function getDetachedProps(detached: boolean) {
  if (detached) {
    return {
      detached: true,
      bottomInset: 46,
      style: { marginHorizontal: 16, overflow: 'hidden' },
    } as Partial<BottomSheetModalProps>;
  }
  return {} as Partial<BottomSheetModalProps>;
}

/**
 * ModalHeader
 */

const ModalHeader = React.memo(({ title, dismiss, focusRef }: ModalHeaderProps) => (
  <View className="flex-row items-center gap-2 px-4 py-1" onAccessibilityEscape={dismiss}>
    {title && (
      <View ref={focusRef} accessible accessibilityRole="header" accessibilityLabel={title} className="flex-1">
        <Text className="text-base font-bold text-foreground">{title}</Text>
      </View>
    )}
    <Pressable
      ref={title ? undefined : focusRef}
      onPress={dismiss}
      onAccessibilityEscape={dismiss}
      className="ml-auto items-center justify-center rounded-full"
      style={{ minHeight: 48, minWidth: 48 }}
      accessibilityLabel={translate('common.close')}
      accessibilityRole="button"
      accessibilityHint={translate('common.close_hint')}
    >
      <StyledSvg
        className="fill-foreground"
        width={24}
        height={24}
        viewBox="0 0 24 24"
      >
        <Path d="M18.707 6.707a1 1 0 0 0-1.414-1.414L12 10.586 6.707 5.293a1 1 0 0 0-1.414 1.414L10.586 12l-5.293 5.293a1 1 0 1 0 1.414 1.414L12 13.414l5.293 5.293a1 1 0 0 0 1.414-1.414L13.414 12l5.293-5.293Z" />
      </StyledSvg>
    </Pressable>
  </View>
));
