import { describe, expect, it } from "vitest";
import { parseEmployeeImport, resolveImportManagers } from "../import";

const row = (email: string, managerEmail: string | null) => ({
  email,
  managerEmail,
});

describe("resolveImportManagers (to-pas import)", () => {
  const profileIds: Record<string, string> = {
    "anne@f.dk": "p-anne",
    "lars@f.dk": "p-lars",
    "mette@f.dk": "p-mette",
    "chef@f.dk": "p-chef", // eksisterende profil, ikke i filen
  };
  const lookup = (email: string) => profileIds[email] ?? null;

  it("er rækkefølge-uafhængig: medarbejder før leder i filen virker", () => {
    const r = resolveImportManagers(
      [row("anne@f.dk", "lars@f.dk"), row("lars@f.dk", null)],
      lookup,
    );
    expect(r.links).toEqual([
      { email: "anne@f.dk", profileId: "p-anne", managerProfileId: "p-lars" },
    ]);
    expect(r.missing).toEqual([]);
  });

  it("finder ledere der allerede findes i organisationen", () => {
    const r = resolveImportManagers([row("anne@f.dk", "chef@f.dk")], lookup);
    expect(r.links[0]?.managerProfileId).toBe("p-chef");
  });

  it("rapporterer manglende leder som advarsel", () => {
    const r = resolveImportManagers([row("anne@f.dk", "ukendt@f.dk")], lookup);
    expect(r.links).toEqual([]);
    expect(r.missing).toEqual([
      { email: "anne@f.dk", managerEmail: "ukendt@f.dk", reason: "not_found" },
    ]);
  });

  it("afviser selv-reference", () => {
    const r = resolveImportManagers([row("anne@f.dk", "anne@f.dk")], lookup);
    expect(r.missing[0]?.reason).toBe("self");
  });

  it("bryder cykler inden for filen (A→B→C→A)", () => {
    const r = resolveImportManagers(
      [
        row("anne@f.dk", "lars@f.dk"),
        row("lars@f.dk", "mette@f.dk"),
        row("mette@f.dk", "anne@f.dk"),
      ],
      lookup,
    );
    expect(r.links.map((l) => l.email)).toEqual(["anne@f.dk", "lars@f.dk"]);
    expect(r.missing).toEqual([
      { email: "mette@f.dk", managerEmail: "anne@f.dk", reason: "cycle" },
    ]);
  });

  it("matcher emails case-insensitivt", () => {
    const r = resolveImportManagers([row("Anne@F.dk", "LARS@f.dk")], lookup);
    expect(r.links[0]?.managerProfileId).toBe("p-lars");
  });
});

describe("parseEmployeeImport – hr-rolle", () => {
  it("accepterer 'hr' og 'lønansvarlig' som rolle", () => {
    const parsed = parseEmployeeImport(
      "navn;email;rolle\nHanne;hanne@f.dk;hr\nLone;lone@f.dk;lønansvarlig\n",
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((r) => r.role)).toEqual(["hr", "hr"]);
  });
});
