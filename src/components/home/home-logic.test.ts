import { describe, expect, it } from "vitest";
import {
  canSaveHomeDraft,
  formatDuration,
  formatRange,
  greetingFor,
  isTypingTarget,
  quickStartLabel,
} from "./home-logic";

const base = {
  hours: 2,
  description: "Logo",
  clientId: "c1",
  projectId: null,
  requireClientOrProject: true,
};

describe("canSaveHomeDraft", () => {
  it("kræver varighed > 0 og beskrivelse", () => {
    expect(canSaveHomeDraft(base)).toBe(true);
    expect(canSaveHomeDraft({ ...base, hours: null })).toBe(false);
    expect(canSaveHomeDraft({ ...base, hours: 0 })).toBe(false);
    expect(canSaveHomeDraft({ ...base, description: "   " })).toBe(false);
  });

  it("kræver kunde eller projekt når modulerne er slået til", () => {
    expect(canSaveHomeDraft({ ...base, clientId: null })).toBe(false);
    expect(canSaveHomeDraft({ ...base, clientId: null, projectId: "p1" })).toBe(
      true,
    );
    expect(
      canSaveHomeDraft({
        ...base,
        clientId: null,
        requireClientOrProject: false,
      }),
    ).toBe(true);
  });
});

describe("isTypingTarget", () => {
  it("genkender felter og contenteditable", () => {
    expect(isTypingTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(
      true,
    );
    expect(
      isTypingTarget({ tagName: "textarea" } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isTypingTarget({
        tagName: "DIV",
        isContentEditable: true,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isTypingTarget({
        tagName: "DIV",
        getAttribute: () => "textbox",
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isTypingTarget({ tagName: "BUTTON" } as unknown as EventTarget),
    ).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("greetingFor", () => {
  it("følger tidspunktet", () => {
    expect(greetingFor(3)).toBe("God nat");
    expect(greetingFor(8)).toBe("God morgen");
    expect(greetingFor(11)).toBe("God formiddag");
    expect(greetingFor(14)).toBe("God eftermiddag");
    expect(greetingFor(20)).toBe("God aften");
  });
});

describe("formatDuration", () => {
  it("formaterer timer og minutter", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(0.75)).toBe("45 min");
    expect(formatDuration(2)).toBe("2 t");
    expect(formatDuration(2.25)).toBe("2 t 15 min");
  });
});

describe("formatRange", () => {
  it("viser dansk tid og null uden tidsrum", () => {
    expect(formatRange(null, null)).toBeNull();
    expect(formatRange("2026-10-02T07:15:00Z", "2026-10-02T09:00:00Z")).toBe(
      "09.15–11.00",
    );
  });
});

describe("quickStartLabel", () => {
  it("projekt først, ellers kunden", () => {
    expect(
      quickStartLabel({ projectName: "Hjemmeside", clientName: "Acme" }),
    ).toEqual({ primary: "Hjemmeside", secondary: "Acme" });
    expect(quickStartLabel({ projectName: null, clientName: "Acme" })).toEqual({
      primary: "Acme",
      secondary: null,
    });
  });
});
