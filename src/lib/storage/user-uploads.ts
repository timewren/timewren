import { and, eq, inArray, isNotNull, isNull, like, or } from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import {
  emailThreads,
  feedbackSubmissions,
  taskAttachments,
  taskComments,
  tasks,
} from "@/lib/db/schema";
import { locateEmailAttachment } from "@/lib/email/attachment-location";
import { prefixKey } from "@/lib/s3";
import { isStorageConfigured } from "@/lib/storage/config";
import { deleteAllVersions } from "@/lib/storage/objects";
import { taskImageKeyFromUrl } from "@/lib/upload/s3";

/**
 * Mapperne /api/upload skriver til. Nøglen er altid
 * `<mappe>/<userId>/<tidsstempel>.webp` (+ S3_PREFIX), så alt en bruger har
 * uploadet kan findes uden at slå felter op i databasen — også ældre
 * avatarer, som er erstattet af nyere.
 */
export const USER_UPLOAD_FOLDERS = [
  "profile",
  "logos",
  "favicons",
  "uploads",
] as const;

const USER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Sletter alle versioner af en brugers uploadede avatarer, logoer og
 * favicons. Præfikset slutter på "/", så user1 aldrig rammer user10.
 * `folders` afgrænser oprydningen — en anonymiseret teambruger (#918) får
 * kun sine profilbilleder slettet, fordi teamet kan bruge logoer o.l.
 *
 * Fortsætter med de øvrige mapper hvis én fejler, og kaster til sidst, så
 * kalderen kan logge at oprydningen er ufuldstændig. Gør ingenting hvis S3
 * ikke er konfigureret.
 */
export async function purgeUserUploads(
  userId: string,
  folders: readonly (typeof USER_UPLOAD_FOLDERS)[number][] = USER_UPLOAD_FOLDERS,
): Promise<number> {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error("Ugyldigt bruger-id");
  }
  if (!isStorageConfigured()) return 0;

  let deleted = 0;
  const failed: string[] = [];

  for (const folder of folders) {
    try {
      deleted += await deleteAllVersions({
        prefix: `${prefixKey(folder)}/${userId}/`,
      });
    } catch (err) {
      failed.push(folder);
      console.error(`[Storage] Kunne ikke rydde ${folder}/ for bruger:`, err);
    }
  }

  if (failed.length > 0) {
    throw new Error(`S3-oprydning mislykkedes for: ${failed.join(", ")}`);
  }
  return deleted;
}

type Db = typeof dbType;

const TASK_IMAGE_URL_IN_HTML_RE = /\/api\/files\/task-image\/[^"'\s<>)]+/g;

/** Skærmbilleder fra feedback: <S3_PREFIX>/feedback/<uuid>.png (se feedback/submit.ts). */
const FEEDBACK_FILE_RE = /^[0-9a-f-]{36}\.png$/;

/**
 * Samler FULDE objektnøgler til alt, kontosletningen ellers ville efterlade i
 * S3 og som kun databasen ved hvor ligger:
 * - opgave-billeder (taskAttachments.storageUrl),
 * - billeder i kommentarer,
 * - gemte e-mailvedhæftninger (emailThreads.attachments[].storagePath),
 * - feedback-screenshots (feedbackSubmissions.screenshotKey).
 *
 * SKAL kaldes FØR databasesletningen, fordi rækkerne forsvinder med den.
 * `orgIds` er de solo-orgs der slettes, så opgaverne i dem hører alle til
 * brugeren. Opgaver i teams, brugeren forlader, bevares (#918) — også
 * brugerens egne vedhæftninger og kommentarer på dem — så deres filer
 * indsamles ikke; brugerens egne opgaver uden org slettes og indsamles. Nøgler valideres strengt; en URL
 * eller sti i databasen kan aldrig udpege andre objekter end de kendte former.
 * Billeder der blev uploadet men aldrig gemt i en opgave eller kommentar står
 * ikke i databasen og findes derfor ikke her.
 */
export async function collectUserStorageKeys(
  db: Db,
  userId: string,
  orgIds: string[],
): Promise<string[]> {
  const keys = new Set<string>();

  const userTasks = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      orgIds.length > 0
        ? or(
            and(eq(tasks.userId, userId), isNull(tasks.organizationId)),
            inArray(tasks.organizationId, orgIds),
          )
        : and(eq(tasks.userId, userId), isNull(tasks.organizationId)),
    );

  const [attachments, comments, threads, feedback] = await Promise.all([
    db.query.taskAttachments.findMany({
      where: and(
        isNotNull(taskAttachments.storageUrl),
        inArray(taskAttachments.taskId, userTasks),
      ),
      columns: { storageUrl: true },
    }),
    db.query.taskComments.findMany({
      where: and(
        like(taskComments.contentHtml, "%/api/files/task-image/%"),
        or(
          inArray(taskComments.taskId, userTasks),
          // Egne kommentarer uden org slettes med kontoen (keep-politikken)
          and(
            eq(taskComments.userId, userId),
            isNull(taskComments.organizationId),
          ),
        ),
      ),
      columns: { contentHtml: true },
    }),
    db.query.emailThreads.findMany({
      where: eq(emailThreads.userId, userId),
      columns: { attachments: true },
    }),
    db.query.feedbackSubmissions.findMany({
      where: eq(feedbackSubmissions.userId, userId),
      columns: { screenshotKey: true, organizationId: true },
    }),
  ]);

  const addTaskImage = (url: unknown) => {
    const key = taskImageKeyFromUrl(url);
    if (key) keys.add(prefixKey(key));
  };

  for (const row of attachments) addTaskImage(row.storageUrl);
  for (const row of comments) {
    for (const url of row.contentHtml.match(TASK_IMAGE_URL_IN_HTML_RE) ?? []) {
      addTaskImage(url);
    }
  }
  for (const thread of threads) {
    for (const attachment of thread.attachments ?? []) {
      if (!attachment.storagePath) continue;
      const location = locateEmailAttachment(attachment.storagePath);
      if (location.kind === "s3") keys.add(location.key);
    }
  }
  const feedbackDir = prefixKey("feedback/");
  // Sletnings-SQL'en fjerner kun feedback uden org eller i de slettede orgs;
  // øvrige rækker bevares (user_id sættes til NULL), og så skal deres
  // screenshot også blive liggende.
  const deletedOrgs = new Set(orgIds);
  for (const row of feedback) {
    if (row.organizationId && !deletedOrgs.has(row.organizationId)) continue;
    const key = row.screenshotKey;
    if (
      key?.startsWith(feedbackDir) &&
      FEEDBACK_FILE_RE.test(key.slice(feedbackDir.length))
    ) {
      keys.add(key);
    }
  }

  return [...keys];
}

/** Antal samtidige sletninger; hver slettet nøgle koster en liste og mindst et delete. */
const PURGE_CONCURRENCY = 8;

/**
 * Sletter alle versioner af hver (fuld) nøgle. Fortsætter ved fejl og kaster
 * til sidst med antal fejlede; nøglerne logges ikke (ældre e-mailnøgler kan
 * indeholde filnavne). Gør ingenting uden S3-konfiguration.
 */
export async function purgeStorageKeys(keys: string[]): Promise<number> {
  if (keys.length === 0 || !isStorageConfigured()) return 0;

  let deleted = 0;
  let failed = 0;
  let next = 0;

  async function worker() {
    while (next < keys.length) {
      const key = keys[next++];
      try {
        // Ikke `deleted += await …`: samtidige workers ville overskrive hinanden
        const count = await deleteAllVersions({ key });
        deleted += count;
      } catch (err) {
        failed++;
        console.error("[Storage] Kunne ikke slette objekt:", err);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PURGE_CONCURRENCY, keys.length) }, worker),
  );

  if (failed > 0) {
    throw new Error(
      `${failed} af ${keys.length} S3-objekter blev ikke slettet`,
    );
  }
  return deleted;
}
