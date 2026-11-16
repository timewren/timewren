import { describe, expect, it } from "vitest";
import {
  answerForButton,
  readIdlePrompt,
  sameIdleSession,
} from "./idle-prompt";

describe("idle-spørgsmålet i popup'en (#C8)", () => {
  const prompt = { kind: "away", away: "45 min", clock: "14:05", at: 1000 };

  it("viser kun gyldige og nye spørgsmål", () => {
    expect(readIdlePrompt(prompt, 2000)).toEqual(prompt);
    expect(readIdlePrompt(prompt, 1000 + 13 * 60 * 60 * 1000)).toBeNull();
    expect(readIdlePrompt({ ...prompt, kind: "x" }, 2000)).toBeNull();
    expect(readIdlePrompt(undefined)).toBeNull();
  });

  it("knapperne betyder det samme som før", () => {
    expect(answerForButton("away", 0)).toBe("keep");
    expect(answerForButton("away", 1)).toBe("discard");
    expect(answerForButton("paused", 0)).toBe("resume");
    // Gammel notifikation uden gemt spørgsmål: som før
    expect(answerForButton(null, 1)).toBe("discard");
    expect(answerForButton(null, 0)).toBe("resume");
  });
});

describe("gammelt spørgsmål og en ny timer (review P2)", () => {
  it("rører ikke en anden session", () => {
    expect(sameIdleSession("a", "b")).toBe(false);
    expect(sameIdleSession("a", "a")).toBe(true);
    // Ukendt på én af siderne: som før
    expect(sameIdleSession(null, "b")).toBe(true);
    expect(sameIdleSession("a", null)).toBe(true);
  });
});
