import { Link, Text } from "@react-email/components";
import {
  PersonalEmailLayout,
  personalLink,
  personalText,
} from "./PersonalEmailLayout";

/**
 * Mads' mail til betalende Cloud-kunder om, at kildekoden åbnes som
 * TimeWren. Tekst: docs/launch/kundemails.md (mail 1). Sendes kun efter
 * Mads' "send den"; fornavnet flettes ind på serveren.
 */

export const LAUNCH_OPEN_SOURCE_SUBJECT =
  "Jeg åbner kildekoden til TimeTrack: hvad det betyder for dig";

export const LAUNCH_OPEN_SOURCE_FROM = "Mads fra TimeTrack <mads@timetrack.dk>";

const SUPPORT_EMAIL = "mads@timetrack.dk";

interface LaunchOpenSourceEmailProps {
  /** Fornavn, hvis det kendes. Ellers står der bare "Hej". */
  userName?: string;
}

export function LaunchOpenSourceEmail({
  userName,
}: LaunchOpenSourceEmailProps) {
  return (
    <PersonalEmailLayout
      preview="For dig ændrer intet sig. Du beholder dine data, dine funktioner og din pris, og du får én måned gratis."
      showReplyCta={false}
      footerNote="Du modtager denne mail, fordi du er kunde på TimeTrack."
    >
      <Text style={personalText}>{userName ? `Hej ${userName},` : "Hej,"}</Text>

      <Text style={personalText}>
        Jeg skriver til dig, før det bliver offentligt: Jeg åbner kildekoden til
        TimeTrack, og projektet får navnet TimeWren. Du kan dermed se præcis,
        hvad det system, du bruger, er bygget af, og alle kan køre det selv.
      </Text>

      <Text style={personalText}>
        For dig ændrer intet sig. Du bliver på timetrack.dk med alle dine data,
        alle funktioner bliver i dit abonnement, og din pris er den samme. Jeg
        står fortsat for drift, backup og support. Vil du senere flytte til det
        nye domæne, er det helt frivilligt.
      </Text>

      <Text style={personalText}>
        Som tak, fordi du var med fra starten, mærker jeg dig som &quot;Founding
        customer&quot; i appen. Du kan skrive direkte til mig på{" "}
        <Link href={`mailto:${SUPPORT_EMAIL}`} style={personalLink}>
          {SUPPORT_EMAIL}
        </Link>{" "}
        og få svar inden for én hverdag. Du får også én måned gratis, som jeg
        trækker fra på din næste faktura.
      </Text>

      <Text style={personalText}>
        Har du spørgsmål, så svar bare på denne mail.
      </Text>
    </PersonalEmailLayout>
  );
}

export default LaunchOpenSourceEmail;
