import * as React from 'react';
import { AppState } from 'react-native';
import { toISODate } from '~/lib/format';

/** Millisekunder til næste lokale midnat — aldrig under et minut, så et ur der springer ikke giver et tæt loop. */
function msUntilMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(next.getTime() - now.getTime(), 60_000);
}

/**
 * Dagens kalenderdato som `yyyy-MM-dd`.
 *
 * Udledes i en state-initializer, aldrig under render: værdien er stabil
 * gennem hele dagen, så den kan stå i en query-nøgle uden at genhente ved
 * hvert render. Den genberegnes både når uret passerer midnat og når appen
 * bliver aktiv igen — en telefon der lå på bordet over natten skal vise
 * dagens dato, ikke gårsdagens.
 */
export function useToday(): string {
  const [today, setToday] = React.useState(() => toISODate(new Date()));

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer)
        clearTimeout(timer);
      timer = setTimeout(() => {
        setToday(toISODate(new Date()));
        schedule();
      }, msUntilMidnight());
    };
    schedule();

    // iOS sætter ofte baggrundstimere i bane, så midnat kan springes over;
    // appState-ændringen er den sikre kontrol. React springer render fra ved
    // uændret værdi, så det koster intet at læse dagen igen.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active')
        setToday(toISODate(new Date()));
    });
    return () => {
      if (timer)
        clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return today;
}

/** Det kalenderår `useToday` står i — følger med ved årsskiftet kl. 00.00. */
export function useCurrentYear(): number {
  return Number(useToday().slice(0, 4));
}
