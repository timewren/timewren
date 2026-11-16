import { eq, inArray, like } from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import { taskAttachments, taskComments, tasks } from "@/lib/db/schema";
import { ORG_ID_META, taskImageUrl, UPLOADED_BY_META } from "@/lib/upload/s3";

type Db = typeof dbType;

/** Rækker der højst indlæses som kandidater til en enkelt URL. */
const MAX_REFERENCES = 20;

/**
 * Må brugeren læse dette opgave-/kommentarbillede?
 *
 * 1. Uploaderen må altid læse sit eget billede. Det er også det, der får
 *    forhåndsvisningen i kommentar-editoren til at virke, før kommentaren er
 *    gemt og der endnu ikke findes en reference.
 * 2. Ellers kræves BÅDE at billedet blev uploadet i brugerens aktive org
 *    (S3-metadata `org-id`, sat ved upload) OG at en opgave eller kommentar i
 *    den org refererer billedet. Referencerne skrives af brugere, så
 *    "en række i min org peger på nøglen" er ikke nok alene — ellers kunne
 *    man give sig selv adgang ved at oprette en reference til en nøgle, man
 *    har set.
 *
 * `requesterOrgId` kommer fra `resolveActiveOrgId` (medlemskab er verificeret)
 * og har samme betydning som `ctx.orgId` i tRPC-routerne. Brugere uden org
 * har kun adgang som uploader, ligesom opgaverne er scopet til userId.
 */
export async function canReadTaskImage({
  db,
  userId,
  requesterOrgId,
  key,
  metadata,
}: {
  db: Db;
  userId: string;
  requesterOrgId: string | null;
  /** Logisk nøgle (uploads/images/...), allerede valideret. */
  key: string;
  metadata: Record<string, string>;
}): Promise<boolean> {
  if (metadata[UPLOADED_BY_META] === userId) return true;

  const objectOrgId = metadata[ORG_ID_META];
  if (!objectOrgId || !requesterOrgId || objectOrgId !== requesterOrgId) {
    return false;
  }

  const url = taskImageUrl(key);
  const [attachmentRefs, commentRefs] = await Promise.all([
    db.query.taskAttachments.findMany({
      where: eq(taskAttachments.storageUrl, url),
      columns: { taskId: true },
      limit: MAX_REFERENCES,
    }),
    // Nøglen er valideret (cifre, hex, "-", "/", "."), så den indeholder
    // ingen LIKE-jokertegn der skal escapes.
    db.query.taskComments.findMany({
      where: like(taskComments.contentHtml, `%${url}%`),
      columns: { taskId: true },
      limit: MAX_REFERENCES,
    }),
  ]);

  const taskIds = [
    ...new Set([...attachmentRefs, ...commentRefs].map((ref) => ref.taskId)),
  ];
  if (taskIds.length === 0) return false;

  const referencingTasks = await db.query.tasks.findMany({
    where: inArray(tasks.id, taskIds),
    columns: { id: true, organizationId: true },
  });

  return referencingTasks.some((task) => task.organizationId === objectOrgId);
}
