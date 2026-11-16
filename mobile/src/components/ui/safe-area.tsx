import { SafeAreaView as RNSCSafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

/** SafeAreaView med className-understøttelse (tredjeparts-komponent → withUniwind). */
export const SafeAreaView = withUniwind(RNSCSafeAreaView);
