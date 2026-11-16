/**
 * Blogindlæggene, ét sted (issue #877: forsidens "Seneste fra Mads"-strimmel
 * og /blog læser begge herfra, så der kun er én liste at holde ved).
 * Nyeste først.
 */
export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  category: string;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "tidsregistrering-medarbejdere-systemer",
    title:
      "Tidsregistrering af medarbejdere: 8 systemer og priser sammenlignet (2026)",
    excerpt:
      "SmartTID, Danløn, DataLøn, Intempus, TimeLog, BitaBIZ, Timegrip og TimeTrack: pris, opstartsgebyr og hvem de passer til.",
    date: "2026-10-11",
    readTime: "8 min",
    category: "Sammenligning",
  },
  {
    slug: "klippekort-skabelon",
    title: "Klippekort-skabelon til kunder: gratis aftale i Word",
    excerpt:
      "Download en klippekort-aftale med antal timer, gyldighed, trækning og udløb, og se de tre ting, der oftest bliver glemt.",
    date: "2026-10-11",
    readTime: "5 min",
    category: "Skabelon",
  },
  {
    slug: "desktop-app-coming-soon",
    title: "TimeTrack Desktop til Mac og Windows, nu med i alle planer",
    excerpt:
      "Desktop-appen til Mac og Windows kan hentes nu i beta. Den registrerer aktivitet lokalt, foreslår projekter og er med i alle planer, også Gratis.",
    date: "2026-05-24",
    readTime: "4 min",
    category: "Produkt",
  },
  {
    slug: "timeregistrering-freelancer-guide",
    title: "Timeregistrering som freelancer: Den komplette guide (2026)",
    excerpt:
      "Fra Excel til automatisk registrering: lær hvordan du holder styr på dine timer, undgår tabte indtægter og fakturerer korrekt.",
    date: "2026-05-23",
    readTime: "8 min",
    category: "Guide",
  },
  {
    slug: "klippekort-freelancer",
    title: "Klippekort til kunder: Sådan sælger du forudbetalte timer",
    excerpt:
      "Klippekort giver forudsigelig indtægt og trygge kunder. Her er en trin-for-trin guide til at komme i gang.",
    date: "2026-05-23",
    readTime: "6 min",
    category: "Guide",
  },
  {
    slug: "klippekort-vs-fastpris",
    title:
      "Klippekort vs. fastpris: Hvad er bedst for din freelance-forretning?",
    excerpt:
      "Skal du sælge timer på forhånd eller give en fast pris? Her er fordele, ulemper og hvornår du vælger hvad.",
    date: "2026-05-02",
    readTime: "7 min",
    category: "Strategi",
  },
  {
    slug: "vaelg-tidsregistrering",
    title: "Sådan vælger du det rigtige tidsregistreringssystem i 2026",
    excerpt:
      "Sammenligning af Harvest, Toggl, Clockify og TimeTrack, plus en tjekliste til at vælge det rigtige værktøj.",
    date: "2026-04-18",
    readTime: "7 min",
    category: "Sammenligning",
  },
  {
    slug: "dinero-timeregistrering-guide",
    title: "Dinero + TimeTrack: Automatisk fakturering for freelancere",
    excerpt:
      "Sæt Dinero-integrationen op og lad dine timer flyde direkte ind i dine fakturaer. Trin-for-trin.",
    date: "2026-04-05",
    readTime: "5 min",
    category: "Integration",
  },
  {
    slug: "tidsregistrering-lov-danmark",
    title: "Tidsregistreringslov i Danmark: Hvad du skal vide som freelancer",
    excerpt:
      "Den danske L68-lov om tidsregistrering: hvem den gælder for, hvad der skal registreres, og hvordan du overholder den.",
    date: "2026-03-28",
    readTime: "6 min",
    category: "Lov & Regler",
  },
  {
    slug: "fakturering-fejl-freelancer",
    title: "5 fakturerings-fejl freelancere laver (og hvordan du undgår dem)",
    excerpt:
      "Glemte timer, sene fakturaer og manglende opfølgning: her er de mest almindelige fejl og hvordan du fikser dem.",
    date: "2026-03-12",
    readTime: "6 min",
    category: "Tips",
  },
  {
    slug: "freelancer-timepris-2026",
    title: "Freelancer timepris 2026: sådan regner du din minimumssats ud",
    excerpt:
      "Sådan regner du den timepris ud, du mindst skal tage, ud fra indkomst, udgifter og fakturerbare timer.",
    date: "2026-02-22",
    readTime: "5 min",
    category: "Prisguide",
  },
  {
    slug: "billy-timeregistrering-guide",
    title: "Billy og TimeTrack: send registrerede timer til en fakturakladde",
    excerpt:
      "Sådan forbinder du Billy, sender timerne som en fakturakladde og undgår de almindelige faldgruber med moms og produkter.",
    date: "2026-02-08",
    readTime: "5 min",
    category: "Integration",
  },
  {
    slug: "excel-til-timerapport",
    title: "Fra Excel til automatisk timerapport: en freelancers guide",
    excerpt:
      "Hvornår regnearket ikke slår til længere, og hvordan du flytter dine timer over med en CSV-import.",
    date: "2026-01-15",
    readTime: "5 min",
    category: "Guide",
  },
];

export function formatBlogDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("da-DK", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
