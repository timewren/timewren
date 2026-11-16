// Genererer paritets-fixtures til tt-core ved at køre web-appens EGEN kode.
//
//   WEB=~/dev/timetrack-web-ro TZ=Europe/Copenhagen \
//     node --import ./register.mjs generate.ts
//
// (fra crates/tt-core/tests/parity). Kræver Node 23+ (stripper TypeScript
// selv) og ingen npm install: kun rene web-moduler uden pakke-importer bruges.
//
// Inputtene er de samme som i web- og udvidelsestestene (filnavnet står ved
// hver blok) plus net, der afprøver reglerne bredt. Det forventede output er
// det, web-koden faktisk giver. Kør scriptet igen, når web ændrer en regel, og
// lad `cargo test -p tt-core` vise, hvad Rust-koden skal følge med i.
//
// Regler, hvis web-kode trækker databasen eller npm-pakker med sig
// (deductHoursCore, getRateFromCache, isUnbilledEntry, fakturanummer-SQL'en,
// momsen i InvoicePDF), kan ikke køres her; de er portet som håndskrevne
// Rust-tests med kildehenvisning i tests/parity.rs.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const WEB = process.env.WEB as string;
if (process.env.TZ !== "Europe/Copenhagen") {
  throw new Error("Kør med TZ=Europe/Copenhagen (web-formularerne regner i browserens danske lokaltid)");
}

const web = (p: string) => import(path.join(WEB, p));
const prepaidExt = await web("browser-extension/src/lib/prepaid.ts");
const hullerExt = await web("browser-extension/src/lib/klippekort-huller.ts");
const formatHours = await web("browser-extension/src/lib/format-hours.ts");
const hullerWeb = await web("src/components/klippekort/huller-model.ts");
const autoSelect = await web("src/lib/prepaid/auto-select.ts");
const expiry = await web("src/lib/prepaid/expiry.ts");
const hours = await web("src/lib/prepaid/hours.ts");
const balance = await web("src/lib/prepaid/balance.ts");
const usable = await web("src/lib/prepaid/usable-balance.ts");
const reconcile = await web("src/lib/prepaid/reconcile.ts");
const rounding = await web("src/lib/utils/rounding.ts");
const scheduled = await web("src/lib/rates/scheduled.ts");
const cph = await web("src/lib/time/copenhagen.ts");
const clock = await web("src/lib/time/clock-range.ts");
const entryDate = await web("src/lib/timer/entry-date.ts");
const preview = await web("src/lib/invoicing/invoice-preview.ts");
const draft = await web("src/lib/invoices/draft-number.ts");
const format = await web("src/lib/format.ts");
const vat = await web("src/lib/vat/compute.ts");

const commit = execFileSync("git", ["-C", WEB, "rev-parse", "--short", "HEAD"])
  .toString()
  .trim();
const outDir = path.join(import.meta.dirname, "fixtures");
mkdirSync(outDir, { recursive: true });

function save(name: string, kilder: string[], data: Record<string, unknown>) {
  const file = path.join(outDir, `${name}.json`);
  const body = { web_commit: commit, kilder, ...data };
  // Arrays med kun simple værdier skrives på én linje, så net-rækker fylder
  // en linje hver og diffs ved en regelændring er til at læse.
  const json = JSON.stringify(body, null, 1).replace(/\[[^[\]{}]*\]/g, (m) =>
    m.replace(/\s*\n\s*/g, " ").replace(/\[ /, "[").replace(/ \]$/, "]"),
  );
  writeFileSync(file, `${json}\n`);
  console.log(`skrev ${name}.json`);
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const hour = 3_600_000;

// ---------------------------------------------------------------------------
// Klippekort: auto-valg
// ---------------------------------------------------------------------------
{
  type Pkg = {
    id: string;
    clientId?: string;
    autoDeduct: boolean;
    remainingHours: number;
    expiryDate: string | null;
    isActive: boolean;
    purchaseDate: string | null;
  };
  const p = (over: Partial<Pkg> & { id: string }): Pkg => ({
    clientId: "c1",
    autoDeduct: true,
    remainingHours: 10,
    expiryDate: null,
    isActive: true,
    purchaseDate: null,
    ...over,
  });
  const cases: Array<{ name: string; now: string; packages: Pkg[] }> = [];
  const add = (name: string, now: string, packages: Pkg[]) =>
    cases.push({ name, now, packages });
  const now = "2026-09-05T10:00:00.000Z";

  // src/lib/prepaid/auto-select.test.ts
  add("tom liste", now, []);
  add("udløber først vinder, ikke nyeste", now, [
    p({ id: "nyt", expiryDate: "2026-12-31T00:00:00.000Z" }),
    p({ id: "gammelt", expiryDate: "2026-09-30T00:00:00.000Z" }),
  ]);
  add("uden udløb sidst", now, [
    p({ id: "uden-udløb" }),
    p({ id: "med-udløb", expiryDate: "2026-12-01T00:00:00.000Z" }),
  ]);
  add("springer manuelle, tomme, inaktive og udløbne over", now, [
    p({ id: "manuelt", autoDeduct: false }),
    p({ id: "tomt", remainingHours: 0 }),
    p({ id: "inaktivt", isActive: false }),
    p({ id: "udløbet", expiryDate: "2026-09-01T00:00:00.000Z" }),
    p({ id: "ok" }),
  ]);
  const expiring = [
    p({ id: "udløber-i-dag", expiryDate: "2026-09-05T00:00:00.000Z" }),
    p({ id: "uden-udløb" }),
  ];
  add("udløbsdagen 23:30 dansk", "2026-09-05T21:30:00.000Z", expiring);
  add("dagen efter 00:01 dansk", "2026-09-05T22:01:00.000Z", expiring);
  add("ISO-udløb og saldo som tal", now, [
    p({ id: "sen", expiryDate: "2026-12-01T00:00:00.000Z", remainingHours: 3 }),
    p({ id: "tidlig", expiryDate: "2026-10-01T00:00:00.000Z", remainingHours: 3 }),
  ]);
  add("FIFO uden udløb", now, [
    p({ id: "købt-8-7", purchaseDate: "2026-07-08T00:00:00.000Z" }),
    p({ id: "købt-1-7", purchaseDate: "2026-07-01T00:00:00.000Z" }),
  ]);
  add("samme udløb: ældste købte først", now, [
    p({ id: "nyt", expiryDate: "2026-12-01T00:00:00.000Z", purchaseDate: "2026-08-01T00:00:00.000Z" }),
    p({ id: "gammelt", expiryDate: "2026-12-01T00:00:00.000Z", purchaseDate: "2026-06-01T00:00:00.000Z" }),
  ]);
  add("udløb vinder over købsdato", now, [
    p({ id: "nyt-udløber-først", expiryDate: "2026-10-15T00:00:00.000Z", purchaseDate: "2026-09-01T00:00:00.000Z" }),
    p({ id: "gammelt-uden-udløb", purchaseDate: "2026-01-01T00:00:00.000Z" }),
  ]);
  const a = p({ id: "uden-dato" });
  const b = p({ id: "8-7", purchaseDate: "2026-07-08T00:00:00.000Z" });
  const c = p({ id: "1-7", purchaseDate: "2026-07-01T00:00:00.000Z" });
  for (const order of [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]]) {
    add(`manglende købsdato sidst (${order.map((x) => x.id).join(",")})`, now, order);
  }
  add("manglende købsdato sidst (to kort)", now, [a, b]);
  add("stabil uden købsdato og samme udløb", now, [
    p({ id: "først-i-listen", expiryDate: "2026-12-01T00:00:00.000Z" }),
    p({ id: "sidst-i-listen", expiryDate: "2026-12-01T00:00:00.000Z" }),
  ]);

  // browser-extension/src/lib/prepaid-parity.test.ts
  const fx = [
    p({ id: "nyt-uden-udløb", remainingHours: 20, purchaseDate: "2026-07-08T00:00:00.000Z" }),
    p({ id: "nyt-sen", expiryDate: "2026-12-31T00:00:00.000Z", remainingHours: 5, purchaseDate: "2026-07-05T00:00:00.000Z" }),
    p({ id: "manuelt", expiryDate: "2026-09-10T00:00:00.000Z", autoDeduct: false, remainingHours: 5, purchaseDate: "2026-06-20T00:00:00.000Z" }),
    p({ id: "tomt", expiryDate: "2026-09-11T00:00:00.000Z", remainingHours: 0, purchaseDate: "2026-06-10T00:00:00.000Z" }),
    p({ id: "gammelt-tidlig", expiryDate: "2026-09-30T00:00:00.000Z", remainingHours: 2.5, purchaseDate: "2026-05-01T00:00:00.000Z" }),
  ];
  add("paritet: fuldt sæt", now, fx);
  add("paritet: kun uden udløb", now, fx.filter((f) => f.expiryDate === null));
  add("paritet: to med udløb", now, fx.filter((f) => f.id === "nyt-sen" || f.id === "gammelt-tidlig"));
  add("paritet: ingen auto", now, fx.filter((f) => !f.autoDeduct));
  add("paritet: omvendt rækkefølge", now, [...fx].reverse());
  add("paritet: to uden udløb (FIFO)", now, [
    fx[0],
    p({ id: "gammelt-uden-udløb", remainingHours: 25.75, purchaseDate: "2026-07-01T00:00:00.000Z" }),
  ]);
  // Ekstra: udløbet kort med saldo — web springer det over, udvidelsen ikke
  add("ekstra: udløbet kort med saldo", now, [
    p({ id: "udløbet", expiryDate: "2026-08-31T00:00:00.000Z" }),
    p({ id: "gyldigt", expiryDate: "2026-12-31T00:00:00.000Z" }),
  ]);
  add("ekstra: inaktivt kort", now, [
    p({ id: "inaktivt", expiryDate: "2026-09-10T00:00:00.000Z", isActive: false }),
    p({ id: "aktivt" }),
  ]);

  const toWeb = (x: Pkg) => ({
    id: x.id,
    autoDeduct: x.autoDeduct,
    remainingHours: x.remainingHours,
    expiryDate: x.expiryDate,
    isActive: x.isActive,
    purchaseDate: x.purchaseDate,
  });
  const toExt = (x: Pkg) => ({
    id: x.id,
    clientId: x.clientId,
    clientName: "Kunde",
    name: x.id,
    totalHours: 35,
    usedHours: 35 - x.remainingHours,
    remainingHours: x.remainingHours,
    expiresAt: x.expiryDate,
    purchasedAt: x.purchaseDate ?? undefined,
    isActive: x.isActive,
    autoDeduct: x.autoDeduct,
  });

  const pick = cases.map((cs) => ({
    ...cs,
    expected: autoSelect.pickAutoDeductPackage(cs.packages.map(toWeb), new Date(cs.now))?.id ?? null,
    extension: prepaidExt.pickAutoPrepaid(cs.packages.map(toExt), "c1")?.id ?? null,
  }));

  // resolveTimerPrepaidSelection (auto-select.test.ts)
  const sel = [
    p({ id: "senere", expiryDate: "2026-12-31T00:00:00.000Z" }),
    p({ id: "først", expiryDate: "2026-09-30T00:00:00.000Z" }),
  ];
  const choices: Array<[string, unknown, string | null]> = [
    ["intet valg", null, "c1"],
    ["valgt kort", { mode: "package", packageId: "senere", clientId: "c1" }, "c1"],
    ["intet klippekort", { mode: "none", clientId: "c1" }, "c1"],
    ["valgt kort findes ikke", { mode: "package", packageId: "væk", clientId: "c1" }, "c1"],
    ["valg for en anden kunde", { mode: "none", clientId: "anden" }, "c1"],
    ["ingen kunde", { mode: "none", clientId: "c1" }, null],
  ];
  const resolve = choices.map(([name, choice, clientId]) => ({
    name,
    choice,
    clientId,
    now,
    packages: sel,
    expected:
      autoSelect.resolveTimerPrepaidSelection(choice, clientId, sel.map(toWeb), new Date(now))?.id ?? null,
  }));

  save(
    "prepaid-auto-select",
    [
      "src/lib/prepaid/auto-select.ts:37-110",
      "src/lib/prepaid/auto-select.test.ts",
      "browser-extension/src/lib/prepaid.ts:35-61",
      "browser-extension/src/lib/prepaid-parity.test.ts",
    ],
    { pick, resolve },
  );
}

// ---------------------------------------------------------------------------
// Klippekort: udløb
// ---------------------------------------------------------------------------
{
  const expiries = [
    "2026-08-15T00:00:00.000Z",
    "2026-12-15T00:00:00.000Z",
    "2026-08-14T22:00:00.000Z",
    "2026-03-29T00:00:00.000Z",
    "2026-10-25T00:00:00.000Z",
    "2026-10-24T23:00:00.000Z",
    "2027-03-28T00:00:00.000Z",
    "2026-09-05T13:37:00.000Z",
  ];
  // Samme net som expiry.test.ts ("ækvivalent med isPrepaidExpired"): hver
  // 7. time i 300 dage fra 27/3-2026, + 1 minut.
  const start = Date.parse("2026-03-27T00:00:00Z");
  const nows: string[] = [];
  for (let h = 0; h < 24 * 300; h += 7) nows.push(new Date(start + h * hour + 60_000).toISOString());
  nows.push(
    "2026-08-14T22:30:00.000Z",
    "2026-08-15T21:30:00.000Z",
    "2026-08-15T21:59:59.000Z",
    "2026-08-15T22:00:00.000Z",
    "2026-08-15T22:01:00.000Z",
    "2026-12-14T23:30:00.000Z",
    "2026-12-15T22:30:00.000Z",
    "2026-12-15T23:01:00.000Z",
    "2026-10-25T22:30:00.000Z",
    "2026-10-25T23:01:00.000Z",
  );
  const grid = [];
  for (const e of expiries) {
    for (const n of nows) {
      const now = new Date(n);
      const days = expiry.prepaidDaysUntilExpiry(e, now);
      const ext = prepaidExt.daysUntilPrepaidExpiry(e, now);
      if (days !== ext) throw new Error(`udvidelse og web uenige om udløbsdage: ${e} ${n}`);
      grid.push([e, n, expiry.isPrepaidExpired(e, now), days, iso(expiry.prepaidExpiredBefore(now))]);
    }
  }
  const perExpiry = expiries.map((e) => ({
    expiry: e,
    date: expiry.prepaidExpiryDateStr(e),
    validUntil: iso(expiry.prepaidValidUntil(e)),
  }));
  const within = [0, 1, 7, 30].flatMap((d) =>
    ["2026-08-08T06:00:00.000Z", "2026-10-24T22:30:00.000Z", "2026-03-28T23:30:00.000Z"].map((n) => [
      d,
      n,
      iso(expiry.prepaidExpiresWithinBefore(d, new Date(n))),
    ]),
  );
  const phrases = [-3, -1, 0, 1, 2, 5, 30].map((d) => [d, expiry.prepaidExpiryPhrase(d), expiry.prepaidExpiryLabel(d)]);
  const duplicated = [
    ["2026-03-01T13:37:00.000Z", "2026-03-31T00:00:00.000Z", "2026-10-20T21:30:00.000Z"],
    ["2026-06-30T22:00:00.000Z", "2026-07-30T22:00:00.000Z", "2026-10-24T22:30:00.000Z"],
    [null, "2026-07-30T00:00:00.000Z", "2026-10-24T22:30:00.000Z"],
    ["2026-08-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z", "2026-10-24T22:30:00.000Z"],
    ["2026-01-01T00:00:00.000Z", null, "2026-10-24T22:30:00.000Z"],
  ].map(([pd, ed, n]) => [pd, ed, n, iso(expiry.duplicatedPrepaidExpiry(pd, ed, new Date(n as string)))]);
  save(
    "prepaid-expiry",
    [
      "src/lib/prepaid/expiry.ts",
      "src/lib/prepaid/expiry.test.ts",
      "browser-extension/src/lib/prepaid.ts:242-260 (daysUntilPrepaidExpiry, krydstjekket = web)",
    ],
    {
      grid_columns: ["expiry", "now", "expired", "daysUntil", "expiredBefore"],
      grid,
      perExpiry,
      within,
      phrases,
      duplicated,
    },
  );
}

// ---------------------------------------------------------------------------
// Klippekort: timer, saldo, afstemning
// ---------------------------------------------------------------------------
{
  const values = [
    0, 0.001, 0.004, 0.005, 0.0049, 0.015, 0.125, 0.135, 0.285, 1.005, 1.015, 1.115, 1.38, 2.675, 3.333,
    7.4999, 10.555, 22.754, 0.1 + 0.2, 1 / 3, 2 / 3, 25.75, 27.6, 57.59, 100.005,
  ];
  const roundGrid = values.map((v) => [v, hours.roundPrepaidHours(v), hours.ceilPrepaidHours(v)]);
  const clips = [null, 0, 1, 5, 6, 10, 15, 30, 60];
  const normGrid = [];
  for (const clip of clips) {
    for (let m = 1; m <= 200; m += 1) {
      const h = m / 60;
      normGrid.push([h, clip, hours.normalizePrepaidDeductionHours(h, clip)]);
    }
    for (const v of values) normGrid.push([v, clip, hours.normalizePrepaidDeductionHours(v, clip)]);
  }
  const totalChange = [
    [40, 22.75],
    [10, 3.333],
    [22.75, 22.75],
    [20, 22.75],
    [22.75, 22.754],
    [35, 0],
    [0, 0],
  ].map(([t, u]) => [t, u, hours.remainingAfterTotalChange(t, u)]);
  const levelGrid = [];
  for (const total of [0, 3, 10, 20, 35, 100, 1000]) {
    for (const r of [-2, 0, 0.5, 0.99, 1, 1.01, 1.5, 2, 4, 5, 6.99, 7, 7.01, 19.99, 20, 21, 80]) {
      levelGrid.push([r, total, balance.prepaidBalanceLevel(r, total)]);
    }
  }
  const usableNow = "2026-10-02T10:00:00.000Z";
  const usablePkgs = [
    { remainingHours: 25.75, isActive: true, isArchived: false, expiryDate: null },
    { remainingHours: 27.6, isActive: true, isArchived: false, expiryDate: null },
    { remainingHours: 57.59, isActive: false, isArchived: false, expiryDate: null },
    { remainingHours: 10, isActive: true, isArchived: false, expiryDate: "2026-09-30T00:00:00.000Z" },
    { remainingHours: 5, isActive: true, isArchived: true, expiryDate: null },
    { remainingHours: 2, isActive: true, isArchived: false, expiryDate: "2026-12-31T00:00:00.000Z" },
    { remainingHours: 3, isActive: true, isArchived: false, expiryDate: "2026-10-02T00:00:00.000Z" },
  ];
  const usableSum = usable.sumUsablePrepaidHours(usablePkgs, new Date(usableNow));

  const PKG_A = "pkg-a";
  const PKG_B = "pkg-b";
  const only = (clientId: string | null) => ({ clientId, projectClientId: null });
  const base = {
    wasPrepaid: true,
    oldPackageId: PKG_A,
    oldClient: only("A"),
    newClient: only("A"),
    requestedPackageId: undefined as string | null | undefined,
    oldHours: 2,
    newHours: 2,
  };
  const reconcileInputs = [
    { ...base, newClient: only("B") },
    { ...base, newClient: only(null) },
    { ...base, newClient: only("B"), requestedPackageId: PKG_B },
    base,
    { ...base, requestedPackageId: null },
    { ...base, requestedPackageId: PKG_B },
    { wasPrepaid: false, oldPackageId: null, oldClient: only("A"), newClient: only("A"), requestedPackageId: PKG_A, oldHours: 2, newHours: 2 },
    { wasPrepaid: false, oldPackageId: null, oldClient: only("A"), newClient: only("B"), requestedPackageId: undefined, oldHours: 2, newHours: 5 },
    { ...base, newHours: 5 },
    { ...base, oldHours: 5, newHours: 2 },
    { ...base, oldHours: 5, newHours: 2, requestedPackageId: PKG_B },
    { ...base, oldClient: { clientId: "A", projectClientId: "A" }, newClient: { clientId: null, projectClientId: "A" } },
    { ...base, oldClient: { clientId: null, projectClientId: "A" }, newClient: { clientId: "A", projectClientId: "A" }, newHours: 3 },
    { ...base, oldClient: { clientId: null, projectClientId: "A" }, newClient: { clientId: null, projectClientId: "B" } },
    { ...base, requestedPackageId: PKG_A },
    { ...base, wasPrepaid: false, oldPackageId: PKG_A },
  ];
  const reconcileCases = reconcileInputs.map((input) => ({
    // undefined overlever ikke JSON: "requested" skelner udeladt/null/id
    input: { ...input, requestedPackageId: input.requestedPackageId === undefined ? "<udeladt>" : input.requestedPackageId },
    expected: reconcile.resolvePrepaidReconcile(input),
  }));
  const effective = [
    [{ clientId: "A", projectClientId: "B" }],
    [{ clientId: null, projectClientId: "B" }],
    [{ clientId: null, projectClientId: null }],
  ].map(([ref]) => [ref, reconcile.effectiveClientId(ref)]);

  save(
    "prepaid-hours",
    [
      "src/lib/prepaid/hours.ts",
      "src/lib/prepaid/hours.test.ts",
      "src/lib/prepaid/balance.ts (+ src/lib/config.ts PREPAID_* standardværdier)",
      "src/lib/prepaid/balance.test.ts",
      "src/lib/prepaid/usable-balance.ts",
      "src/lib/prepaid/usable-balance.test.ts",
      "src/lib/prepaid/reconcile.ts",
      "src/lib/prepaid/reconcile.test.ts",
    ],
    {
      roundGrid,
      normGrid,
      totalChange,
      levelGrid,
      usable: { now: usableNow, packages: usablePkgs, expected: usableSum },
      reconcile: reconcileCases,
      effective,
    },
  );
}

// ---------------------------------------------------------------------------
// Klippekort-huller og dansk talformat
// ---------------------------------------------------------------------------
{
  const pairs: Array<[number, number]> = [
    [20, 7], [20, 20], [20, 0], [20, -3], [20, -2], [10, 7.5], [7.5, 0], [7.5, 0.5], [21, 21], [21, 1],
    [21, 0], [21, -3], [40, 39], [50, 17.5], [200, 120], [200, 100], [205, 10], [205, 100], [300, 150],
    [0, 0], [1, 0.25], [0.1 + 0.2 + 19.7, 0.1 + 0.2], [35, 12.34], [12.5, 3.333], [100, 33.333],
  ];
  for (let t = 1; t <= 60; t += 1.25) {
    for (const f of [0, 0.1, 0.33, 0.5, 0.9, 1]) pairs.push([t, Math.round(t * f * 100) / 100]);
  }
  const models = pairs.map(([t, r]) => {
    const w = hullerWeb.klippekortModel(t, r);
    const e = hullerExt.klippekortModel(t, r);
    if (JSON.stringify(w) !== JSON.stringify(e)) throw new Error(`huller: web og udvidelse uenige ${t} ${r}`);
    return { total: t, remaining: r, expected: w };
  });
  // NaN kan ikke stå i JSON: Rust-testen afprøver NaN separat.
  const nan = hullerWeb.klippekortModel(Number.NaN, 4);

  const numbers = [
    0, 0.5, 1, 1.005, 1.25, 2.25, 2.675, 7.5, 8, 13.8, 13.8333, 13.835, 20, 0.125, 0.135, 1.115,
    1234.5, 1250, 712.5, 1000000.255, 99.995, 0.004, 0.005, 25.75, 0.1 + 0.2, -2, -1234.567,
  ];
  const formatTimer = numbers.map((n) => [n, hullerWeb.formatTimer(n)]);
  const short = [...numbers, 0.75, 0.999, 0.0083, 0.25, 0.5083, 1 / 3, 2 / 3, 0.99, 59.5 / 60, -1].map((n) => [
    n,
    formatHours.formatHoursShort(n),
  ]);
  for (let m = 0; m <= 180; m++) short.push([m / 60, formatHours.formatHoursShort(m / 60)]);
  const rate = [850, 1250, 712.5, 0, 99.999, 1234567.891, 600.005].map((n) => [n, formatHours.formatHourlyRate(n)]);

  save(
    "huller-format",
    [
      "src/components/klippekort/huller-model.ts (= browser-extension/src/lib/klippekort-huller.ts, krydstjekket)",
      "src/components/klippekort/huller-model.test.ts",
      "browser-extension/src/lib/klippekort-huller-parity.test.ts",
      "browser-extension/src/lib/format-hours.ts",
      "browser-extension/src/lib/format-hours.test.ts",
    ],
    { models, nan_total_4: nan, formatTimer, formatHoursShort: short, formatHourlyRate: rate },
  );
}

// ---------------------------------------------------------------------------
// Afrunding og timepris
// ---------------------------------------------------------------------------
{
  const grid = [];
  for (const method of ["up", "down", "nearest"]) {
    for (const minutes of [1, 5, 6, 10, 15, 30, 60]) {
      for (let i = 0; i <= 400; i++) {
        const h = i / 100;
        grid.push([h, minutes, method, rounding.roundHours(h, { enabled: true, minutes, method })]);
      }
      for (const h of [1.38, 1.3, 1.1, 0.18, 0.01, 0.125, 7.5 / 60, 22.5 / 60, 1 / 3, 2 / 3]) {
        grid.push([h, minutes, method, rounding.roundHours(h, { enabled: true, minutes, method })]);
      }
    }
  }
  const disabled = [
    [1.38, { enabled: false, minutes: 15, method: "up" }],
    [1.38, null],
  ].map(([h, cfg]) => [h, cfg, rounding.roundHours(h, cfg)]);
  const u = { roundingEnabled: true, roundingMinutes: 15, roundingMethod: "up" };
  const c = { roundingEnabled: true, roundingMinutes: 30, roundingMethod: "nearest" };
  const p = { roundingEnabled: true, roundingMinutes: 5, roundingMethod: "down" };
  const n = { roundingEnabled: null, roundingMinutes: null, roundingMethod: null };
  const off = { roundingEnabled: false, roundingMinutes: 15, roundingMethod: "up" };
  const partial = { roundingEnabled: true, roundingMinutes: null, roundingMethod: null };
  const resolveCases = [
    [u, c, p], [u, c, n], [u, n, n], [n, n, n], [off, n, n], [u, off, n], [u, c, off], [n, n, partial], [u, partial, n],
  ].map(([user, client, project]) => ({
    user,
    client,
    project,
    expected: rounding.resolveRoundingConfig(user, client, project),
  }));

  // scheduled.test.ts
  let seq = 0;
  const change = (over: Record<string, unknown> = {}) => {
    seq++;
    return {
      id: `change-${seq}`,
      clientId: "C",
      projectId: null,
      newRate: "800.00",
      oldRate: null,
      effectiveDate: "2026-11-01",
      appliedAt: null,
      cancelledAt: null,
      createdAt: new Date(Date.UTC(2026, 8, 1, 10, 0, seq)).toISOString(),
      ...over,
    };
  };
  const applied = (y: number, m: number, d: number, hh = 23, mm = 5) =>
    new Date(Date.UTC(y, m, d, hh, mm)).toISOString();
  const sets: Array<[string, ReturnType<typeof change>[], string | null, string[]]> = [];
  const planned = [change()];
  sets.push(["planlagt", planned, "600.00", ["2026-11-01", "2026-12-15", "2026-10-31"]]);
  sets.push([
    "kø",
    [
      change({ newRate: "800.00", effectiveDate: "2026-11-01" }),
      change({ newRate: "900.00", effectiveDate: "2027-01-01" }),
      change({ newRate: "1000.00", effectiveDate: "2027-06-01" }),
    ],
    "600.00",
    ["2026-10-31", "2026-12-31", "2027-01-01", "2027-05-31", "2027-06-01"],
  ]);
  sets.push(["samme dag: senest oprettede vinder", [change({ newRate: "750.00" }), change({ newRate: "800.00" })], "600.00", ["2026-11-01"]]);
  sets.push(["anvendt", [change({ oldRate: "600.00", appliedAt: applied(2026, 9, 31) })], "800.00", ["2026-10-31", "2026-11-01", "2027-02-01"]]);
  sets.push([
    "historik",
    [
      change({ effectiveDate: "2026-11-01", newRate: "800.00", oldRate: "600.00", appliedAt: applied(2026, 9, 31) }),
      change({ effectiveDate: "2027-01-01", newRate: "900.00", oldRate: "800.00", appliedAt: applied(2026, 11, 31) }),
    ],
    "900.00",
    ["2026-06-01", "2026-12-01", "2027-01-01"],
  ]);
  sets.push(["første sats anvendt", [change({ oldRate: null, appliedAt: applied(2026, 9, 31) })], "800.00", ["2026-10-01"]]);
  sets.push([
    "blandet",
    [
      change({ effectiveDate: "2026-11-01", oldRate: "600.00", appliedAt: applied(2026, 9, 31) }),
      change({ effectiveDate: "2027-01-01", newRate: "900.00" }),
    ],
    "800.00",
    ["2026-10-15", "2026-11-15", "2027-01-01"],
  ]);
  sets.push(["ingen ændringer", [], "600.00", ["2026-11-01"]]);
  sets.push([
    "annulleret",
    [
      change({ cancelledAt: new Date(Date.UTC(2026, 9, 1)).toISOString() }),
      change({
        effectiveDate: "2026-12-01",
        oldRate: "500.00",
        appliedAt: new Date(Date.UTC(2026, 10, 30)).toISOString(),
        cancelledAt: new Date(Date.UTC(2026, 10, 30, 1)).toISOString(),
      }),
    ],
    "600.00",
    ["2026-11-15"],
  ]);
  sets.push([
    "samme ikrafttræden, anvendt-tid før oprettet-tid",
    [
      change({ newRate: "700.00", createdAt: "2026-09-01T12:00:00.000Z" }),
      change({ newRate: "750.00", createdAt: "2026-09-01T09:00:00.000Z" }),
    ],
    null,
    ["2026-11-01"],
  ]);
  const rateCases = sets.flatMap(([name, changes, current, dates]) =>
    [...dates, null].map((date) => ({
      name,
      changes,
      current,
      date,
      expected: scheduled.resolveRateAtDate(
        changes.map((ch) => ({
          ...ch,
          appliedAt: ch.appliedAt ? new Date(ch.appliedAt as string) : null,
          cancelledAt: ch.cancelledAt ? new Date(ch.cancelledAt as string) : null,
          createdAt: new Date(ch.createdAt),
        })),
        current,
        date ?? undefined,
      ),
    })),
  );
  const keys = [
    "2026-11-01",
    "2026-11-01T00:00:00.000Z",
    "2026-10-31T23:30:00.000Z",
    "2026-10-31T22:30:00.000Z",
    "2026-06-30T22:00:00.000Z",
    "2026-06-30T21:59:59.000Z",
    // Formater new Date også læser (review-fund): SQLite, uden sekunder, +hhmm
    "2026-10-26 22:30:00",
    "2026-10-26 23:30:00",
    "2026-10-26T22:30Z",
    "2026-10-26T23:30:00+0100",
    "2026-10-26T23:30:00-0100",
    "2026-10-26T23:30-01:00",
    "2026-10-26T23:30:00.123+01:00",
    "2026-10-26T23:30",
    "2026-10-26T23:30:15.5",
    "ikke en dato",
    "",
  ].map((k) => [k, scheduled.toRateDateKey(k) ?? null]);
  const today = ["2026-10-31T22:30:00.000Z", "2026-10-31T23:05:00.000Z"].map((k) => [k, scheduled.copenhagenToday(new Date(k))]);

  save(
    "rounding-rates",
    [
      "src/lib/utils/rounding.ts",
      "src/lib/utils/__tests__/rounding.test.ts",
      "src/lib/rates/scheduled.ts",
      "src/lib/rates/scheduled.test.ts",
    ],
    { roundGrid: grid, disabled, resolve: resolveCases, rates: rateCases, rateDateKeys: keys, today },
  );
}

// ---------------------------------------------------------------------------
// Dansk tid og datogrænser
// ---------------------------------------------------------------------------
{
  const instants: string[] = [];
  for (const day of ["2026-03-28", "2026-03-29", "2026-10-24", "2026-10-25", "2026-12-31", "2027-03-28", "2027-10-31", "2026-09-30"]) {
    const s = Date.parse(`${day}T00:00:00Z`) - 3 * hour;
    for (let m = 0; m < 30 * 60; m += 15) instants.push(new Date(s + m * 60_000).toISOString());
  }
  instants.push("2026-09-30T21:59:59.000Z", "2026-12-31T22:59:59.000Z", "2026-03-29T00:59:00.000Z");
  const dates = instants.map((i) => [
    i,
    cph.toCopenhagenDateStr(new Date(i)),
    cph.copenhagenHour(new Date(i)),
    iso(entryDate.entryDateForStart(new Date(i))),
  ]);
  const days = [
    "2026-01-01", "2026-03-28", "2026-03-29", "2026-03-30", "2026-07-01", "2026-10-01", "2026-10-24", "2026-10-25",
    "2026-10-26", "2026-11-15", "2026-12-31", "2027-03-28", "2027-10-31", "2028-02-29",
  ];
  const dayBounds = days.map((d) => [
    d,
    iso(cph.copenhagenDayStart(d)),
    iso(cph.copenhagenDayEndExclusive(d)),
    cph.isoWeekdayOfDateStr(d),
    cph.weekStartDateStr(d),
    cph.monthStartDateStr(d),
    iso(cph.entryDateFromStr(d)),
  ]);
  const addDays = [
    ["2026-03-28", 1], ["2026-03-29", 1], ["2026-10-25", 1], ["2026-12-31", 1], ["2026-03-01", -1], ["2028-02-28", 1],
    ["2026-01-31", 400], ["2026-05-10", -365],
  ].map(([d, n]) => [d, n, cph.addDaysToDateStr(d, n)]);
  const addMonths = [
    ["2026-01-31", 1], ["2026-10-15", -1], ["2026-12-01", 1], ["2028-01-31", 1], ["2026-03-31", -1], ["2026-08-31", 18],
    ["2026-05-15", -17],
  ].map(([d, n]) => [d, n, cph.addMonthsToDateStr(d, n)]);
  const wall = [
    [2026, 7, 1, 9, 30, 0], [2026, 12, 1, 9, 30, 0], [2026, 10, 25, 12, 0, 0], [2026, 3, 29, 2, 30, 0],
    [2026, 10, 25, 2, 30, 0], [2026, 10, 25, 1, 59, 0], [2026, 10, 25, 3, 0, 0], [2026, 3, 29, 3, 0, 0],
    [2026, 3, 29, 1, 59, 59], [2027, 1, 1, 0, 0, 0],
  ].map((a) => [a, iso(cph.copenhagenWallTime(...(a as [number, number, number, number, number, number])))]);
  const isDate = ["2026-02-29", "2028-02-29", "2026-13-01", "2026-10-01", "2026-10-1", "x"].map((s) => [s, cph.isDateStr(s)]);

  // clock-range.ts: lokaltid i en proces med TZ=Europe/Copenhagen
  const clockCases: Array<[string, string, string]> = [
    ["2026-10-02", "09:00", "11:30"],
    ["2026-10-25", "01:00", "04:00"],
    ["2026-10-25", "02:00", "03:00"],
    ["2026-10-25", "02:30", "02:15"],
    ["2027-03-28", "01:00", "04:00"],
    ["2027-03-28", "02:30", "03:30"],
    ["2026-10-02", "23:00", "01:00"],
    ["2026-10-02", "09:00", "09:00"],
    ["2026-10-24", "23:30", "00:30"],
    ["2026-03-28", "22:00", "06:00"],
    ["2026-12-31", "23:45", "00:15"],
    ["2026-10-02", "9:5", "17:"],
    // Umulige datoer løber over som i new Date (review-fund)
    ["2026-02-30", "09:00", "10:00"],
    ["2026-13-01", "09:00", "10:00"],
    ["2026-10-26", "25:00", "26:30"],
  ];
  const clockRange = clockCases.map(([d, s, e]) => {
    const r = clock.clockRangeToInstants(d, s, e);
    return [d, s, e, iso(r.start), iso(r.end), clock.clockRangeHours(d, s, e)];
  });
  const between = [
    ["2026-10-02T07:00:00.000Z", "2026-10-02T09:20:00.000Z"],
    ["2026-10-02T07:00:00.000Z", "2026-10-02T07:00:20.000Z"],
    ["2026-10-02T07:00:00.000Z", "2026-10-02T06:00:00.000Z"],
    ["2026-10-02T07:00:00.000Z", "2026-10-02T07:00:18.000Z"],
    ["2026-10-02T07:00:00.000Z", "2026-10-02T07:00:54.000Z"],
  ].map(([a, b]) => [a, b, clock.hoursBetween(new Date(a), new Date(b))]);

  save(
    "copenhagen",
    [
      "src/lib/time/copenhagen.ts",
      "src/lib/time/__tests__/copenhagen.test.ts",
      "src/lib/timer/entry-date.ts (dateres efter START)",
      "src/lib/timer/__tests__/entry-date.test.ts",
      "src/lib/time/clock-range.ts",
      "src/lib/time/__tests__/clock-range.test.ts",
    ],
    { dates, dayBounds, addDays, addMonths, wall, isDate, clockRange, hoursBetween: between },
  );
}

// ---------------------------------------------------------------------------
// Faktura: forhåndsvisning, beløb, kladdenumre, moms-overblik
// ---------------------------------------------------------------------------
{
  const previewCases = [
    [
      { id: "a", hours: "2.5", billableRate: "800", projectId: "p1", projectName: "Hjemmeside", date: "2026-09-03" },
      { id: "b", hours: "1.5", billableRate: "800", projectId: "p1", projectName: "Hjemmeside", date: "2026-09-10" },
      { id: "c", hours: "1", billableRate: "600", projectId: null, projectName: null, date: "2026-08-28" },
    ],
    [{ id: "a", hours: 3, billableRate: null, projectId: null, projectName: null, date: "2026-09-01" }],
    [],
    [
      { id: "x", hours: "0.25", billableRate: "750.50", projectId: "p2", projectName: null, date: "2026-10-01" },
      { id: "y", hours: "1.33", billableRate: "333.33", projectId: "p3", projectName: "B", date: "2026-10-02" },
      { id: "z", hours: "abc", billableRate: "900", projectId: "p3", projectName: "B", date: "2026-09-30" },
      { id: "w", hours: "1.33", billableRate: "0", projectId: "p2", projectName: null, date: "2026-10-05" },
      { id: "v", hours: null, billableRate: "-100", projectId: null, projectName: null, date: "2026-10-05" },
    ],
    [
      { id: "1", hours: "1", billableRate: "100", projectId: "pa", projectName: "A", date: "2026-10-01" },
      { id: "2", hours: "2", billableRate: "50", projectId: "pb", projectName: "B", date: "2026-10-01" },
      { id: "3", hours: "4", billableRate: "25", projectId: "pc", projectName: "C", date: "2026-10-01" },
    ],
  ].map((entries) => ({ entries, expected: preview.buildInvoicePreview(entries) }));
  const periods = [
    ["all", "2026-10-02"], ["this_month", "2026-10-02"], ["last_month", "2026-10-02"], ["last_month", "2027-01-15"],
    ["last_month", "2028-03-01"], ["this_month", "2026-12-31"],
  ].map(([p, t]) => [p, t, preview.previewPeriodRange(p, t)]);

  const money = [
    0.1 + 0.2, 1.005, 1.015, 2.675, 1234.565, 0.125, 0.135, -1.005, -0.5, 4999.99, 10.075, 1249.9975, 0.285, 8.345,
    1000000.005, 33.333333,
  ].map((n) => [
    n,
    format.roundMoney(n),
    n.toFixed(2),
    // Sådan viser faktura-PDF'en beløb (InvoicePDF.tsx:125-132)
    n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ]);
  const lines = [];
  for (const q of ["1", "0.25", "1.33", "2.5", "7.75", "0.1", "3", "1.005", "12.345"]) {
    for (const pr of ["800", "750.50", "333.33", "0.1", "1250", "99.99", "1.005", "425.25"]) {
      const qty = Number.parseFloat(q) || 0;
      const price = Number.parseFloat(pr) || 0;
      lines.push([q, pr, (qty * price).toFixed(2)]);
    }
  }
  const sums = [
    [["0.1", "0.2"]],
    [["1000.00", "250.50", null, "", "abc", 3]],
    [["4999.99"]],
    [[]],
    [["1.005", "2.675"]],
  ].map(([xs]) => [xs, format.sumMoney(xs)]);
  const drafts = ["INV-042", "2026-117", "UDKAST-ABC", "udkast-abc", "Udkast-1", "", null, "XUDKAST-1"].map((n) => [
    n,
    draft.isDraftInvoiceNumber(n),
    draft.formatInvoiceNumber(n),
  ]);

  // vat/compute.ts regner i processens lokaltid; datoerne gives som
  // "yyyy-MM-dd" og bygges som lokal midnat, som web-testen gør.
  const local = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const invoicesA = [
    ["2026-01-15", 10000], ["2026-03-31", 5000], ["2026-04-01", 20000], ["2026-04-19", 8000], ["2025-12-31", 100000],
  ];
  const invoicesB = [["2026-10-15", 50000], ["2026-11-30", 30000], ["2026-09-30", 10000]];
  const invoicesC = [["2026-04-10", 10000], ["2026-05-05", 5000]];
  const invoicesD = [["2026-02-01", 1234.565], ["2026-02-02", 0.1], ["2026-02-03", 0.2], ["2026-07-01", 333.335]];
  const overviews = [];
  for (const [invoices, today] of [
    [invoicesA, "2026-04-19"], [invoicesB, "2026-12-01"], [[], "2026-04-19"], [invoicesC, "2026-04-20"], [invoicesD, "2026-02-28"],
    [invoicesD, "2026-07-31"], [invoicesD, "2026-12-31"], [invoicesC, "2028-02-10"],
  ] as Array<[Array<[string, number]>, string]>) {
    for (const kind of [undefined, "monthly", "quarterly", "semi_annual"]) {
      overviews.push({
        invoices,
        today,
        vatPeriod: kind ?? null,
        expected: vat.computeVatOverview({
          invoices: invoices.map(([d, a]) => ({ issueDate: local(d), amountExVat: a })),
          today: local(today),
          vatPeriod: kind,
        }),
      });
    }
  }
  const daysUntil = [["2026-04-20", "2026-04-20"], ["2026-04-01", "2026-04-20"], ["2026-04-21", "2026-04-20"], ["2026-12-31", "2027-01-20"], ["2026-03-01", "2026-04-20"], ["2026-10-01", "2026-11-01"]].map(
    ([a, b]) => [a, b, vat.daysUntilDeadline(local(a), local(b))],
  );

  save(
    "invoice",
    [
      "src/lib/invoicing/invoice-preview.ts",
      "src/lib/invoicing/invoice-preview.test.ts",
      "src/lib/format.ts:143-161 (roundMoney, sumMoney)",
      "src/components/invoices/InvoiceLineEditor.tsx:66-70 (linjebeløb = (antal × pris).toFixed(2))",
      "src/lib/invoices/draft-number.ts",
      "src/lib/invoices/draft-number.test.ts",
      "src/lib/vat/compute.ts",
      "src/lib/vat/compute.test.ts",
    ],
    { preview: previewCases, periods, money, lines, sums, drafts, vatOverview: overviews, daysUntilDeadline: daysUntil },
  );
}
