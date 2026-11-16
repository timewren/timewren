# TimeTrack E2E-tests (Playwright)

Et lille, pålideligt kernesæt frem for fuld dækning. Den gamle suite fra
TimeCraft-æraen ligger stadig her, men er markeret `test.skip` med en
begrundelse øverst i hver fil — genoplives spec for spec efter behov.

## Kernesættet

| Fil                    | Dækker                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.setup.ts`        | Registrér → bekræft e-mail (DB) → log ind → onboarding/trial → tour afvist. Gemmer sessionen i `.auth/user.json` (gitignored)                |
| `core-flow.spec.ts`    | Opret kunde → projekt → tidspostering → ses i listen; beskyttede ruter; forkert adgangskode                                                  |
| `gratis-limit.spec.ts` | Egen bruger på Gratis: 4. aktive kunde blokeres med den rolige note, og serveren afviser                                                     |
| `public-pages.spec.ts` | `/`, `/pricing`, `/privat`, `/selvstaendig`, `/teams-og-bureauer`, `/virksomheder` loader uden konsolfejl; `/offline` hydrerer uden mismatch |

`helpers.ts` eksporterer en `test`-fixture, der blokerer alle eksterne requests
(Google Ads, Plausible, Sentry …) og giver hver test sin egen `x-forwarded-for`,
så better-auths login-rate-limit ikke rammer ved gentagne kørsler.

## Kørsel lokalt

1. PostgreSQL med skemaet pushet: `npm run docker:up && npm run db:push`
   (eller en vilkårlig lokal Postgres via `DATABASE_URL`).
2. `DATABASE_URL` skal være sat i shell'en eller i `.env.local` — testene
   markerer e-mail som bekræftet og sætter Gratis-tieren direkte i DB.
3. `npm run test:e2e` — starter dev-serveren med registrering slået til
   (se `webServer` i `playwright.config.ts`), eller genbruger en dev-server,
   der allerede kører på port 3000. `npm test` kører enhedstestene og kræver
   ingen database; E2E-suiten har sit eget script, fordi den kræver Postgres.

Kør mod en lokal database med eksterne nøgler (Resend, Stripe, OpenAI,
Alunta, Sentry) tomme, så intet rammer produktionstjenester. Uden
`RESEND_API_KEY` fejler afsendelsen af bekræftelsesmailen stille, og signup
lykkes stadig.

Nyttige varianter: `npx playwright test core-flow --headed`,
`npx playwright test --ui`, `npm run test:report`.
