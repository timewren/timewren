import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "mahope",
  prefixKey: (k: string) => `timetrack/${k}`,
  s3: { send: vi.fn() },
}));

const { locateEmailAttachment } = await import("../attachment-location");

describe("locateEmailAttachment", () => {
  it("genkender den URL, ældre rækker har (getPublicUrl)", () => {
    expect(
      locateEmailAttachment(
        "https://hel1.your-objectstorage.com/mahope/timetrack/email-attachments/a1b2c3d4/0123456789ab-faktura_2026.pdf",
      ),
    ).toEqual({
      kind: "s3",
      key: "timetrack/email-attachments/a1b2c3d4/0123456789ab-faktura_2026.pdf",
    });
  });

  it("genkender den logiske nøgle nye rækker har", () => {
    expect(
      locateEmailAttachment("email-attachments/a1b2c3d4/0123456789ab"),
    ).toEqual({
      kind: "s3",
      key: "timetrack/email-attachments/a1b2c3d4/0123456789ab",
    });
  });

  it("genkender gamle nøgler med tomt filnavn efter bindestregen", () => {
    expect(
      locateEmailAttachment("email-attachments/a1b2c3d4/0123456789ab-"),
    ).toEqual({
      kind: "s3",
      key: "timetrack/email-attachments/a1b2c3d4/0123456789ab-",
    });
    expect(
      locateEmailAttachment(
        "https://hel1.your-objectstorage.com/mahope/timetrack/email-attachments/a1b2c3d4/0123456789ab-",
      ),
    ).toEqual({
      kind: "s3",
      key: "timetrack/email-attachments/a1b2c3d4/0123456789ab-",
    });
  });

  it("afviser URL'er og nøgler uden for vedhæftnings-mønstret", () => {
    for (const bad of [
      // andre mapper i samme bucket
      "https://hel1.your-objectstorage.com/mahope/timetrack/profile/user-1/1.webp",
      "https://hel1.your-objectstorage.com/mahope/timetrack/feedback/abc.png",
      // forkert præfiks / bucket-løse stier
      "https://hel1.your-objectstorage.com/mahope/other/email-attachments/a1b2c3d4/0123456789ab",
      "https://hel1.your-objectstorage.com/",
      // traversal og forkert form
      "email-attachments/../profile/user-1/1.webp",
      "email-attachments/a1b2c3d4/../0123456789ab",
      "email-attachments/a1b2c3d4/0123456789ab/extra",
      "email-attachments/XYZ/0123456789ab",
      "https://hel1.your-objectstorage.com/mahope/timetrack/email-attachments/a1b2c3d4/../../profile/x.webp",
      "http://",
    ]) {
      expect(locateEmailAttachment(bad)).toEqual({ kind: "invalid" });
    }
  });

  it("lader lokale stier gå videre til den eksisterende sti-kontrol", () => {
    for (const local of [
      "storage/email-attachments/abc/file.pdf",
      "/data/email-attachments/abc/file.pdf",
      "C:\\data\\x.pdf",
    ]) {
      expect(locateEmailAttachment(local)).toEqual({ kind: "local" });
    }
  });
});
