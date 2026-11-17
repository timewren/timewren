import type { db as Database } from "@/lib/db";
import {
  clients,
  invoiceLines,
  invoices,
  prepaidPackages,
  prepaidUsage,
  projects,
  rateHistory,
  tasks,
  timeEntries,
} from "@/lib/db/schema";
import { draftInvoiceNumber } from "@/lib/invoices/draft-number";

/**
 * Demodata til den offentlige demo (DEMO_MODE=1, POST /api/demo/start): en
 * hel, opdigtet freelancerverden, så en besøgende straks kan klikke rundt.
 * Fem kunder, seks projekter, tre klippekort (ét næsten brugt op), seks
 * ugers tidsposter frem til i dag, opgaver, tre fakturaer (kladde, sendt,
 * betalt) og satshistorik.
 *
 * Alt er opfundet: navnene er ikke rigtige firmaer, og adresserne bruger det
 * reserverede `.example`-domæne. Onboardingens "Ryd demo-data"
 * (seed-demo-data.ts) bruges ikke her; hele kontoen slettes af
 * /api/cron/demo-cleanup efter 24 timer.
 *
 * Alt indsættes i én transaktion med få, samlede inserts.
 */

type Db = typeof Database;

export interface SandboxScope {
  userId: string;
  orgId: string;
}

export interface SandboxCounts {
  clients: number;
  projects: number;
  prepaidPackages: number;
  timeEntries: number;
  prepaidUsage: number;
  tasks: number;
  invoices: number;
  rateHistory: number;
}

/** Antal dage bagud, der seedes tidsposter for (6 uger). */
export const SANDBOX_DAYS = 42;

type ClientKey =
  | "nordlys"
  | "fjordhavn"
  | "groenGren"
  | "bakketop"
  | "saltvand";
type ProjectKey =
  | "nordlysWeb"
  | "nordlysBrand"
  | "fjordhavnPortal"
  | "groenGrenSupport"
  | "bakketopEtiket"
  | "saltvandKampagne";
type PackageKey = "groenGren" | "bakketop" | "saltvand";

const CLIENTS: Record<
  ClientKey,
  { name: string; email: string; rate: string; color: string; cvr: string }
> = {
  nordlys: {
    name: "Nordlys Design ApS",
    email: "kontakt@nordlys-design.example",
    rate: "850",
    color: "#3b82f6",
    cvr: "00000001",
  },
  fjordhavn: {
    name: "Fjordhavn Arkitekter ApS",
    email: "post@fjordhavn-arkitekter.example",
    rate: "950",
    color: "#8b5cf6",
    cvr: "00000002",
  },
  groenGren: {
    name: "Grøn Gren Webshop ApS",
    email: "hej@groen-gren.example",
    rate: "750",
    color: "#22c55e",
    cvr: "00000003",
  },
  bakketop: {
    name: "Bakketop Bryggeri ApS",
    email: "info@bakketop-bryggeri.example",
    rate: "800",
    color: "#f59e0b",
    cvr: "00000004",
  },
  saltvand: {
    name: "Saltvand Kommunikation ApS",
    email: "hello@saltvand.example",
    rate: "900",
    color: "#06b6d4",
    cvr: "00000005",
  },
};

const PROJECTS: Record<
  ProjectKey,
  { client: ClientKey; name: string; description: string; budget?: string }
> = {
  nordlysWeb: {
    client: "nordlys",
    name: "Ny hjemmeside",
    description: "Design og udvikling af ny hjemmeside",
    budget: "80",
  },
  nordlysBrand: {
    client: "nordlys",
    name: "Brandguide",
    description: "Logo, farver og typografi",
  },
  fjordhavnPortal: {
    client: "fjordhavn",
    name: "Projektportal",
    description: "Intern portal til tegninger og byggesager",
    budget: "60",
  },
  groenGrenSupport: {
    client: "groenGren",
    name: "Webshop-support",
    description: "Løbende support og småopgaver",
  },
  bakketopEtiket: {
    client: "bakketop",
    name: "Etiketdesign",
    description: "Etiketter til forårets nye øl",
  },
  saltvandKampagne: {
    client: "saltvand",
    name: "Forårskampagne",
    description: "Kampagnesider og annoncer",
  },
};

const PACKAGES: Record<
  PackageKey,
  {
    client: ClientKey;
    project: ProjectKey;
    total: string;
    purchasedDaysAgo: number;
  }
> = {
  groenGren: {
    client: "groenGren",
    project: "groenGrenSupport",
    total: "20",
    purchasedDaysAgo: 45,
  },
  // Næsten brugt op: viser lav-saldo-advarslen
  bakketop: {
    client: "bakketop",
    project: "bakketopEtiket",
    total: "10",
    purchasedDaysAgo: 44,
  },
  saltvand: {
    client: "saltvand",
    project: "saltvandKampagne",
    total: "15",
    purchasedDaysAgo: 35,
  },
};

/** Klippekort-træk: [dage siden, timer]. Summerne giver pakkernes forbrug. */
const PREPAID_ENTRIES: Record<
  PackageKey,
  { days: number; hours: string; description: string }[]
> = {
  groenGren: [
    { days: 38, hours: "1.50", description: "Opdatering af fragtpriser" },
    { days: 31, hours: "2.00", description: "Fejlretning i checkout" },
    { days: 24, hours: "1.25", description: "Nye produktbilleder" },
    { days: 17, hours: "1.75", description: "Rabatkoder til Black Friday" },
    { days: 10, hours: "1.00", description: "Opdatering af plugins" },
    { days: 3, hours: "0.75", description: "Hurtig rettelse af tekst" },
  ],
  bakketop: [
    { days: 36, hours: "1.50", description: "Skitser til tre etiketter" },
    { days: 29, hours: "2.00", description: "Rentegning af valgt etiket" },
    { days: 22, hours: "1.50", description: "Farveprøver og korrektur" },
    { days: 15, hours: "1.75", description: "Tilpasning til dåse" },
    { days: 8, hours: "1.25", description: "Trykklare filer" },
    { days: 1, hours: "1.00", description: "Rettelser efter prøvetryk" },
  ],
  saltvand: [
    { days: 33, hours: "2.00", description: "Kampagneoplæg" },
    { days: 19, hours: "1.50", description: "Annoncetekster" },
    { days: 5, hours: "1.00", description: "Opfølgning på tal" },
  ],
};

/** Daglig projekttid på hverdage, på skift mellem projekterne. */
const DAILY_ROTATION: { project: ProjectKey; descriptions: string[] }[] = [
  {
    project: "nordlysWeb",
    descriptions: [
      "Wireframes til forsiden",
      "Udvikling af komponenter",
      "Responsivt design",
      "Feedbackrunde med kunden",
    ],
  },
  {
    project: "fjordhavnPortal",
    descriptions: [
      "Opsætning af login",
      "Upload af tegninger",
      "Møde om sagsflow",
      "Test med brugerne",
    ],
  },
  {
    project: "nordlysBrand",
    descriptions: ["Logoskitser", "Farvepalet", "Typografi og grid"],
  },
  {
    project: "saltvandKampagne",
    descriptions: ["Kampagneside", "Bannere til sociale medier", "A/B-test"],
  },
];
const DAILY_HOURS = ["3.50", "5.00", "2.75", "4.25", "6.00", "3.00", "4.50"];

/** Dato `days` dage før `now`, kl. `hour`; weekender flyttes til fredag. */
function workday(now: Date, days: number, hour = 9): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() - 1);
  if (dow === 0) d.setDate(d.getDate() - 2);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function at(now: Date, days: number, hour = 9): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const money = (n: number) => n.toFixed(2);

interface EntrySpec {
  client: ClientKey | null;
  project: ProjectKey | null;
  prepaid: PackageKey | null;
  days: number;
  date: Date;
  hours: string;
  description: string;
  billable: boolean;
  rate: string | null;
  invoice: "paid" | "sent" | "draft" | null;
}

function buildEntries(now: Date): EntrySpec[] {
  const out: EntrySpec[] = [];
  let weekday = 0;
  for (let days = SANDBOX_DAYS - 1; days >= 0; days--) {
    const date = at(now, days);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;
    const slot = DAILY_ROTATION[weekday % DAILY_ROTATION.length];
    const project = PROJECTS[slot.project];
    out.push({
      client: project.client,
      project: slot.project,
      prepaid: null,
      days,
      date,
      hours: DAILY_HOURS[weekday % DAILY_HOURS.length],
      description:
        slot.descriptions[
          Math.floor(weekday / DAILY_ROTATION.length) % slot.descriptions.length
        ],
      billable: true,
      rate: CLIENTS[project.client].rate,
      invoice: null,
    });
    // Intern tid om mandagen
    if (dow === 1) {
      out.push({
        client: null,
        project: null,
        prepaid: null,
        days,
        date: at(now, days, 8),
        hours: "1.00",
        description: "Bogføring og administration",
        billable: false,
        rate: null,
        invoice: null,
      });
    }
    weekday++;
  }
  for (const [key, entries] of Object.entries(PREPAID_ENTRIES) as [
    PackageKey,
    (typeof PREPAID_ENTRIES)[PackageKey],
  ][]) {
    const pkg = PACKAGES[key];
    for (const e of entries) {
      out.push({
        client: pkg.client,
        project: pkg.project,
        prepaid: key,
        days: e.days,
        date: workday(now, e.days, 13),
        hours: e.hours,
        description: e.description,
        billable: true,
        rate: CLIENTS[pkg.client].rate,
        invoice: null,
      });
    }
  }
  // Fakturaer: Fjordhavns ældste uger er betalt, Nordlys' hjemmeside er sendt,
  // og Saltvands kampagne (uden for klippekortet) ligger som kladde.
  for (const e of out) {
    if (e.prepaid) continue;
    if (e.project === "fjordhavnPortal" && e.days >= 21) e.invoice = "paid";
    else if (e.project === "nordlysWeb" && e.days >= 14) e.invoice = "sent";
    else if (e.project === "saltvandKampagne" && e.days < 14) {
      e.invoice = "draft";
    }
  }
  return out;
}

/**
 * Seeder demoverdenen for en ny, tom demokonto. Kaldes inde i
 * /api/demo/start's transaktion (en indlejret transaktion bliver et
 * savepoint), men åbner selv én, når den kaldes med db.
 */
export async function seedDemoSandbox(
  db: Db,
  scope: SandboxScope,
  now: Date = new Date(),
): Promise<SandboxCounts> {
  return db.transaction(async (tx) => {
    const base = { userId: scope.userId, organizationId: scope.orgId };

    // ── Kunder ────────────────────────────────────────────────────────────
    const clientKeys = Object.keys(CLIENTS) as ClientKey[];
    const clientRows = await tx
      .insert(clients)
      .values(
        clientKeys.map((k) => ({
          ...base,
          name: CLIENTS[k].name,
          company: CLIENTS[k].name,
          email: CLIENTS[k].email,
          cvr: CLIENTS[k].cvr,
          defaultHourlyRate: CLIENTS[k].rate,
          color: CLIENTS[k].color,
          notes: "Opdigtet demokunde.",
        })),
      )
      .returning({ id: clients.id });
    const clientId = Object.fromEntries(
      clientKeys.map((k, i) => [k, clientRows[i].id]),
    ) as Record<ClientKey, string>;

    // ── Projekter ─────────────────────────────────────────────────────────
    const projectKeys = Object.keys(PROJECTS) as ProjectKey[];
    const projectRows = await tx
      .insert(projects)
      .values(
        projectKeys.map((k) => ({
          ...base,
          name: PROJECTS[k].name,
          description: PROJECTS[k].description,
          clientId: clientId[PROJECTS[k].client],
          budgetHours: PROJECTS[k].budget ?? null,
          status: "active",
        })),
      )
      .returning({ id: projects.id });
    const projectId = Object.fromEntries(
      projectKeys.map((k, i) => [k, projectRows[i].id]),
    ) as Record<ProjectKey, string>;

    // ── Klippekort (forbruget følger trækkene nedenfor) ───────────────────
    const packageKeys = Object.keys(PACKAGES) as PackageKey[];
    const usedHours = (k: PackageKey) =>
      PREPAID_ENTRIES[k].reduce((sum, e) => sum + Number(e.hours), 0);
    const packageRows = await tx
      .insert(prepaidPackages)
      .values(
        packageKeys.map((k) => {
          const p = PACKAGES[k];
          const rate = Number(CLIENTS[p.client].rate);
          const total = Number(p.total);
          return {
            ...base,
            name: `Klippekort ${p.total} timer`,
            clientId: clientId[p.client],
            projectId: projectId[p.project],
            totalHours: money(total),
            usedHours: money(usedHours(k)),
            remainingHours: money(total - usedHours(k)),
            hourlyRate: money(rate),
            totalValue: money(total * rate),
            purchaseDate: at(now, p.purchasedDaysAgo),
            expiryDate: at(now, p.purchasedDaysAgo - 365),
            description: "Forudbetalte timer",
          };
        }),
      )
      .returning({ id: prepaidPackages.id });
    const packageId = Object.fromEntries(
      packageKeys.map((k, i) => [k, packageRows[i].id]),
    ) as Record<PackageKey, string>;

    // ── Fakturaer (beløb ekskl. moms = summen af linjerne) ────────────────
    const specs = buildEntries(now);
    const invoiceKinds = ["paid", "sent", "draft"] as const;
    const invoiceClient: Record<(typeof invoiceKinds)[number], ClientKey> = {
      paid: "fjordhavn",
      sent: "nordlys",
      draft: "saltvand",
    };
    const totals = Object.fromEntries(
      invoiceKinds.map((kind) => {
        const hours = specs
          .filter((e) => e.invoice === kind)
          .reduce((sum, e) => sum + Number(e.hours), 0);
        const rate = Number(CLIENTS[invoiceClient[kind]].rate);
        return [kind, { hours, rate, amount: hours * rate }];
      }),
    ) as Record<
      (typeof invoiceKinds)[number],
      { hours: number; rate: number; amount: number }
    >;
    const invoiceRows = await tx
      .insert(invoices)
      .values([
        {
          ...base,
          invoiceNumber: "INV-001",
          clientId: clientId.fjordhavn,
          amount: money(totals.paid.amount),
          status: "paid",
          issueDate: at(now, 20),
          dueDate: at(now, 6),
          paidDate: at(now, 8),
        },
        {
          ...base,
          invoiceNumber: "INV-002",
          clientId: clientId.nordlys,
          amount: money(totals.sent.amount),
          status: "sent",
          issueDate: at(now, 10),
          dueDate: at(now, -4),
        },
        {
          ...base,
          invoiceNumber: draftInvoiceNumber(),
          clientId: clientId.saltvand,
          amount: money(totals.draft.amount),
          status: "draft",
          issueDate: at(now, 0),
          dueDate: at(now, -14),
        },
      ])
      .returning({ id: invoices.id });
    const invoiceId = {
      paid: invoiceRows[0].id,
      sent: invoiceRows[1].id,
      draft: invoiceRows[2].id,
    };
    const lineText = {
      paid: "Projektportal: udvikling og møder",
      sent: "Ny hjemmeside: design og udvikling",
      draft: "Forårskampagne: kampagnesider og annoncer",
    };
    await tx.insert(invoiceLines).values(
      invoiceKinds.map((kind) => ({
        invoiceId: invoiceId[kind],
        description: lineText[kind],
        quantity: money(totals[kind].hours),
        unitPrice: money(totals[kind].rate),
        amount: money(totals[kind].amount),
      })),
    );

    // ── Tidsposter ────────────────────────────────────────────────────────
    const entryRows = await tx
      .insert(timeEntries)
      .values(
        specs.map((e) => ({
          ...base,
          clientId: e.client ? clientId[e.client] : null,
          projectId: e.project ? projectId[e.project] : null,
          prepaidPackageId: e.prepaid ? packageId[e.prepaid] : null,
          invoiceId: e.invoice ? invoiceId[e.invoice] : null,
          isBilled: e.invoice === "paid" || e.invoice === "sent",
          description: e.description,
          hours: e.hours,
          date: e.date,
          billableRate: e.rate,
          isBillable: e.billable,
          isPrepaid: e.prepaid !== null,
          source: "demo",
        })),
      )
      .returning({ id: timeEntries.id });

    // ── Klippekort-træk (én usage-række pr. prepaid tidspost) ─────────────
    const usageRows = specs.flatMap((e, i) =>
      e.prepaid
        ? [
            {
              prepaidPackageId: packageId[e.prepaid],
              timeEntryId: entryRows[i].id,
              hoursUsed: e.hours,
              valueUsed: money(Number(e.hours) * Number(e.rate)),
            },
          ]
        : [],
    );
    await tx.insert(prepaidUsage).values(usageRows);

    // ── Opgaver ───────────────────────────────────────────────────────────
    const taskValues = [
      {
        title: "Lav forslag til footer",
        project: "nordlysWeb" as const,
        status: "todo",
        priority: "medium",
        deadline: at(now, -3),
      },
      {
        title: "Gennemgå tilbagemeldinger fra testbrugere",
        project: "fjordhavnPortal" as const,
        status: "in_progress",
        priority: "high",
        deadline: at(now, -1),
      },
      {
        title: "Bestil prøvetryk af etiketter",
        project: "bakketopEtiket" as const,
        status: "todo",
        priority: "urgent",
        deadline: at(now, 0, 15),
      },
      {
        title: "Send kampagnerapport",
        project: "saltvandKampagne" as const,
        status: "done",
        priority: "low",
        deadline: at(now, 4),
        completedAt: at(now, 4, 14),
      },
    ];
    await tx.insert(tasks).values(
      taskValues.map((t, position) => ({
        ...base,
        title: t.title,
        projectId: projectId[t.project],
        clientId: clientId[PROJECTS[t.project].client],
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        completedAt: t.completedAt ?? null,
        position,
      })),
    );

    // ── Satshistorik ──────────────────────────────────────────────────────
    const rateRows = [
      {
        ...base,
        rateType: "global",
        oldRate: "700",
        newRate: "750",
        effectiveDate: at(now, 120),
        reason: "Årlig regulering",
      },
      {
        ...base,
        rateType: "client",
        clientId: clientId.nordlys,
        oldRate: "800",
        newRate: CLIENTS.nordlys.rate,
        effectiveDate: at(now, 60),
        reason: "Ny aftale",
      },
      {
        ...base,
        rateType: "project",
        clientId: clientId.fjordhavn,
        projectId: projectId.fjordhavnPortal,
        oldRate: null,
        newRate: CLIENTS.fjordhavn.rate,
        effectiveDate: at(now, 50),
        reason: "Projektstart",
      },
    ];
    await tx.insert(rateHistory).values(rateRows);

    return {
      clients: clientRows.length,
      projects: projectRows.length,
      prepaidPackages: packageRows.length,
      timeEntries: entryRows.length,
      prepaidUsage: usageRows.length,
      tasks: taskValues.length,
      invoices: invoiceRows.length,
      rateHistory: rateRows.length,
    };
  });
}

/** Til tests: tidsposterne for en given dag, uden database. */
export const buildSandboxEntriesForTests = buildEntries;
