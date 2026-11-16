import { usePathname, useRouter } from 'expo-router';
import * as React from 'react';
import { captureScreen } from 'react-native-view-shot';
import { setPendingFeedback } from './feedback-store';

/** Tag et skærmbillede af den aktuelle skærm og åbn feedback-skærmen. */
export function useOpenFeedback() {
  const router = useRouter();
  const pathname = usePathname();
  return React.useCallback(async () => {
    let shot: string | null = null;
    try {
      // 720 px bred holder PNG'en langt under serverens 2 MB-grænse
      shot = await captureScreen({ format: 'png', result: 'base64', width: 720 });
    }
    catch {
      // Skærmbillede er nice-to-have — feedback kan sendes uden
    }
    setPendingFeedback(shot, pathname);
    router.push('/feedback');
  }, [pathname, router]);
}
