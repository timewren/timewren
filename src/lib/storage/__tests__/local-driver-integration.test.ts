import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * STORAGE_DRIVER=local gennem de rigtige kaldere: dataeksport, sletning af
 * alle versioner, offentlige URL'er og den offentlige fil-rute.
 */

let root: string;
const original = { ...process.env };

beforeEach(async () => {
  vi.resetModules();
  root = await mkdtemp(path.join(os.tmpdir(), "tt-local-int-"));
  process.env.STORAGE_DRIVER = "local";
  process.env.STORAGE_LOCAL_PATH = root;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
  delete process.env.S3_ENDPOINT;
  delete process.env.S3_PREFIX;
});
afterEach(async () => {
  process.env = { ...original };
  await rm(root, { recursive: true, force: true });
});

async function readAll(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString();
}

describe("dataeksport på lokalt lager", () => {
  it("putOrgExportStream → getOrgExportStream → deleteOrgExport", async () => {
    const storage = await import("@/lib/export/org-export/storage");
    expect(storage.isExportStorageConfigured()).toBe(true);

    const enc = new TextEncoder();
    await storage.putOrgExportStream("req-1", async (out) => {
      await out.write(enc.encode("ZIP"));
      await out.write(enc.encode("DATA"));
    });
    const got = await storage.getOrgExportStream("req-1");
    expect(got?.size).toBe(7);
    expect(await readAll(got?.stream as ReadableStream)).toBe("ZIPDATA");

    await storage.deleteOrgExport("req-1");
    expect(await storage.getOrgExportStream("req-1")).toBeNull();
  });

  it("en fejlet eksport efterlader hverken objekt eller midlertidig fil", async () => {
    const storage = await import("@/lib/export/org-export/storage");
    await expect(
      storage.putOrgExportStream("req-2", async (out) => {
        await out.write(new TextEncoder().encode("HALV"));
        throw new Error("produce fejlede");
      }),
    ).rejects.toThrow("produce fejlede");
    expect(await storage.getOrgExportStream("req-2")).toBeNull();
  });

  it("uden driver og uden S3_ENDPOINT er lageret ikke konfigureret", async () => {
    delete process.env.STORAGE_DRIVER;
    const storage = await import("@/lib/export/org-export/storage");
    expect(storage.isExportStorageConfigured()).toBe(false);
  });
});

describe("offentlige URL'er", () => {
  it("getPublicUrl peger på appens egen rute, og publicUploadKey kender den igen", async () => {
    const { getPublicUrl } = await import("@/lib/s3");
    const { publicUploadKey } = await import("@/lib/export/org-export/files");
    const url = getPublicUrl("logos/user1/1700000000000.webp");
    expect(url).toBe(
      "https://app.example.com/api/files/public/logos/user1/1700000000000.webp",
    );
    expect(publicUploadKey(url)).toEqual({
      key: "logos/user1/1700000000000.webp",
      uploaderId: "user1",
    });
    expect(publicUploadKey("https://evil.example/x.webp")).toBeNull();
  });
});

describe("sletning af alle versioner", () => {
  it("purgeUserUploads rydder kun den ene brugers mapper", async () => {
    const { s3, prefixKey } = await import("@/lib/s3");
    const { purgeUserUploads } = await import("@/lib/storage/user-uploads");
    const put = (Key: string) =>
      s3.send(new PutObjectCommand({ Bucket: "b", Key, Body: "x" }));
    await put(prefixKey("profile/user1/1.webp"));
    await put(prefixKey("logos/user1/2.webp"));
    await put(prefixKey("profile/user10/3.webp"));

    expect(await purgeUserUploads("user1")).toBe(2);

    const { headObject } = await import("@/lib/storage/objects");
    expect(await headObject(prefixKey("profile/user1/1.webp"))).toBeNull();
    expect(await headObject(prefixKey("profile/user10/3.webp"))).not.toBeNull();
  });
});

describe("GET /api/files/public/[...path]", () => {
  async function call(segments: string[]) {
    const { GET } = await import("@/app/api/files/public/[...path]/route");
    return GET(new Request("http://x") as never, {
      params: Promise.resolve({ path: segments }),
    });
  }

  it("serverer en uploadet fil som webp med lang cache", async () => {
    const { s3, prefixKey } = await import("@/lib/s3");
    await s3.send(
      new PutObjectCommand({
        Bucket: "b",
        Key: prefixKey("profile/user1/1700000000000.webp"),
        Body: "BILLEDE",
      }),
    );
    const res = await call(["profile", "user1", "1700000000000.webp"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("BILLEDE");
  });

  it("afviser alt uden for upload-mønstret (private mapper, traversal)", async () => {
    expect((await call(["data-exports", "x.zip"])).status).toBe(404);
    expect((await call(["profile", "..", "x.webp"])).status).toBe(404);
    expect((await call(["profile", "user1", "findes-ikke.webp"])).status).toBe(
      404,
    );
  });

  it("svarer 404 når lageret ikke er lokalt", async () => {
    delete process.env.STORAGE_DRIVER;
    process.env.S3_ENDPOINT = "https://s3.example.com";
    const res = await call(["profile", "user1", "1700000000000.webp"]);
    expect(res.status).toBe(404);
  });
});

describe("produktion (S3) er uændret", () => {
  it("med S3_ENDPOINT og uden STORAGE_DRIVER bruges S3-klienten og S3-URL'er", async () => {
    delete process.env.STORAGE_DRIVER;
    process.env.S3_ENDPOINT = "https://hel1.your-objectstorage.com";
    process.env.S3_BUCKET = "timetrack";
    process.env.S3_PREFIX = "pfx";
    const { s3, getPublicUrl } = await import("@/lib/s3");
    const { LocalStorageClient } = await import("@/lib/storage/local");
    expect(s3).not.toBeInstanceOf(LocalStorageClient);
    expect(getPublicUrl("logos/u/1.webp")).toBe(
      "https://hel1.your-objectstorage.com/timetrack/pfx/logos/u/1.webp",
    );
  });
});
