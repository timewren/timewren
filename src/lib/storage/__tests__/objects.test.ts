import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "bucket",
  prefixKey: (k: string) => `timetrack/${k}`,
  s3: { send },
}));

const { deleteAllVersions, getObjectStream, headObject } = await import(
  "../objects"
);

const KEY = "timetrack/uploads/images/2026/10/a.jpg";

type Version = { Key: string; VersionId: string };

/**
 * Simulerer en versioneret bucket med to listesider. Siden afhænger af
 * KeyMarker, så et fejlende markers-flow giver forkerte svar.
 */
function mockVersionedBucket(pages: {
  first: { Versions?: Version[]; DeleteMarkers?: Version[] };
  second?: { Versions?: Version[]; DeleteMarkers?: Version[] };
}) {
  send.mockImplementation(async (command: unknown) => {
    if (command instanceof ListObjectVersionsCommand) {
      const input = command.input;
      if (!input.KeyMarker) {
        return {
          ...pages.first,
          IsTruncated: Boolean(pages.second),
          NextKeyMarker: pages.second ? KEY : undefined,
          NextVersionIdMarker: pages.second ? "v2" : undefined,
        };
      }
      expect(input.KeyMarker).toBe(KEY);
      expect(input.VersionIdMarker).toBe("v2");
      return { ...pages.second, IsTruncated: false };
    }
    return {};
  });
}

function deletedVersions() {
  return send.mock.calls
    .map(([cmd]) => cmd)
    .filter(
      (cmd): cmd is DeleteObjectsCommand => cmd instanceof DeleteObjectsCommand,
    )
    .flatMap((cmd) =>
      (cmd.input.Delete?.Objects ?? []).map((o) => ({
        Key: o.Key,
        VersionId: o.VersionId,
      })),
    );
}

describe("deleteAllVersions", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("sletter alle versioner og delete markers af den præcise nøgle (på tværs af sider)", async () => {
    mockVersionedBucket({
      first: {
        Versions: [
          { Key: KEY, VersionId: "v1" },
          { Key: KEY, VersionId: "v2" },
          // Samme præfiks, anden nøgle: må ikke røres
          { Key: `${KEY}.bak`, VersionId: "other-1" },
        ],
      },
      second: {
        Versions: [{ Key: KEY, VersionId: "v3" }],
        DeleteMarkers: [
          { Key: KEY, VersionId: "dm1" },
          { Key: `${KEY}2`, VersionId: "other-2" },
        ],
      },
    });

    const count = await deleteAllVersions({ key: KEY });

    expect(count).toBe(4);
    expect(deletedVersions()).toEqual([
      { Key: KEY, VersionId: "v1" },
      { Key: KEY, VersionId: "v2" },
      { Key: KEY, VersionId: "v3" },
      { Key: KEY, VersionId: "dm1" },
    ]);
  });

  it("lister med præcis nøgle som præfiks i den rigtige bucket", async () => {
    mockVersionedBucket({ first: { Versions: [] } });

    await deleteAllVersions({ key: KEY });

    const list = send.mock.calls[0][0] as ListObjectVersionsCommand;
    expect(list.input).toMatchObject({ Bucket: "bucket", Prefix: KEY });
  });

  it("præfiks-tilstand sletter alt under præfikset men ikke søsterpræfikset", async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListObjectVersionsCommand) {
        return {
          Versions: [
            { Key: "timetrack/profile/user1/1.webp", VersionId: "a" },
            { Key: "timetrack/profile/user1/2.webp", VersionId: "b" },
            { Key: "timetrack/profile/user10/1.webp", VersionId: "c" },
          ],
          IsTruncated: false,
        };
      }
      return {};
    });

    const count = await deleteAllVersions({
      prefix: "timetrack/profile/user1/",
    });

    expect(count).toBe(2);
    expect(deletedVersions().map((d) => d.VersionId)).toEqual(["a", "b"]);
  });

  it("afviser tomme nøgler og præfikser uden afsluttende skråstreg", async () => {
    await expect(deleteAllVersions({ key: "" })).rejects.toThrow();
    await expect(
      deleteAllVersions({ prefix: "timetrack/profile/user1" }),
    ).rejects.toThrow(/ende på/);
    expect(send).not.toHaveBeenCalled();
  });

  it("kaster hvis DeleteObjects melder fejl pr. nøgle", async () => {
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListObjectVersionsCommand) {
        return {
          Versions: [{ Key: KEY, VersionId: "v1" }],
          IsTruncated: false,
        };
      }
      if (command instanceof DeleteObjectsCommand) {
        return {
          Errors: [{ Key: KEY, VersionId: "v1", Code: "AccessDenied" }],
        };
      }
      return {};
    });
    await expect(deleteAllVersions({ key: KEY })).rejects.toThrow(
      /AccessDenied/,
    );
  });

  it("kaster videre hvis listen fejler, så delvis sletning ikke forbliver tavs", async () => {
    send.mockRejectedValue(new Error("AccessDenied"));
    await expect(deleteAllVersions({ key: KEY })).rejects.toThrow(
      "AccessDenied",
    );
  });
});

describe("headObject / getObjectStream", () => {
  beforeEach(() => {
    send.mockReset();
  });

  it("headObject returnerer metadata og null for manglende objekter", async () => {
    send.mockResolvedValueOnce({
      ContentType: "image/jpeg",
      ContentLength: 12,
      Metadata: { "uploaded-by": "user-1" },
    });
    expect(await headObject(KEY)).toEqual({
      contentType: "image/jpeg",
      contentLength: 12,
      metadata: { "uploaded-by": "user-1" },
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);

    send.mockRejectedValueOnce(
      Object.assign(new Error("nf"), { name: "NotFound" }),
    );
    expect(await headObject(KEY)).toBeNull();

    send.mockRejectedValueOnce(new Error("boom"));
    await expect(headObject(KEY)).rejects.toThrow("boom");
  });

  it("getObjectStream streamer kroppen og returnerer null ved NoSuchKey", async () => {
    const stream = new ReadableStream<Uint8Array>();
    send.mockResolvedValueOnce({
      Body: { transformToWebStream: () => stream },
      ContentType: "image/jpeg",
      ContentLength: 3,
      Metadata: {},
    });
    const res = await getObjectStream(KEY);
    expect(res?.stream).toBe(stream);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);

    send.mockRejectedValueOnce(
      Object.assign(new Error("nope"), { name: "NoSuchKey" }),
    );
    expect(await getObjectStream(KEY)).toBeNull();
  });
});
