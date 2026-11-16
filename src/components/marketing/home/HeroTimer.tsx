"use client";

import { Play, Square } from "lucide-react";
import Link from "next/link";
import { usePlausible } from "next-plausible";
import { useEffect, useState } from "react";
import { appLinkHref } from "@/lib/config";

/**
 * Et rigtigt stopur i forsidens hero: besøgende kan registrere tid med det
 * samme, uden konto. Posterne ligger kun i browseren (localStorage), og
 * de flytter ikke med over i en konto (intet læser nøglen ved oprettelse).
 */

type Entry = { description: string; startedAt: number; seconds: number };

type Stored = {
  day: string;
  running: { description: string; startedAt: number } | null;
  entries: Entry[];
};

const STORAGE_KEY = "tt-hero-timer";

function today(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function load(): Stored {
  const empty: Stored = { day: today(), running: null, entries: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Stored;
    // Gårsdagens poster hører ikke til "I dag"
    return parsed.day === today() ? parsed : empty;
  } catch {
    return empty;
  }
}

function save(state: Stored) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Privat vindue eller fuld storage: stopuret virker stadig i sessionen
  }
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

function formatShort(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} t` : `${h} t ${m} min`;
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("da-DK", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HeroTimer() {
  const plausible = usePlausible();
  const [state, setState] = useState<Stored | null>(null);
  const [description, setDescription] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const loaded = load();
    setState(loaded);
    if (loaded.running) setDescription(loaded.running.description);
  }, []);

  const running = state?.running ?? null;

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const update = (next: Stored) => {
    setState(next);
    save(next);
  };

  const start = () => {
    const base = state ?? { day: today(), running: null, entries: [] };
    update({
      ...base,
      running: { description: description.trim(), startedAt: Date.now() },
    });
    plausible("hero_timer_start");
  };

  const stop = () => {
    if (!state?.running) return;
    const seconds = Math.max(
      1,
      Math.round((Date.now() - state.running.startedAt) / 1000),
    );
    update({
      ...state,
      running: null,
      entries: [
        {
          description: state.running.description || "Uden beskrivelse",
          startedAt: state.running.startedAt,
          seconds,
        },
        ...state.entries,
      ].slice(0, 20),
    });
    setDescription("");
    plausible("hero_timer_stop", { props: { seconds } });
  };

  const elapsed = running ? (now - running.startedAt) / 1000 : 0;
  const entries = state?.entries ?? [];
  const total = entries.reduce((sum, e) => sum + e.seconds, 0) + elapsed;

  return (
    <div className="rounded-[14px] border border-tt-streg bg-tt-papir">
      <div className="flex items-center justify-between border-b border-tt-streg px-5 py-3 text-sm">
        <span className="font-medium text-tt-blaek">I dag</span>
        <span className="text-tt-graa">
          <span className="sr-only">I alt i dag: </span>
          {formatShort(total)}
        </span>
      </div>

      <div className="px-5 pt-6 pb-5">
        <div
          role="timer"
          aria-label={running ? "Timeren kører" : "Timeren er stoppet"}
          className="flex items-center gap-3"
        >
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              running ? "bg-tt-gran motion-safe:animate-pulse" : "bg-tt-kant"
            }`}
          />
          <Clock seconds={elapsed} />
        </div>

        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            running ? stop() : start();
          }}
        >
          <label htmlFor="hero-timer-desc" className="sr-only">
            Hvad arbejder du på?
          </label>
          <input
            id="hero-timer-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={Boolean(running)}
            maxLength={80}
            placeholder="Hvad arbejder du på?"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-tt-kant bg-tt-papir px-3 text-base text-tt-blaek placeholder:text-tt-graa disabled:bg-tt-flade disabled:text-tt-graa"
          />
          <button
            type="submit"
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-4 text-base font-semibold transition-colors ${
              running
                ? "bg-tt-blaek text-tt-papir hover:opacity-90"
                : "bg-tt-gran text-tt-paa-gran hover:bg-tt-gran-moerk"
            }`}
          >
            {running ? (
              <>
                <Square
                  className="h-3.5 w-3.5 fill-current"
                  aria-hidden="true"
                />
                Stop
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                Start
              </>
            )}
          </button>
        </form>
      </div>

      {entries.length > 0 ? (
        <>
          <ul className="divide-y divide-tt-streg border-t border-tt-streg">
            {entries.slice(0, 3).map((entry) => (
              <li
                key={entry.startedAt}
                className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm"
              >
                <span className="truncate text-tt-blaek">
                  {entry.description}
                </span>
                <span className="flex shrink-0 gap-3">
                  <span className="text-tt-graa">
                    {clockTime(entry.startedAt)}
                  </span>
                  <span className="font-medium text-tt-blaek">
                    {formatShort(entry.seconds)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-tt-streg bg-tt-flade px-5 py-3 text-sm text-tt-graa">
            Timerne her bliver i denne browser og flytter ikke med over i en
            konto.{" "}
            <Link
              href={appLinkHref("/register")}
              className="font-medium text-tt-gran underline underline-offset-2"
              onClick={() =>
                plausible("cta_signup_click", {
                  props: { location: "hero_timer", href: "/register" },
                })
              }
            >
              Opret en konto
            </Link>
            , så registrerer du fremover på telefonen, i browseren og på
            computeren.
          </div>
        </>
      ) : (
        <p className="border-t border-tt-streg px-5 py-3 text-sm text-tt-graa">
          Du behøver ikke en konto for at starte.
        </p>
      )}
    </div>
  );
}

/** Uret: tal med faste cifre, kolonerne i egne spans (BRAND.md → Tal). */
function Clock({ seconds }: { seconds: number }) {
  const [h, m, s] = formatClock(seconds).split(":");
  return (
    <span className="text-[44px] font-bold leading-none tracking-[-0.02em] text-tt-blaek sm:text-6xl">
      <span className="tabular-nums">{h}</span>
      <span>:</span>
      <span className="tabular-nums">{m}</span>
      <span>:</span>
      <span className="tabular-nums">{s}</span>
    </span>
  );
}
