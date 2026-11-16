import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Image, { getImageProps } from "next/image";
import type { Locale } from "@/lib/brands/registry";
import {
  resolveScreen,
  type ScreenName,
  webpSize,
} from "@/lib/brands/timewren-landing";

/*
 * Screenshots pr. sprog (public/brand/timewren/screens/<locale>/<navn>.webp)
 * med en-fallback, se resolveScreen. Siderne bygges statisk på serveren, så
 * filerne slås op i public/ her; findes ingen fil, vises intet billede.
 */

const PUBLIC_DIR = join(process.cwd(), "public");
const sizeCache = new Map<string, { width: number; height: number }>();

const exists = (publicPath: string) => existsSync(join(PUBLIC_DIR, publicPath));

/** Billedets egne mål, så rammen passer og intet hopper (CLS). */
function sizeOf(publicPath: string) {
  let size = sizeCache.get(publicPath);
  if (!size) {
    size = webpSize(readFileSync(join(PUBLIC_DIR, publicPath))) ?? {
      width: 2880,
      height: 1800,
    };
    sizeCache.set(publicPath, size);
  }
  return size;
}

export function screenSrc(name: ScreenName, locale: Locale): string | null {
  return resolveScreen(name, locale, exists);
}

/** Fuld bredde i .wrap: 72rem minus 2 × 1.25rem gutter. */
const WIDE = "(min-width: 72rem) 69.5rem, calc(100vw - 2.5rem)";
/** Billedkolonnen i funktionsgennemgangen: 7/12 af bredden minus 4rem fra 60rem. */
const HALF =
  "(min-width: 72rem) 39rem, (min-width: 60rem) 58vw, calc(100vw - 2.5rem)";
/** Telefonbilledet vises højst 20rem bredt. */
const PHONE = "(min-width: 24rem) 20rem, calc(100vw - 2.5rem)";

export function Screen({
  name,
  locale,
  alt,
  half = false,
  preload = false,
  mobile,
  className,
}: {
  name: ScreenName;
  locale: Locale;
  alt: string;
  /** Står i en halv kolonne (funktionsgennemgangen). */
  half?: boolean;
  /** Over folden: hent med det samme. Ellers lazy. */
  preload?: boolean;
  /** Andet billede på smalle skærme (fx mobile-dashboard), hvis det findes. */
  mobile?: ScreenName;
  className?: string;
}) {
  const src = screenSrc(name, locale);
  if (!src) return null;
  const { width, height } = sizeOf(src);
  const sizes = half ? HALF : WIDE;
  const loading = preload ? undefined : ("lazy" as const);
  const mobileSrc = mobile ? screenSrc(mobile, locale) : null;
  const cls = className ? `shot ${className}` : "shot";

  if (!mobileSrc) {
    return (
      <div className={cls}>
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          preload={preload}
          loading={loading}
        />
      </div>
    );
  }

  // Art direction: telefonbilledet under 40rem, skrivebordet derover.
  const m = sizeOf(mobileSrc);
  const {
    props: { srcSet: mobileSet },
  } = getImageProps({
    alt,
    src: mobileSrc,
    width: m.width,
    height: m.height,
    sizes: PHONE,
  });
  const { props: desktop } = getImageProps({
    alt,
    src,
    width,
    height,
    sizes,
    // getImageProps lægger ingen preload-link ind og gør en manglende
    // loading til lazy, så eager og høj prioritet sættes selv over folden.
    fetchPriority: preload ? "high" : undefined,
    loading: preload ? "eager" : "lazy",
  });
  return (
    <div className={`${cls} has-mobile`}>
      <picture>
        <source
          media="(max-width: 40rem)"
          srcSet={mobileSet}
          sizes={PHONE}
          width={m.width}
          height={m.height}
        />
        {/* biome-ignore lint/a11y/useAltText: alt kommer fra getImageProps */}
        <img {...desktop} />
      </picture>
    </div>
  );
}
