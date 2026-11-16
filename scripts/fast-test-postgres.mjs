// Slår holdbarheden fra på CI's kasserede test-Postgres. Service-containere
// kan ikke få `postgres -c …`, så indstillingerne sættes med ALTER SYSTEM og
// en reload (alle tre kræver kun SIGHUP). Hver commit venter så ikke på disken,
// som på de delte runnere også bruges af Docker-builds: model-testene gik fra
// 638 til 444 s lokalt, og forbindelser og schema-opsætning sulter mindre.
// Kun til test-databaser — data overlever ikke et nedbrud.
//
//   node scripts/fast-test-postgres.mjs <database-url>
import postgres from "postgres";

const url = process.argv[2];
if (!url) {
  console.error("Brug: node scripts/fast-test-postgres.mjs <database-url>");
  process.exit(1);
}

const settings = {
  fsync: "off",
  synchronous_commit: "off",
  full_page_writes: "off",
};

const sql = postgres(url, { max: 1, connect_timeout: 60, onnotice: () => {} });
try {
  for (const [name, value] of Object.entries(settings)) {
    await sql.unsafe(`ALTER SYSTEM SET ${name} = ${value}`);
  }
  await sql`SELECT pg_reload_conf()`;

  // Reloaden er asynkron; vent til serveren melder de nye værdier.
  let current = {};
  for (let attempt = 0; attempt < 20; attempt++) {
    const rows = await sql`
      SELECT name, setting FROM pg_settings WHERE name IN ${sql(Object.keys(settings))}
    `;
    current = Object.fromEntries(rows.map((r) => [r.name, r.setting]));
    if (Object.entries(settings).every(([k, v]) => current[k] === v)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(
    Object.entries(current)
      .map(([k, v]) => `${k}=${v}`)
      .join(" "),
  );
  if (!Object.entries(settings).every(([k, v]) => current[k] === v)) {
    // Testene er stadig gyldige, bare langsommere: advar i stedet for at fejle.
    // Actions læser også `::warning::` fra stderr.
    console.warn("::warning::Test-Postgres kører stadig med fsync slået til");
  }
} finally {
  await sql.end();
}
