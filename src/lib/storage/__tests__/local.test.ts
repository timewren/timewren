import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getStorageDriver,
  isStorageConfigured,
  localStorageRoot,
} from "../config";
import { LocalStorageClient } from "../local";

let root: string;
let client: LocalStorageClient;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "tt-storage-"));
  client = new LocalStorageClient(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const put = (Key: string, Body: Buffer | string, extra = {}) =>
  client.send(new PutObjectCommand({ Bucket: "b", Key, Body, ...extra }));

describe("getStorageDriver", () => {
  it("S3 når kun S3_ENDPOINT er sat (produktion uændret)", () => {
    expect(getStorageDriver({ S3_ENDPOINT: "https://s3.x" } as never)).toBe(
      "s3",
    );
  });
  it("local vinder over S3_ENDPOINT, kun når den vælges eksplicit", () => {
    expect(
      getStorageDriver({
        STORAGE_DRIVER: "local",
        S3_ENDPOINT: "https://s3.x",
      } as never),
    ).toBe("local");
  });
  it("none uden noget", () => {
    expect(getStorageDriver({} as never)).toBe("none");
    expect(isStorageConfigured({} as never)).toBe(false);
    expect(isStorageConfigured({ STORAGE_DRIVER: "local" } as never)).toBe(
      true,
    );
  });
  it("localStorageRoot har en standard", () => {
    expect(localStorageRoot({} as never)).toBe("./data/storage");
    expect(localStorageRoot({ STORAGE_LOCAL_PATH: "/data/s" } as never)).toBe(
      "/data/s",
    );
  });
});

describe("LocalStorageClient", () => {
  it("round-trip: put → head → get med metadata", async () => {
    await put("task-images/a/b.png", Buffer.from("hej"), {
      ContentType: "image/png",
      Metadata: { uploadedby: "u1" },
    });

    const head = (await client.send(
      new HeadObjectCommand({ Bucket: "b", Key: "task-images/a/b.png" }),
    )) as { ContentLength: number; ContentType: string; Metadata: object };
    expect(head).toMatchObject({
      ContentLength: 3,
      ContentType: "image/png",
      Metadata: { uploadedby: "u1" },
    });

    const got = (await client.send(
      new GetObjectCommand({ Bucket: "b", Key: "task-images/a/b.png" }),
    )) as {
      Body: {
        transformToByteArray(): Promise<Uint8Array>;
        transformToWebStream(): ReadableStream<Uint8Array>;
      };
    };
    expect(Buffer.from(await got.Body.transformToByteArray()).toString()).toBe(
      "hej",
    );
    const chunks: Uint8Array[] = [];
    const reader = got.Body.transformToWebStream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    expect(Buffer.concat(chunks).toString()).toBe("hej");
  });

  it("manglende objekt giver NoSuchKey/NotFound som S3", async () => {
    await expect(
      client.send(new GetObjectCommand({ Bucket: "b", Key: "findes/ikke" })),
    ).rejects.toMatchObject({ name: "NoSuchKey" });
    await expect(
      client.send(new HeadObjectCommand({ Bucket: "b", Key: "findes/ikke" })),
    ).rejects.toMatchObject({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
  });

  it("afviser nøgler der kan slippe ud af roden", async () => {
    await expect(put("../ud", "x")).rejects.toThrow("Ugyldig lagernøgle");
    await expect(put("a/../../ud", "x")).rejects.toThrow("Ugyldig lagernøgle");
    await expect(put("/absolut", "x")).rejects.toThrow("Ugyldig lagernøgle");
    // Intet er skrevet, hverken i roden eller ved siden af den.
    expect(await readdir(root)).toEqual([]);
    expect(await readdir(path.dirname(root))).not.toContain("ud");
  });

  it("overskriver et objekt og efterlader ingen temp-filer", async () => {
    await put("k/x.zip", Buffer.from("v1"));
    await put("k/x.zip", Buffer.from("version2"));
    const head = (await client.send(
      new HeadObjectCommand({ Bucket: "b", Key: "k/x.zip" }),
    )) as { ContentLength: number };
    expect(head.ContentLength).toBe(8);
    expect(await readdir(path.join(root, "objects", "k"))).toEqual(["x.zip"]);
  });

  it("DeleteObject er idempotent og fjerner metadata", async () => {
    await put("k/a", "1");
    await client.send(new DeleteObjectCommand({ Bucket: "b", Key: "k/a" }));
    await client.send(new DeleteObjectCommand({ Bucket: "b", Key: "k/a" }));
    await expect(
      client.send(new HeadObjectCommand({ Bucket: "b", Key: "k/a" })),
    ).rejects.toMatchObject({ name: "NotFound" });
    expect(await readdir(path.join(root, "meta", "k"))).toEqual([]);
  });

  it("ListObjectVersions + DeleteObjects virker som deleteAllVersions forventer", async () => {
    await put("profile/u1/1.webp", "a");
    await put("profile/u1/2.webp", "b");
    await put("profile/u10/1.webp", "andens");
    await put("profile/u1x", "andens2");

    const listing = (await client.send(
      new ListObjectVersionsCommand({ Bucket: "b", Prefix: "profile/u1/" }),
    )) as { Versions: { Key: string }[]; IsTruncated: boolean };
    expect(listing.Versions.map((v) => v.Key)).toEqual([
      "profile/u1/1.webp",
      "profile/u1/2.webp",
    ]);
    expect(listing.IsTruncated).toBe(false);

    const res = (await client.send(
      new DeleteObjectsCommand({
        Bucket: "b",
        Delete: { Objects: listing.Versions.map(({ Key }) => ({ Key })) },
      }),
    )) as { Errors: unknown[] };
    expect(res.Errors).toEqual([]);

    const after = (await client.send(
      new ListObjectVersionsCommand({ Bucket: "b", Prefix: "profile/" }),
    )) as { Versions: { Key: string }[] };
    expect(after.Versions.map((v) => v.Key)).toEqual([
      "profile/u10/1.webp",
      "profile/u1x",
    ]);
  });

  it("præfiks der er en eksakt nøgle matcher også kun præfiks-nøgler", async () => {
    await put("email-attachments/h/abc", "1");
    await put("email-attachments/h/abc.bak", "2");
    const listing = (await client.send(
      new ListObjectVersionsCommand({
        Bucket: "b",
        Prefix: "email-attachments/h/abc",
      }),
    )) as { Versions: { Key: string }[] };
    expect(listing.Versions.map((v) => v.Key)).toEqual([
      "email-attachments/h/abc",
      "email-attachments/h/abc.bak",
    ]);
  });
});
