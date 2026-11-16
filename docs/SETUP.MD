# Lokal opsætning

Kort guide til at køre TimeTrack/TimeWren lokalt. Selvhosting (Docker Compose, Coolify, Dokploy, Helm) står i [self-hosting.md](self-hosting.md).

## Kom i gang

```bash
npm install
cp .env.example .env.local   # sæt DATABASE_URL, BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL, CRON_SECRET
npm run dev:setup            # docker (Postgres) + migrate + seed + dev-server
```

Trin for trin: `npm run docker:up`, `npm run db:migrate`, `npm run dev`.

## Skemaet

Alle tabeller (ca. 170) er defineret i `src/lib/db/schema.ts` (Drizzle). Det er den eneste kilde; denne fil gengiver det ikke.

- Ny migration efter skemaændring: `npm run db:generate` (filer i `drizzle/`).
- Kør migrationer: `npm run db:migrate` (sikker tilstand). `db:push` er kun til lokal udvikling.
- Container og Helm sætter `MIGRATE_ON_START=1` (se `docker-compose.yml` og `charts/timewren/templates/app.yaml`), så migrationer kører ved opstart. Uden variablen kører de ikke af sig selv; kør da `npm run deploy:migrate`.

## Tests

- `npm test`: enhedstests (Vitest), ingen database nødvendig.
- `npm run test:e2e`: Playwright-kernesættet, kræver Postgres. Se [tests/e2e/README.md](../tests/e2e/README.md).
