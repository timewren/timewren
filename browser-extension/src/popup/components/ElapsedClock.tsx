import { useTimerStore } from "../../stores/timerStore";
import { ClockText } from "./ClockText";

export function formatClock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Timerens tid som "01:24:08". Kun dette element abonnerer på det sekundvise
 * tick, så resten af timeren, headeren og ny fane ikke tegnes om hvert sekund.
 */
export function ElapsedClock() {
  const displayTime = useTimerStore((s) => s.displayTime);
  return <ClockText value={formatClock(displayTime)} />;
}
