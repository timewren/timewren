import { sql } from "drizzle-orm";
import type { db as DbType } from "@/lib/db";
import {
  addDaysToDateStr,
  addMonthsToDateStr,
  copenhagenToday,
  monthStartDateStr,
} from "@/lib/time/copenhagen";
import { parseDbTimestamp } from "@/lib/time/db-timestamp";

export interface ChurnRiskUser {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  riskScore: number;
  riskLevel: "high" | "medium" | "low";
  reasons: string[];
  daysSinceLastEntry: number;
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
}

function getRiskLevel(score: number): "high" | "medium" | "low" {
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export async function calculateChurnRisk(
  db: typeof DbType,
  options: { limit?: number; minLevel?: "high" | "medium" | "low" },
): Promise<ChurnRiskUser[]> {
  // Danske datoer som "yyyy-MM-dd" — `toISOString()` af en lokal midnat
  // ville rykke en dag tilbage, hvis processen kørte i Europe/Copenhagen (#649).
  const today = copenhagenToday();
  const fourteenDaysAgo = addDaysToDateStr(today, -14);
  const firstOfThisMonth = monthStartDateStr(today);
  const firstOfLastMonth = addMonthsToDateStr(firstOfThisMonth, -1);

  const scoreExpr = sql`
    CASE
      WHEN COUNT(te.id) FILTER (WHERE te.date >= ${fourteenDaysAgo}::date) <= 1
        AND COALESCE(EXTRACT(DAY FROM (now() - MAX(te.date))), 999) < 30
      THEN 40
      WHEN COALESCE(EXTRACT(DAY FROM (now() - MAX(te.date))), 999) >= 30 THEN 60
      ELSE 0
    END
    + CASE
        WHEN s.status = 'trialing'
          AND s.trial_ends_at IS NOT NULL
          AND s.trial_ends_at <= (now() + interval '7 days')
          AND s.trial_ends_at > now()
        THEN 25
        ELSE 0
      END
    + CASE WHEN s.status IN ('past_due', 'canceled') THEN 30 ELSE 0 END
    + CASE
        WHEN COUNT(te.id) FILTER (
          WHERE te.date >= ${firstOfLastMonth}::date
            AND te.date < ${firstOfThisMonth}::date
        ) > 0
        AND COUNT(te.id) FILTER (WHERE te.date >= ${firstOfThisMonth}::date)::float
          < COUNT(te.id) FILTER (
              WHERE te.date >= ${firstOfLastMonth}::date
                AND te.date < ${firstOfThisMonth}::date
            )::float * 0.5
        THEN 20
        ELSE 0
      END
  `;

  const result = await db.execute(sql`
    SELECT
      u.id AS user_id,
      u.name,
      u.email,
      u.image,
      COALESCE(EXTRACT(DAY FROM (now() - MAX(te.date))), 999)::int AS days_since_last,
      COUNT(te.id) FILTER (WHERE te.date >= ${fourteenDaysAgo}::date)::int AS entries_14d,
      COUNT(te.id) FILTER (WHERE te.date >= ${firstOfThisMonth}::date)::int AS entries_this_month,
      COUNT(te.id) FILTER (
        WHERE te.date >= ${firstOfLastMonth}::date
          AND te.date < ${firstOfThisMonth}::date
      )::int AS entries_last_month,
      s.status AS sub_status,
      s.trial_ends_at,
      (${scoreExpr})::int AS risk_score
    FROM "user" u
    LEFT JOIN time_entries te ON te.user_id = u.id
    LEFT JOIN subscriptions s ON s.user_id = u.id
    WHERE u.role = 'user'
      AND (u.is_demo IS NULL OR u.is_demo = false)
      AND u.banned = false
    GROUP BY u.id, u.name, u.email, u.image, s.status, s.trial_ends_at
    HAVING (${scoreExpr})::int >= ${options.minLevel === "high" ? 60 : options.minLevel === "medium" ? 40 : 1}
    ORDER BY (${scoreExpr})::int DESC
    LIMIT ${options.limit ?? 10}
  `);

  return (result as unknown as Array<Record<string, unknown>>).map((r) => {
    const score = Number(r.risk_score);
    const daysSince = Number(r.days_since_last);
    const entries14d = Number(r.entries_14d);
    const entriesThisMonth = Number(r.entries_this_month);
    const entriesLastMonth = Number(r.entries_last_month);
    const subStatus = r.sub_status as string | null;

    const reasons: string[] = [];
    if (daysSince >= 30) reasons.push(`Ingen aktivitet i ${daysSince} dage`);
    else if (entries14d <= 1)
      reasons.push(`Kun ${entries14d} postering(er) de seneste 14 dage`);
    if (subStatus === "trialing" && r.trial_ends_at)
      reasons.push("Prøveperiode udløber snart");
    if (subStatus === "past_due") reasons.push("Betaling fejlet");
    if (subStatus === "canceled") reasons.push("Abonnement opsagt");
    if (entriesLastMonth > 0 && entriesThisMonth < entriesLastMonth * 0.5)
      reasons.push("Faldende aktivitet (>50% drop)");

    return {
      userId: r.user_id as string,
      name: (r.name as string) || "Unavngivet",
      email: r.email as string,
      image: (r.image as string) || null,
      riskScore: score,
      riskLevel: getRiskLevel(score),
      reasons,
      daysSinceLastEntry: daysSince >= 999 ? -1 : daysSince,
      subscriptionStatus: subStatus,
      trialEndsAt: parseDbTimestamp(r.trial_ends_at as Date | string | null),
    };
  });
}
