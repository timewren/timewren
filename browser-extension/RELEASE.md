# Udgivelse af browser-udvidelsen

Udgivelsen til Chrome Web Store er automatiseret i
`.github/workflows/extension-publish.yml`. Workflowet bygger, tester og pakker
udvidelsen, uploader Chrome-zippen og sender den til review. Resultatet meldes
i ops-kanalen på Discord.

Store-ID: `omfnfamlmdfaobhcphdfhcnihcllekof`

## Sådan udgiver du en ny version

1. Bump versionen de tre steder — de skal være ens, ellers stopper workflowet:
   - `browser-extension/manifest.json`
   - `browser-extension/manifest.firefox.json`
   - `browser-extension/package.json` (kør `npm install --package-lock-only`
     i `browser-extension/`, så `package-lock.json` følger med)
2. Skriv en ny sektion øverst i `browser-extension/CHANGELOG.md`.
3. Commit og merge til `main` via PR som normalt.
4. Tag merge-committen på `main` og push tagget:

   ```bash
   git checkout main && git pull
   git tag extension-v2.7.0
   git push origin extension-v2.7.0
   ```

Tagget skal hedde `extension-v` + præcis den version, der står i
`manifest.json`. Passer de ikke sammen, fejler workflowet, før der uploades
noget.

Et tag-push udgiver altid til alle brugere (`default`). Google reviewer
derefter versionen — typisk fra et par timer til et par dage. Discord viser
"sendt til review", når upload og indsendelse er gået igennem.

### Manuel kørsel

Under _Actions → Extension Publish → Run workflow_ kan du køre workflowet uden
at tagge. Committen skal stadig være merget til `main` — workflowet nægter at
uploade kode, der ikke har været gennem review (det gælder også tags):

- `publish = false` uploader kun zippen som udkast i Developer Dashboard, så
  du selv kan trykke "Indsend til review" bagefter.
- `target = trustedTesters` udgiver kun til de testere, der er sat op i
  dashboardet.

Versionen i `manifest.json` skal stadig være højere end den, der ligger i
butikken, ellers afviser Chrome Web Store uploaden.

Zip-filerne (Chrome og Firefox) gemmes i 90 dage som artefakt på kørslen.

## Engangsopsætning af Google-adgangen

Workflowet bruger Chrome Web Store API'et med en OAuth refresh token. Den skal
høre til den Google-konto, der ejer udvidelsen i Developer Dashboard.

1. **Eget Google Cloud-projekt.** Opret projektet "TimeTrack Release" i
   [Google Cloud Console](https://console.cloud.google.com/). Det holdes
   adskilt fra app'ens øvrige Google-integrationer, så en rotation her ikke
   rammer login eller kalender-sync.
2. **Slå API'et til.** _APIs & Services → Library → "Chrome Web Store API" →
   Enable._
3. **OAuth consent screen.** Vælg brugertype **Internal** (kræver at kontoen er
   i Google Workspace). Interne apps skal ikke verificeres, og deres refresh
   tokens udløber ikke efter 7 dage, som de gør for eksterne apps i
   testtilstand.
4. **OAuth-klient.** _Credentials → Create credentials → OAuth client ID →
   Application type: Desktop app._ Notér client ID og client secret.
5. **Hent en refresh token lokalt.** Åbn denne URL i browseren, logget ind med
   den konto der ejer udvidelsen (indsæt dit client ID):

   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&prompt=consent&redirect_uri=http://localhost:8818&client_id=<CLIENT_ID>
   ```

   Efter godkendelse sender Google dig videre til `http://localhost:8818/?code=…`.
   Siden kan ikke indlæses — det er forventet. Kopiér værdien af `code` fra
   adresselinjen og byt den til en refresh token:

   ```bash
   curl -s https://oauth2.googleapis.com/token \
     -d client_id=<CLIENT_ID> \
     -d client_secret=<CLIENT_SECRET> \
     -d code=<CODE> \
     -d grant_type=authorization_code \
     -d redirect_uri=http://localhost:8818
   ```

   Svaret indeholder `refresh_token`. Koden kan kun bruges én gang og udløber
   efter få minutter.
6. **Gem som GitHub-secrets** i `mahope/timetrack` (_Settings → Secrets and
   variables → Actions_), og læg en kopi i Bitwarden:

   | Secret              | Værdi                              |
   | ------------------- | ---------------------------------- |
   | `CWS_CLIENT_ID`     | OAuth client ID                    |
   | `CWS_CLIENT_SECRET` | OAuth client secret                |
   | `CWS_REFRESH_TOKEN` | refresh token fra trin 5           |
   | `CWS_EXTENSION_ID`  | `omfnfamlmdfaobhcphdfhcnihcllekof` |

   Med `gh`: `gh secret set CWS_REFRESH_TOKEN --repo mahope/timetrack` (værdien
   indtastes interaktivt og havner ikke i shell-historikken).

`DISCORD_OPS_WEBHOOK_URL` findes allerede og deles med uptime-overvågningen.

## Rotation

- **Refresh token** (fx hvis den er lækket, eller workflowet fejler med
  `AUTH_FAILED`/`invalid_grant`): tilbagekald den gamle adgang under
  <https://myaccount.google.com/permissions>, gentag trin 5 og opdatér
  `CWS_REFRESH_TOKEN`. En token bliver også ugyldig, hvis kontoens adgangskode
  skiftes, eller hvis den ikke er brugt i seks måneder.
- **Client secret:** opret en ny secret på OAuth-klienten i Cloud Console,
  opdatér `CWS_CLIENT_SECRET`, kør en manuel kørsel med `publish = false` for at
  bekræfte, og slet derefter den gamle secret. En ny client secret kræver ikke
  en ny refresh token.
- Opdatér altid kopien i Bitwarden samtidig.

## Firefox (valgfrit)

Workflowet har et Firefox-job, der signerer `dist-firefox` med
`web-ext sign --channel listed` og sender versionen til review på
addons.mozilla.org. Jobbet springes over, indtil disse secrets findes:

- `AMO_JWT_ISSUER` og `AMO_JWT_SECRET` — fra
  <https://addons.mozilla.org/developers/addon/api/key/>

Bemærk: AMO beder normalt om kildekoden, når udvidelsen er bygget med en
bundler. Den skal i så fald uploades manuelt i AMO's Developer Hub første gang,
indtil workflowet også sender en kildekode-zip med (`--upload-source-code`).
