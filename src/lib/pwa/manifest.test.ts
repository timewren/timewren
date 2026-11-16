import { describe, expect, it } from "vitest";
import { getBrand } from "@/lib/brand";
import { buildManifest } from "./manifest";
import template from "./manifest.template.json";

describe("buildManifest", () => {
  it("TimeTrack: manifestet er den oprindelige skabelon, ordret", () => {
    const m = buildManifest(getBrand("timetrack"));
    expect(m).toEqual(template);
    expect(m.short_name).toBe("TimeTrack");
    expect(m.theme_color).toBe("#1E5B47");
    expect(m.icons.some((i) => i.src === "/icons/icon-192x192.png")).toBe(true);
  });

  it("TimeWren: eget navn, farve, ikoner og protokol, ingen TimeTrack-skærmbilleder", () => {
    const m = buildManifest(getBrand("timewren"));
    expect(m.name).toContain("TimeWren");
    expect(m.short_name).toBe("TimeWren");
    expect(m.theme_color).toBe("#3F5A3A");
    expect(m.screenshots).toEqual([]);
    expect(m.protocol_handlers[0].protocol).toBe("web+timewren");
    const all = JSON.stringify(m);
    expect(all).not.toContain("TimeTrack");
    expect(all).not.toContain("/icons/");
    expect(m.icons.map((i) => i.src)).toContain(
      "/brand/timewren/icon-maskable-512.png",
    );
  });
});
