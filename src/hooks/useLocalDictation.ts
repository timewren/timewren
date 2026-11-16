"use client";

import { useLocale } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { toIntlLocale } from "@/i18n/format-locale";
import { sharedT } from "@/i18n/shared-text";
import {
  collectTranscript,
  detectLocalSpeech,
  getLocalSpeechCtor,
  installLocalSpeech,
  type LocalSpeechStatus,
  type SpeechRecognitionLike,
  speechErrorMessage,
} from "@/lib/speech/local-speech";

/**
 * Diktering med lokal (on-device) talegenkendelse. `status` er "unsupported"
 * indtil detektionen er færdig, så mikrofonen aldrig blinker frem og forsvinder.
 * Lyden forlader aldrig maskinen: `processLocally = true` er påkrævet.
 */
export function useLocalDictation(opts: {
  /** Endelig tekst for en ytring */
  onFinal: (text: string) => void;
}) {
  const locale = useLocale();
  const LANG = toIntlLocale(locale);
  const [status, setStatus] = useState<LocalSpeechStatus>("unsupported");
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(opts.onFinal);
  onFinalRef.current = opts.onFinal;

  useEffect(() => {
    let cancelled = false;
    const ctor = getLocalSpeechCtor(
      typeof window === "undefined" ? undefined : window,
    );
    detectLocalSpeech(ctor, LANG).then((s) => {
      if (!cancelled) setStatus(s);
    });
    return () => {
      cancelled = true;
      recRef.current?.abort();
    };
  }, [LANG]);

  const install = useCallback(async () => {
    const ctor = getLocalSpeechCtor(window);
    setStatus("downloading");
    const ok = await installLocalSpeech(ctor, LANG);
    const next = await detectLocalSpeech(ctor, LANG);
    setStatus(next);
    const language = sharedT(
      "sharedLabels",
      "speech.language",
      undefined,
      locale,
    );
    if (!ok || next !== "available") {
      toast.error(
        sharedT("sharedLabels", "speech.downloadFailed", { language }, locale),
      );
    } else {
      toast.success(
        sharedT("sharedLabels", "speech.ready", { language }, locale),
      );
    }
  }, [LANG, locale]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const ctor = getLocalSpeechCtor(window);
    if (!ctor || status !== "available" || recRef.current) return;
    const rec = new ctor();
    rec.lang = LANG;
    rec.processLocally = true;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const { final, interim: partial } = collectTranscript(e);
      setInterim(partial);
      if (final) onFinalRef.current(final);
    };
    rec.onerror = (e) => {
      const msg = speechErrorMessage(e.error, locale);
      if (msg) toast.error(msg);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      toast.error(
        sharedT("sharedLabels", "speech.cantStart", undefined, locale),
      );
    }
  }, [status, LANG, locale]);

  return { status, listening, interim, start, stop, install };
}
