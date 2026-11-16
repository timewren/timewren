import { Link, Text } from "@react-email/components";
import { getBrand } from "@/lib/brand";
import { MAIL_APP_URL } from "./brand";
import { EmailKlippekort } from "./EmailShell";
import {
  PersonalBox,
  PersonalButton,
  PersonalEmailLayout,
  personalBoxItem,
  personalLink,
  personalText,
} from "./PersonalEmailLayout";

/**
 * UDKAST, ikke koblet på nogen afsendelse. Mads' mail til alle brugere om
 * rebrandet og den lovpligtige varsling af databehandleraftale 1.1 og de
 * nye vilkår (vilkårene punkt 11: mindst 30 dages varsel på mail). Tekst og
 * beslutninger: docs/brand/udkast/rebrand-mail.md.
 */

export const REBRAND_VARSEL_SUBJECT =
  "Nyt udseende og opdaterede vilkår i TimeTrack";

/** Ønsket afsender (PERSONAL_FROM_EMAIL siger "Mads Holst Jensen"). */
export const REBRAND_VARSEL_FROM = `Mads fra TimeTrack <${getBrand("timetrack").contactEmail}>`;

/** Antal kalenderdage fra afsendelse til ændringerne gælder. */
export const REBRAND_VARSEL_DAGE = 30;

const TERMS_URL = "https://timetrack.dk/terms";
const TERMS_LUKNING_URL = "https://timetrack.dk/terms#lukning";
const DPA_URL = "https://timetrack.dk/databehandleraftale";

/**
 * Datoen ændringerne gælder fra: afsendelsesdagen i dansk tid plus 30
 * kalenderdage. Regnes på kalenderdatoen, ikke i millisekunder, så skiftet
 * fra sommertid (sidste søndag i oktober) ikke flytter datoen en dag.
 */
export function rebrandVarselIkrafttraedelse(sentAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(sentAt);
  const del = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const dato = new Date(
    Date.UTC(del("year"), del("month") - 1, del("day") + REBRAND_VARSEL_DAGE),
  );
  return new Intl.DateTimeFormat("da-DK", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dato);
}

export function rebrandVarselPreview(dato: string): string {
  return `De nye vilkår og databehandleraftalen gælder for dig fra ${dato}. TimeTrack har også fået nyt logo og klippekort med huller.`;
}

interface RebrandVarselEmailProps {
  /** Fornavn, hvis det kendes. Ellers står der bare "Hej". */
  userName?: string;
  /** Afsendelsestidspunkt; [DATO] i teksten er denne dag + 30 dage. */
  sentAt: Date;
  /**
   * Sæt kun til true, når extension, desktop- og mobilappen med hulkortet
   * er udgivet. Indtil da nævner mailen kun web-appen og kundeportalen.
   */
  appsUdgivet?: boolean;
}

export function RebrandVarselEmail({
  userName,
  sentAt,
  appsUdgivet = false,
}: RebrandVarselEmailProps) {
  const dato = rebrandVarselIkrafttraedelse(sentAt);
  const settingsUrl = `${MAIL_APP_URL}/dashboard/settings`;

  return (
    <PersonalEmailLayout
      preview={rebrandVarselPreview(dato)}
      showReplyCta={false}
      footerNote="Du modtager denne mail, fordi du har en konto på TimeTrack, og ændringer i vilkårene skal varsles på mail."
    >
      <Text style={personalText}>{userName ? `Hej ${userName},` : "Hej,"}</Text>

      <PersonalBox>
        <Text style={{ ...personalBoxItem, fontWeight: 700 }}>
          Kort fortalt
        </Text>
        <Text style={personalBoxItem}>
          • Vilkårene og databehandleraftalen er opdateret og gælder fra {dato}.
          Du skal ikke gøre noget.
        </Text>
        <Text style={personalBoxItem}>
          • TimeTrack har fået nyt udseende og en ny Hjem-side, hvor du bare
          skriver, hvad du har lavet.
        </Text>
        <Text style={personalBoxItem}>• Timeren er blevet mere stabil.</Text>
        <Text style={{ ...personalBoxItem, margin: 0 }}>
          • Apps til iPhone og Android er på vej. Svar på mailen, hvis du vil
          prøve dem først.
        </Text>
      </PersonalBox>

      <Text style={personalText}>
        Jeg har opdateret TimeTracks vilkår og databehandleraftalen til version
        1.1. For dig gælder ændringerne fra <strong>{dato}</strong>, 30 dage
        efter denne mail. Indtil da gælder de tidligere versioner. Du skal ikke
        gøre noget.
      </Text>

      <Text style={{ ...personalText, fontWeight: 700, margin: "24px 0 8px" }}>
        Det ændrer sig
      </Text>

      <Text style={personalText}>
        Databehandleraftalen gælder for alle planer, også Gratis, og er en del
        af vilkårene. Listen over underleverandører er komplet, med land og
        grundlag for hver. Du kan læse aftalen og hente den som PDF på{" "}
        <Link href={DPA_URL} style={personalLink}>
          timetrack.dk/databehandleraftale
        </Link>
        . Ejere og administratorer kan hente den udfyldt med organisationens
        navn og CVR og acceptere den elektronisk under Indstillinger.
      </Text>

      <Text style={personalText}>
        Vilkårene har fået et nyt{" "}
        <Link href={TERMS_LUKNING_URL} style={personalLink}>
          punkt 9.3
        </Link>{" "}
        om, hvad der sker, hvis TimeTrack lukker. Du får besked mindst 6 måneder
        før, du kan hente alle dine data indtil lukningen, og har du betalt
        forud, får du den ubrugte del tilbage. Derefter slettes dine data efter
        databehandleraftalen, også i backup.
      </Text>

      <Text style={personalText}>
        Du kan selv hente alle dine data som én fil, også uden betalt
        abonnement. AI-funktionerne virker kun, hvis du selv indsætter en nøgle
        til en AI-udbyder, og data sendes kun til den udbyder, du har valgt. Nye
        versioner af databehandleraftalen gælder for eksisterende kunder 30 dage
        efter, at du har fået en mail om dem.
      </Text>

      <Text style={personalText}>
        Du kan læse hele vilkårene på{" "}
        <Link href={TERMS_URL} style={personalLink}>
          timetrack.dk/terms
        </Link>
        .
      </Text>

      <PersonalButton href={DPA_URL}>Læs databehandleraftalen</PersonalButton>

      <Text style={{ ...personalText, fontWeight: 700, margin: "32px 0 8px" }}>
        TimeTrack har fået nyt udseende
      </Text>

      <Text style={personalText}>
        Samtidig har TimeTrack fået nyt logo og en ny skrift. Alt virker som
        før. Klippekortet viser nu timerne som huller. De brugte er fyldt ud, og
        dem, der er tilbage, står åbne. Du ser det på oversigten, på kunden og i
        kundeportalen
        {appsUdgivet
          ? ", og det samme kort står i browserudvidelsen, desktop-appen og mobilappen."
          : "."}
      </Text>

      <EmailKlippekort
        name="Eksempel: Bageriet på hjørnet"
        totalHours={20}
        remainingHours={7}
      />

      <Text style={personalText}>
        Portalen, dine kunder logger ind i, hedder nu Kundeportal. Ejere og
        administratorer kan hente alle organisationens data under{" "}
        <Link href={`${settingsUrl}/data`} style={personalLink}>
          Indstillinger &gt; Import og eksport
        </Link>
        , og medarbejdere kan hente deres egne samme sted. Mørk tilstand er
        gennemgået, så tekst og knapper står tydeligt.
      </Text>

      <Text style={personalText}>
        Hjem er ny. Skriv bare, hvad du har lavet, fx &quot;2 timer på
        hjemmeside til Jensen i går&quot;, så registrerer TimeTrack tiden. På
        telefonen kan du indtale det. Herfra starter du også timeren med ét tryk
        på dine mest brugte kunder, og Overblik med nøgletallene ligger ét klik
        væk. Under Indstillinger &gt; Profil kan du vælge, hvilken side du
        lander på, når du logger ind.
      </Text>

      <Text style={personalText}>
        Feedback er også ny: du kan tage et billede af hele siden, et område
        eller et enkelt element, tegne på det eller sløre det, du ikke vil vise,
        og sende det direkte til mig.
      </Text>

      <Text style={{ ...personalText, fontWeight: 700, margin: "32px 0 8px" }}>
        En mere stabil timer
      </Text>

      <Text style={personalText}>
        I oktober har jeg brugt meget tid på timeren. Den gemmer ikke længere
        den samme tid to gange, en stoppet timer kommer ikke tilbage, og
        &quot;Fortsæt&quot; beholder den oprindelige starttid. Faner og
        browserudvidelsen holder hinanden opdateret med det samme. Jeg tester nu
        timeren automatisk mod den rigtige app hver time, og dine data har
        løbende backup, så de kan gendannes til et vilkårligt tidspunkt.
      </Text>

      <Text style={{ ...personalText, fontWeight: 700, margin: "32px 0 8px" }}>
        Apps på vej
      </Text>

      <Text style={personalText}>
        TimeTrack til iPhone og Android er sendt til godkendelse hos Apple og
        Google. Vil du prøve appen, før den kommer ud til alle, så svar på denne
        mail, så sender jeg dig en invitation til betaen.
      </Text>

      <Text style={personalText}>
        Og så vil jeg gerne høre fra dig. Hvad savner du, og hvad driller i
        hverdagen? Svar på mailen eller brug Feedback i TimeTrack. Jeg læser
        selv det hele, og flere af ændringerne her er kommet af jeres ønsker.
      </Text>

      <Text style={personalText}>
        Har du spørgsmål til ændringerne, så svar også bare på mailen.
      </Text>
    </PersonalEmailLayout>
  );
}

export default RebrandVarselEmail;
