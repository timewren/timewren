/**
 * Popup og ny fane beder baggrunden om at synke straks efter en
 * timerhandling, så badget og alarmens interval følger med uden at vente på
 * næste sync-alarm.
 */
export const TIMER_CHANGED = "TIMER_CHANGED";

export function notifyTimerChanged(): void {
  try {
    void chrome.runtime
      ?.sendMessage?.({ type: TIMER_CHANGED })
      ?.catch(() => {});
  } catch {
    // Ingen baggrund (fx i tests): alarmen synker senere
  }
}
