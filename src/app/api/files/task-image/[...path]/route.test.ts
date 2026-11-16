import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActiveOrgId: vi.fn(),
  headObject: vi.fn(),
  getObjectStream: vi.fn(),
  attachments: vi.fn(),
  comments: vi.fn(),
  tasks: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: mocks.resolveActiveOrgId,
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      taskAttachments: { findMany: mocks.attachments },
      taskComments: { findMany: mocks.comments },
      tasks: { findMany: mocks.tasks },
    },
  },
}));
vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "bucket",
  prefixKey: (k: string) => `timetrack/${k}`,
  s3: { send: vi.fn() },
}));
vi.mock("@/lib/storage/objects", () => ({
  headObject: mocks.headObject,
  getObjectStream: mocks.getObjectStream,
}));

const { GET } = await import("./route");

const UUID = "0b9c1f3e-6d2a-4c5b-8e7f-1a2b3c4d5e6f";
const SEGMENTS = ["2026", "10", `${UUID}.jpg`];
const OBJECT_KEY = `timetrack/uploads/images/2026/10/${UUID}.jpg`;

function request(segments: string[] = SEGMENTS) {
  return GET(
    new NextRequest(
      `http://localhost/api/files/task-image/${segments.join("/")}`,
    ),
    { params: Promise.resolve({ path: segments }) },
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

describe("GET /api/files/task-image/[...path]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("S3_ENDPOINT", "https://s3.example.test");
    mocks.getSession.mockResolvedValue({ user: { id: "user-b" } });
    mocks.resolveActiveOrgId.mockResolvedValue("org-a");
    // Billedet er uploadet af user-a i org-a
    mocks.headObject.mockResolvedValue({
      contentType: "image/jpeg",
      contentLength: 9,
      metadata: { "uploaded-by": "user-a", "org-id": "org-a" },
    });
    mocks.getObjectStream.mockResolvedValue({
      stream: streamOf("img-bytes"),
      contentType: "image/jpeg",
      contentLength: 9,
      metadata: {},
    });
    // Opgaven i org-a refererer billedet
    mocks.attachments.mockResolvedValue([{ taskId: "task-1" }]);
    mocks.comments.mockResolvedValue([]);
    mocks.tasks.mockResolvedValue([{ id: "task-1", organizationId: "org-a" }]);
  });

  it("uautentificeret giver 401 uden at røre S3", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await request();
    expect(res.status).toBe(401);
    expect(mocks.headObject).not.toHaveBeenCalled();
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("ugyldig nøgle eller .. giver 400 uden at røre S3", async () => {
    for (const segments of [
      ["..", "..", "profile", "user-a", "1.webp"],
      ["2026", "10", ".."],
      ["2026", "%2e%2e", `${UUID}.jpg`],
      ["2026", "10", "not-a-uuid.jpg"],
      [],
    ]) {
      const res = await request(segments);
      expect(res.status).toBe(400);
    }
    expect(mocks.headObject).not.toHaveBeenCalled();
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("et medlem af den rigtige org får billedet streamet med sikre headers", async () => {
    const res = await request();

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("img-bytes");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-length")).toBe("9");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(mocks.headObject).toHaveBeenCalledWith(OBJECT_KEY);
    expect(mocks.getObjectStream).toHaveBeenCalledWith(OBJECT_KEY);
  });

  it("en bruger i en anden org får 404 og kroppen hentes aldrig", async () => {
    mocks.resolveActiveOrgId.mockResolvedValue("org-b");
    const res = await request();
    expect(res.status).toBe(404);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("en bruger uden nogen org får 404", async () => {
    mocks.resolveActiveOrgId.mockResolvedValue(null);
    const res = await request();
    expect(res.status).toBe(404);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("uploaderen får billedet, før det er refereret (forhåndsvisning i editoren)", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.resolveActiveOrgId.mockResolvedValue("org-a");
    mocks.attachments.mockResolvedValue([]);

    const res = await request();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("img-bytes");
  });

  it("en reference i en anden org giver ikke adgang", async () => {
    mocks.tasks.mockResolvedValue([{ id: "task-1", organizationId: "org-b" }]);
    const res = await request();
    expect(res.status).toBe(404);
    expect(mocks.getObjectStream).not.toHaveBeenCalled();
  });

  it("manglende objekt giver 404", async () => {
    mocks.headObject.mockResolvedValue(null);
    const res = await request();
    expect(res.status).toBe(404);
  });

  it("S3-fejl giver 500 uden at lække detaljer", async () => {
    mocks.headObject.mockRejectedValue(new Error("secret endpoint details"));
    const res = await request();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
