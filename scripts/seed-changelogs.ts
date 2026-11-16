/**
 * Seed initial changelog entries based on recent development work.
 * Run: npx tsx scripts/seed-changelogs.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const client = postgres(DATABASE_URL);
const db = drizzle(client);

const changelogs = [
  {
    version: "1.8.0",
    title: "Importér fra TimeOps",
    publishedAt: new Date("2026-04-08T18:00:00+02:00"),
    content: `Ny 4-trins import-wizard der gør det nemt at flytte fra TimeOps til TimeTrack:

- **Forbind** — indtast din TimeOps API-nøgle
- **Forhåndsvis** — se hvor mange klienter, projekter og registreringer der importeres
- **Konflikter** — vælg hvad der skal ske med dubletter (flet, opret ny, spring over)
- **Import** — følg fremgangen med live progress-bar

Importen kører i baggrunden — du kan lukke siden og vende tilbage senere.

Find den under **Indstillinger → Integrationer → TimeOps**.
`,
  },
  {
    version: "1.9.0",
    title: "Tidsregistrering uden projekt",
    publishedAt: new Date("2026-04-09T12:00:00+02:00"),
    content: `Du kan nu oprette tidsregistreringer **uden at vælge et projekt**:

- **Klient-kun** — registrér tid direkte på en klient uden projekt
- **Intern tid** — registrér intern tid som admin, transport eller møder
- Brug tags til at kategorisere intern tid

Virker i kalenderen, timeren og hurtig-registrering. Klippekort og fakturering kræver stadig et projekt.
`,
  },
  {
    version: "1.10.0",
    title: "Ny browser extension",
    publishedAt: new Date("2026-04-10T08:00:00+02:00"),
    content: `## Nye genveje

- **Alt+Shift+N** — hurtig tidsregistrering direkte fra browseren
- **Alt+Shift+S** — start/stop timer
- **Alt+Shift+T** — åbn extension

## Daglig påmindelse

Få en notifikation kl. 15:00 (konfigurerbar) hvis du har registreret under 4 timer. Slå til/fra i extension-indstillingerne.

## Genstart og kopiér

- Klik **▶** på en tidligere registrering for at starte timer med samme projekt og beskrivelse
- Klik **📋** for at udfylde formularen med data fra en tidligere registrering

## Forbedret daglig oversigt

- Fuld-bredde progress-bar med "4.2t / 8t" visning
- Konfigurerbart dagsmål (2-12 timer) i indstillingerne
- Grøn pulserende dot viser hvad du arbejder på lige nu

Opdatér din extension i Chrome Web Store for at få de nye funktioner.
`,
  },
  {
    version: "1.10.1",
    title: "Forbedret klippekort-oversigt",
    publishedAt: new Date("2026-04-10T10:00:00+02:00"),
    content: `Dashboard-widgets viser nu tydeligt forskel på klippekort der **snart udløber** og klippekort der **allerede er udløbet**:

- "Udløber om 5 dage" → orange badge
- "Udløbet for 3 dage siden" → rød badge med tydelig tekst

Tidligere viste begge situationer det samme — nu er det klart hvad der kræver handling.
`,
  },
  {
    version: "1.10.2",
    title: "Nyheder i TimeTrack",
    publishedAt: new Date("2026-04-10T14:00:00+02:00"),
    content: `Fra nu af vil du automatisk se en oversigt over nye funktioner når vi udgiver noget nyt.

Du kan altid genåbne denne dialog via **din profil-menu → Nyheder** for at se tidligere opdateringer.
`,
  },
];

async function seed() {
  console.log("Seeding changelogs...");

  for (const entry of changelogs) {
    // Skip if a changelog with this version already exists
    const existing = await db.execute(
      sql`SELECT id FROM changelogs WHERE version = ${entry.version} LIMIT 1`,
    );
    const rows =
      (existing as { rows?: unknown[] }).rows ?? (existing as unknown[]);
    if (Array.isArray(rows) && rows.length > 0) {
      console.log(`  ⏭ v${entry.version}: ${entry.title} (already exists)`);
      continue;
    }
    await db.execute(
      sql`INSERT INTO changelogs (version, title, content, published_at)
          VALUES (${entry.version}, ${entry.title}, ${entry.content}, ${entry.publishedAt.toISOString()})`,
    );
    console.log(`  ✓ ${entry.title}`);
  }

  console.log("Done!");
  await client.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
