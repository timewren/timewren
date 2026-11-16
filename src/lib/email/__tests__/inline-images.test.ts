import { describe, expect, it, vi } from "vitest";
import { extractInlineImages, MAX_INLINE_IMAGE_BYTES } from "../inline-images";

const PNG_B64 = Buffer.from("fake-png-bytes").toString("base64");

describe("extractInlineImages", () => {
  it("erstatter data:-billeder med cid-referencer og returnerer dem som vedhæftninger", () => {
    const { html, attachments } = extractInlineImages(
      `<p>Hej</p><img alt="a" src="data:image/png;base64,${PNG_B64}" width="10"><img src='data:image/jpeg;base64,${PNG_B64}'>`,
    );

    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      contentType: "image/png",
      filename: "billede-1.png",
    });
    expect(attachments[1]).toMatchObject({
      contentType: "image/jpeg",
      filename: "billede-2.jpg",
    });
    expect(attachments[0].content.toString()).toBe("fake-png-bytes");
    expect(attachments[0].contentId).not.toBe(attachments[1].contentId);

    expect(html).toContain(`src="cid:${attachments[0].contentId}"`);
    expect(html).toContain(`src='cid:${attachments[1].contentId}'`);
    expect(html).not.toContain("data:image");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("lader almindelige billeder og html uden data:-billeder være", () => {
    const input = '<p>Hej</p><img src="https://example.com/a.png">';
    const { html, attachments } = extractInlineImages(input);
    expect(html).toBe(input);
    expect(attachments).toEqual([]);
  });

  it("fjerner svg og tomme billeder frem for at videresende dem", () => {
    const { html, attachments } = extractInlineImages(
      `<img src="data:image/svg+xml;base64,${PNG_B64}"><img src="data:image/png;base64,====">`,
    );
    expect(attachments).toEqual([]);
    expect(html.match(/\[Indlejret billede fjernet\]/g)).toHaveLength(2);
    expect(html).not.toContain("<img");
  });

  it("afkoder ikke billeder der er over budgettet", () => {
    const spy = vi.spyOn(Buffer, "from");
    const huge = "A".repeat(Math.ceil((MAX_INLINE_IMAGE_BYTES * 4) / 3) + 8);
    const { attachments } = extractInlineImages(
      `<img src="data:image/png;base64,${huge}">`,
    );
    expect(attachments).toHaveLength(0);
    expect(spy).not.toHaveBeenCalledWith(huge, "base64");
    spy.mockRestore();
  });

  it("holder det samlede loft og erstatter overskydende billeder med en placeholder", () => {
    const big = Buffer.alloc(MAX_INLINE_IMAGE_BYTES - 10).toString("base64");
    const { html, attachments } = extractInlineImages(
      `<img src="data:image/png;base64,${big}"><img src="data:image/png;base64,${big}">`,
    );
    expect(attachments).toHaveLength(1);
    expect(html).toContain("[Indlejret billede fjernet]");
  });
});
