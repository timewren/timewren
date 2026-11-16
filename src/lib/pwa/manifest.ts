import { brand as activeBrand, type Brand } from "@/lib/brand";
import template from "./manifest.template.json";

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

/**
 * PWA-manifestet for et brand (#968). Skabelonen er TimeTracks oprindelige
 * manifest; for TimeTrack er resultatet uændret. TimeWren får eget navn,
 * ikoner og farve, og undlader TimeTracks skærmbilleder.
 */
export function buildManifest(b: Brand = activeBrand) {
  if (b.id === "timetrack") return template;

  const iconMap: Record<string, string> = {
    "/icons/icon-192x192.png": b.logo.icon192,
    "/icons/icon-512x512.png": b.logo.icon512,
    "/icons/icon-maskable-192x192.png": b.logo.iconMaskable192,
    "/icons/icon-maskable-512x512.png": b.logo.iconMaskable512,
  };
  const mapIcon = (i: ManifestIcon): ManifestIcon | null => {
    const src = iconMap[i.src];
    return src ? { ...i, src } : null;
  };

  return {
    ...template,
    name: `${b.name} - Tid til det der tæller`,
    short_name: b.shortName,
    description: b.description,
    theme_color: b.themeColor,
    icons: (template.icons as ManifestIcon[])
      .map(mapIcon)
      .filter((i): i is ManifestIcon => i !== null),
    screenshots: [],
    shortcuts: template.shortcuts.map((s) => ({
      ...s,
      icons: (s.icons as ManifestIcon[])
        .map(mapIcon)
        .filter((i): i is ManifestIcon => i !== null),
    })),
    protocol_handlers: [
      { protocol: `web+${b.id}`, url: "/dashboard?action=%s" },
    ],
  };
}
