/**
 * #843 mod en rigtig Postgres: to organisationer (A og B) i samme database.
 * Org-eksporten for A bygges gennem hele kæden (collectOrgExport ->
 * extractFiles -> writeExportZip) med en falsk objektlæser, og testen tjekker, at
 * læseren aldrig bliver bedt om et objekt, der hører til B, og at fritekst
 * med adresser til private objekter aldrig giver en læsning.
 *
 * Kører KUN med TT_DB_TESTS=1 og DATABASE_URL til en kasseret database med
 * repoets schema (se docs/testing/timer-model-tests.md).
 */

import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { collectZip } from "./collect-zip";

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  captureEvent: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

const ENABLED = process.env.TT_DB_TESTS === "1";
process.env.ENCRYPTION_KEY ??= "d".repeat(64);
// Før @/lib/s3 importeres (dynamisk i beforeAll).
process.env.S3_ENDPOINT = "https://hel1.your-objectstorage.com";
process.env.S3_BUCKET = "timetrack";
delete process.env.S3_PREFIX;

const BASE = "https://hel1.your-objectstorage.com/timetrack/";
const IMG_A = "2026/10/aaaaaaaa-1111-4111-8111-111111111111.jpg";
const IMG_B = "2026/10/bbbbbbbb-2222-4222-8222-222222222222.jpg";
const MAIL_B = "email-attachments/0b0b0b0b/0b0b0b0b0b0b";
const FOREIGN_EXPORT = "data-exports/cccccccc-3333-4333-8333-333333333333.zip";

let d: {
  db: typeof import("@/lib/db").db;
  s: typeof import("@/lib/db/schema");
  zip: typeof import("../zip");
};
let w: { A: string; B: string; uA: string; uB: string };

async function seed() {
  const sfx = randomUUID().slice(0, 8);
  const A = `org-a-${sfx}`;
  const B = `org-b-${sfx}`;
  const uA = `uA${sfx}`;
  const uB = `uB${sfx}`;
  const { db, s } = d;

  await db.insert(s.users).values([
    { id: uA, email: `a-${sfx}@test.local`, name: "A" },
    { id: uB, email: `b-${sfx}@test.local`, name: "B" },
  ] as never);
  await db.insert(s.organizations).values([
    // A's logo peger på et logo, som kun B's medlem har uploadet.
    {
      id: A,
      name: "Org A",
      slug: `a-${sfx}`,
      logo: `${BASE}logos/${uB}/1700000000000.webp`,
    },
    {
      id: B,
      name: "Org B",
      slug: `b-${sfx}`,
      logo: `${BASE}logos/${uB}/1700000000001.webp`,
    },
  ] as never);
  await db.insert(s.members).values([
    { id: `m-a-${sfx}`, organizationId: A, userId: uA, role: "owner" },
    { id: `m-b-${sfx}`, organizationId: B, userId: uB, role: "owner" },
  ] as never);

  const tasks = await db
    .insert(s.tasks)
    .values([
      {
        title: "a-opgave",
        userId: uA,
        organizationId: A,
        description: `Se ${BASE}${FOREIGN_EXPORT} og ${BASE}${MAIL_B}`,
      },
      { title: "b-opgave", userId: uB, organizationId: B },
    ] as never)
    .returning({ id: s.tasks.id, title: s.tasks.title });
  const tA = tasks.find((t) => t.title === "a-opgave")!.id;
  const tB = tasks.find((t) => t.title === "b-opgave")!.id;

  const att = (taskId: string, userId: string, img: string) => ({
    taskId,
    userId,
    filename: "billede.jpg",
    contentType: "image/jpeg",
    sizeBytes: 3,
    storageUrl: `/api/files/task-image/${img}`,
  });
  await db.insert(s.taskAttachments).values([
    att(tA, uA, IMG_A),
    // Et medlem af A har lagt B's billede på A's opgave.
    att(tA, uA, IMG_B),
    att(tB, uB, IMG_B),
  ] as never);

  await db.insert(s.emailThreads).values({
    userId: uB,
    taskId: tB,
    messageId: `msg-${sfx}`,
    subject: "b",
    fromEmail: "b@test.local",
    toEmails: ["b@test.local"],
    receivedDate: new Date(),
    attachments: [
      {
        filename: "b.pdf",
        contentType: "application/pdf",
        size: 1,
        storagePath: MAIL_B,
      },
    ],
  } as never);

  return { A, B, uA, uB };
}

describe.skipIf(!ENABLED)(
  "org-eksportens filer mod rigtig Postgres (#843)",
  () => {
    beforeAll(async () => {
      d = {
        db: (await import("@/lib/db")).db,
        s: await import("@/lib/db/schema"),
        zip: await import("../zip"),
      };
      w = await seed();
    }, 60_000);

    it("org B's filer og fritekst-adresser kommer aldrig med i org A's eksport", async () => {
      const requested: string[] = [];
      const reader = {
        head: async (key: string) => {
          requested.push(`head:${key}`);
          if (key.endsWith(IMG_A)) return { metadata: { "org-id": w.A } };
          if (key.endsWith(IMG_B)) return { metadata: { "org-id": w.B } };
          return null;
        },
        get: async (key: string) => {
          requested.push(`get:${key}`);
          return new TextEncoder().encode(key);
        },
      };
      const { zip } = await collectZip((out) =>
        d.zip.generateOrgExportZip(
          d.db,
          { orgId: w.A, userId: w.uA },
          out,
          reader,
        ),
      );

      const gets = requested.filter((r) => r.startsWith("get:"));
      expect(gets).toEqual([`get:uploads/images/${IMG_A}`]);
      const all = requested.join(" ");
      expect(all).not.toContain(w.uB);
      expect(all).not.toContain(FOREIGN_EXPORT);
      expect(all).not.toContain(MAIL_B);
      expect(
        requested.filter((r) => r.startsWith("get:")).join(" "),
      ).not.toContain(IMG_B);

      const files = unzipSync(zip);
      const stored = Object.keys(files).filter(
        (n) => n.startsWith("filer/") && n !== "filer/oversigt.csv",
      );
      expect(stored).toHaveLength(1);
      expect(new TextDecoder().decode(files[stored[0]])).toBe(
        `uploads/images/${IMG_A}`,
      );
    });
  },
);
