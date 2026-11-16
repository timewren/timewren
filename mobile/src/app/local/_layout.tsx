import { Stack } from 'expo-router';
import * as React from 'react';

/** "Uden konto"-tilstand: egen lille stak uden faner. */
export default function LocalLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
