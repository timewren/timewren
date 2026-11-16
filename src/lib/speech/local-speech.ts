import { sharedT } from "@/i18n/shared-text";
/**
 * Lokal (on-device) talegenkendelse via Web Speech API.
 *
 * Beslutning (docs/research/2026-10-02-hjem-dashboard.md): TimeTrack tilbyder
 * kun mikrofonen, når browseren bekræfter at genkendelsen kører PÅ maskinen
 * (`processLocally`, Chrome 139+ desktop). Standard-Web-Speech i Chrome/Edge
 * og Safari sender lyden til Google/Microsoft/Apple — det gør vi ikke uden en
 * databehandleraftale og et samtykkeflow. Uden lokal genkendelse henviser UI'et
 * til telefonens tastatur-diktering i stedet.
 *
 * Ingen React/DOM-imports her, så logikken kan testes i vitest.
 */

export type LocalSpeechStatus =
  /** Browseren har ikke on-device-API'et (eller ingen Web Speech overhovedet) */
  | "unsupported"
  /** Sprogpakken findes ikke lokalt og kan ikke hentes */
  | "unavailable"
  /** Kan hentes (~60 MB) — kræver et klik fra brugeren */
  | "downloadable"
  | "downloading"
  | "available";

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}
export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface AvailabilityOptions {
  langs: string[];
  processLocally: boolean;
}

export interface SpeechRecognitionCtorLike {
  new (): SpeechRecognitionLike;
  available?: (opts: AvailabilityOptions) => Promise<string>;
  install?: (opts: AvailabilityOptions) => Promise<boolean>;
  prototype: object;
}

/** Konstruktøren — kun hvis den har on-device-API'et. */
export function getLocalSpeechCtor(
  win: unknown,
): SpeechRecognitionCtorLike | null {
  if (!win || typeof win !== "object") return null;
  const w = win as {
    SpeechRecognition?: SpeechRecognitionCtorLike;
    webkitSpeechRecognition?: SpeechRecognitionCtorLike;
  };
  const ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!ctor) return null;
  if (typeof ctor.available !== "function") return null;
  if (!("processLocally" in ctor.prototype)) return null;
  return ctor;
}

const KNOWN: ReadonlySet<string> = new Set([
  "available",
  "downloadable",
  "downloading",
  "unavailable",
]);

export async function detectLocalSpeech(
  ctor: SpeechRecognitionCtorLike | null,
  lang: string,
): Promise<LocalSpeechStatus> {
  if (!ctor?.available) return "unsupported";
  try {
    const answer = await ctor.available({
      langs: [lang],
      processLocally: true,
    });
    return KNOWN.has(answer) ? (answer as LocalSpeechStatus) : "unavailable";
  } catch {
    return "unsupported";
  }
}

export async function installLocalSpeech(
  ctor: SpeechRecognitionCtorLike | null,
  lang: string,
): Promise<boolean> {
  if (!ctor?.install) return false;
  try {
    return await ctor.install({ langs: [lang], processLocally: true });
  } catch {
    return false;
  }
}

/** Saml den endelige og den foreløbige tekst fra et resultat-event. */
export function collectTranscript(e: SpeechRecognitionEventLike): {
  final: string;
  interim: string;
} {
  let final = "";
  let interim = "";
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const r = e.results[i];
    const t = r[0]?.transcript ?? "";
    if (r.isFinal) final += t;
    else interim += t;
  }
  return { final: final.trim(), interim: interim.trim() };
}

/** Sæt dikteret tekst ind efter det, brugeren allerede har skrevet. */
export function appendDictation(current: string, spoken: string): string {
  const s = spoken.trim();
  if (!s) return current;
  const c = current.trimEnd();
  return c ? `${c} ${s}` : s;
}

/** Brugervendt fejltekst for SpeechRecognition-fejlkoder. */
export function speechErrorMessage(
  code: string,
  locale?: string | null,
): string | null {
  switch (code) {
    case "aborted":
    case "no-speech":
      return null; // Ikke en fejl for brugeren — bare ingen tale
    case "not-allowed":
    case "service-not-allowed":
      return sharedT("sharedLabels", "speech.micBlocked", undefined, locale);
    case "audio-capture":
      return sharedT("sharedLabels", "speech.noMic", undefined, locale);
    case "language-not-supported":
      return sharedT(
        "sharedLabels",
        "speech.langUnsupported",
        {
          language: sharedT(
            "sharedLabels",
            "speech.language",
            undefined,
            locale,
          ),
        },
        locale,
      );
    default:
      return sharedT("sharedLabels", "speech.stopped", undefined, locale);
  }
}
