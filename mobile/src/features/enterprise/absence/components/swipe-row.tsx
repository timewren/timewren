import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Check, X } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import ReanimatedSwipeable, { SwipeDirection } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Text } from '~/components/ui/text';
import { translate } from '~/lib/i18n';

type SwipeRowProps = {
  /** Swipe mod højre (venstre panel) */
  onApprove: () => void;
  /** Swipe mod venstre (højre panel) */
  onReject: () => void;
  enabled?: boolean;
  children: React.ReactNode;
};

function ApprovePanel() {
  return (
    <View className="w-24 items-center justify-center bg-success-600">
      <Check size={22} color="#fff" />
      <Text className="text-xs font-semibold text-white">{translate('enterprise.absence.approve')}</Text>
    </View>
  );
}

function RejectPanel() {
  return (
    <View className="w-24 items-center justify-center bg-danger-600">
      <X size={22} color="#fff" />
      <Text className="text-xs font-semibold text-white">{translate('enterprise.absence.reject')}</Text>
    </View>
  );
}

/** Række med swipe: højre = godkend, venstre = afvis. Panelet lukker efter handlingen. */
export function SwipeRow({ onApprove, onReject, enabled = true, children }: SwipeRowProps) {
  const ref = React.useRef<SwipeableMethods>(null);
  const onOpen = React.useCallback((direction: SwipeDirection) => {
    ref.current?.close();
    if (direction === SwipeDirection.RIGHT)
      onApprove();
    else
      onReject();
  }, [onApprove, onReject]);
  return (
    <ReanimatedSwipeable
      ref={ref}
      enabled={enabled}
      friction={2}
      leftThreshold={60}
      rightThreshold={60}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={ApprovePanel}
      renderRightActions={RejectPanel}
      onSwipeableOpen={onOpen}
    >
      {children}
    </ReanimatedSwipeable>
  );
}
