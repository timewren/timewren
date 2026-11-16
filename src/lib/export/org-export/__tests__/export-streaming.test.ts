/**
 * #898: eksporten må ikke samles i hukommelsen. putOrgExportStream får en
 * mocket multipart-upload, der tager imod ZIP'en stump for stump og er langsom
 * (som en netværksforbindelse). Testen beviser, at en stor eksport skrives
 * løbende: filerne hentes én ad gangen, uploaden har modtaget det meste, før
 * den sidste fil hentes, og bufferen mellem skribent og upload forbliver lille.
 */
import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const up = vi.hoisted(() => {
  process.env.S3_ENDPOINT = "https://hel1.your-objectstorage.com";
  return {
    received: 0,
    chunks: 0,
    maxChunk: 0,
    maxBuffered: 0,
    aborted: 0,
    done: 0,
    failAfterChunks: null as number | null,
    reset() {
      this.received = 0;
      this.chunks = 0;
      this.maxChunk = 0;
      this.maxBuffered = 0;
      this.aborted = 0;
      this.done = 0;
      this.failAfterChunks = null;
    },
  };
});

vi.mock("@/lib/s3", () => ({
  s3: {},
  S3_BUCKET: "timetrack",
  prefixKey: (k: string) => k,
}));

vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    private body: Readable;
    constructor(opts: { params: { Body: Readable } }) {
      this.body = opts.params.Body;
    }
    async done() {
      for await (const chunk of this.body) {
        up.received += chunk.length;
        up.chunks++;
        up.maxChunk = Math.max(up.maxChunk, chunk.length);
        up.maxBuffered = Math.max(up.maxBuffered, this.body.readableLength);
        if (up.failAfterChunks !== null && up.chunks >= up.failAfterChunks) {
          throw new Error("s3 nede");
        }
        // Langsom modtager, så skribenten tvinges til at vente.
        await new Promise((r) => setImmediate(r));
      }
      up.done++;
    }
    async abort() {
      up.aborted++;
    }
  },
}));

import type { CollectedTable } from "../collect";
import { exportableColumns } from "../collect";
import type { FileOwner, ObjectReader } from "../files";
import { ORG_EXPORT_TABLES } from "../registry";
import { putOrgExportStream } from "../storage";
import { writeExportZip } from "../zip";

const MIB = 1024 * 1024;
const FILES = 40;
const FILE_BYTES = 2 * MIB;

const profile = ORG_EXPORT_TABLES.find((e) => e.key === "companyProfiles");
if (!profile) throw new Error("companyProfiles");

function logoTable(n: number): CollectedTable {
  const { columns, numericColumns } = exportableColumns(profile as never);
  return {
    entry: profile as never,
    columns,
    numericColumns,
    rows: Array.from({ length: n }, (_, i) => ({
      id: `cp-${i}`,
      logoUrl: `https://hel1.your-objectstorage.com/timetrack/logos/uA/${1700000000000 + i}.webp`,
    })),
  };
}

const owner: FileOwner = {
  orgId: "org-A",
  userId: "uA",
  mode: "org",
  uploaderIds: new Set(["uA"]),
};
const META = {
  organizationId: "org-A",
  organizationName: "Stor ApS",
  requestedByUserId: "uA",
  exportedAt: new Date("2026-10-29T10:00:00Z"),
};

function bigReader() {
  const state = {
    inFlight: 0,
    maxInFlight: 0,
    gets: 0,
    receivedAtGet: [] as number[],
  };
  const reader: ObjectReader = {
    head: async () => null,
    async get() {
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      state.gets++;
      state.receivedAtGet.push(up.received);
      const data = new Uint8Array(randomBytes(FILE_BYTES)); // kan ikke komprimeres
      state.inFlight--;
      return data;
    },
  };
  return { reader, state };
}

describe("eksport streames til objektlageret (#898)", () => {
  it("en eksport på 80 MB skrives løbende og samles aldrig i hukommelsen", async () => {
    up.reset();
    const { reader, state } = bigReader();
    let fileCount = 0;
    await putOrgExportStream("req-1", async (out) => {
      const r = await writeExportZip(
        out,
        [logoTable(FILES)],
        owner,
        reader,
        META,
      );
      fileCount = r.fileCount;
    });

    expect(fileCount).toBe(FILES);
    expect(up.done).toBe(1);
    // Hele eksporten nåede frem ...
    expect(up.received).toBeGreaterThanOrEqual(FILES * FILE_BYTES);
    expect(up.received).toBeLessThan(FILES * FILE_BYTES + MIB);
    // ... men aldrig som ét stykke eller som en stor kø.
    expect(up.maxChunk).toBeLessThan(FILE_BYTES + 4096);
    expect(up.maxBuffered).toBeLessThan(4 * MIB);
    // Filerne hentes én ad gangen ...
    expect(state.gets).toBe(FILES);
    expect(state.maxInFlight).toBe(1);
    // ... og uploaden har allerede modtaget det meste, før den sidste hentes.
    expect(state.receivedAtGet[FILES - 1]).toBeGreaterThan(
      (FILES - 3) * FILE_BYTES,
    );
    expect(state.receivedAtGet[0]).toBe(0);
  });

  it("afbryder uploaden og stopper med at hente filer, når uploaden fejler", async () => {
    up.reset();
    up.failAfterChunks = 3;
    const { reader, state } = bigReader();
    await expect(
      putOrgExportStream("req-2", (out) =>
        writeExportZip(out, [logoTable(FILES)], owner, reader, META),
      ),
    ).rejects.toThrow("s3 nede");
    expect(up.aborted).toBe(1);
    expect(state.gets).toBeLessThan(FILES);
  });

  it("afbryder uploaden, når skribenten selv fejler", async () => {
    up.reset();
    await expect(
      putOrgExportStream("req-3", async () => {
        throw new Error("rækker kunne ikke hentes");
      }),
    ).rejects.toThrow("rækker kunne ikke hentes");
    expect(up.aborted).toBe(1);
    expect(up.done).toBe(0);
  });
});
