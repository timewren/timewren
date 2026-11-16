import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const s3Send = vi.fn();
const uploadToS3 = vi.fn();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } },
}));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: async () => "org-1",
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/i18n/server-text", () => ({
  tr: async (_ns: string, k: string) => k,
}));
vi.mock("@/lib/storage/config", () => ({ isStorageConfigured: () => true }));
vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "bucket",
  s3: { send: (...a: unknown[]) => s3Send(...a) },
  prefixKey: (k: string) => k,
  getPublicUrl: (k: string) => `https://cdn.example.com/${k}`,
}));
vi.mock("@/lib/upload/s3", () => ({
  ORG_ID_META: "org-id",
  UPLOADED_BY_META: "uploaded-by",
  newTaskImageKey: () => "uploads/images/2026/11/x.jpg",
  uploadToS3: (...a: unknown[]) => uploadToS3(...a),
}));

const routes = {
  "/api/upload": (await import("../route")).POST,
  "/api/upload/task-image": (await import("../task-image/route")).POST,
};

/** PNG hvis header lover width×height pixels, uden at indeholde dem. */
function pngHeader(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(width + 1))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const smallPng = await sharp({
  create: { width: 8, height: 8, channels: 3, background: "#336699" },
})
  .png()
  .toBuffer();

async function upload(path: keyof typeof routes, file: Uint8Array) {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(file)], "billede.png", { type: "image/png" }),
  );
  const encoded = new Response(form);
  const body = await encoded.arrayBuffer();
  const req = new Request(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": encoded.headers.get("content-type") ?? "",
      "content-length": String(body.byteLength),
    },
    body,
  });
  // biome-ignore lint/suspicious/noExplicitAny: NextRequest-felterne bruges ikke
  return routes[path](req as any);
}

describe.each(Object.keys(routes) as (keyof typeof routes)[])(
  "POST %s: grænser",
  (path) => {
    beforeEach(() => {
      getSession.mockReset();
      getSession.mockResolvedValue({ user: { id: `u-${Math.random()}` } });
      s3Send.mockReset();
      uploadToS3.mockReset();
      uploadToS3.mockResolvedValue("/api/files/task-image/x.jpg");
    });

    it("accepterer et almindeligt billede", async () => {
      const res = await upload(path, smallPng);
      expect(res.status).toBe(200);
    });

    it("afviser en body over grænsen med 413, før den buffers", async () => {
      const res = await upload(path, new Uint8Array(11 * 1024 * 1024));
      expect(res.status).toBe(413);
    });

    it("afviser et billede med for mange pixels med 400 i stedet for at dekode det", async () => {
      const res = await upload(path, pngHeader(12_000, 12_000));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("api.upload.invalidImage");
      expect(s3Send).not.toHaveBeenCalled();
      expect(uploadToS3).not.toHaveBeenCalled();
    });

    it("rate-limiter uploads pr. bruger", async () => {
      let last: Response | undefined;
      for (let i = 0; i < 31; i++) {
        last = await upload(path, smallPng);
      }
      expect(last?.status).toBe(429);
      expect((await last?.json())?.error).toBe("api.tooManyRequestsLater");
    });
  },
);
