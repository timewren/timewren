import { Stack } from 'expo-router';

/** Indstillinger som stack under Mere-fanen. Skærmene tegner selv header via `Screen back`. */
export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
