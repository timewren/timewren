import type { ConsoleEntry } from './feedback-logic';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { storage } from '~/lib/storage';
import { formatConsoleArgs, pushEntry } from './feedback-logic';

type FeedbackState = {
  /** Skærmbillede (base64-PNG) taget lige før feedback-skærmen åbnede. */
  screenshot: string | null;
  /** Ruten brugeren stod på, da de åbnede feedback. */
  route: string;
  console: ConsoleEntry[];
};

const useFeedbackStore = create<FeedbackState>(() => ({ screenshot: null, route: '/', console: [] }));

export const feedbackState = () => useFeedbackStore.getState();
export const useFeedbackState = useFeedbackStore;

export function setPendingFeedback(screenshot: string | null, route: string) {
  useFeedbackStore.setState({ screenshot, route });
}

let installed = false;

/** Opsaml de seneste console.error/warn (som bugbottle), så fejlrapporter har spor. Kaldes én gang ved opstart. */
export function installConsoleCapture() {
  if (installed)
    return;
  installed = true;
  for (const level of ['error', 'warn'] as const) {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      useFeedbackStore.setState(s => ({
        console: pushEntry(s.console, { ts: new Date().toISOString(), level, message: formatConsoleArgs(args) }),
      }));
      original(...args);
    };
  }
}

const INSTALL_ID_KEY = 'install-id';

/** Anonymt, stabilt id for denne installation (rate-limit og gruppering af feedback uden konto). */
export function getInstallId(): string {
  const existing = storage.getString(INSTALL_ID_KEY);
  if (existing)
    return existing;
  const id = Crypto.randomUUID();
  storage.set(INSTALL_ID_KEY, id);
  return id;
}
