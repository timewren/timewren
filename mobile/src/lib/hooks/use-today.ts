import * as React from 'react';
import { AppState } from 'react-native';
import { toCopenhagenISODate, toISODate } from '~/lib/format';

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
export function useToday(timeZone: 'local' | 'Europe/Copenhagen' = 'local'): string {
  const dateAt = timeZone === 'Europe/Copenhagen' ? toCopenhagenISODate : toISODate;
  const [today, setToday] = React.useState(() => dateAt(new Date()));

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer)
        clearTimeout(timer);
      // Danish midnight falls on a whole UTC hour in both winter and summer.
      const hour = 60 * 60 * 1000;
      const delay = timeZone === 'Europe/Copenhagen' ? hour - Date.now() % hour : msUntilMidnight();
      timer = setTimeout(() => {
        setToday(dateAt(new Date()));
        schedule();
      }, delay);
    };
    schedule();

    // iOS sætter ofte baggrundstimere i bane, så midnat kan springes over;
    // appState-ændringen er den sikre kontrol. React springer render fra ved
    // uændret værdi, så det koster intet at læse dagen igen.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active')
        setToday(dateAt(new Date()));
    });
    return () => {
      if (timer)
        clearTimeout(timer);
      sub.remove();
    };
  }, [dateAt, timeZone]);

  return today;
}

/** Det kalenderår `useToday` står i — følger med ved årsskiftet kl. 00.00. */
export function useCurrentYear(): number {
  return Number(useToday().slice(0, 4));
}
