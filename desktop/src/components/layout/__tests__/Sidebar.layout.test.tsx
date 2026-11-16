import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import en from "@/locales/en.json";
import sv from "@/locales/sv.json";

/**
 * Sidebaren i et smalt vindue.
 *
 * Før dette var der ingen bredde i appen overhovedet: sidebarens hover
 * udvidelse tog 164 px på ethvert vindue, også et på 800 px, og de otte
 * rækker lå som ens ikoner uden navn. Derfor dømmer testen fire ting:
 *
 * 1. **Ikonerne er centreret, og etiketten er væk.** Ellers ligger ikonet
 *    mod venstre kant af en 56 px bred bjælke, som ser ud som en fejl.
 * 2. **Hover må ikke stjæle pladsen i et smalt vindue.** Det er hele
 *    pointen: hover-udvidelsen er præcis de 164 px der skubber dagens
 *    kolonner ud af skærmen. Uden denne dømning kunne en mutation slå
 *    `smalt`-våben fra og testen stadig være grøn, fordi den kun tjekker
 *    bredden.
 * 3. **Navnet flytter med, det forsvinder ikke.** En række der kun er et
 *    ikon uden tooltip er ubynavngiven for alle — også synet, som
 *    skærmlæseren ikke hjælper.
 * 4. **Et bredt vindue beholder hover-udvidelsen.** Ellers «fixen» tager
 *    en funktion fra den, der har plads til den.
 */

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: async () => {},
    minimize: async () => {},
    toggleMaximize: async () => {},
  }),
}));

const path = "/";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => ({ to: path }),
  useRouterState: () => ({ location: { pathname: path } }),
  Outlet: () => null,
}));

import { Sidebar } from "../Sidebar";

const ETIKETTER = [
  "nav.dashboard",
  "nav.calendar",
  "nav.timeline",
  "nav.projects",
  "nav.klippekort",
  "nav.invoices",
  "nav.reports",
  "nav.settings",
];

function setBredde(px: number) {
  Object.defineProperty(window, "innerWidth", {
    value: px,
    configurable: true,
    writable: true,
  });
}

function navButton(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  setBredde(1280);
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("da");
});

describe("Sidebar i et smalt vindue", () => {
  it("viser ikonerne alene, centreret i 56 px", () => {
    setBredde(900);
    render(<Sidebar />);

    const aside = document.querySelector("aside");
    // framer-motion sætter den animerede bredde som inline-stil.
    expect(aside?.style.width).toBe("56px");
    for (const key of ETIKETTER) {
      const knap = navButton(i18n.t(key));
      // `justify-center`: uden den ligger ikonet mod venstre kant, og en
      // 56 px bjælke med 18 px ikon til venstre ligner en fejl, ikke et valg.
      expect(knap.className).toContain("justify-center");
      // Etiketten er ikke i DOM'en, så den kan heller ikke læses ved
      // at vælge teksten, og skærmlæseren får kun `aria-label`.
      expect(knap.textContent).toBe("");
      expect(knap.getAttribute("aria-label")).toBe(i18n.t(key));
    }
  });

  it("lader hover stjæle ingen plads, selv om den er forsøgt", () => {
    setBredde(900);
    render(<Sidebar />);
    const aside = document.querySelector("aside");

    fireEvent.mouseEnter(aside as HTMLElement);
    fireEvent.mouseLeave(aside as HTMLElement);
    fireEvent.mouseOver(aside as HTMLElement);

    // 164 px mere end det er plads til i 900 px er præcis den skub.
    expect(aside?.style.width).toBe("56px");
  });

  it("viser navnet i en tooltip ved hover og ved fokus, og lukker den igen", () => {
    setBredde(900);
    render(<Sidebar />);
    const knap = navButton(i18n.t("nav.timeline"));

    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(knap);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe(i18n.t("nav.timeline"));
    // `pointer-events-none`: ellers fanger tooltip'en selv hoveren og
    // forsvinder i det øjeblik brugeren forsøger at læse den.
    expect(tip.className).toContain("pointer-events-none");

    fireEvent.mouseLeave(knap);
    expect(screen.queryByRole("tooltip")).toBeNull();

    // Tastatur: et ikon uden navn er ubrugeligt uden den her. `fireEvent.focus`
    // og ikke `knap.focus()` — jsdom flytter ikke fokus, hvilket setup.ts
    // allerede noterer, så metoden ville aldrig sende hændelsen.
    fireEvent.focus(knap);
    expect(screen.getByRole("tooltip").textContent).toBe(
      i18n.t("nav.timeline"),
    );

    // Escape: ellers hænger navnet oveni det brugeren nu laver.
    fireEvent.keyDown(knap, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("følger appens sprog i tooltip'en", async () => {
    setBredde(900);
    await i18n.changeLanguage("en");
    render(<Sidebar />);
    fireEvent.mouseEnter(navButton(i18n.t("nav.reports")));
    expect(screen.getByRole("tooltip").textContent).toBe(
      en.nav.reports as string,
    );

    cleanup();
    await i18n.changeLanguage("sv");
    render(<Sidebar />);
    fireEvent.mouseEnter(navButton(i18n.t("nav.reports")));
    // Tooltip'en er et nyt sted en dansk streng kunne falde ind i: den bygger
    // på `label`, som kommer fra `t()` — så dømmer den at den følger sprog.
    expect(screen.getByRole("tooltip").textContent).toBe(
      sv.nav.reports as string,
    );
  });
});

describe("Sidebar i et bredt vindue", () => {
  it("beholder hover-udvidelsen og viser navnet i knappen", () => {
    setBredde(1280);
    render(<Sidebar />);
    const aside = document.querySelector("aside");
    const knap = navButton(i18n.t("nav.timeline"));

    expect(aside?.style.width).toBe("56px");
    expect(knap.className).not.toContain("justify-center");

    fireEvent.mouseEnter(aside as HTMLElement);
    expect(aside?.style.width).toBe("220px");
    // Med etiketten i DOM'en er der ingen grund til en tooltip oveni den.
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseLeave(aside as HTMLElement);
    expect(aside?.style.width).toBe("56px");
  });

  it("skifter til smalt, når vindet trækkes under grænsen", () => {
    setBredde(1280);
    render(<Sidebar />);
    const aside = document.querySelector("aside");
    expect(aside?.style.width).toBe("56px");

    fireEvent.mouseEnter(aside as HTMLElement);
    expect(aside?.style.width).toBe("220px");

    setBredde(820);
    fireEvent(window, new Event("resize"));
    // 220 px i et 820 px vindue er den fejl tasken handlede om. Hover må
    // heller ikke kunne tage den tilbage, fordi brugeren netop har
    // lært at den ikke gør det.
    expect(aside?.style.width).toBe("56px");
    fireEvent.mouseEnter(aside as HTMLElement);
    expect(aside?.style.width).toBe("56px");
  });

  it("beholder hver knap som en knap med sit eget navn", () => {
    setBredde(900);
    render(<Sidebar />);
    for (const key of ETIKETTER) {
      const knap = navButton(i18n.t(key));
      expect(knap.tagName).toBe("BUTTON");
      expect(knap).toHaveProperty("type", "button");
    }
    // Den aktive side siger det samme i begge layouts, så et skifte ikke
    // mister orienteringen.
    const aktiv = within(document.querySelector("aside") as HTMLElement)
      .getAllByRole("button")
      .filter((k) => k.getAttribute("aria-current") === "page");
    expect(aktiv).toHaveLength(1);
  });
});
