type NamedRef = { id: string; name: string };

type TaskRow = {
  id: string;
  title: string;
  status: string;
  completedAt: Date | string | null;
  projectId: string | null;
  clientId: string | null;
  project: (NamedRef & { client?: NamedRef | null }) | null;
  client: NamedRef | null;
};

/**
 * Opgavevalget i tidsregistreringen (`tasks.listForTime`) må kun se det,
 * valget viser: titel, status og kunde/projekt. Beskrivelser, estimater og
 * undertasks bliver i opgavemodulet, som rollen måske ikke har adgang til
 * (#1116).
 */
export function toTimeTaskPayload<T extends TaskRow>(
  grouped: Record<string, T[]>,
) {
  const ref = (r: NamedRef | null | undefined) =>
    r ? { id: r.id, name: r.name } : null;
  const result: Record<
    string,
    Array<
      Pick<
        TaskRow,
        "id" | "title" | "status" | "completedAt" | "projectId" | "clientId"
      > & {
        project: (NamedRef & { client: NamedRef | null }) | null;
        client: NamedRef | null;
      }
    >
  > = {};
  for (const [lane, rows] of Object.entries(grouped)) {
    result[lane] = rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      completedAt: t.completedAt,
      projectId: t.projectId,
      clientId: t.clientId,
      project: t.project
        ? {
            id: t.project.id,
            name: t.project.name,
            client: ref(t.project.client),
          }
        : null,
      client: ref(t.client),
    }));
  }
  return result;
}
