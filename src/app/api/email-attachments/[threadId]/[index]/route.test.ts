import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getObjectStream: vi.fn(),
  threads: [] as {
    id: string;
    userId: string;
    attachments: {
      filename: string;
      contentType: string;
      size: number;
      storagePath?: string;
    }[];
  }[],
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "mahope",
  prefixKey: (k: string) => `timetrack/${k}`,
  s3: { send: vi.fn() },
}));
vi.mock("@/lib/storage/objects", () => ({
  getObjectStream: mocks.getObjectStream,
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      emailThreads: {
        // Rækken findes på id; ejerskab afgøres af ruten (userId i koden)
        findFirst: vi.fn(async ({ where }: { where: unknown }) => {
          const ids = paramsOf(where);
          return mocks.threads.find((t) => ids.includes(t.id));
        }),
      },
    },
  },
}));

function paramsOf(node: unknown, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== "object") return out;
  const chunk = node as {
    constructor?: { name?: string };
    queryChunks?: unknown[];
  };
  if (chunk.constructor?.name === "Param") {
    out.push((node as { value: unknown }).value);
    return out;
  }
  for (const child of chunk.queryChunks ?? []) paramsOf(child, out);
  return out;
}

const { GET } = await import("./route");

const S3_URL =
  "https://hel1.your-objectstorage.com/mahope/timetrack/email-attachments/a1b2c3d4/0123456789ab-faktura.pdf";
const FULL_KEY =
  "timetrack/email-attachments/a1b2c3d4/0123456789ab-faktura.pdf";

function call(threadId = "thread-1", index = "0") {
  return GET(
    new NextRequest(
      `http://localhost/api/email-attachments/${threadId}/${index}`,
    ),
    { params: Promise.resolve({ threadId, index }) },
  );
}

function streamOf(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("GET /api/email-attachments/[threadId]/[index]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getObjectStream.mockResolvedValue({
      stream: streamOf("pdf-bytes"),
      contentLength: 9,
      metadata: {},
    });
    mocks.threads = [
      {
        id: "thread-1",
        userId: "user-1",
        attachments: [
          {
            filename: "faktura.pdf",
            contentType: "application/pdf",
            size: 9,
            storagePath: S3_URL,
          },
        ],
      },
      {
        id: "thread-2",
        userId: "user-2",
        attachments: [
          {
            filename: "hemmeligt.pdf",
            contentType: "application/pdf",
            size: 9,
            storagePath: S3_URL,
          },
        ],
      },
    ];
  });

  it("streamer en S3-vedhæftning fra brugerens egen tråd", async () => {
    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pdf-bytes");
    expect(mocks.getObjectStream).toHaveBeenCalledWith(FULL_KEY);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="faktura.pdf"',
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("en andens tråd giver 404 og S3 røres aldrig", async () => {
    const res = await call("thread-2");
    expect(res.status).toBe(404);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("uautentificeret giver 401 uden S3-kald", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("en vedhæftning uden storagePath (kun metadata) giver 404", async () => {
    delete mocks.threads[0].attachments[0].storagePath;
    const res = await call();
    expect(res.status).toBe(404);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("en S3-sti uden for vedhæftnings-mønstret giver 400 uden S3-kald", async () => {
    mocks.threads[0].attachments[0].storagePath =
      "https://hel1.your-objectstorage.com/mahope/timetrack/profile/user-2/1.webp";
    const res = await call();
    expect(res.status).toBe(400);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("manglende S3-objekt giver 404", async () => {
    mocks.getObjectStream.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("lokale stier uden for vedhæftningsmappen afvises stadig med 400", async () => {
    mocks.threads[0].attachments[0].storagePath = "/etc/passwd";
    const res = await call();
    expect(res.status).toBe(400);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("ugyldigt index giver 400", async () => {
    const res = await call("thread-1", "abc");
    expect(res.status).toBe(400);
  });
});
