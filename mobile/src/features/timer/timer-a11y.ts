import { translate } from '~/lib/i18n';

/**
 * Tælleren som ord til skærmlæseren: "Timer kører, 1 time, 5 minutter".
 * VoiceOver læste før "00:12:34" ciffer for ciffer, og status var et eget stop.
 * Sekunder udelades: de er forældede, før de er læst op.
 */
export function spokenElapsed(seconds: number, running: boolean): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [translate(running ? 'timer.running' : 'timer.idle')];
  if (hours > 0)
    parts.push(translate(hours === 1 ? 'timer.elapsed_hours_one' : 'timer.elapsed_hours_other', { count: hours }));
  if (running || total > 0)
    parts.push(translate(minutes === 1 ? 'timer.elapsed_minutes_one' : 'timer.elapsed_minutes_other', { count: minutes }));
  return parts.join(', ');
}
