/**
 * Hurtigstart på Hjem: de kunde/projekt-kombinationer brugeren faktisk bruger.
 * Ren funktion (ingen DB), så rangeringen kan testes i vitest.
 *
 * Regel: flest poster i perioden først, ved lighed den senest brugte. Intern tid
 * (hverken projekt eller kunde), arkiverede/afsluttede projekter og arkiverede
 * kunder springes over — man skal ikke kunne starte en timer på dem herfra.
 */

export interface QuickStartRow {
  projectId: string | null;
  projectName: string | null;
  projectStatus: string | null;
  /** Projektets kunde (bruges når posten ikke selv har en kunde) */
  projectClientId: string | null;
  entryClientId: string | null;
  clientName: string | null;
  clientArchived: boolean | null;
  createdAt: Date;
}

export interface QuickStartItem {
  key: string;
  projectId: string | null;
  clientId: string | null;
  projectName: string | null;
  clientName: string | null;
  count: number;
  lastUsed: Date;
}

const INACTIVE_PROJECT = new Set(["archived", "completed"]);

export function rankQuickStart(
  rows: readonly QuickStartRow[],
  limit = 6,
): QuickStartItem[] {
  const byKey = new Map<string, QuickStartItem>();
  for (const r of rows) {
    const clientId = r.entryClientId ?? r.projectClientId ?? null;
    if (!r.projectId && !clientId) continue;
    if (r.projectStatus && INACTIVE_PROJECT.has(r.projectStatus)) continue;
    if (r.clientArchived) continue;
    const key = `${r.projectId ?? ""}|${clientId ?? ""}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      if (r.createdAt > existing.lastUsed) existing.lastUsed = r.createdAt;
    } else {
      byKey.set(key, {
        key,
        projectId: r.projectId,
        clientId,
        projectName: r.projectName,
        clientName: r.clientName,
        count: 1,
        lastUsed: r.createdAt,
      });
    }
  }
  return [...byKey.values()]
    .sort(
      (a, b) =>
        b.count - a.count || b.lastUsed.getTime() - a.lastUsed.getTime(),
    )
    .slice(0, Math.max(0, limit));
}
