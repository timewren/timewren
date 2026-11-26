import { Link } from 'expo-router';

import { Pressable, Text, View } from '~/components/ui';
import { translate } from '~/lib/i18n';

export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background p-4">
      <Text className="mb-2 text-center text-2xl font-bold text-foreground">{translate('common.not_found_title')}</Text>
      <Text className="mb-4 text-center text-muted-foreground">{translate('common.not_found_body')}</Text>

      <Link href="/" asChild>
        <Pressable className="mt-4 min-h-11 justify-center" accessibilityRole="link">
          <Text className="text-primary-600 underline dark:text-primary-400">{translate('common.go_home')}</Text>
        </Pressable>
      </Link>
    </View>
  );
}
