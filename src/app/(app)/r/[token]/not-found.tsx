import { getTranslations } from "next-intl/server";
import { LeveretAfTimeTrack } from "@/components/LeveretAfTimeTrack";

export async function generateMetadata() {
  const t = await getTranslations("portal.sharedReport");
  return {
    title: t("notFoundTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * Ugyldigt eller tilbagekaldt rapport-link. Læseren er afsenderens kunde,
 * ikke en TimeTrack-bruger, så siden peger tilbage til afsenderen og ikke
 * ind i appen.
 */
export default async function ReportNotFound() {
  const t = await getTranslations("portal.sharedReport");
  return (
    <main className="flex min-h-screen flex-col bg-tt-flade px-4 py-16 text-tt-blaek">
      <div className="mx-auto w-full max-w-xl flex-1">
        <p className="text-sm font-medium text-tt-graa">{t("notFoundLabel")}</p>
        <h1 className="mt-2 text-3xl font-bold leading-[1.1] tracking-[-0.035em] sm:text-4xl">
          {t("notFoundTitle")}
        </h1>
        <p className="mt-6 max-w-[60ch] text-lg leading-relaxed text-tt-graa">
          {t("notFoundText")}
        </p>
      </div>
      <LeveretAfTimeTrack className="mt-16" />
    </main>
  );
}
