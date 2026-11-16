import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { getClientMessages } from "@/i18n/server";
import { db } from "@/lib/db";
import { portalBranding } from "@/lib/db/schema";
import { ThemeProvider } from "@/providers/theme-provider";
import { TRPCProvider } from "@/providers/trpc-provider";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal");
  const headersList = await headers();
  const customDomain = headersList.get("x-custom-domain");

  if (customDomain) {
    const branding = await db.query.portalBranding.findFirst({
      where: and(
        eq(portalBranding.customDomain, customDomain.toLowerCase()),
        eq(portalBranding.customDomainVerified, true),
      ),
    });

    if (branding?.brandName) {
      return {
        title: branding.brandName,
        description: t("metaBranded", { name: branding.brandName }),
      };
    }
  }

  return {
    title: t("title"),
    description: t("metaDescription"),
  };
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider messages={await getClientMessages("portal")}>
      <TRPCProvider>
        <ThemeProvider>
          <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {children}
          </div>
        </ThemeProvider>
      </TRPCProvider>
    </NextIntlClientProvider>
  );
}
