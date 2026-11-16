import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hvad der er tilbage til dagens kolonner.
 *
 * To ting afgør det, og de lå begge fast i koden uanset vinduet:
 *
 * 1. **`min-w-0` på `main`.** Et flex-barn har `min-width: auto`, så ét bredt
 *    barn — ugentidslinjens syv dage, et projektnavn uden mellemrum — trykker
 *    `main` ud over sin andel. `overflow-hidden` på rækken så sidebaren forsvinde
 *    i stedet for at indholdet blev klippet, altså en sti der fjerner
 *    navigationen. Det er præcis modsatningen af «dagens kolonner skal kunne
 *    ses».
 * 2. **Paddingen følger bredden.** 48 px er 6 % af et 800 px vindue og 1,9 % af
 *    et 2560 px. Den lå fast på 48.
 *
 * Bredderne er målt i `Sidebar.layout.test.tsx`; her dømmes kun at `main` faktisk
 * følger det samme `smalt`-flag — ellers kunne de to være uafhængige og intet
 * ville sige det.
 */

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: async () => "0.0.0-test",
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: async () => {},
    minimize: async () => {},
    toggleMaximize: async () => {},
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => ({ to: "/" }),
  useRouterState: () => ({ location: { pathname: "/" } }),
  Outlet: () => null,
}));

import { NARROW_MAX_WIDTH } from "@/hooks/useNarrowLayout";
import { AppShell } from "../AppShell";

function setBredde(px: number) {
  Object.defineProperty(window, "innerWidth", {
    value: px,
    configurable: true,
    writable: true,
  });
}

function main(): HTMLElement {
  return document.querySelector("main") as HTMLElement;
}

beforeEach(() => {
  setBredde(NARROW_MAX_WIDTH + 1);
});

afterEach(() => {
  cleanup();
});

describe("AppShell", () => {
  it("giver main den padding, vinduet har plads til", () => {
    render(<AppShell />);
    expect(main().className).toContain("p-6");

    setBredde(900);
    fireEvent(window, new Event("resize"));
    expect(main().className).toContain("p-3");
    expect(main().className).not.toContain("p-6");
  });

  it("lader main krympe under sit indhold, så sidebaren ikke skubbes væk", () => {
    // Uden `min-w-0` er `main`s minimum bredde *dets eget bredeste barn*, og
    // den kan da ikke krympe under 800 px vinduet minus padding.
    render(<AppShell />);
    expect(main().className).toContain("min-w-0");
  });
});
