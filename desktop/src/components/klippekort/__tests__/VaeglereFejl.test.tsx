import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import type { Client, Project } from "@/lib/types";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

import { ProjectForm } from "@/components/projects/ProjectForm";
import { KlippekortForm } from "../KlippekortForm";

/**
 * Syv vælgere hentede kunder og projekter uden at kunne sige fra, når det gik
 * galt. De fire viste en dropdown uden valg — altså at brugeren *ikke har*
 * kunder — og tre af dem skrev det i `console.error`, som ingen ser i en
 * udgivelse.
 *
 * Denne test dømmer DOM'en, fordi porten (`ValgPort`) kun kan se at tilstanden
 * *findes i koden*. Den kan ikke se om den vises: en `{loadFailed && …}` der
 * står i en komponent, der aldrig mounts, er lige så grøn for porten som den
 * rigtige kode. Det er præcis den falske grøn, K48b-2's mutationer afdømte.
 *
 * Den dømmer også **at fejlen forsvinder igen** — det er den anden halvdel af
 * «prøv igen»: et kryds der bliver stående efter et vellykket genindlæs er en
 * fejl, der siger det modsatte af det der skete.
 */
const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;

function flatten(node: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node !== "object" || node === null) return out;
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of flatten(value, full)) out.set(k, v);
    } else {
      out.set(full, String(value));
    }
  }
  return out;
}

const TABLES = Object.fromEntries(
  Object.entries(LANGS).map(([lang, json]) => [lang, flatten(json)]),
) as Record<Lang, Map<string, string>>;

function value(lang: Lang, key: string) {
  return TABLES[lang].get(key) ?? "";
}

const CLIENTS = [{ id: "c-acme", name: "Acme", company: null }] as Client[];

const PROJECTS = [
  { id: "p-acme-web", name: "Acme web", client_id: "c-acme" },
] as Project[];

/** Svar der lyder som en låst database. */
const LÅST = () => Promise.reject(new Error("database is locked"));

beforeEach(() => {
  invoke.mockReset();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("da");
});

describe("Klippekort-formularen siger når listerne ikke kunne hentes", () => {
  it("viser fejlen og prøv-igen i alle 5 sprog", async () => {
    for (const lang of Object.keys(LANGS) as Lang[]) {
      cleanup();
      invoke.mockImplementation((cmd: string) =>
        cmd === "list_clients" || cmd === "list_projects" ? LÅST() : null,
      );
      await i18n.changeLanguage(lang);
      render(
        <KlippekortForm
          open
          onClose={() => {}}
          onSaved={() => {}}
          klippekort={null}
        />,
      );

      await waitFor(() => {
        expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
      });
      // Begge lister fejlede → den samlede besked, ikke to halve.
      expect(
        screen.getByText(value(lang, "errors.couldNotLoadProjectsAndClients")),
      ).toBeTruthy();
      // Og der er en knap, der er stor nok at ramme med en tommelfinger.
      const prøvIgen = screen.getByRole("button", {
        name: new RegExp(value(lang, "errors.tryAgain")),
      });
      expect(prøvIgen.getAttribute("class")).toContain("min-h-11");
    }
  });

  it("tømmer dropdownen for kunder, så den ikke ligner en kundeliste", async () => {
    // Det er her løgnen boede: et `<select>` med kun «Vælg klient» *ser* ud
    // som en kundeliste. Uden advarslen er der intet i DOM'en, der kan skelne
    // «brugeren har ingen kunder» fra «databasen ikke svarede».
    cleanup();
    invoke.mockImplementation((cmd: string) =>
      cmd === "list_clients" || cmd === "list_projects" ? LÅST() : null,
    );
    render(
      <KlippekortForm
        open
        onClose={() => {}}
        onSaved={() => {}}
        klippekort={null}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByText(da.errors.couldNotLoadProjectsAndClients),
      ).toBeTruthy();
    });
    const select = screen.getByLabelText(
      new RegExp(`${da.form.clientLabel}`),
    ) as HTMLSelectElement;
    expect(select.querySelectorAll("option").length).toBe(1);
    expect(select.textContent).not.toContain("Acme");
  });

  it("fejlen forsvinder igen, når et genindlæs lykkes", async () => {
    cleanup();
    invoke.mockImplementation((cmd: string) =>
      cmd === "list_clients" || cmd === "list_projects" ? LÅST() : null,
    );
    render(
      <KlippekortForm
        open
        onClose={() => {}}
        onSaved={() => {}}
        klippekort={null}
      />,
    );
    const advarsel = await waitFor(() => {
      expect(
        screen.getByText(da.errors.couldNotLoadProjectsAndClients),
      ).toBeTruthy();
      return screen.getByRole("button", {
        name: new RegExp(da.errors.tryAgain),
      });
    });

    // Nu svarer databasen igen. Et kryds der bliver stående nu, ville sige
    // «listerne kunne ikke hentes» om en liste der lige blev hentet.
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_clients") return Promise.resolve(CLIENTS);
      if (cmd === "list_projects") return Promise.resolve(PROJECTS);
      return Promise.resolve(null);
    });
    advarsel.click();

    await waitFor(() => {
      expect(screen.queryByText(da.errors.couldNotLoadProjectsAndClients)).toBe(
        null,
      );
    });
    const select = screen.getByLabelText(
      new RegExp(`${da.form.clientLabel}`),
    ) as HTMLSelectElement;
    expect(select.textContent).toContain("Acme");
  });

  it("henter ikke listerne, før formularen er åben", async () => {
    // Ellers koster hver tidslinje-blok der monterer formularen to kalde mod
    // databasen for en dialog, ingen har bedt om.
    cleanup();
    invoke.mockImplementation(() => Promise.resolve(null));
    render(
      <KlippekortForm
        open={false}
        onClose={() => {}}
        onSaved={() => {}}
        klippekort={null}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(
      invoke.mock.calls.filter(
        (c) => c[0] === "list_clients" || c[0] === "list_projects",
      ),
    ).toEqual([]);
  });
});

describe("Projektformularen siger når kunderne ikke kunne hentes", () => {
  it("viser kun kundefejlen, fordi den ikke henter projekter", async () => {
    cleanup();
    invoke.mockImplementation((cmd: string) =>
      cmd === "list_clients" ? LÅST() : null,
    );
    render(
      <ProjectForm open onClose={() => {}} onSaved={() => {}} project={null} />,
    );

    await waitFor(() => {
      expect(screen.getByText(da.errors.couldNotLoadClients)).toBeTruthy();
    });
    // Der er ingen grund til at hente projekter ind i en kundevælger, og det
    // må heller ikke koste et kald pr. dialog.
    expect(invoke.mock.calls.filter((c) => c[0] === "list_projects")).toEqual(
      [],
    );
  });

  it("siger intet, når kunderne kom", async () => {
    cleanup();
    invoke.mockImplementation((cmd: string) =>
      cmd === "list_clients" ? Promise.resolve(CLIENTS) : null,
    );
    render(
      <ProjectForm open onClose={() => {}} onSaved={() => {}} project={null} />,
    );
    const select = await waitFor(() => {
      const el = screen.getByLabelText(
        new RegExp(`${da.form.clientLabel}`),
      ) as HTMLSelectElement;
      expect(el.textContent).toContain("Acme");
      return el;
    });
    expect(screen.queryByRole("alert")).toBe(null);
    expect(select.textContent).toContain("Acme");
  });
});
