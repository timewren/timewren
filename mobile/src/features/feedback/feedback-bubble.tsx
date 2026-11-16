import { usePathname } from 'expo-router';
import { MessageSquareText } from 'lucide-react-native';
import * as React from 'react';
import { Pressable } from 'react-native';
import { colors } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { useOpenFeedback } from './use-open-feedback';

// Skærme hvor boblen ville forstyrre eller være meningsløs
const HIDDEN_ON = ['/feedback', '/onboarding', '/login', '/signup', '/setup', '/settings/feedback'];

/**
 * Smal greb-fane i højre kant (som bugbottle) — passer i skærmens 16 px margen, så den ikke dækker
 * indhold. Et tryk tager et skærmbillede af
 * den aktuelle skærm og åbner feedback. Sidder midt på kanten, så den ikke dækker
 * FAB'er og faner i bunden.
 */
export function FeedbackBubble() {
  const pathname = usePathname();
  const open = useOpenFeedback();
  if (HIDDEN_ON.includes(pathname))
    return null;
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={translate('settings.feedback.bubble')}
      hitSlop={{ top: 12, bottom: 12, left: 16, right: 8 }}
      className="absolute top-[62%] right-0 h-11 w-3 items-center justify-center rounded-l-md bg-primary-600/80 active:bg-primary-600"
      testID="feedback-bubble"
    >
      <MessageSquareText size={10} color={colors.white} />
    </Pressable>
  );
}
