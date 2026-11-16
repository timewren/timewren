import type { Metadata } from "next";
import { generateMetadata } from "@/lib/metadata";

export const metadata: Metadata = generateMetadata({
  title: "Kontakt TimeTrack - Vi Svarer Inden For 24 Timer",
  description:
    "Har du spørgsmål om TimeTrack? Kontakt vores support team. Vi svarer typisk inden for 24 timer. Email, telefon og kontaktformular tilgængelig.",
  canonical: "/contact",
  keywords: [
    "kontakt timetrack",
    "timetrack support",
    "kundeservice",
    "hjælp timetrack",
    "kontakt freelancer crm",
  ],
});

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
