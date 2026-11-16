# Telemetry and outbound connections

This page lists every outbound connection the app can make, whether it is on by default, and which setting turns it on or off. It describes what the code does today. If you find a connection that is not listed here, that is a bug in this page; please open an issue.

TimeTrack has no usage reporting, no "phone home" call and no install counter. No feature is gated behind telemetry, analytics or billing settings.

## Summary

| Connection                                                      | Default                          | Controlled by                                                                 |
| --------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| Sentry error reports                                            | Off                              | `NEXT_PUBLIC_SENTRY_DSN` (build time)                                         |
| Plausible page analytics (script in the browser)                | Off                              | `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL` (build time)                               |
| Plausible Stats API (admin traffic page)                        | Off                              | `PLAUSIBLE_API_KEY` and `PLAUSIBLE_SITE_ID`                                   |
| Google Ads tag (`gtag.js`)                                      | Off (on for TimeTrack Cloud)     | `NEXT_PUBLIC_GOOGLE_ADS_ID`                                                   |
| GitHub release lookups                                          | Off (on for TimeTrack Cloud)     | `NEXT_PUBLIC_DESKTOP_RELEASES_REPO`, `DESKTOP_UPDATER_REPO`, `CHANGELOG_REPO` |
| API docs page loads a script from jsDelivr                      | On when `/api/v1/docs` is opened | Not configurable by env today                                                 |
| Feature integrations (mail, S3, AI, CVR, accounting, push, ...) | Off until configured             | Their own settings, see the last section                                      |

## Brand defaults

With `NEXT_PUBLIC_BRAND=timetrack` (Mahope's hosted TimeTrack Cloud) two more connections are on by default. Any other brand, including a self-hosted TimeWren with an empty or missing value, leaves them off until you set the variable yourself:

**Google Ads tag.** `src/components/GoogleAds.tsx` (rendered by `src/components/DocumentLayout.tsx`) loads `https://www.googletagmanager.com/gtag/js` only when `getGoogleAdsId()` in `src/lib/google-ads.ts` returns an ID: `NEXT_PUBLIC_GOOGLE_ADS_ID`, or Mahope's account on the TimeTrack brand. It sets Google Consent Mode defaults to "denied"; consent is upgraded to "granted" only when the visitor accepts marketing cookies in the cookie banner.

**GitHub release lookups.** `src/lib/release-repos.ts` returns no repository unless one is configured (or the brand is TimeTrack), and then no request is made. When configured, the browser calls the GitHub API from the desktop download card and the app drawer (`src/components/desktop/useLatestDesktopRelease.ts`, `NEXT_PUBLIC_DESKTOP_RELEASES_REPO`), and the server calls it from the download page, the changelog page (`CHANGELOG_REPO`) and the desktop auto-update endpoint (`DESKTOP_UPDATER_REPO`). These requests carry no app data, only the requesting IP address. `GITHUB_TOKEN` only raises the rate limit.

## Known gaps in "none by default"

**API docs page.** `GET /api/v1/docs` returns a page that loads `@scalar/api-reference` from `https://cdn.jsdelivr.net` in the visitor's browser (`src/app/api/v1/docs/route.ts`). The fonts and styles allowed from the same host in the CSP are used by the same page.

## Error reporting (Sentry)

Off unless `NEXT_PUBLIC_SENTRY_DSN` is set. The value is read in three places: the browser (`src/instrumentation-client.ts`), the Node server (`sentry.server.config.ts`) and the edge runtime (`sentry.edge.config.ts`). It is baked in at build time, so pass it as a Docker build argument. With no DSN the Sentry client is created disabled and sends nothing.

- `NEXT_PUBLIC_SENTRY_BROWSER_ENABLED=false` turns off the browser part only (it defaults to on once a DSN exists).
- Only errors are sent. Tracing, session replay and client reports are not enabled.
- Personal data collection is switched off in `src/lib/sentry/data-collection.ts`: no user info, no cookies, no request bodies, no query parameters, and request headers are filtered to a short allowlist.
- Events from `localhost` are dropped before sending (`src/lib/utils/sentry-filter.ts`).
- Source-map upload and the `/monitoring` tunnel route (`next.config.ts`) exist only when the build has `SENTRY_AUTH_TOKEN` set. The Dockerfile sets `SENTRY_DISABLED=1`, so Docker builds never include them.
- `SENTRY_API_URL`, `SENTRY_ACCESS_TOKEN`, `SENTRY_AUTH_TOKEN` and `SENTRY_WEBHOOK_SECRET` are used only by the optional Sentry webhook and issue lookup (`src/app/api/webhooks/sentry/route.ts`, `src/lib/sentry/issue-environment.ts`). Without a token, no lookup is made.

## Page analytics (Plausible)

Off unless `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL` is set (build time). Then `DocumentLayout.tsx` loads that script through `next-plausible`, and the script's origin is added to the CSP (`next.config.ts`, `src/lib/security-headers.ts`). Unset: no script and no analytics origin in the CSP. Where the script is hosted, and so who receives the data, is your choice.

The cookie banner (`src/components/CookieConsent.tsx`) records the analytics choice in a consent cookie. It does not by itself load the script: if you set the script URL, the script is loaded for all visitors.

The admin traffic page (`/admin/analytics`) reads statistics from a Plausible instance with `PLAUSIBLE_API_KEY` and `PLAUSIBLE_SITE_ID`, from `PLAUSIBLE_BASE_URL` (default `https://plausible.io`). Without key and site ID the page shows "not configured" and no request is made (`src/lib/plausible.ts`).

## Desktop app usage events

`POST /api/desktop/analytics` accepts anonymous event names from the desktop app and stores them in your own database (table `desktop_analytics`). Nothing is forwarded to a third party. This is a receiving endpoint, not an outbound call, and it only has data if a desktop app is pointed at your instance.

## Integrations you configure

These connect to a third party only when you set them up. They send data needed for the feature, not telemetry.

| Feature             | Goes to                                            | Turned on by                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email               | Resend, or your SMTP server                        | `RESEND_API_KEY`, or `SMTP_HOST`; with neither, mails are only logged (`src/lib/email/transport.ts`)                                                                                              |
| File storage        | Your S3 endpoint                                   | `S3_ENDPOINT` and keys; `STORAGE_DRIVER=local` keeps files on disk (`src/lib/s3.ts`)                                                                                                              |
| AI features         | OpenAI, or the base URL a user sets                | `OPENAI_API_KEY`, or a user's own key and URL in settings (`src/lib/ai/openai.ts`)                                                                                                                |
| CVR lookup          | `cvrapi.dk`, or the service in `CVR_SERVICE_URL`   | Used when a user looks up a CVR number. With `CVR_SERVICE_API_KEY` set, the service is tried first (default URL `https://cvr.mahoje.dk`); without it, `cvrapi.dk` (`src/lib/integrations/cvr.ts`) |
| Accounting          | Billy, Dinero, e-conomic, TimeOps                  | A user connects their own account                                                                                                                                                                 |
| Calendar            | Google Calendar, iCloud CalDAV                     | A user connects their own account; OAuth keys for Google                                                                                                                                          |
| Login providers     | Google, GitHub, Discord, Apple, Microsoft          | Their client ID and secret variables                                                                                                                                                              |
| Web push            | The browser vendor's push service                  | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`                                                                                                                                            |
| Mobile push         | Expo (`exp.host`)                                  | Used when a mobile device has registered a token (`src/lib/notifications/expo-push.ts`)                                                                                                           |
| Admin alerts        | A Discord webhook                                  | `ADMIN_DISCORD_WEBHOOK_URL` or the admin setting                                                                                                                                                  |
| Payments            | Stripe                                             | `STRIPE_SECRET_KEY`; without it, no call is made (`src/lib/stripe.ts`)                                                                                                                            |
| Alunta              | `app.alunta.com` (hard-coded)                      | `ALUNTA_API_KEY`; without it, no call is made (`src/lib/alunta.ts`)                                                                                                                               |
| Domain registration | Your Dokploy instance                              | `DOKPLOY_API_URL`, `DOKPLOY_API_TOKEN` and `DOKPLOY_APP_ID`; otherwise skipped (`src/lib/hosting/dokploy.ts`)                                                                                     |
| Outgoing webhooks   | URLs a user enters                                 | A user adds a webhook (`src/lib/webhooks/delivery.ts`)                                                                                                                                            |
| Chat notifications  | Teams, Slack or Discord webhook URLs a user enters | A user adds the webhook URL (`src/lib/integrations/notifications.ts`, `src/lib/notifications/discord.ts`)                                                                                         |
| Email inbox         | The IMAP server a user enters                      | A user connects a mailbox (`src/lib/services/imap-client.ts`)                                                                                                                                     |

## What Mahope Cloud uses

Mahope runs the hosted TimeTrack service from this same code. The CI build in `.github/workflows/ci.yml` passes `NEXT_PUBLIC_SENTRY_DSN` and `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL` as build arguments when they are configured, and refuses to deploy without the Plausible URL. The hosted service therefore uses Plausible and, when a DSN is configured, Sentry. It also loads the Google Ads tag and looks up GitHub releases, as described above for the TimeTrack brand. A self-hosted build does not inherit those values; they come only from your own build arguments.

## If installation counts are ever added

None exist today. If opt-in installation statistics are added, the exact payload and a contact address will be listed here before the feature ships, and it will stay off unless you turn it on.
