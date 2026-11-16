import { PutObjectCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "bucket",
  prefixKey: (k: string) => `timetrack/${k}`,
  s3: { send },
}));

const { storeAttachments } = await import("../store-attachments");
const { locateEmailAttachment } = await import("../attachment-location");

const files = [
  {
    filename: "Kontrakt Hansen.pdf",
    contentType: "application/pdf",
    size: 9,
    content: Buffer.from("pdf-bytes"),
  },
  {
    filename: "logo.png",
    contentType: "image/png",
    size: 3,
    content: Buffer.from("png"),
  },
];

describe("storeAttachments (IMAP-sync)", () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
    vi.stubEnv("S3_ENDPOINT", "https://s3.example.test");
    vi.stubEnv("EMAIL_SYNC_STORE_ATTACHMENTS", "");
  });

  it("gemmer som standard kun metadata: intet S3-kald og ingen storagePath", async () => {
    const stored = await storeAttachments(files, "<msg-1@example.com>");

    expect(send).not.toHaveBeenCalled();
    expect(stored).toEqual([
      {
        filename: "Kontrakt Hansen.pdf",
        contentType: "application/pdf",
        size: 9,
      },
      { filename: "logo.png", contentType: "image/png", size: 3 },
    ]);
    for (const item of stored) {
      expect(item).not.toHaveProperty("storagePath");
      expect(item).not.toHaveProperty("content");
    }
  });

  it("en fejlet upload giver kun metadata for den fil og vælter ikke resten", async () => {
    vi.stubEnv("EMAIL_SYNC_STORE_ATTACHMENTS", "true");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    send.mockRejectedValueOnce(new Error("S3 nede")).mockResolvedValueOnce({});
    const stored = await storeAttachments(files, "<msg-1@example.com>");
    expect(send).toHaveBeenCalledTimes(2);
    expect(stored[0]).not.toHaveProperty("storagePath");
    expect(stored[1]).toHaveProperty("storagePath");
  });

  it("kun den præcise værdi 'true' slår upload til", async () => {
    for (const value of ["false", "0", "1", "yes", "TRUE", " true"]) {
      vi.stubEnv("EMAIL_SYNC_STORE_ATTACHMENTS", value);
      await storeAttachments(files, "<msg-1@example.com>");
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("med flaget til uploades privat uden filnavn i nøglen, og nøglen gemmes", async () => {
    vi.stubEnv("EMAIL_SYNC_STORE_ATTACHMENTS", "true");

    const stored = await storeAttachments(files, "<msg-1@example.com>");

    expect(send).toHaveBeenCalledTimes(2);
    for (const [command] of send.mock.calls) {
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).not.toHaveProperty("ACL");
      expect(command.input.Bucket).toBe("bucket");
      expect(command.input.Key).toMatch(
        /^timetrack\/email-attachments\/[0-9a-f]{8}\/[0-9a-f]{12}$/,
      );
      expect(command.input.Key).not.toMatch(/Kontrakt|Hansen|pdf|logo|png/i);
    }

    expect(stored[0]).toMatchObject({
      filename: "Kontrakt Hansen.pdf",
      size: 9,
    });
    // Den gemte nøgle kan slås op igen af downloadruten
    const location = locateEmailAttachment(stored[0].storagePath as string);
    expect(location).toEqual({
      kind: "s3",
      key: `timetrack/${stored[0].storagePath}`,
    });
  });

  it("med flaget til gemmes for store eller tomme filer kun som metadata", async () => {
    vi.stubEnv("EMAIL_SYNC_STORE_ATTACHMENTS", "true");

    const stored = await storeAttachments(
      [
        { ...files[0], size: 11 * 1024 * 1024 },
        { filename: "tom.txt", contentType: "text/plain", size: 0 },
      ],
      "<msg-2@example.com>",
    );

    expect(send).not.toHaveBeenCalled();
    expect(stored.every((s) => s.storagePath === undefined)).toBe(true);
  });

  it("med flaget til men uden S3 gemmes kun metadata", async () => {
    vi.stubEnv("EMAIL_SYNC_STORE_ATTACHMENTS", "true");
    vi.stubEnv("S3_ENDPOINT", "");

    const stored = await storeAttachments(files, "<msg-3@example.com>");

    expect(send).not.toHaveBeenCalled();
    expect(stored.every((s) => s.storagePath === undefined)).toBe(true);
  });

  it("returnerer tom liste uden vedhæftninger", async () => {
    expect(await storeAttachments([], "<msg-4@example.com>")).toEqual([]);
  });
});
