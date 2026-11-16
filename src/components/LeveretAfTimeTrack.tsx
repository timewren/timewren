"use client";

import { useBrand } from "@/components/BrandContext";
import { BrandIcon } from "@/components/Logo";
import { useSafeTranslations } from "@/components/ui/use-safe-translations";
import daBranding from "@/i18n/messages/da/branding.json";
import { brand as buildBrand } from "@/lib/brand";
import { appUrl, marketingUrl } from "@/lib/config";
import { isMarketingEnabled } from "@/lib/marketing-guard";

/**
 * Diskret afsender-linje på flader, som brugerens kunder ser (kundeportal,
 * delt rapport). Kundens eget brand står øverst; produktnavnet står kun småt
 * nederst (docs/BRAND.md → Kundeportalen: hvem ejer den).
 */
export function LeveretAfTimeTrack({ className = "" }: { className?: string }) {
  const t = useSafeTranslations("branding", daBranding);
  // Hostens brand: på timewren.com står TimeWren, og linket går til hostens
  // egen forside (marketing-URL'en er build-brandets).
  const brand = useBrand();
  const home =
    brand.id !== buildBrand.id
      ? "/"
      : isMarketingEnabled()
        ? marketingUrl()
        : appUrl("/");
  return (
    <p
      className={`flex items-center justify-center gap-1.5 text-xs text-tt-graa ${className}`}
    >
      <BrandIcon size={14} brand={brand} />
      <span>
        {t.rich("deliveredBy", {
          name: brand.name,
          link: (chunks) => (
            <a
              href={home}
              className="font-medium text-tt-graa underline-offset-2 hover:text-tt-blaek hover:underline"
            >
              {chunks}
            </a>
          ),
        })}
      </span>
    </p>
  );
}
