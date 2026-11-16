"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DpaStatusResponse } from "@/app/api/dpa/status/route";
import { formatDanishDateTime } from "@/lib/enterprise/dpa/format";

/**
 * Download-knapper på /databehandleraftale. Siden er statisk; kun denne ø
 * spørger /api/dpa/status, om den besøgende er ejer eller administrator, og
 * viser i så fald den udfyldte PDF. Marketingsiden er altid lys, så farverne
 * er faste (brand-600 = #1E5B47) og skifter ikke med .dark.
 */

const primary =
  "inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
const secondary =
  "inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#8A918D] bg-white px-4 py-2 text-sm font-semibold text-[#1A1D1C] hover:bg-[#F2F3F0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";
const link =
  "font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800";

export function DpaPdfActions() {
  const [status, setStatus] = useState<DpaStatusResponse | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/dpa/status", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: DpaStatusResponse | null) => {
        if (alive) setStatus(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const isAdmin = status?.viewer === "admin";

  return (
    <div
      id="download"
      className="rounded-xl border border-[#DFE2DE] p-5 sm:p-6"
    >
      <h2 className="text-lg font-semibold text-[#1A1D1C]">Download aftalen</h2>
      <p className="mt-1 text-sm leading-relaxed text-[#5F6663]">
        PDF'en har samme tekst som her på siden og er underskrevet elektronisk
        af TimeTrack som databehandler.
        {isAdmin
          ? " Den tomme udgave har felter til Kunden, som kan udfyldes i hånden."
          : " Feltet til Kunden står tomt, så du kan udfylde det."}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {isAdmin && (
          <a href="/api/dpa/pdf/udfyldt" className={primary} download>
            <Download className="h-4 w-4" aria-hidden />
            Download udfyldt PDF
          </a>
        )}
        <a
          href="/databehandleraftale/pdf"
          className={isAdmin ? secondary : primary}
          download
        >
          <Download className="h-4 w-4" aria-hidden />
          {isAdmin ? "Download tom PDF" : "Download som PDF"}
        </a>
      </div>

      {isAdmin && (
        <p className="mt-3 text-sm leading-relaxed text-[#1A1D1C]">
          Den udfyldte PDF har jeres navn og CVR fra Indstillinger &gt;
          Virksomhedsprofil.{" "}
          {status.acceptance ? (
            <>
              I accepterede version {status.acceptance.version} den{" "}
              {formatDanishDateTime(new Date(status.acceptance.acceptedAt))}, og
              accepten står i PDF'en.
            </>
          ) : (
            <>
              Jeres organisation har ikke accepteret version {status.version}{" "}
              endnu. Det kan du gøre under{" "}
              <Link
                href="/dashboard/settings/gdpr#databehandleraftale"
                className={link}
              >
                Indstillinger &gt; GDPR &amp; Databeskyttelse
              </Link>
              .
            </>
          )}
        </p>
      )}
      {status?.viewer === "anonymous" && (
        <p className="mt-3 text-sm leading-relaxed text-[#5F6663]">
          Er du ejer eller administrator i TimeTrack,{" "}
          <Link href="/login?redirect=/databehandleraftale" className={link}>
            log ind
          </Link>{" "}
          for at hente aftalen udfyldt med jeres navn og CVR og acceptere den
          elektronisk.
        </p>
      )}
      {status?.viewer === "admin-2fa" && (
        <p className="mt-3 text-sm leading-relaxed text-[#5F6663]">
          Jeres organisation kræver totrinsbekræftelse for administratorer. Slå
          det til under{" "}
          <Link href="/dashboard/settings/security" className={link}>
            Indstillinger &gt; Sikkerhed &amp; Login
          </Link>
          , så kan du hente den udfyldte aftale.
        </p>
      )}
      {(status?.viewer === "member" || status?.viewer === "no-org") && (
        <p className="mt-3 text-sm leading-relaxed text-[#5F6663]">
          Den udfyldte aftale kan hentes af ejere og administratorer i jeres
          organisation.
        </p>
      )}
    </div>
  );
}
