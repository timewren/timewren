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

export const DEMO_HOURLY_RATE = "90";

export interface SandboxScope {
  userId: string;
  orgId: string;
  invoiceTemplateId: string;
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
  | "northwind"
  | "harbour"
  | "greenleaf"
  | "hilltop"
  | "saltwater";
type ProjectKey =
  | "northwindWeb"
  | "northwindBrand"
  | "harbourPortal"
  | "greenleafSupport"
  | "hilltopLabels"
  | "saltwaterCampaign";
type PackageKey = "greenleaf" | "hilltop" | "saltwater";

const CLIENTS: Record<
  ClientKey,
  { name: string; email: string; rate: string; color: string; cvr: string }
> = {
  northwind: {
    name: "Northwind Studio",
    email: "hello@northwind-studio.example",
    rate: "105",
    color: "#3b82f6",
    cvr: "00000001",
  },
  harbour: {
    name: "Harbour Architects",
    email: "studio@harbour-architects.example",
    rate: "120",
    color: "#8b5cf6",
    cvr: "00000002",
  },
  greenleaf: {
    name: "Greenleaf Shop",
    email: "hello@greenleaf-shop.example",
    rate: DEMO_HOURLY_RATE,
    color: "#22c55e",
    cvr: "00000003",
  },
  hilltop: {
    name: "Hilltop Brewery",
    email: "info@hilltop-brewery.example",
    rate: "95",
    color: "#f59e0b",
    cvr: "00000004",
  },
  saltwater: {
    name: "Saltwater Communications",
    email: "hello@saltwater-communications.example",
    rate: "110",
    color: "#06b6d4",
    cvr: "00000005",
  },
};

const PROJECTS: Record<
  ProjectKey,
  { client: ClientKey; name: string; description: string; budget?: string }
> = {
  northwindWeb: {
    client: "northwind",
    name: "New website",
    description: "Design and development of a new website",
    budget: "80",
  },
  northwindBrand: {
    client: "northwind",
    name: "Brand guidelines",
    description: "Logo, colours and typography",
  },
  harbourPortal: {
    client: "harbour",
    name: "Project portal",
    description: "Internal portal for drawings and construction projects",
    budget: "60",
  },
  greenleafSupport: {
    client: "greenleaf",
    name: "Online shop support",
    description: "Ongoing support and small improvements",
  },
  hilltopLabels: {
    client: "hilltop",
    name: "Label design",
    description: "Labels for the spring beer releases",
  },
  saltwaterCampaign: {
    client: "saltwater",
    name: "Spring campaign",
    description: "Campaign landing pages and ads",
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
  greenleaf: {
    client: "greenleaf",
    project: "greenleafSupport",
    total: "20",
    purchasedDaysAgo: 45,
  },
  // Næsten brugt op: viser lav-saldo-advarslen
  hilltop: {
    client: "hilltop",
    project: "hilltopLabels",
    total: "10",
    purchasedDaysAgo: 44,
  },
  saltwater: {
    client: "saltwater",
    project: "saltwaterCampaign",
    total: "15",
    purchasedDaysAgo: 35,
  },
};

/** Klippekort-træk: [dage siden, timer]. Summerne giver pakkernes forbrug. */
const PREPAID_ENTRIES: Record<
  PackageKey,
  { days: number; hours: string; description: string }[]
> = {
  greenleaf: [
    { days: 38, hours: "1.50", description: "Update shipping rates" },
    { days: 31, hours: "2.00", description: "Fix checkout issues" },
    { days: 24, hours: "1.25", description: "Add new product photos" },
    {
      days: 17,
      hours: "1.75",
      description: "Set up promotional discount codes",
    },
    { days: 10, hours: "1.00", description: "Update plugins" },
    { days: 3, hours: "0.75", description: "Make a quick copy edit" },
  ],
  hilltop: [
    { days: 36, hours: "1.50", description: "Sketch three label concepts" },
    {
      days: 29,
      hours: "2.00",
      description: "Refine the selected label design",
    },
    {
      days: 22,
      hours: "1.50",
      description: "Review colour swatches and proofs",
    },
    { days: 15, hours: "1.75", description: "Adapt the design to the can" },
    { days: 8, hours: "1.25", description: "Prepare print-ready files" },
    {
      days: 1,
      hours: "1.00",
      description: "Revise artwork after the print proof",
    },
  ],
  saltwater: [
    { days: 33, hours: "2.00", description: "Draft the campaign brief" },
    { days: 19, hours: "1.50", description: "Write ad copy" },
    { days: 5, hours: "1.00", description: "Review campaign results" },
  ],
};

/** Daglig projekttid på hverdage, på skift mellem projekterne. */
const DAILY_ROTATION: { project: ProjectKey; descriptions: string[] }[] = [
  {
    project: "northwindWeb",
    descriptions: [
      "Homepage wireframes",
      "Build website components",
      "Responsive design",
      "Client feedback session",
    ],
  },
  {
    project: "harbourPortal",
    descriptions: [
      "Set up sign-in",
      "Upload architectural drawings",
      "Discuss the project workflow",
      "User testing",
    ],
  },
  {
    project: "northwindBrand",
    descriptions: [
      "Logo sketches",
      "Colour palette",
      "Typography and grid layout",
    ],
  },
  {
    project: "saltwaterCampaign",
    descriptions: [
      "Campaign landing page",
      "Social media banners",
      "A/B testing",
    ],
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
        description: "Bookkeeping and admin",
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
  // Invoice the older Harbour and Northwind entries and draft the latest
  // non-prepaid Saltwater campaign work.
  for (const e of out) {
    if (e.prepaid) continue;
    if (e.project === "harbourPortal" && e.days >= 21) e.invoice = "paid";
    else if (e.project === "northwindWeb" && e.days >= 14) e.invoice = "sent";
    else if (e.project === "saltwaterCampaign" && e.days < 14) {
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
          notes: "Fictional demo client.",
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
            name: `Prepaid ${p.total} hours`,
            clientId: clientId[p.client],
            projectId: projectId[p.project],
            totalHours: money(total),
            usedHours: money(usedHours(k)),
            remainingHours: money(total - usedHours(k)),
            hourlyRate: money(rate),
            totalValue: money(total * rate),
            purchaseDate: at(now, p.purchasedDaysAgo),
            expiryDate: at(now, p.purchasedDaysAgo - 365),
            description: "Prepaid hours for project work",
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
      paid: "harbour",
      sent: "northwind",
      draft: "saltwater",
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
          templateId: scope.invoiceTemplateId,
          invoiceNumber: "INV-001",
          clientId: clientId.harbour,
          amount: money(totals.paid.amount),
          status: "paid",
          issueDate: at(now, 20),
          dueDate: at(now, 6),
          paidDate: at(now, 8),
        },
        {
          ...base,
          templateId: scope.invoiceTemplateId,
          invoiceNumber: "INV-002",
          clientId: clientId.northwind,
          amount: money(totals.sent.amount),
          status: "sent",
          issueDate: at(now, 10),
          dueDate: at(now, -4),
        },
        {
          ...base,
          templateId: scope.invoiceTemplateId,
          invoiceNumber: draftInvoiceNumber(),
          clientId: clientId.saltwater,
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
      paid: "Project portal: development and meetings",
      sent: "New website: design and development",
      draft: "Spring campaign: landing pages and ads",
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
        title: "Draft a website footer",
        project: "northwindWeb" as const,
        status: "todo",
        priority: "medium",
        deadline: at(now, -3),
      },
      {
        title: "Review user testing feedback",
        project: "harbourPortal" as const,
        status: "in_progress",
        priority: "high",
        deadline: at(now, -1),
      },
      {
        title: "Order label print proofs",
        project: "hilltopLabels" as const,
        status: "todo",
        priority: "urgent",
        deadline: at(now, 0, 15),
      },
      {
        title: "Send the campaign report",
        project: "saltwaterCampaign" as const,
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
        oldRate: "85",
        newRate: DEMO_HOURLY_RATE,
        effectiveDate: at(now, 120),
        reason: "Annual rate adjustment",
      },
      {
        ...base,
        rateType: "client",
        clientId: clientId.northwind,
        oldRate: "95",
        newRate: CLIENTS.northwind.rate,
        effectiveDate: at(now, 60),
        reason: "New client agreement",
      },
      {
        ...base,
        rateType: "project",
        clientId: clientId.harbour,
        projectId: projectId.harbourPortal,
        oldRate: null,
        newRate: CLIENTS.harbour.rate,
        effectiveDate: at(now, 50),
        reason: "Project kickoff",
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
