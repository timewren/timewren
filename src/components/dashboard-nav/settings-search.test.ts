import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { settingsNavGroups } from "./navigation-config";
import {
  activeSettingsHref,
  resolveSettingsAnchor,
  searchSettings,
  visibleSettingsGroups,
} from "./settings-search";

const allOn = { isFlagEnabled: () => true, isModuleEnabled: () => true };

describe("searchSettings", () => {
  it("finder en enkelt indstilling og hopper til dens anker", () => {
    const [first] = searchSettings(settingsNavGroups, "timepris");
    expect(first).toMatchObject({
      kind: "setting",
      label: "Standard timepris",
      href: "/dashboard/settings#hourlyRate",
      context: "Profil og udseende",
    });
  });

  it("finder afrunding på dansk og engelsk", () => {
    expect(searchSettings(settingsNavGroups, "afrunding")[0]?.href).toBe(
      "/dashboard/settings#afrunding",
    );
    expect(searchSettings(settingsNavGroups, "rounding")[0]?.href).toBe(
      "/dashboard/settings#afrunding",
    );
  });

  it("matcher uanset store bogstaver, også æøå", () => {
    expect(searchSettings(settingsNavGroups, "MØRK")[0]?.label).toBe(
      "Tema (lyst eller mørkt)",
    );
  });

  it("kræver at alle ord matcher, og sidens navn tæller med", () => {
    const results = searchSettings(settingsNavGroups, "sikkerhed passkey");
    expect(results[0]?.href).toBe("/dashboard/settings/security#passkeys");
    expect(results.every((r) => r.href.includes("/security"))).toBe(true);
  });

  it("finder sider på nøgleord", () => {
    const hrefs = searchSettings(settingsNavGroups, "cvr").map((r) => r.href);
    expect(hrefs).toContain("/dashboard/settings/company");
  });

  it("titel-match slår nøgleord-match", () => {
    // "Moduler" (titel) før sider der blot nævner ordet
    expect(searchSettings(settingsNavGroups, "modul")[0]?.label).toBe(
      "Moduler",
    );
  });

  it("tom eller ukendt søgning giver ingen resultater", () => {
    expect(searchSettings(settingsNavGroups, "   ")).toEqual([]);
    expect(searchSettings(settingsNavGroups, "xyzzy")).toEqual([]);
  });

  it("respekterer loftet over antal resultater", () => {
    expect(searchSettings(settingsNavGroups, "e", 3)).toHaveLength(3);
  });
});

describe("resolveSettingsAnchor", () => {
  it("oversætter gamle aliaser", () => {
    expect(resolveSettingsAnchor("#rounding")).toBe("afrunding");
  });

  it("afkoder %-kodede ankre og tåler ugyldig kodning", () => {
    expect(resolveSettingsAnchor("#fridage")).toBe("fridage");
    expect(resolveSettingsAnchor("#%C3%A6")).toBe("æ");
    expect(resolveSettingsAnchor("#%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("giver null for tom hash", () => {
    expect(resolveSettingsAnchor("")).toBeNull();
    expect(resolveSettingsAnchor("#")).toBeNull();
  });
});

describe("visibleSettingsGroups", () => {
  const labels = (groups: ReturnType<typeof visibleSettingsGroups>) =>
    groups.flatMap((g) => g.items.map((i) => i.label));

  it("ejeren ser admin-sider", () => {
    const visible = labels(
      visibleSettingsGroups(settingsNavGroups, { ...allOn, role: "owner" }),
    );
    expect(visible).toContain("Moduler");
    expect(visible).toContain("Abonnement");
    expect(visible).toContain("Virksomhedsprofil");
  });

  it("et almindeligt medlem ser ikke sider, kun admin kan gemme", () => {
    const visible = labels(
      visibleSettingsGroups(settingsNavGroups, { ...allOn, role: "member" }),
    );
    expect(visible).not.toContain("Moduler");
    expect(visible).not.toContain("Abonnement");
    expect(visible).not.toContain("Virksomhedsprofil");
    expect(visible).not.toContain("Aktivitetslog");
    expect(visible).toContain("Profil og udseende");
    expect(visible).toContain("Tags");
  });

  it("skjuler API når modulet er slukket", () => {
    const visible = labels(
      visibleSettingsGroups(settingsNavGroups, {
        isFlagEnabled: () => true,
        isModuleEnabled: (m) => m !== "public_api",
        role: "owner",
      }),
    );
    expect(visible).not.toContain("API");
  });

  it("enterprise-medarbejdere ser ikke freelance-sider", () => {
    const visible = labels(
      visibleSettingsGroups(settingsNavGroups, {
        ...allOn,
        role: "member",
        orgProfile: "enterprise",
      }),
    );
    expect(visible).not.toContain("Kundeportal");
    expect(visible).not.toContain("Email & skabeloner");
  });

  it("fjerner grupper uden synlige punkter", () => {
    // Enterprise-medarbejder: Abonnement (admin) og de freelance-vendte
    // faktureringssider er skjult, så hele gruppen forsvinder.
    const groups = visibleSettingsGroups(settingsNavGroups, {
      ...allOn,
      role: "member",
      orgProfile: "enterprise",
    });
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    expect(groups.map((g) => g.label)).not.toContain("Fakturering");
  });
});

describe("activeSettingsHref", () => {
  it("vælger det længste præfiks", () => {
    expect(
      activeSettingsHref(
        settingsNavGroups,
        "/dashboard/organization/permissions",
      ),
    ).toBe("/dashboard/organization/permissions");
    expect(
      activeSettingsHref(settingsNavGroups, "/dashboard/organization"),
    ).toBe("/dashboard/organization");
  });

  it("profilsiden er kun aktiv på præcis /dashboard/settings", () => {
    expect(activeSettingsHref(settingsNavGroups, "/dashboard/settings")).toBe(
      "/dashboard/settings",
    );
    expect(
      activeSettingsHref(settingsNavGroups, "/dashboard/settings/security"),
    ).toBe("/dashboard/settings/security");
  });

  it("dybe undersider hører til deres menupunkt", () => {
    expect(
      activeSettingsHref(
        settingsNavGroups,
        "/dashboard/settings/email-templates/abc",
      ),
    ).toBe("/dashboard/settings/email");
  });
});

// Dybe links må ikke rådne: hvert anker i registret skal findes som id i
// sidens kildekode (eller i en af komponenterne, siden bruger).
describe("settingsNavGroups – registret", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (file: string) => readFileSync(file, "utf8");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory()
        ? walk(full)
        : /\.tsx?$/.test(name)
          ? [full]
          : [];
    });
  const sharedComponents = walk(path.join(root, "src/components/settings"))
    .map(read)
    .join("\n");

  const items = settingsNavGroups.flatMap((g) => g.items);

  it("har unikke sider og unikke ankre pr. side", () => {
    const hrefs = items.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const item of items) {
      const ids = (item.settings ?? []).map((s) => s.id);
      expect(new Set(ids).size, item.href).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9-]+$/);
    }
  });

  it.each(
    items.filter((i) => i.settings?.length).map((i) => [i.href, i] as const),
  )("%s har alle sine ankre", (_href, item) => {
    const dir = path.join(root, "src/app/(app)", item.href.split("?")[0]);
    const page = path.join(dir, "page.tsx");
    expect(existsSync(page), page).toBe(true);
    const source = `${read(page)}\n${sharedComponents}`;
    for (const entry of item.settings ?? []) {
      expect(
        source.includes(`id="${entry.id}"`),
        `#${entry.id} mangler på ${item.href}`,
      ).toBe(true);
    }
  });
});
