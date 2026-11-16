/**
 * #843: eksporten må kun hente objekter fra lageret, der er knyttet til
 * organisationen via databasen, aldrig ud fra URL'er eller stier i fritekst.
 * Bucketen er delt (andre organisationers færdige eksporter, feedback-
 * screenshots og mail-vedhæftninger ligger samme sted), så testene bruger
 * netop de objekter som "fremmede" mål og tjekker, at læseren aldrig bliver
 * bedt om dem.
 */
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.S3_ENDPOINT = "https://hel1.your-objectstorage.com";
  process.env.S3_BUCKET = "mahope";
  process.env.S3_PREFIX = "timetrack";
});

import type { CollectedTable } from "../collect";
import { exportableColumns } from "../collect";
import {
  extractFiles,
  FILE_COLUMNS,
  type FileOwner,
  type ObjectReader,
  publicUploadKey,
} from "../files";
import { ORG_EXPORT_TABLES } from "../registry";
import { orgFileOwner } from "../zip";

const BASE = "https://hel1.your-objectstorage.com/mahope/timetrack/";
const ORG_A = "org-a";
const ORG_B = "org-b";
const IMG_A = "2026/10/11111111-1111-4111-8111-111111111111.jpg";
const IMG_B = "2026/10/22222222-2222-4222-8222-222222222222.jpg";
const IMG_COLLEAGUE = "2026/10/33333333-3333-4333-8333-333333333333.jpg";
const FOREIGN_EXPORT = "data-exports/99999999-9999-4999-8999-999999999999.zip";
const FOREIGN_FEEDBACK = "feedback/88888888-8888-4888-8888-888888888888.png";

const entry = (key: string) => {
  const e = ORG_EXPORT_TABLES.find((x) => x.key === key);
  if (!e) throw new Error(key);
  return e;
};

function table(key: string, rows: Record<string, unknown>[]): CollectedTable {
  const { columns, numericColumns } = exportableColumns(entry(key));
  return { entry: entry(key), columns, numericColumns, rows };
}

/** Læser med metadata pr. fuld nøgle. Alt kald logges. */
function fakeReader(meta: Record<string, Record<string, string>> = {}) {
  const head = vi.fn(async (key: string) =>
    key in meta ? { metadata: meta[key] } : null,
  );
  const get = vi.fn(async (key: string) => new TextEncoder().encode(key));
  const reader: ObjectReader = { head, get };
  return { reader, head, get };
}

const ownerA: FileOwner = {
  orgId: ORG_A,
  userId: "uA",
  mode: "org",
  uploaderIds: new Set(["uA"]),
};

function requestedKeys(m: ReturnType<typeof fakeReader>): string[] {
  return [
    ...m.head.mock.calls.map((c) => c[0]),
    ...m.get.mock.calls.map((c) => c[0]),
  ];
}

describe("FILE_COLUMNS", () => {
  it("peger kun på kolonner, der findes i de registrerede tabeller", () => {
    for (const c of FILE_COLUMNS) {
      const cols = getTableColumns(entry(c.table).table);
      expect(Object.keys(cols), `${c.table}.${c.column}`).toContain(c.column);
    }
  });
});

describe("publicUploadKey", () => {
  it("godtager kun den form, /api/upload giver", () => {
    expect(publicUploadKey(`${BASE}logos/uA/1700000000000.webp`)).toEqual({
      key: "logos/uA/1700000000000.webp",
      uploaderId: "uA",
    });
    for (const bad of [
      `${BASE}${FOREIGN_EXPORT}`,
      `${BASE}${FOREIGN_FEEDBACK}`,
      `${BASE}logos/uA/../../${FOREIGN_EXPORT}`,
      `${BASE}logos/uA/1.webp?x=1`,
      `${BASE}email-attachments/0123abcd/0123456789ab`,
      "https://hel1.your-objectstorage.com/mahope/logos/uA/1.webp",
      "https://hel1.your-objectstorage.com/anden/timetrack/logos/uA/1.webp",
      "https://example.com/mahope/timetrack/logos/uA/1.webp",
      "logos/uA/1.webp",
    ]) {
      expect(publicUploadKey(bad), bad).toBeNull();
    }
  });
});

describe("extractFiles", () => {
  it("henter aldrig noget ud fra URL'er eller stier i fritekst", async () => {
    const tasks = table("tasks", [
      {
        id: "t1",
        organizationId: ORG_A,
        description: `Se ${BASE}${FOREIGN_EXPORT} og ![](/api/files/task-image/${IMG_B})`,
      },
    ]);
    const comments = table("taskComments", [
      {
        id: "c1",
        contentHtml: `<img src="/api/files/task-image/${IMG_A}"><a href="${BASE}${FOREIGN_FEEDBACK}">x</a>`,
      },
    ]);
    const clients = table("clients", [
      { id: "k1", notes: `email-attachments/0123abcd/0123456789ab ${BASE}x` },
    ]);
    const m = fakeReader();
    const { files, manifest } = await extractFiles(
      [tasks, comments, clients],
      ownerA,
      m.reader,
    );
    expect(requestedKeys(m)).toEqual([]);
    expect(files).toEqual([]);
    expect(manifest).toEqual([]);
  });

  it("logoer: kun egne uploads fra organisationens medlemmer", async () => {
    const m = fakeReader();
    const { files, manifest } = await extractFiles(
      [
        table("companyProfiles", [
          { id: "cp", logoUrl: `${BASE}logos/uA/1700000000000.webp` },
        ]),
        table("invoiceTemplates", [
          { id: "it", logoUrl: `${BASE}${FOREIGN_EXPORT}` },
        ]),
        table("portalBranding", [
          {
            id: "pb",
            // uB er kun medlem af org B
            logoUrl: `${BASE}logos/uB/1700000000001.webp`,
            faviconUrl: `${BASE}email-attachments/0123abcd/0123456789ab`,
          },
        ]),
        table("organizations", [
          { id: ORG_A, logo: "https://example.com/logo.png" },
        ]),
      ],
      ownerA,
      m.reader,
    );
    expect(requestedKeys(m)).toEqual(["timetrack/logos/uA/1700000000000.webp"]);
    expect(files.map((f) => f.path)).toEqual([
      "filer/firmaoplysninger/cp-logoUrl.webp",
    ]);
    const rejected = manifest.filter((r) => r.status !== "Med");
    expect(rejected.map((r) => r.kilde).sort()).toEqual(
      [
        "fakturaskabeloner/it/logoUrl",
        "kundeportal-udseende/pb/faviconUrl",
        "kundeportal-udseende/pb/logoUrl",
        "organisation/org-a/logo",
      ]
        .map((k) =>
          k
            .replace("fakturaskabeloner", entry("invoiceTemplates").file)
            .replace("kundeportal-udseende", entry("portalBranding").file)
            .replace("organisation", entry("organizations").file),
        )
        .sort(),
    );
    // Oversigten afslører ikke adressen til det fremmede objekt.
    expect(JSON.stringify(manifest)).not.toContain(FOREIGN_EXPORT);
  });

  it("opgavebilleder: kun objekter, hvis metadata siger org A", async () => {
    const m = fakeReader({
      [`timetrack/uploads/images/${IMG_A}`]: {
        "org-id": ORG_A,
        "uploaded-by": "uA",
      },
      [`timetrack/uploads/images/${IMG_B}`]: {
        "org-id": ORG_B,
        "uploaded-by": "uB",
      },
    });
    const { files, manifest } = await extractFiles(
      [
        table("taskAttachments", [
          {
            id: "a1",
            filename: "skitse.jpg",
            storageUrl: `/api/files/task-image/${IMG_A}`,
          },
          // Et medlem af org A har limet org B's billede ind som vedhæftning.
          {
            id: "a2",
            filename: "fremmed.jpg",
            storageUrl: `/api/files/task-image/${IMG_B}`,
          },
          {
            id: "a3",
            filename: "x.zip",
            storageUrl: `${BASE}${FOREIGN_EXPORT}`,
          },
        ]),
      ],
      ownerA,
      m.reader,
    );
    expect(m.get.mock.calls.map((c) => c[0])).toEqual([
      `timetrack/uploads/images/${IMG_A}`,
    ]);
    expect(requestedKeys(m).join(" ")).not.toContain(FOREIGN_EXPORT);
    expect(files.map((f) => f.path)).toEqual([
      "filer/opgave-vedhaeftninger/a1-skitse.jpg",
    ]);
    expect(manifest.find((r) => r.kilde.includes("/a2/"))?.status).toMatch(
      /^Ikke med/,
    );
  });

  it("mail-vedhæftninger: kun gyldige nøgler under email-attachments/", async () => {
    const m = fakeReader();
    const { files } = await extractFiles(
      [
        table("emailThreads", [
          {
            id: "th1",
            attachments: [
              {
                filename: "tilbud.pdf",
                storagePath: "email-attachments/0123abcd/0123456789ab",
              },
              { filename: "a", storagePath: "../../etc/passwd" },
              { filename: "b", storagePath: `${BASE}${FOREIGN_EXPORT}` },
              {
                filename: "c",
                storagePath: "email-attachments/../data-exports/x",
              },
            ],
          },
        ]),
      ],
      ownerA,
      m.reader,
    );
    expect(requestedKeys(m)).toEqual([
      "timetrack/email-attachments/0123abcd/0123456789ab",
    ]);
    expect(files.map((f) => f.path)).toEqual([
      "filer/opgave-mails/th1-tilbud.pdf",
    ]);
  });

  it("org B's filer kommer aldrig med i org A's eksport", async () => {
    // Medlemsrækkerne er scopet til org A af databasen. uB er kun i org B.
    const tables = [
      table("members", [{ id: "m1", organizationId: ORG_A, userId: "uA" }]),
      table("companyProfiles", [
        { id: "cpA", logoUrl: `${BASE}logos/uA/1700000000000.webp` },
        { id: "cpX", logoUrl: `${BASE}logos/uB/1700000000002.webp` },
      ]),
      table("taskAttachments", [
        {
          id: "a1",
          filename: "a.jpg",
          storageUrl: `/api/files/task-image/${IMG_A}`,
        },
        {
          id: "a2",
          filename: "b.jpg",
          storageUrl: `/api/files/task-image/${IMG_B}`,
        },
      ]),
    ];
    const owner = orgFileOwner(tables, { orgId: ORG_A, userId: "uA" });
    expect([...owner.uploaderIds]).toEqual(["uA"]);
    const m = fakeReader({
      [`timetrack/uploads/images/${IMG_A}`]: { "org-id": ORG_A },
      [`timetrack/uploads/images/${IMG_B}`]: { "org-id": ORG_B },
    });
    const { files } = await extractFiles(tables, owner, m.reader);
    const fetched = m.get.mock.calls.map((c) => c[0]);
    expect(fetched).toEqual([
      "timetrack/logos/uA/1700000000000.webp",
      `timetrack/uploads/images/${IMG_A}`,
    ]);
    expect(fetched.join(" ")).not.toContain("uB");
    expect(fetched.join(" ")).not.toContain(IMG_B);
    expect(files).toHaveLength(2);
  });

  it("bruger-eksporten tager kun brugerens egne billeder og logoer", async () => {
    const owner: FileOwner = {
      orgId: ORG_A,
      userId: "uA",
      mode: "user",
      uploaderIds: new Set(["uA"]),
    };
    const m = fakeReader({
      [`timetrack/uploads/images/${IMG_A}`]: {
        "org-id": ORG_A,
        "uploaded-by": "uA",
      },
      // Kollegaens billede i samme org
      [`timetrack/uploads/images/${IMG_COLLEAGUE}`]: {
        "org-id": ORG_A,
        "uploaded-by": "uC",
      },
      // Brugerens eget billede fra en anden org
      [`timetrack/uploads/images/${IMG_B}`]: {
        "org-id": ORG_B,
        "uploaded-by": "uA",
      },
    });
    const { files } = await extractFiles(
      [
        table("taskAttachments", [
          {
            id: "a1",
            filename: "a.jpg",
            storageUrl: `/api/files/task-image/${IMG_A}`,
          },
          {
            id: "a2",
            filename: "c.jpg",
            storageUrl: `/api/files/task-image/${IMG_COLLEAGUE}`,
          },
          {
            id: "a3",
            filename: "b.jpg",
            storageUrl: `/api/files/task-image/${IMG_B}`,
          },
        ]),
        table("companyProfiles", [
          { id: "cp", logoUrl: `${BASE}logos/uC/1700000000000.webp` },
        ]),
      ],
      owner,
      m.reader,
    );
    expect(m.get.mock.calls.map((c) => c[0])).toEqual([
      `timetrack/uploads/images/${IMG_A}`,
    ]);
    expect(files.map((f) => f.path)).toEqual([
      "filer/opgave-vedhaeftninger/a1-a.jpg",
    ]);
  });

  it("uden organisation: kun brugerens egne opgavebilleder", async () => {
    const owner = orgFileOwner([], { orgId: null, userId: "uA" });
    const m = fakeReader({
      [`timetrack/uploads/images/${IMG_A}`]: { "uploaded-by": "uA" },
      [`timetrack/uploads/images/${IMG_B}`]: {
        "org-id": ORG_B,
        "uploaded-by": "uB",
      },
    });
    const { files } = await extractFiles(
      [
        table("taskAttachments", [
          {
            id: "a1",
            filename: "a.jpg",
            storageUrl: `/api/files/task-image/${IMG_A}`,
          },
          {
            id: "a2",
            filename: "b.jpg",
            storageUrl: `/api/files/task-image/${IMG_B}`,
          },
        ]),
      ],
      owner,
      m.reader,
    );
    expect(files.map((f) => f.path)).toEqual([
      "filer/opgave-vedhaeftninger/a1-a.jpg",
    ]);
  });

  it("lægger vedhæftninger fra databasen i filer/", async () => {
    const attachments = table("taskAttachments", [
      {
        id: "att-1",
        filename: "../tilbud.pdf",
        content: new Uint8Array([1, 2, 3]),
        storageUrl: null,
      },
    ]);
    const m = fakeReader();
    const { files } = await extractFiles([attachments], ownerA, m.reader);
    expect(files.map((f) => f.path)).toEqual([
      "filer/opgave-vedhaeftninger/att-1-tilbud.pdf",
    ]);
    expect(attachments.rows[0].content).toEqual({
      filIEksporten: "filer/opgave-vedhaeftninger/att-1-tilbud.pdf",
    });
    expect(requestedKeys(m)).toEqual([]);
  });

  it("noterer filer, der ikke kunne hentes, i stedet for at fejle", async () => {
    const reader: ObjectReader = {
      head: async () => null,
      get: async () => {
        throw new Error("HTTP 403");
      },
    };
    const { files, manifest } = await extractFiles(
      [
        table("companyProfiles", [
          { id: "cp", logoUrl: `${BASE}logos/uA/1700000000000.webp` },
        ]),
      ],
      ownerA,
      reader,
    );
    expect(files).toEqual([]);
    expect(manifest[0].status).toBe("Ikke hentet: HTTP 403");
  });
});

describe("extractFiles med sink", () => {
  const logos = () =>
    table("companyProfiles", [
      { id: "cp1", logoUrl: `${BASE}logos/uA/1700000000000.webp` },
      { id: "cp2", logoUrl: `${BASE}logos/uA/1700000000001.webp` },
    ]);

  it("afleverer hver fil til sinken, så snart den er hentet, og holder dem ikke tilbage", async () => {
    const events: string[] = [];
    const reader: ObjectReader = {
      head: async () => null,
      get: async (key) => {
        events.push(`get:${key.slice(-18)}`);
        return new TextEncoder().encode(key);
      },
    };
    const { files, manifest, fileCount } = await extractFiles(
      [logos()],
      ownerA,
      reader,
      async (f) => {
        events.push(`sink:${f.path.slice(-12)}`);
      },
    );
    expect(files).toEqual([]);
    expect(fileCount).toBe(2);
    expect(manifest.filter((m) => m.status === "Med")).toHaveLength(2);
    // Hentning og aflevering skiftes: den første fil er afleveret, før den næste hentes.
    expect(events.map((e) => e.split(":")[0])).toEqual([
      "get",
      "sink",
      "get",
      "sink",
    ]);
  });

  it('afbryder hele udtrækket, hvis sinken fejler, i stedet for at skrive "Ikke hentet"', async () => {
    const m = fakeReader();
    await expect(
      extractFiles([logos()], ownerA, m.reader, async () => {
        throw new Error("upload røg");
      }),
    ).rejects.toThrow("upload røg");
    expect(m.get).toHaveBeenCalledTimes(1);
  });
});
