import { PutObjectCommand } from "@aws-sdk/client-s3";
import sanitizeHtml from "sanitize-html";
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
const objects = vi.hoisted(() => ({
  deleteAllVersions: vi.fn(),
  headObject: vi.fn(),
}));

vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "bucket",
  prefixKey: (k: string) => `timetrack/${k}`,
  s3: { send },
}));
vi.mock("@/lib/storage/objects", () => objects);

const {
  deleteFromS3,
  deleteTaskImageByUrl,
  newTaskImageKey,
  taskImageKeyFromSegments,
  taskImageKeyFromUrl,
  taskImageUrl,
  uploadToS3,
} = await import("../s3");

const UUID = "0b9c1f3e-6d2a-4c5b-8e7f-1a2b3c4d5e6f";
const KEY = `uploads/images/2026/10/${UUID}.jpg`;
const APP_URL = `/api/files/task-image/2026/10/${UUID}.jpg`;

describe("task-image nøgler og URL'er", () => {
  it("newTaskImageKey giver en gyldig nøgle uden filnavn", () => {
    const key = newTaskImageKey(new Date(2026, 9, 11));
    expect(key).toMatch(/^uploads\/images\/2026\/10\/[0-9a-f-]{36}\.jpg$/);
    expect(taskImageKeyFromUrl(taskImageUrl(key))).toBe(key);
  });

  it("taskImageUrl er en relativ app-URL, ikke en S3-URL", () => {
    expect(taskImageUrl(KEY)).toBe(APP_URL);
    expect(() => taskImageUrl("profile/user/1.webp")).toThrow();
  });

  it("taskImageKeyFromUrl accepterer kun vores egen app-URL", () => {
    expect(taskImageKeyFromUrl(APP_URL)).toBe(KEY);

    for (const bad of [
      // andre objekter i bucketen, som en bruger kunne lægge i en kommentar
      "https://mahope.hel1.your-objectstorage.com/timetrack/profile/u1/1.webp",
      `https://evil.example/timetrack/${KEY}`,
      `https://example.com${APP_URL}`,
      "/api/files/task-image/../../profile/u1/1.webp",
      `/api/files/task-image/2026/13/${UUID}.jpg`,
      `/api/files/task-image/2026/10/${UUID}.svg`,
      `${APP_URL}?x=1`,
      `${APP_URL}/extra`,
      "",
      null,
      42,
    ]) {
      expect(taskImageKeyFromUrl(bad)).toBeNull();
    }
  });

  it("taskImageKeyFromSegments afviser .., tomme og kodede segmenter", () => {
    expect(taskImageKeyFromSegments(["2026", "10", `${UUID}.jpg`])).toBe(KEY);

    for (const bad of [
      [],
      ["..", "..", "etc", "passwd"],
      ["2026", "10", ".."],
      ["2026", "10", ""],
      ["2026", "%2e%2e", `${UUID}.jpg`],
      ["2026", "10", `${UUID}.jpg/..`],
      ["2026\\10", `${UUID}.jpg`],
      ["2026", "10", "not-a-uuid.jpg"],
      ["2026", "10", `${UUID}.html`],
    ]) {
      expect(taskImageKeyFromSegments(bad)).toBeNull();
    }
  });

  it("en relativ app-URL overlever HTML-saniteringen i kommentarer", () => {
    // Samme indstillinger som taskComments.create/update. Kommentarbilleder
    // gemmes som relative URL'er, så saniteringen må ikke fjerne src.
    const clean = sanitizeHtml(`<p>x</p><img src="${APP_URL}" alt="a">`, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "span"]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        img: ["src", "alt", "width", "height"],
        span: ["class", "data-type", "data-id", "data-label"],
      },
      allowedSchemes: ["http", "https"],
    });
    expect(clean).toContain(`src="${APP_URL}"`);
  });
});

describe("uploadToS3", () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({});
  });

  it("uploader privat (ingen ACL) med præfikset nøgle og returnerer app-URL", async () => {
    const url = await uploadToS3(Buffer.from("x"), KEY, "image/jpeg", {
      "uploaded-by": "user-1",
      "org-id": "org-1",
    });

    expect(url).toBe(APP_URL);
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "bucket",
      Key: `timetrack/${KEY}`,
      ContentType: "image/jpeg",
      Metadata: { "uploaded-by": "user-1", "org-id": "org-1" },
    });
    expect(command.input).not.toHaveProperty("ACL");
    // Nøglen må ikke indeholde noget filnavn
    expect(command.input.Key).toMatch(/[0-9a-f-]{36}\.jpg$/);
  });

  it("afviser nøgler uden for task-image-formen uden at røre S3", async () => {
    await expect(
      uploadToS3(Buffer.from("x"), "profile/user-1/1.webp", "image/webp"),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sletning", () => {
  beforeEach(() => {
    objects.deleteAllVersions.mockReset();
    objects.headObject.mockReset();
  });

  it("deleteFromS3 sletter alle versioner af den fulde nøgle", async () => {
    await deleteFromS3(`timetrack/${KEY}`);
    expect(objects.deleteAllVersions).toHaveBeenCalledWith({
      key: `timetrack/${KEY}`,
    });
  });

  it("deleteTaskImageByUrl sletter kun egne billeder", async () => {
    objects.headObject.mockResolvedValue({
      metadata: { "uploaded-by": "user-1" },
    });

    expect(await deleteTaskImageByUrl(APP_URL, "user-1")).toBe(true);
    expect(objects.deleteAllVersions).toHaveBeenCalledWith({
      key: `timetrack/${KEY}`,
    });

    objects.deleteAllVersions.mockClear();
    expect(await deleteTaskImageByUrl(APP_URL, "user-2")).toBe(false);
    expect(objects.deleteAllVersions).not.toHaveBeenCalled();
  });

  it("deleteTaskImageByUrl rører ikke S3 for fremmede URL'er", async () => {
    const evil =
      "https://mahope.hel1.your-objectstorage.com/timetrack/profile/u1/1.webp";
    expect(await deleteTaskImageByUrl(evil, "user-1")).toBe(false);
    expect(objects.headObject).not.toHaveBeenCalled();
    expect(objects.deleteAllVersions).not.toHaveBeenCalled();
  });

  it("deleteTaskImageByUrl sletter intet hvis objektet mangler", async () => {
    objects.headObject.mockResolvedValue(null);
    expect(await deleteTaskImageByUrl(APP_URL, "user-1")).toBe(false);
    expect(objects.deleteAllVersions).not.toHaveBeenCalled();
  });
});
