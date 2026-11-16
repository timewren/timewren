/**
 * Lokalt fillager med samme `send(command)`-flade som S3-klienten, så alle
 * eksisterende kaldere (`s3.send(new PutObjectCommand(...))`) virker uændret
 * med `STORAGE_DRIVER=local`. Kun de kommandoer, appen bruger, er understøttet.
 *
 * Layout under roden: `objects/<nøgle>` er filerne, `meta/<nøgle>.json` er
 * ContentType og brugerdefineret metadata. Der er ingen versionering, så
 * "slet alle versioner" er et almindeligt sletning.
 */

import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

interface StoredMeta {
  contentType?: string;
  metadata: Record<string, string>;
}

function storageError(name: "NoSuchKey" | "NotFound", key: string) {
  const err = new Error(`${name}: ${key}`) as Error & {
    $metadata: { httpStatusCode: number };
  };
  err.name = name;
  err.$metadata = { httpStatusCode: 404 };
  return err;
}

async function toBuffer(body: unknown): Promise<Buffer> {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  throw new Error("Lokalt lager: ukendt Body-type");
}

export class LocalStorageClient {
  private readonly objects: string;
  private readonly meta: string;

  constructor(root: string) {
    const resolved = path.resolve(root);
    this.objects = path.join(resolved, "objects");
    this.meta = path.join(resolved, "meta");
  }

  /** Absolut sti til en nøgle; afviser alt der kan slippe ud af roden. */
  private objectPath(key: string): string {
    if (!key || key.includes("\0") || key.split("/").includes("..")) {
      throw new Error("Ugyldig lagernøgle");
    }
    const full = path.resolve(this.objects, key);
    if (!full.startsWith(this.objects + path.sep)) {
      throw new Error("Ugyldig lagernøgle");
    }
    return full;
  }

  private metaPath(key: string): string {
    this.objectPath(key);
    return path.resolve(this.meta, `${key}.json`);
  }

  private async readMeta(key: string): Promise<StoredMeta> {
    try {
      return JSON.parse(await readFile(this.metaPath(key), "utf8"));
    } catch {
      return { metadata: {} };
    }
  }

  private async put(input: {
    Key: string;
    Body?: unknown;
    ContentType?: string;
    Metadata?: Record<string, string>;
  }) {
    const file = this.objectPath(input.Key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      // Streams (fx dataeksporten) skrives direkte til disk uden buffer
      if (input.Body instanceof Readable) {
        await pipeline(input.Body, createWriteStream(tmp));
      } else {
        await writeFile(tmp, await toBuffer(input.Body));
      }
      await rename(tmp, file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    const metaFile = this.metaPath(input.Key);
    await mkdir(path.dirname(metaFile), { recursive: true });
    const meta: StoredMeta = {
      contentType: input.ContentType,
      metadata: input.Metadata ?? {},
    };
    await writeFile(metaFile, JSON.stringify(meta));
    return {};
  }

  private async head(key: string) {
    const file = this.objectPath(key);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      throw storageError("NotFound", key);
    }
    const meta = await this.readMeta(key);
    return {
      ContentLength: size,
      ContentType: meta.contentType,
      Metadata: meta.metadata,
    };
  }

  private async get(key: string) {
    const info = await this.head(key).catch(() => {
      throw storageError("NoSuchKey", key);
    });
    const file = this.objectPath(key);
    return {
      ...info,
      Body: {
        transformToWebStream: () =>
          Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
        transformToByteArray: async () => new Uint8Array(await readFile(file)),
        transformToString: async () => readFile(file, "utf8"),
      },
    };
  }

  private async remove(key: string) {
    await rm(this.objectPath(key), { force: true });
    await rm(this.metaPath(key), { force: true });
  }

  private async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const startDir = path.resolve(
      this.objects,
      prefix.slice(0, prefix.lastIndexOf("/") + 1),
    );
    if (!startDir.startsWith(this.objects)) return keys;
    const walk = async (dir: string) => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (!entry.name.endsWith(".tmp")) {
          const key = path
            .relative(this.objects, full)
            .split(path.sep)
            .join("/");
          if (key.startsWith(prefix)) keys.push(key);
        }
      }
    };
    await walk(startDir);
    return keys.sort();
  }

  async send(command: unknown, _options?: unknown): Promise<unknown> {
    if (command instanceof PutObjectCommand) {
      return this.put(
        command.input as Parameters<LocalStorageClient["put"]>[0],
      );
    }
    if (command instanceof GetObjectCommand) {
      return this.get(command.input.Key as string);
    }
    if (command instanceof HeadObjectCommand) {
      return this.head(command.input.Key as string);
    }
    if (command instanceof DeleteObjectCommand) {
      await this.remove(command.input.Key as string);
      return {};
    }
    if (command instanceof DeleteObjectsCommand) {
      const errors: { Key?: string; Code: string }[] = [];
      for (const obj of command.input.Delete?.Objects ?? []) {
        try {
          await this.remove(obj.Key as string);
        } catch {
          errors.push({ Key: obj.Key, Code: "InternalError" });
        }
      }
      return { Errors: errors };
    }
    if (command instanceof ListObjectVersionsCommand) {
      const keys = await this.list(command.input.Prefix ?? "");
      return {
        Versions: keys.map((Key) => ({ Key, VersionId: "null" })),
        DeleteMarkers: [],
        IsTruncated: false,
      };
    }
    throw new Error(
      `Lokalt lager understøtter ikke ${(command as object)?.constructor?.name}`,
    );
  }
}
