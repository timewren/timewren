# TimeWren Cloud E2E (https://timewren.com lokalt)

Kører tilmeldingen på TimeWren-hosten ende til ende mod en lokal
produktionsbuild med prods form af konfigurationen: `MULTIBRAND_ENABLED=1`,
`TIMEWREN_APP_ENABLED=1` og `BRANDS_CONFIG` med `timewren.com` og
`www.timewren.com`. TimeTracks Google-nøgler er sat på serveren, så testen
beviser, at de ikke vises eller virker på TimeWren.

`signup.spec.ts` dækker:

- tilmelding med mail → bekræftelsesmail fra `TimeWren <noreply@timewren.com>`
  med links til `https://timewren.com` og uden TimeTrack → onboarding →
  dashboard på Gratis (uden prøveperiode), `users.brand`/`organizations.brand`
  = `timewren`, `users.locale` = `en`;
- abonnement og Google Calendar viser "kommer snart";
- ingen knapper til sociale logins (login, tilmelding, Sikkerhed), og
  `/api/auth/sign-in/social` kender ikke udbyderne;
- passkey (Chromes virtuelle authenticator) og magic link.
- ingen "TimeTrack" i synlig tekst, titel eller title/aria-label/placeholder/alt
  på tilmelding, login, glemt adgangskode, onboarding og 20 app-sider
  (dashboard, tid, kunder, projekter, klippekort, fakturaer, rapporter,
  opgaver, hjælp, integrationer og indstillinger), og manifest og
  `/runtime-config.js` er TimeWrens.

## Sådan kører den

1. En kasseret Postgres med skemaet, uden fast værtsport:

   ```bash
   docker run -d --name tw-e2e-pg -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=timetrack \
     -p 127.0.0.1::5432 postgres:16-alpine
   export DATABASE_URL="postgresql://postgres:e2e@$(docker port tw-e2e-pg 5432)/timetrack"
   npx drizzle-kit push --force
   ```

2. En build: `NODE_OPTIONS=--max-old-space-size=6144 npx next build`.
3. `scripts/e2e/timewren-cloud.sh`. Scriptet starter appen fra
   `.next/standalone` på en ledig port, en Resend-mock
   (`tests/e2e/resend-mock.mjs`), der gemmer mails som JSON, og
   `https-proxy.mjs` med et selvsigneret certifikat. Proxyen bevarer
   `Host`-headeren, så appen vælger TimeWren-instansen som bag Traefik.
   Chromium sender `timewren.com` og `www.timewren.com` til proxyen med
   `--host-resolver-rules`, og testen afbryder alle andre hosts.
4. Ryd op: `docker rm -f tw-e2e-pg`.

Brug kun `page`-navigation og `fetch` fra siden. `page.request` følger ikke
`--host-resolver-rules` og ville ramme det rigtige timewren.com.
