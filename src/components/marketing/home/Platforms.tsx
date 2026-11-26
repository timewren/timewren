import Image from "next/image";
import Link from "next/link";
import { AppStoreBadge } from "@/components/marketing/AppStoreBadge";
import { mk } from "@/components/marketing/mk";
import { playStoreUrl } from "@/lib/app-stores";

/** Rigtige skærmbilleder fra appen (opdigtede testdata). */
const COMPUTER = {
  src: "/screenshots/marketing/tidsregistrering.webp",
  width: 1600,
  height: 1112,
  alt: "Tidsregistreringen i TimeTrack med dagens poster, fakturerbar tid og timer trukket fra klippekort.",
};

const TELEFON = {
  src: "/screenshots/marketing/mobil-hjem.webp",
  width: 780,
  height: 1688,
  alt: "TimeTrack på en telefon med feltet til at skrive tid ind og en liste over projekter, timeren kan startes på.",
};

type Platform = { name: string; text: string; soon?: boolean; href?: string };

function platforms(): Platform[] {
  const android = playStoreUrl("timetrack");
  return [
    {
      name: "iPhone og iPad",
      text: "Appen ligger i App Store. Start og stop timeren, og skriv tid ind for tidligere dage.",
    },
    { name: "Mac", text: "Desktop-appen til macOS 11 eller nyere." },
    { name: "Windows", text: "Desktop-appen til Windows 10 eller nyere." },
    {
      name: "Browseren",
      text: "Webappen virker i alle moderne browsere, også på Linux og Chromebook, og kan lægges på telefonens hjemmeskærm.",
    },
    {
      name: "Browserudvidelsen",
      text: "Til Chrome, Edge og de andre Chromium-browsere. Start timeren fra den fane, du arbejder i.",
    },
    android
      ? { name: "Android", text: "Appen ligger i Google Play.", href: android }
      : {
          name: "Android",
          text: "Appen kommer i Google Play. Indtil da virker webappen på telefonen.",
          soon: true,
        },
  ];
}

/**
 * "På alle dine enheder": platformene som rækker (ikke ens ikon-kort) og
 * appen på computer og telefon som rigtige skærmbilleder. Android viser
 * "Kommer snart" uden link, til Play-listen er offentlig (`playLive`).
 */
export function Platforms() {
  return (
    <section aria-labelledby="enheder-heading" className={mk.section}>
      <div
        className={`${mk.wrap} grid items-start gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16 [&>*]:min-w-0`}
      >
        <div>
          <h2 id="enheder-heading" className={mk.h2}>
            På alle dine enheder
          </h2>
          <p className={`${mk.lead} mt-5 max-w-xl`}>
            Én konto på telefonen, computeren og i browseren. Start timeren på
            telefonen, og stop den på computeren, når du er færdig.
          </p>
          <ul className="mt-10 border-t border-tt-streg">
            {platforms().map((p) => (
              <li
                key={p.name}
                className="grid gap-1 border-b border-tt-streg py-4 sm:grid-cols-[170px_1fr] sm:gap-6"
              >
                <span className="font-semibold text-tt-blaek">
                  {p.name}
                  {p.soon ? (
                    <span className="mt-1 block w-fit rounded-full border border-tt-kant px-2 py-px text-[13px] font-medium text-tt-graa">
                      Kommer snart
                    </span>
                  ) : null}
                </span>
                <span className="text-[15px] leading-relaxed text-tt-graa">
                  {p.text}
                  {p.href ? (
                    <>
                      {" "}
                      <a href={p.href} className={mk.link}>
                        Åbn i Google Play
                      </a>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-4">
            <Link href="/download" className={mk.btnSecondary}>
              Hent appen til din enhed
            </Link>
            <AppStoreBadge brand="timetrack" height={44} />
          </div>
          <p className={`${mk.fine} mt-5`}>
            Alle apps er med i alle planer, også Gratis.
          </p>
        </div>

        <figure className="relative pb-16 sm:pb-20">
          <div className={mk.shot}>
            <Image
              src={COMPUTER.src}
              width={COMPUTER.width}
              height={COMPUTER.height}
              alt={COMPUTER.alt}
              className="h-auto w-full"
              sizes="(min-width: 1152px) 560px, (min-width: 1024px) 50vw, 100vw"
            />
          </div>
          <div className="absolute right-3 bottom-0 w-[120px] overflow-hidden rounded-[20px] border-[5px] border-tt-blaek bg-tt-blaek sm:right-8 sm:w-[150px]">
            <Image
              src={TELEFON.src}
              width={TELEFON.width}
              height={TELEFON.height}
              alt={TELEFON.alt}
              className="h-auto w-full"
              sizes="150px"
            />
          </div>
          <figcaption className="mt-5 max-w-[calc(100%-150px)] text-[13px] text-tt-graa sm:max-w-[calc(100%-190px)]">
            Tidsregistreringen på computeren og forsiden på telefonen, med
            opdigtede testdata.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
