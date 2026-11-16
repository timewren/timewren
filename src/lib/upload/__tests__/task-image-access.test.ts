import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "bucket",
  prefixKey: (k: string) => k,
  s3: { send: vi.fn() },
}));

const { canReadTaskImage } = await import("../task-image-access");

const UUID = "0b9c1f3e-6d2a-4c5b-8e7f-1a2b3c4d5e6f";
const KEY = `uploads/images/2026/10/${UUID}.jpg`;
const URL_IN_DB = `/api/files/task-image/2026/10/${UUID}.jpg`;

/**
 * Søgeværdierne i et drizzle-condition-træ: eq/inArray pakker dem i Param,
 * mens like() lader en rå streng ligge i queryChunks.
 */
function conditionParams(node: unknown, out: unknown[] = []): unknown[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) conditionParams(child, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const chunk = node as {
    constructor?: { name?: string };
    queryChunks?: unknown[];
  };
  if (chunk.constructor?.name === "Param") {
    out.push((node as { value: unknown }).value);
    return out;
  }
  for (const child of chunk.queryChunks ?? []) conditionParams(child, out);
  return out;
}

const state = {
  attachments: [] as { taskId: string; storageUrl: string }[],
  comments: [] as { taskId: string; contentHtml: string }[],
  tasks: [] as { id: string; organizationId: string | null }[],
};

/**
 * En lille db, der anvender de søgeværdier ruten sender: attachments matches
 * på præcis URL, kommentarer på LIKE '%…%', og tasks på id. Organisationen
 * filtreres med vilje IKKE i db'en — den afgøres i koden, så testen fejler
 * hvis org-tjekket fjernes.
 */
const fakeDb = {
  query: {
    taskAttachments: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        const params = conditionParams(where);
        return state.attachments.filter((a) => params.includes(a.storageUrl));
      }),
    },
    taskComments: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        const [pattern] = conditionParams(where) as string[];
        const needle = pattern.replace(/^%|%$/g, "");
        return state.comments.filter((c) => c.contentHtml.includes(needle));
      }),
    },
    tasks: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        const params = conditionParams(where);
        return state.tasks.filter((t) => params.includes(t.id));
      }),
    },
  },
};

const base = {
  db: fakeDb as never,
  userId: "user-b",
  requesterOrgId: "org-a" as string | null,
  key: KEY,
  metadata: { "uploaded-by": "user-a", "org-id": "org-a" } as Record<
    string,
    string
  >,
};

describe("canReadTaskImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.attachments = [];
    state.comments = [];
    state.tasks = [{ id: "task-1", organizationId: "org-a" }];
  });

  it("uploaderen må altid læse sit eget billede, også før der findes en reference", async () => {
    const allowed = await canReadTaskImage({
      ...base,
      userId: "user-a",
      requesterOrgId: null,
    });
    expect(allowed).toBe(true);
    expect(fakeDb.query.taskAttachments.findMany).not.toHaveBeenCalled();
  });

  it("et medlem af orgen må læse et billede, der er refereret af en opgave-vedhæftning", async () => {
    state.attachments = [{ taskId: "task-1", storageUrl: URL_IN_DB }];
    expect(await canReadTaskImage(base)).toBe(true);
  });

  it("et medlem af orgen må læse et billede, der er refereret i en kommentar", async () => {
    state.comments = [
      {
        taskId: "task-1",
        contentHtml: `<p>x</p><img src="${URL_IN_DB}">`,
      },
    ];
    expect(await canReadTaskImage(base)).toBe(true);
  });

  it("slår op på den præcise app-URL", async () => {
    state.attachments = [{ taskId: "task-1", storageUrl: URL_IN_DB }];
    await canReadTaskImage(base);

    const attWhere = (
      fakeDb.query.taskAttachments.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].where;
    const commentWhere = (
      fakeDb.query.taskComments.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].where;
    expect(conditionParams(attWhere)).toContain(URL_IN_DB);
    expect(conditionParams(commentWhere)).toContain(`%${URL_IN_DB}%`);
  });

  it("en bruger i en anden org får nej, selv om billedet er refereret", async () => {
    state.attachments = [{ taskId: "task-1", storageUrl: URL_IN_DB }];
    expect(await canReadTaskImage({ ...base, requesterOrgId: "org-b" })).toBe(
      false,
    );
  });

  it("en bruger uden org får nej (kun uploaderen har adgang)", async () => {
    state.attachments = [{ taskId: "task-1", storageUrl: URL_IN_DB }];
    expect(await canReadTaskImage({ ...base, requesterOrgId: null })).toBe(
      false,
    );
  });

  it("en reference i en anden org giver ikke adgang (forfalsket reference)", async () => {
    // Billedet blev uploadet i org-a, men den eneste opgave der peger på det
    // ligger i org-b, fx fordi en bruger dér har lagt nøglen ind i en kommentar.
    state.attachments = [{ taskId: "task-9", storageUrl: URL_IN_DB }];
    state.tasks = [{ id: "task-9", organizationId: "org-b" }];
    expect(await canReadTaskImage(base)).toBe(false);
  });

  it("uden nogen reference får et andet medlem nej", async () => {
    expect(await canReadTaskImage(base)).toBe(false);
  });

  it("billeder uden org-metadata kan kun læses af uploaderen", async () => {
    state.attachments = [{ taskId: "task-1", storageUrl: URL_IN_DB }];
    expect(
      await canReadTaskImage({
        ...base,
        metadata: { "uploaded-by": "user-a" },
      }),
    ).toBe(false);
    expect(await canReadTaskImage({ ...base, metadata: {} })).toBe(false);
  });
});
