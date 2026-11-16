import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.S3_ENDPOINT = "https://hel1.your-objectstorage.com";
  process.env.S3_BUCKET = "timetrack";
  delete process.env.S3_PREFIX;
});

import type { CollectedTable } from "../collect";
import { extractFiles, type ObjectReader } from "../files";
import { userExportableColumns } from "../user-collect";
import { USER_EXPORT_TABLES } from "../user-registry";
import { userFileOwner, writeExportZip } from "../zip";
import { collectZip } from "./collect-zip";

const entry = (key: string) => USER_EXPORT_TABLES.find((e) => e.key === key)!;

function table(key: string, rows: Record<string, unknown>[]): CollectedTable {
  const { columns, numericColumns } = userExportableColumns(entry(key));
  return { entry: entry(key), columns, numericColumns, rows };
}

function fakeReader(meta: Record<string, Record<string, string>> = {}) {
  const head = vi.fn(async (key: string) =>
    key in meta ? { metadata: meta[key] } : null,
  );
  const get = vi.fn(async (_key: string) => new Uint8Array([1, 2, 3]));
  const reader: ObjectReader = { head, get };
  return { reader, head, get };
}

const owner = userFileOwner({ orgId: "org-1", userId: "u1" });

// En privat fil i TimeTracks eget lager, som en medarbejder ikke må få med
// ved at lime adressen ind i en note.
const PRIVATE =
  "https://hel1.your-objectstorage.com/timetrack/email-attachments/0123abcd/0123456789ab?X-Amz-Signature=hemmelig";
const OWN = "2026/10/11111111-1111-4111-8111-111111111111.jpg";
const COLLEAGUE = "2026/10/33333333-3333-4333-8333-333333333333.jpg";

describe("bruger-eksport: filer fra lageret", () => {
  it("en adresse til en privat fil i lageret, limet ind i en note, hentes ikke", async () => {
    const m = fakeReader();
    const t = table("timeEntries", [
      { id: "te-1", description: "se her", notes: `fil: ${PRIVATE}` },
    ]);
    const { files, manifest } = await extractFiles([t], owner, m.reader);
    expect(m.head).not.toHaveBeenCalled();
    expect(m.get).not.toHaveBeenCalled();
    expect(files).toEqual([]);
    expect(JSON.stringify(manifest)).not.toContain("hemmelig");
  });

  it("kun egne opgavebilleder fra den aktive organisation", async () => {
    const m = fakeReader({
      [`uploads/images/${OWN}`]: { "org-id": "org-1", "uploaded-by": "u1" },
      [`uploads/images/${COLLEAGUE}`]: {
        "org-id": "org-1",
        "uploaded-by": "u2",
      },
    });
    const t = table("taskAttachments", [
      {
        id: "a1",
        filename: "egen.jpg",
        storageUrl: `/api/files/task-image/${OWN}`,
      },
      {
        id: "a2",
        filename: "kollega.jpg",
        storageUrl: `/api/files/task-image/${COLLEAGUE}`,
      },
    ]);
    const { files } = await extractFiles([t], owner, m.reader);
    expect(m.get.mock.calls.map((c) => c[0])).toEqual([
      `uploads/images/${OWN}`,
    ]);
    expect(files.map((f) => f.path)).toEqual([
      "filer/opgave-vedhaeftninger/a1-egen.jpg",
    ]);
  });

  it("binært indhold i selve rækkerne (en vedhæftning) kommer stadig med", async () => {
    const m = fakeReader();
    const t = table("taskAttachments", [
      {
        id: "att-1",
        filename: "note.txt",
        content: new Uint8Array([97, 98, 99]),
      },
    ]);
    const { files, manifest } = await extractFiles([t], owner, m.reader);
    expect(files).toHaveLength(1);
    expect(files[0].path).toContain("filer/opgave-vedhaeftninger/");
    expect(manifest.some((x) => x.status === "Med")).toBe(true);
    expect(m.get).not.toHaveBeenCalled();
  });
});
describe("bruger-eksport: ZIP-filen", () => {
  it("README og metadata siger, at det er brugerens egne data", async () => {
    const t = table("timeEntries", [{ id: "te-1", hours: "1.50" }]);
    const { zip } = await collectZip((out) =>
      writeExportZip(
        out,
        [t],
        userFileOwner({ orgId: "org-1", userId: "u1" }),
        fakeReader().reader,
        {
          organizationId: "org-1",
          organizationName: "Org X",
          requestedByUserId: "u1",
          exportedAt: new Date("2026-10-12T10:00:00Z"),
          kind: "user",
        },
      ),
    );
    const files = unzipSync(zip);
    const readme = strFromU8(files["README.txt"]);
    expect(readme).toContain("dine egne data");
    expect(readme).toContain('"Org X"');
    expect(readme).toContain("Kollegers data er ikke med");
    expect(readme).not.toContain("alle data for organisationen");
    expect(readme).not.toMatch(/[—!]/);
    const json = JSON.parse(strFromU8(files["data.json"]));
    expect(json.metadata.format).toBe("timetrack-user-export");
    expect(Object.keys(files)).toContain("csv/tidsregistreringer.csv");
  });
});
