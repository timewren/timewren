import { describe, expect, it, vi } from "vitest";
import {
  appendDictation,
  collectTranscript,
  detectLocalSpeech,
  getLocalSpeechCtor,
  installLocalSpeech,
  type SpeechRecognitionCtorLike,
  speechErrorMessage,
} from "./local-speech";

function makeCtor(opts: {
  available?: (o: unknown) => Promise<string>;
  install?: (o: unknown) => Promise<boolean>;
  processLocally?: boolean;
}): SpeechRecognitionCtorLike {
  // biome-ignore lint/complexity/useArrowFunction: skal kunne kaldes med new
  const Ctor = function () {} as unknown as SpeechRecognitionCtorLike;
  if (opts.processLocally !== false) {
    (Ctor.prototype as Record<string, unknown>).processLocally = false;
  }
  if (opts.available) Ctor.available = opts.available;
  if (opts.install) Ctor.install = opts.install;
  return Ctor;
}

describe("getLocalSpeechCtor", () => {
  it("afviser browsere uden Web Speech", () => {
    expect(getLocalSpeechCtor({})).toBeNull();
    expect(getLocalSpeechCtor(undefined)).toBeNull();
  });

  it("afviser cloud-only Web Speech (ingen available/processLocally)", () => {
    const cloudOnly = makeCtor({ processLocally: false });
    expect(
      getLocalSpeechCtor({ webkitSpeechRecognition: cloudOnly }),
    ).toBeNull();
    const noAvailable = makeCtor({});
    expect(getLocalSpeechCtor({ SpeechRecognition: noAvailable })).toBeNull();
  });

  it("accepterer on-device-API'et", () => {
    const ctor = makeCtor({ available: async () => "available" });
    expect(getLocalSpeechCtor({ SpeechRecognition: ctor })).toBe(ctor);
  });
});

describe("detectLocalSpeech", () => {
  it("spørger efter dansk med processLocally", async () => {
    const available = vi.fn(async () => "downloadable");
    const status = await detectLocalSpeech(makeCtor({ available }), "da-DK");
    expect(status).toBe("downloadable");
    expect(available).toHaveBeenCalledWith({
      langs: ["da-DK"],
      processLocally: true,
    });
  });

  it("ukendt svar = unavailable, fejl/ingen ctor = unsupported", async () => {
    expect(
      await detectLocalSpeech(
        makeCtor({ available: async () => "maybe" }),
        "da-DK",
      ),
    ).toBe("unavailable");
    expect(
      await detectLocalSpeech(
        makeCtor({
          available: async () => {
            throw new Error("x");
          },
        }),
        "da-DK",
      ),
    ).toBe("unsupported");
    expect(await detectLocalSpeech(null, "da-DK")).toBe("unsupported");
  });
});

describe("installLocalSpeech", () => {
  it("returnerer false uden install eller ved fejl", async () => {
    expect(await installLocalSpeech(makeCtor({}), "da-DK")).toBe(false);
    expect(
      await installLocalSpeech(
        makeCtor({
          install: async () => {
            throw new Error("nej");
          },
        }),
        "da-DK",
      ),
    ).toBe(false);
    expect(
      await installLocalSpeech(
        makeCtor({ install: async () => true }),
        "da-DK",
      ),
    ).toBe(true);
  });
});

describe("collectTranscript", () => {
  it("skiller endelig og foreløbig tekst ad fra resultIndex", () => {
    const res = (t: string, isFinal: boolean) => ({
      isFinal,
      0: { transcript: t },
      length: 1,
    });
    const out = collectTranscript({
      resultIndex: 1,
      results: [res("gammel", true), res("2 timer ", true), res("acme", false)],
    });
    expect(out).toEqual({ final: "2 timer", interim: "acme" });
  });
});

describe("appendDictation", () => {
  it("tilføjer med mellemrum og ignorerer tom tale", () => {
    expect(appendDictation("", "2 timer")).toBe("2 timer");
    expect(appendDictation("Acme ", "logo")).toBe("Acme logo");
    expect(appendDictation("Acme", "  ")).toBe("Acme");
  });
});

describe("speechErrorMessage", () => {
  it("tier ved ingen tale og forklarer blokeret mikrofon", () => {
    expect(speechErrorMessage("no-speech")).toBeNull();
    expect(speechErrorMessage("aborted")).toBeNull();
    expect(speechErrorMessage("not-allowed")).toMatch(/blokeret/);
    expect(speechErrorMessage("noget-nyt")).toMatch(/Prøv igen/);
  });
});
