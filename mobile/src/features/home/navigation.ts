import type { Href } from 'expo-router';
import { router } from 'expo-router';

/**
 * Ruter der ejes af andre features (registreringer, Tid-fanen). Vi linker
 * med sti-strenge uden at importere fra dem — typed routes kender først
 * ruterne når filerne findes.
 */
export const ROUTES = {
  newEntry: '/entries/new',
  entry: (id: string) => `/entries/${id}`,
  time: '/time',
} as const;

export function goTo(path: string) {
  router.push(path as Href);
}
