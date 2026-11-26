import { assertEntryEditable } from "./edit-guard";

/**
 * Fælles redigeringsguard (#467) for bulk-operationer: ét kald pr. ejer, så
 * ugestatus og rullende lås vurderes for den rigtige bruger.
 */
export async function assertEntriesEditable(
  db: Parameters<typeof assertEntryEditable>[0],
  input: {
    orgId: string | null | undefined;
    actorUserId: string;
    entries: ReadonlyArray<{
      userId: string;
      date: Date;
      approvalStatus: string | null;
    }>;
    periodOnly?: boolean;
  },
): Promise<void> {
  if (!input.orgId) return;
  const byOwner = new Map<string, (typeof input.entries)[number][]>();
  for (const e of input.entries) {
    const list = byOwner.get(e.userId) ?? [];
    list.push(e);
    byOwner.set(e.userId, list);
  }
  for (const [ownerId, rows] of byOwner) {
    await assertEntryEditable(db, {
      orgId: input.orgId,
      userId: ownerId,
      actorUserId: input.actorUserId,
      dates: rows.map((r) => r.date),
      entries: rows,
      periodOnly: input.periodOnly,
    });
  }
}
