import { crc32, deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  readFormDataWithLimit,
  SHARP_INPUT_OPTIONS,
} from "@/lib/upload/limits";

function uploadRequest(bytes: number, init?: { chunked?: boolean }) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), "billede.png");
  form.append("folder", "logos");
  const encoded = new Response(form);
  const headers = new Headers({
    "content-type": encoded.headers.get("content-type") ?? "",
  });
  return encoded.arrayBuffer().then((buf) => {
    if (!init?.chunked) headers.set("content-length", String(buf.byteLength));
    // En strøm uden Content-Length svarer til en chunked upload.
    const body = init?.chunked
      ? new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(buf));
            c.close();
          },
        })
      : buf;
    return new Request("https://example.com/api/upload", {
      method: "POST",
      headers,
      body,
      duplex: "half",
    } as RequestInit);
  });
}

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(width + 1))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("readFormDataWithLimit", () => {
  it("returnerer felterne, når bodyen er under grænsen", async () => {
    const form = await readFormDataWithLimit(await uploadRequest(1024), 4096);
    expect(form?.get("folder")).toBe("logos");
    expect((form?.get("file") as File | undefined)?.size).toBe(1024);
  });

  it("afviser på Content-Length uden at læse bodyen", async () => {
    const req = await uploadRequest(200_000);
    expect(await readFormDataWithLimit(req, 4096)).toBeNull();
    expect(req.bodyUsed).toBe(false);
  });

  it("afviser en chunked body uden Content-Length, når den bliver for stor", async () => {
    const req = await uploadRequest(200_000, { chunked: true });
    expect(req.headers.get("content-length")).toBeNull();
    expect(await readFormDataWithLimit(req, 4096)).toBeNull();
  });
});

describe("SHARP_INPUT_OPTIONS", () => {
  // 144 MP: under sharps standardgrænse (~268 MP), over vores (64 MP).
  it("afviser et billede med flere pixels end grænsen ud fra headeren", async () => {
    await expect(
      sharp(pngHeader(12_000, 12_000), SHARP_INPUT_OPTIONS)
        .resize(400, 400)
        .toBuffer(),
    ).rejects.toThrow(/pixel limit/i);
  });
});
