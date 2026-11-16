import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteAllVersions = vi.hoisted(() => vi.fn());

vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "bucket",
  prefixKey: (k: string) => `timetrack/${k}`,
  s3: { send: vi.fn() },
}));
vi.mock("@/lib/storage/objects", () => ({ deleteAllVersions }));

const { purgeUserUploads } = await import("../user-uploads");

describe("purgeUserUploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("S3_ENDPOINT", "https://s3.example.test");
    deleteAllVersions.mockResolvedValue(2);
  });

  it("sletter alle versioner under brugerens præfiks i hver upload-mappe", async () => {
    const total = await purgeUserUploads("user_1");

    expect(total).toBe(8);
    expect(deleteAllVersions.mock.calls.map(([target]) => target)).toEqual([
      { prefix: "timetrack/profile/user_1/" },
      { prefix: "timetrack/logos/user_1/" },
      { prefix: "timetrack/favicons/user_1/" },
      { prefix: "timetrack/uploads/user_1/" },
    ]);
  });

  it("præfikset slutter på / så user_1 ikke rammer user_10", async () => {
    await purgeUserUploads("user_1");
    for (const [target] of deleteAllVersions.mock.calls) {
      expect(target.prefix.endsWith("/user_1/")).toBe(true);
    }
  });

  it("afviser bruger-id'er der kunne udvide præfikset", async () => {
    for (const bad of ["", "../other", "a/b", "user*", "u 1"]) {
      await expect(purgeUserUploads(bad)).rejects.toThrow("Ugyldigt");
    }
    expect(deleteAllVersions).not.toHaveBeenCalled();
  });

  it("gør ingenting uden S3-konfiguration", async () => {
    vi.stubEnv("S3_ENDPOINT", "");
    expect(await purgeUserUploads("user_1")).toBe(0);
    expect(deleteAllVersions).not.toHaveBeenCalled();
  });

  it("fortsætter med de øvrige mapper hvis én fejler, og kaster til sidst", async () => {
    deleteAllVersions.mockImplementation(async (target: { prefix: string }) => {
      if (target.prefix.includes("/logos/")) throw new Error("boom");
      return 1;
    });

    await expect(purgeUserUploads("user_1")).rejects.toThrow(/logos/);
    expect(deleteAllVersions).toHaveBeenCalledTimes(4);
  });
});

// --- collectUserStorageKeys / purgeStorageKeys ---------------------------

const { collectUserStorageKeys, purgeStorageKeys } = await import(
  "../user-uploads"
);

const IMG_A = "0b9c1f3e-6d2a-4c5b-8e7f-1a2b3c4d5e6f";
const IMG_B = "1c0d2e4f-7e3b-4d6c-9f80-2b3c4d5e6f70";
const IMG_C = "2d1e3f50-8f4c-4e7d-a091-3c4d5e6f7081";
const FB_ID = "3e2f4061-9a5d-4f8e-b1a2-4d5e6f708192";

const dbState = {
  attachments: [] as { storageUrl: string | null }[],
  comments: [] as { contentHtml: string }[],
  threads: [] as { attachments: { storagePath?: string }[] | null }[],
  feedback: [] as {
    screenshotKey: string | null;
    organizationId?: string | null;
  }[],
};

const fakeDb = {
  select: vi.fn(() => ({ from: () => ({ where: () => "tasks-subquery" }) })),
  query: {
    taskAttachments: { findMany: vi.fn(async () => dbState.attachments) },
    taskComments: { findMany: vi.fn(async () => dbState.comments) },
    emailThreads: { findMany: vi.fn(async () => dbState.threads) },
    feedbackSubmissions: { findMany: vi.fn(async () => dbState.feedback) },
  },
};

describe("collectUserStorageKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.attachments = [];
    dbState.comments = [];
    dbState.threads = [];
    dbState.feedback = [];
  });

  it("samler fulde nøgler til task-billeder, kommentar-billeder, e-mailvedhæftninger og feedback", async () => {
    dbState.attachments = [
      { storageUrl: `/api/files/task-image/2026/10/${IMG_A}.jpg` },
      { storageUrl: null },
    ];
    dbState.comments = [
      {
        contentHtml: `<p>x</p><img src="/api/files/task-image/2026/09/${IMG_B}.jpg"><img src="/api/files/task-image/2026/09/${IMG_C}.jpg" alt="y">`,
      },
      // samme billede igen: skal ikke give dubletter
      {
        contentHtml: `<img src="/api/files/task-image/2026/10/${IMG_A}.jpg">`,
      },
    ];
    dbState.threads = [
      {
        attachments: [
          // gammel række: path-style URL med filnavn
          {
            storagePath:
              "https://hel1.your-objectstorage.com/bucket/timetrack/email-attachments/a1b2c3d4/0123456789ab-faktura.pdf",
          },
          // ny række: logisk nøgle
          { storagePath: "email-attachments/a1b2c3d4/ba9876543210" },
          // kun metadata og lokal sti: intet i S3
          {},
          { storagePath: "storage/email-attachments/x/y.pdf" },
        ],
      },
      { attachments: null },
    ];
    dbState.feedback = [
      { screenshotKey: `timetrack/feedback/${FB_ID}.png` },
      { screenshotKey: null },
    ];

    const keys = await collectUserStorageKeys(fakeDb as never, "user_1", [
      "org_1",
    ]);

    expect(keys.sort()).toEqual(
      [
        `timetrack/uploads/images/2026/10/${IMG_A}.jpg`,
        `timetrack/uploads/images/2026/09/${IMG_B}.jpg`,
        `timetrack/uploads/images/2026/09/${IMG_C}.jpg`,
        "timetrack/email-attachments/a1b2c3d4/0123456789ab-faktura.pdf",
        "timetrack/email-attachments/a1b2c3d4/ba9876543210",
        `timetrack/feedback/${FB_ID}.png`,
      ].sort(),
    );
  });

  it("ignorerer URL'er og nøgler i databasen, der ikke har de kendte former", async () => {
    dbState.attachments = [
      { storageUrl: "https://evil.example/timetrack/profile/u2/1.webp" },
      { storageUrl: "/api/files/task-image/../../profile/u2/1.webp" },
    ];
    dbState.comments = [
      {
        contentHtml:
          '<img src="https://x/timetrack/profile/u2/1.webp"><img src="/api/files/task-image/2026/10/not-a-uuid.jpg">',
      },
    ];
    dbState.threads = [
      {
        attachments: [
          {
            storagePath:
              "https://hel1.your-objectstorage.com/bucket/timetrack/profile/u2/1.webp",
          },
          { storagePath: "email-attachments/../profile/u2/1.webp" },
        ],
      },
    ];
    dbState.feedback = [
      { screenshotKey: "timetrack/profile/u2/1.webp" },
      { screenshotKey: "other/feedback/abc.png" },
      { screenshotKey: `timetrack/feedback/../${FB_ID}.png` },
    ];

    expect(await collectUserStorageKeys(fakeDb as never, "user_1", [])).toEqual(
      [],
    );
  });

  it("bevarer screenshots for feedback der overlever sletningen (anden org)", async () => {
    dbState.feedback = [
      {
        screenshotKey: `timetrack/feedback/${FB_ID}.png`,
        organizationId: "org_other",
      },
    ];
    const keys = await collectUserStorageKeys(fakeDb as never, "user_1", [
      "org_1",
    ]);
    expect(keys).not.toContain(`timetrack/feedback/${FB_ID}.png`);
    dbState.feedback = [
      {
        screenshotKey: `timetrack/feedback/${FB_ID}.png`,
        organizationId: "org_1",
      },
    ];
    expect(
      await collectUserStorageKeys(fakeDb as never, "user_1", ["org_1"]),
    ).toContain(`timetrack/feedback/${FB_ID}.png`);
  });

  it("afgrænser opgaverne til brugeren og de orgs der slettes", async () => {
    await collectUserStorageKeys(fakeDb as never, "user_1", ["org_1"]);
    expect(fakeDb.select).toHaveBeenCalledTimes(1);
    for (const table of [
      fakeDb.query.taskAttachments,
      fakeDb.query.taskComments,
      fakeDb.query.emailThreads,
      fakeDb.query.feedbackSubmissions,
    ]) {
      expect(table.findMany).toHaveBeenCalledTimes(1);
    }
  });
});

describe("purgeStorageKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("S3_ENDPOINT", "https://s3.example.test");
    deleteAllVersions.mockResolvedValue(2);
  });

  it("sletter alle versioner af hver præcis nøgle", async () => {
    const keys = ["timetrack/feedback/a.png", "timetrack/feedback/b.png"];
    expect(await purgeStorageKeys(keys)).toBe(4);
    expect(deleteAllVersions.mock.calls.map(([target]) => target)).toEqual([
      { key: "timetrack/feedback/a.png" },
      { key: "timetrack/feedback/b.png" },
    ]);
  });

  it("fortsætter ved fejl, kaster til sidst og logger ikke nøglerne", async () => {
    deleteAllVersions.mockImplementation(async ({ key }: { key: string }) => {
      if (key.endsWith("b.png")) throw new Error("boom");
      return 1;
    });
    const keys = [
      "timetrack/x/a.png",
      "timetrack/x/b.png",
      "timetrack/x/c.png",
    ];

    await expect(purgeStorageKeys(keys)).rejects.toThrow("1 af 3");
    expect(deleteAllVersions).toHaveBeenCalledTimes(3);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("b.png");
  });

  it("gør ingenting uden nøgler eller uden S3", async () => {
    expect(await purgeStorageKeys([])).toBe(0);
    vi.stubEnv("S3_ENDPOINT", "");
    expect(await purgeStorageKeys(["timetrack/x/a.png"])).toBe(0);
    expect(deleteAllVersions).not.toHaveBeenCalled();
  });
});
