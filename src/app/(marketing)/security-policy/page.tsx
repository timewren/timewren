import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sikkerhedspolitik",
  description:
    "Læs om TimeTracks sikkerhedspolitik, databeskyttelse og retningslinjer for ansvarlig rapportering af sårbarheder.",
};

export default function SecurityPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold text-gray-900">Sikkerhedspolitik</h1>
      <p className="mt-4 text-gray-600">Sidst opdateret: 17. april 2026</p>

      <div className="mt-8 space-y-8 text-gray-700">
        <section>
          <h2 className="text-xl font-semibold text-gray-900">
            Ansvarlig rapportering
          </h2>
          <p className="mt-2">
            Vi tager sikkerheden af TimeTrack og vores brugeres data alvorligt.
            Hvis du opdager en sikkerhedssårbarhed, beder vi dig om at
            rapportere den ansvarligt, så vi kan rette den før den bliver
            udnyttet.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900">
            Sådan rapporterer du
          </h2>
          <ul className="mt-2 list-disc space-y-2 pl-6">
            <li>
              Send en email til{" "}
              <a
                href="mailto:security@timetrack.dk"
                className="font-medium text-brand-600 hover:underline"
              >
                security@timetrack.dk
              </a>
            </li>
            <li>Beskriv sårbarheden så detaljeret som muligt</li>
            <li>Inkludér trin til at reproducere problemet</li>
            <li>Angiv hvilken type sårbarhed det drejer sig om</li>
            <li>Vedhæft eventuelt screenshots eller proof-of-concept</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900">
            Vores forpligtelser
          </h2>
          <ul className="mt-2 list-disc space-y-2 pl-6">
            <li>Vi bekræfter modtagelsen inden for 48 timer</li>
            <li>Vi giver en vurdering af sårbarheden inden for 5 hverdage</li>
            <li>Vi løser kritiske sårbarheder inden for 7 dage</li>
            <li>Vi holder dig opdateret om status på din rapportering</li>
            <li>
              Vi krediterer dig (med dit samtykke) når rettelsen er udrullet
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900">
            Hvad er i scope
          </h2>
          <ul className="mt-2 list-disc space-y-2 pl-6">
            <li>timetrack.dk og alle subdomæner</li>
            <li>TimeTrack API (api/v1/*)</li>
            <li>TimeTrack browser-extension</li>
            <li>Autentificering og autorisering</li>
            <li>Datalækager og uautoriseret adgang</li>
            <li>Cross-site scripting (XSS) og injection</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900">
            Hvad er IKKE i scope
          </h2>
          <ul className="mt-2 list-disc space-y-2 pl-6">
            <li>Social engineering / phishing-angreb mod medarbejdere</li>
            <li>Denial-of-service (DoS/DDoS) angreb</li>
            <li>Brute-force angreb mod login</li>
            <li>Selvrapporterede sårbarheder uden teknisk evidence</li>
            <li>Sårbarheder i tredjepartsservices vi ikke kontrollerer</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900">Safe Harbor</h2>
          <p className="mt-2">
            Vi vil ikke forfølge juridiske skridt mod sikkerhedsforskere der
            handler i god tro og følger denne politik. Vi anser
            sikkerhedsforskning udført i overensstemmelse med denne politik for
            at være autoriseret aktivitet.
          </p>
        </section>
      </div>
    </main>
  );
}
