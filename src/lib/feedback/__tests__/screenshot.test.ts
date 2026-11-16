import { describe, expect, it } from "vitest";
import { decodeScreenshotDataUrl, MAX_SCREENSHOT_BYTES } from "../screenshot";

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function pngDataUrl(extraBytes = 16): string {
  const buf = Buffer.concat([PNG_HEADER, Buffer.alloc(extraBytes, 1)]);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

describe("decodeScreenshotDataUrl", () => {
  it("dekoder en gyldig PNG data-url til buffer", () => {
    const buf = decodeScreenshotDataUrl(pngDataUrl());
    expect(buf.subarray(0, 8).equals(PNG_HEADER)).toBe(true);
  });

  it("afviser forkert prefix", () => {
    expect(() =>
      decodeScreenshotDataUrl("data:image/jpeg;base64,AAAA"),
    ).toThrow(/PNG/);
  });

  it("afviser data der ikke er PNG (magic bytes)", () => {
    const fake = Buffer.alloc(20, 7).toString("base64");
    expect(() =>
      decodeScreenshotDataUrl(`data:image/png;base64,${fake}`),
    ).toThrow(/PNG/);
  });

  it("afviser for store screenshots", () => {
    const big = Buffer.concat([
      PNG_HEADER,
      Buffer.alloc(MAX_SCREENSHOT_BYTES, 1),
    ]).toString("base64");
    expect(() =>
      decodeScreenshotDataUrl(`data:image/png;base64,${big}`),
    ).toThrow(/for stort/);
  });
});
