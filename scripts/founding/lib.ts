/**
 * Founding-kunde: udpegning og kredit. Ren logik, så scripts og tests deler
 * den. Intet her returnerer navne, mails eller anden persondata: kun id'er,
 * antal og tekniske felter.
 */
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// biome-ignore lint/suspicious/noExplicitAny: scripts bruger en schema-løs db
type Db = PostgresJsDatabase<any>;

/** Aktiv = mindst én tidsregistrering inden for så mange dage. */
export const ACTIVE_WINDOW_DAYS = 90;

/** Navnet på rabatten i Alunta. Bruges også som idempotens-markør. */
export const CREDIT_DISCOUNT_NAME = "Founding: 1 måned gratis";

export interface FoundingOptions {
  /** Kun organisationer oprettet før dette tidspunkt. */
  before: Date;
  /** "Nu" i aktivitetsvinduet (injiceres, så tests er deterministiske). */
  now: Date;
  activeWindowDays?: number;
}

export interface FoundingSelection {
  /** Kandidater der ikke allerede er mærket. */
  candidates: string[];
  /** Organisationer der allerede har mærket (rører vi ikke). */
  alreadyMarked: number;
}

/**
 * Fælles betingelser. En betalt konto = abonnement hos en betalingsudbyder
 * (Alunta, Stripe eller butik) der ikke bare er en prøve, eller en aktiv/
 * forfalden status. Abonnementet kobles via organizationId, med ejerens
 * userId som fald-tilbage (organizationId er nullable på ældre rækker).
 * Tidsregistreringer kobles på samme måde.
 */
export async function selectFoundingOrgs(
  db: Db,
  opts: FoundingOptions,
): Promise<FoundingSelection> {
  const days = opts.activeWindowDays ?? ACTIVE_WINDOW_DAYS;
  const since = new Date(opts.now.getTime() - days * 86_400_000);
  const rows = (await db.execute(sql`
    SELECT o.id, (o.founding_since IS NOT NULL) AS marked
    FROM organizations o
    WHERE o.brand = 'timetrack'
      AND o.created_at < ${opts.before.toISOString()}::timestamptz
      AND (
        EXISTS (
          SELECT 1 FROM subscriptions s
          WHERE (
              s.organization_id = o.id
              OR s.user_id IN (
                SELECT m.user_id FROM members m
                WHERE m.organization_id = o.id AND m.role = 'owner'
              )
            )
            AND COALESCE(s.is_trial, false) = false
            AND (
              s.status IN ('active', 'past_due')
              OR s.alunta_subscription_id IS NOT NULL
              OR s.stripe_subscription_id IS NOT NULL
              OR s.store_provider IS NOT NULL
            )
        )
        OR EXISTS (
          SELECT 1 FROM time_entries te
          WHERE (
              te.organization_id = o.id
              OR (
                te.organization_id IS NULL
                AND te.user_id IN (
                  SELECT m.user_id FROM members m
                  WHERE m.organization_id = o.id AND m.role = 'owner'
                )
              )
            )
            AND te.date >= ${since.toISOString()}::timestamptz
            AND te.date <= ${opts.now.toISOString()}::timestamptz
        )
      )
    ORDER BY o.id
  `)) as unknown as Array<{ id: string; marked: boolean }>;
  return {
    candidates: rows.filter((r) => !r.marked).map((r) => r.id),
    alreadyMarked: rows.filter((r) => r.marked).length,
  };
}

/**
 * Sætter mærket. Idempotent: rører kun rækker hvor founding_since er NULL,
 * så en gentagelse ændrer ingenting (og overskriver aldrig en tidligere dato).
 * Returnerer de id'er der faktisk blev opdateret.
 */
export async function markFounding(
  db: Db,
  orgIds: string[],
  at: Date,
): Promise<string[]> {
  if (orgIds.length === 0) return [];
  const rows = (await db.execute(sql`
    UPDATE organizations
    SET founding_since = ${at.toISOString()}::timestamptz
    WHERE founding_since IS NULL
      AND id IN (${sql.join(
        orgIds.map((id) => sql`${id}`),
        sql`, `,
      )})
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id).sort();
}

export interface CreditCandidate {
  orgId: string;
  aluntaSubscriptionId: string;
  billingCycle: string;
  planTier: string;
  seatCount: number;
  aluntaPlanId: string | null;
  discountPercent: number;
  currentPeriodEnd: Date | null;
}

/**
 * Founding-orgs med et aktivt betalt Alunta-abonnement (ikke prøve, ikke
 * butiksstyret). Butiksstyrede og abonnementer uden Alunta-id hører ikke
 * hjemme her: de kan ikke krediteres via Alunta.
 */
export async function listCreditCandidates(db: Db): Promise<CreditCandidate[]> {
  const rows = (await db.execute(sql`
    SELECT o.id AS org_id,
           s.alunta_subscription_id,
           s.billing_cycle,
           s.plan_tier,
           s.seat_count,
           s.alunta_plan_id,
           COALESCE(s.discount_percent, 0) AS discount_percent,
           s.current_period_end
    FROM organizations o
    JOIN subscriptions s
      ON s.organization_id = o.id
      OR s.user_id IN (
        SELECT m.user_id FROM members m
        WHERE m.organization_id = o.id AND m.role = 'owner'
      )
    WHERE o.founding_since IS NOT NULL
      AND s.status = 'active'
      AND COALESCE(s.is_trial, false) = false
      AND s.alunta_subscription_id IS NOT NULL
      AND s.store_provider IS NULL
    ORDER BY o.id, s.alunta_subscription_id
  `)) as unknown as Array<{
    org_id: string;
    alunta_subscription_id: string;
    billing_cycle: string;
    plan_tier: string;
    seat_count: number;
    alunta_plan_id: string | null;
    discount_percent: number;
    current_period_end: Date | string | null;
  }>;
  const seen = new Set<string>();
  const out: CreditCandidate[] = [];
  for (const r of rows) {
    if (seen.has(r.alunta_subscription_id)) continue;
    seen.add(r.alunta_subscription_id);
    out.push({
      orgId: r.org_id,
      aluntaSubscriptionId: r.alunta_subscription_id,
      billingCycle: r.billing_cycle,
      planTier: r.plan_tier,
      seatCount: r.seat_count,
      aluntaPlanId: r.alunta_plan_id,
      discountPercent: Number(r.discount_percent),
      currentPeriodEnd: r.current_period_end
        ? new Date(r.current_period_end)
        : null,
    });
  }
  return out;
}

export interface CreditPlan {
  /** Beløb i DKK der springes over (én måneds listepris efter rabat). */
  amount: number;
  discount: {
    discount_name: string;
    discount_type: "percent" | "fixed";
    discount_value: number;
    from_date: string;
    to_date: string;
  };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(
    Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0),
  ).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

/**
 * Hvad der skal ske for ét abonnement: næste måned (fra nuværende periodes
 * slutning) bliver gratis. Kun månedlige: 100 % rabat i den måned. Årlige springes over
 * (manuel kreditnota), og forældet periodeslutning springes over.
 * `monthlyListPrice` er månedsprisen før rabat, udregnet af kalderen med
 * repoets prisbog.
 */
export function planCredit(
  c: CreditCandidate,
  monthlyListPrice: number,
  now: Date = new Date(),
): CreditPlan | { skip: string } {
  if (!c.currentPeriodEnd) return { skip: "mangler periodeslutning" };
  if (c.currentPeriodEnd.getTime() < now.getTime()) {
    return {
      skip: "periodeslutning ligger i fortiden (forældet data), tjek i Alunta",
    };
  }
  if (c.billingCycle === "yearly") {
    return {
      skip: "årligt abonnement: giv kreditnota manuelt i Alunta (rabatsemantik på årsfaktura er ikke verificeret)",
    };
  }
  const from = c.currentPeriodEnd;
  const to = addMonths(from, 1);
  const base = monthlyListPrice * (1 - c.discountPercent / 100);
  const amount = Math.round(base * 100) / 100;
  return {
    amount,
    discount: {
      discount_name: CREDIT_DISCOUNT_NAME,
      discount_type: "percent",
      discount_value: 100,
      from_date: ymd(from),
      to_date: ymd(to),
    },
  };
}
