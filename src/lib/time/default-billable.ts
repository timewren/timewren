import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { activityTypes, clients, projects } from "@/lib/db/schema";

type Db = PostgresJsDatabase<typeof schema>;
/** Transaktions-handle har samme query-API som db. */
type DbLike = Pick<Db, "query">;

/**
 * Præcedens for fakturerbar-default på en NY tidspost (#541, #704):
 *
 * 1. Eksplicit isBillable fra kalderen vinder altid.
 * 2. Intern klient: clients.defaultBillable = false — direkte via clientId
 *    eller via projektets klient — giver altid ikke-fakturerbar. Projekter
 *    har ingen egen fakturerbar-indstilling; de virker gennem deres klient.
 * 3. Aktivitetstypens defaultBillable (true/false; NULL = arv).
 * 4. Kaldestiens standard: true for almindelig tidsregistrering (det samme
 *    som en almindelig klients defaultBillable = true), false for
 *    enterprise-timesedlen, der altid har oprettet ikke-fakturerbare poster.
 *
 * Klientens defaultBillable er NOT NULL med default true, så true kan ikke
 * skelnes fra "ikke sat" — kun false er en aktiv regel. Derfor ligger
 * aktivitetstypen mellem intern-klient-reglen og standarden: "Administration"
 * kan være ikke-fakturerbar på en almindelig kunde, men en fakturerbar
 * aktivitet gør aldrig tid på en intern klient fakturerbar.
 */
export function pickDefaultBillable(input: {
  explicit?: boolean | null;
  clientDefaultBillable?: boolean | null;
  activityTypeDefaultBillable?: boolean | null;
  fallback?: boolean;
}): boolean {
  if (typeof input.explicit === "boolean") return input.explicit;
  if (input.clientDefaultBillable === false) return false;
  if (typeof input.activityTypeDefaultBillable === "boolean") {
    return input.activityTypeDefaultBillable;
  }
  return input.fallback ?? true;
}

/**
 * Fakturerbar-default for en NY tidspost. Henter klient- og
 * aktivitetstype-indstillingerne og anvender præcedensen i
 * pickDefaultBillable, så alle oprettelsesstier (manuel, timer-stop,
 * extension/desktop-sync, public API, import, gentagelser, timeseddel)
 * opfører sig ens.
 */
export async function resolveDefaultBillable(
  db: DbLike,
  ref: {
    projectId?: string | null;
    clientId?: string | null;
    activityTypeId?: string | null;
  },
  explicit?: boolean | null,
  opts?: { fallback?: boolean },
): Promise<boolean> {
  if (typeof explicit === "boolean") return explicit;

  const clientDefaultBillable = await loadClientDefaultBillable(db, ref);
  if (clientDefaultBillable === false) return false;

  let activityTypeDefaultBillable: boolean | null = null;
  if (ref.activityTypeId) {
    const type = await db.query.activityTypes.findFirst({
      where: eq(activityTypes.id, ref.activityTypeId),
      columns: { defaultBillable: true },
    });
    activityTypeDefaultBillable = type?.defaultBillable ?? null;
  }

  return pickDefaultBillable({
    clientDefaultBillable,
    activityTypeDefaultBillable,
    fallback: opts?.fallback,
  });
}

/** Klientens defaultBillable via clientId, ellers via projektets klient. */
async function loadClientDefaultBillable(
  db: DbLike,
  ref: { projectId?: string | null; clientId?: string | null },
): Promise<boolean | null> {
  if (ref.clientId) {
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, ref.clientId),
      columns: { defaultBillable: true },
    });
    if (client) return client.defaultBillable;
  }

  if (ref.projectId) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, ref.projectId),
      columns: { id: true },
      with: { client: { columns: { defaultBillable: true } } },
    });
    if (project?.client) return project.client.defaultBillable;
  }

  return null;
}
