# Microsoft-login (Entra ID / Azure AD) — opsætningsguide

TimeTrack understøtter login med Microsoft-arbejdskonti via Microsoft Entra ID
(tidligere Azure AD). Koden er deployet og slår sig selv til, når de tre
env-vars nedenfor er sat. Uden dem vises Microsoft-knappen ikke på login-siden.

Bruges til enterprise-kunder (fx en skole) hvor medarbejderne skal logge
ind med deres eksisterende Microsoft-konto.

> **Sikkerhed (E12, #470 — nOAuth):** Entra verificerer IKKE `email`-claimet;
> det er en frit redigerbar attribut i enhver tenant. TimeTracks domæne-
> auto-join bruger derfor kun `preferred_username`/`upn` som bevis og KUN når
> organisationen har sat sit tenant-ID. Slå desuden
> **removeUnverifiedEmailClaim = true** til i app-manifestet
> (`authenticationBehaviors`), så Microsoft udelader uverificerede
> email-claims helt. Microsoft-konti linkes aldrig automatisk til
> eksisterende konti på e-mail (ikke trusted provider) — brugere forbinder
> Microsoft manuelt under Indstillinger → Sikkerhed.

## 1. Opret app registration i Azure

1. Gå til [portal.azure.com](https://portal.azure.com) → **Microsoft Entra ID**
   → **App registrations** → **New registration**
2. Udfyld:
   - **Name:** `TimeTrack` (vises for brugerne på samtykke-skærmen)
   - **Supported account types:** vælg ud fra kundescenariet:
     - _"Accounts in any organizational directory"_ (multitenant) — alle
       virksomheders Microsoft-konti kan logge ind. **Anbefalet** når flere
       kunder skal bruge samme login.
     - _"Accounts in this organizational directory only"_ — kun én bestemt
       organisation (kræver at app'en oprettes i kundens tenant, eller at
       `MICROSOFT_TENANT_ID` sættes til kundens tenant-GUID).
   - **Redirect URI:** type **Web**, værdi:

     ```
     https://timetrack.dk/api/auth/callback/microsoft-entra-id
     ```

     (til lokal udvikling tilføjes også
     `http://localhost:3000/api/auth/callback/microsoft-entra-id`)

     Før better-auth 1.7 var stien `/api/auth/oauth2/callback/microsoft-entra-id`.
     Ved opgraderingen tilføjes den nye URI **før** deploy, og den gamle bliver
     stående, så en rollback stadig virker.
3. Klik **Register**

## 2. Opret client secret

1. I app'en: **Certificates & secrets** → **Client secrets** → **New client secret**
2. Beskrivelse fx `timetrack-prod`, udløb **24 måneder** (sæt en
   kalenderpåmindelse — secret SKAL roteres inden udløb, ellers fejler login)
3. Kopiér **Value** med det samme (vises kun én gang)

## 3. Notér ID'erne

På app'ens **Overview**-side:
- **Application (client) ID** → `MICROSOFT_CLIENT_ID`
- **Directory (tenant) ID** → kun relevant hvis login skal begrænses til én tenant

## 4. Sæt env-vars i Dokploy

På TimeTrack-app'en i Dokploy → Environment:

```bash
MICROSOFT_CLIENT_ID="<Application (client) ID>"
MICROSOFT_CLIENT_SECRET="<client secret Value>"
# Valgfri — styrer hvem der kan logge ind:
#   "common"        = alle Microsoft-konti inkl. private (default)
#   "organizations" = kun arbejds-/skolekonti (anbefalet til enterprise)
#   "<tenant-GUID>" = kun én bestemt organisation
MICROSOFT_TENANT_ID="organizations"
```

Redeploy app'en. Knappen **"Fortsæt med Microsoft"** dukker op på
/login og /register, så snart `/api/auth/providers` rapporterer
`microsoft: true`.

## 5. Verificér

1. Åbn https://timetrack.dk/api/auth/providers — skal vise `"microsoft": true`
2. Åbn https://timetrack.dk/login — Microsoft-knappen skal være synlig
3. Log ind med en Microsoft-konto — første login opretter automatisk en
   TimeTrack-bruger med navn/email fra Microsoft-profilen

## Sådan hænger det sammen i koden

- **Server:** `src/lib/auth/microsoft-entra.ts` — better-auths indbyggede
  Microsoft-provider registreret under id'et `microsoft-entra-id` (plugin
  `microsoftEntra` i `src/lib/auth.ts`), aktiveres betinget af env-vars.
  Konti fra better-auth 1.6 er nøglet på `sub`, nye på `oid`; begge findes.
- **Klient:** `src/components/auth/SocialAuthButtons.tsx` —
  `authClient.signIn.social({ provider: "microsoft-entra-id" })`; kobling
  under Indstillinger → Sikkerhed via `authClient.linkSocial`
- **Provider-flag:** `src/app/api/auth/providers/route.ts`
- **Scopes:** `openid profile email` (kun login — ingen kalender/mail-adgang)

## Kundespecifik onboarding (fx en skole)

Med multitenant-app + `MICROSOFT_TENANT_ID="organizations"` kan kundens
medarbejdere logge ind med bruger@example.dk-konti uden videre. Kundens
IT-administrator skal muligvis godkende app'en første gang (admin consent
prompt), afhængigt af deres tenant-politik. Send dem evt. admin-consent-linket:

```
https://login.microsoftonline.com/organizations/adminconsent?client_id=<MICROSOFT_CLIENT_ID>
```

## Fremtidigt arbejde (ikke implementeret)

- **Auto-provisioning til organisation:** nye Microsoft-brugere oprettes som
  almindelige brugere — de skal stadig inviteres til organisationen manuelt.
  Domæne-baseret auto-join (fx "alle @example.dk → kunde-org som member") er et
  oplagt næste skridt.
- **SCIM/directory sync:** automatisk oprettelse/deaktivering af medarbejdere
  fra kundens AD.
- **Kalender-integration:** samme Azure-app kan genbruges til Microsoft Graph
  (Outlook-kalender) med ekstra scopes — se design-spec afsnit 11.
