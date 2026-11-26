import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, like, sql } from "drizzle-orm";
import type { Locale } from "@/i18n/config";
import type { db as Database } from "@/lib/db";
import {
  accounts,
  invoiceTemplates,
  members,
  organizationModules,
  organizations,
  users,
} from "@/lib/db/schema";
import { seedNewOrgModules } from "@/lib/modules/bundles";
import { regionForNewOrg, regionMetadata } from "@/lib/org/region";
import {
  DEMO_CURRENCY,
  DEMO_EMAIL_DOMAIN,
  DEMO_MAX_LIVE_USERS,
  EUR_DEMO_EMAIL_PREFIX,
} from "./demo-mode";
import {
  DEMO_HOURLY_RATE,
  type SandboxCounts,
  seedDemoSandbox,
} from "./seed-demo-sandbox";

type Db = typeof Database;

export type CreateDemoAccountResult =
  | {
      ok: true;
      userId: string;
      orgId: string;
      email: string;
      /** Kun til login i samme request; vises og gemmes aldrig. */
      password: string;
      counts: SandboxCounts;
    }
  | { ok: false; reason: "full" };

/** Demobrugere, der lever lige nu (oprydningen fjerner dem efter 24 timer). */
export function liveDemoUsersWhere() {
  return and(
    eq(users.isDemo, true),
    like(users.email, `%@${DEMO_EMAIL_DOMAIN}`),
  );
}

/**
 * Opretter en frisk demokonto til én besøgende (POST /api/demo/start):
 * bruger (isDemo, tilfældig adresse på det reserverede domæne, tilfældig
 * adgangskode), egen organisation med brugeren som ejer, moduler og
 * demodata. Alt i én transaktion; fejler noget, findes kontoen ikke.
 *
 * Kontoen oprettes direkte og ikke via better-auths signup, så signup-
 * hookens velkomstmail, admin-notifikation og admin-bootstrap ikke kører.
 * Loftet over levende demobrugere tjekkes bag en advisory lock, så samtidige
 * kald ikke kan smutte forbi det.
 */
/**
 * Demoorganisationens metadata. Demoen er TimeWren i EUR uanset sproget
 * (fakturaskabelonen og demodata er i EUR), så valutaen er låst; land og
 * sprog følger demobrugerens sprog som ved en ny TimeWren-workspace.
 */
export function demoOrgMetadata(locale: Locale): Record<string, unknown> {
  return {
    type: "freelance",
    ...regionMetadata({
      ...regionForNewOrg("timewren", locale),
      currency: DEMO_CURRENCY,
    }),
  };
}

export async function createDemoAccount(
  db: Db,
  opts: { locale?: Locale; maxLiveUsers?: number; now?: Date } = {},
): Promise<CreateDemoAccountResult> {
  const maxLiveUsers = opts.maxLiveUsers ?? DEMO_MAX_LIVE_USERS;
  const now = opts.now ?? new Date();
  const userId = randomUUID();
  const orgId = randomUUID();
  const handle = randomBytes(6).toString("hex");
  const email = `${EUR_DEMO_EMAIL_PREFIX}${handle}@${DEMO_EMAIL_DOMAIN}`;
  const password = randomBytes(24).toString("base64url");
  // Uden for transaktionen: scrypt tager ~50 ms og skal ikke holde låsen.
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('demo-start'))`);
    const [live] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(liveDemoUsersWhere());
    if ((live?.n ?? 0) >= maxLiveUsers) return { ok: false, reason: "full" };

    await tx.insert(users).values({
      id: userId,
      email,
      name: "Demo",
      emailVerified: true,
      isDemo: true,
      onboardingCompleted: true,
      locale: opts.locale ?? "en",
      defaultHourlyRate: DEMO_HOURLY_RATE,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(accounts).values({
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: "credential",
      password: passwordHash,
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: "Demo workspace",
      slug: `demo-${handle}`,
      metadata: demoOrgMetadata(opts.locale ?? "en"),
    });
    await tx.insert(members).values({
      id: randomUUID(),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    // @ts-expect-error - tx type is compatible with db for seedNewOrgModules
    await seedNewOrgModules(tx, orgId);
    // Demoen viser også opgaver (slået fra som standard for nye konti).
    await tx
      .update(organizationModules)
      .set({ isEnabled: true, enabledAt: now })
      .where(
        and(
          eq(organizationModules.organizationId, orgId),
          eq(organizationModules.moduleKey, "tasks"),
        ),
      );
    const [template] = await tx
      .insert(invoiceTemplates)
      .values({
        userId,
        organizationId: orgId,
        name: "Standard invoice",
        currency: DEMO_CURRENCY,
        isDefault: true,
      })
      .returning({ id: invoiceTemplates.id });
    const counts = await seedDemoSandbox(
      tx as unknown as Db,
      { userId, orgId, invoiceTemplateId: template.id },
      now,
    );

    return { ok: true, userId, orgId, email, password, counts };
  });
}
