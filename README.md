<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/timewren/readme-banner-dark.svg">
    <img alt="TimeWren" src="public/brand/timewren/readme-banner-light.svg" width="100%">
  </picture>
</h1>

**Open-source time tracking, prepaid hours and invoicing for freelancers and small agencies.**

[Website](https://timewren.com) · [Docs](https://timewren.com/docs) · [Install](https://timewren.com/docs/install/quick) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-1C2119.svg)](LICENSE)
[![Image on GHCR](https://img.shields.io/badge/image-ghcr.io%2Ftimewren%2Ftimewren-3F5A3A.svg)](https://github.com/timewren/timewren/pkgs/container/timewren)
[![Docs for LLMs](https://img.shields.io/badge/docs-llms.txt-8A5A2B.svg)](https://timewren.com/llms.txt)

TimeWren tracks your hours, keeps an eye on prepaid hour packages and turns time into invoices in your accounting system. The same code runs the Danish TimeTrack Cloud service. There is no closed enterprise edition and no CLA.

No locked features by design. Cloud sells operations, not code. See [Cloud vs. self-hosting](docs/cloud-vs-selvhost.md) for what differs between Cloud and a self-hosted instance.

```bash
curl -fsSL https://timewren.com/install.sh | bash
```

![Dashboard with a running timer](.github/assets/screenshots/dashboard.webp)

|                                                                       |                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ![Time entries, week view](.github/assets/screenshots/time-week.webp) | ![Prepaid hours overview](.github/assets/screenshots/prepaid-hours.webp) |
| ![An invoice](.github/assets/screenshots/invoice.webp)                | ![The client portal](.github/assets/screenshots/client-portal.webp)      |

## Why TimeWren

- **Prepaid hours ("klippekort").** Clients buy a block of hours up front; every time entry draws from the balance, with alerts before it runs out and a client portal where they can follow along.
- **From hours to invoices.** Invoices as PDF or straight into Billy, Dinero or e-conomic, with payment status synced back.
- **Track it however you work.** Live timer, manual entries, calendar, a browser extension, mobile apps and a desktop app that detects what you work on. A self-hosted instance has the web app today; see [Apps](#apps) for the other clients.
- **Privacy first.** The desktop app classifies activity on your machine; raw activity never leaves it.
- **AI-ready, on your terms.** A built-in MCP server lets Claude or ChatGPT log and look up time through OAuth, with scopes you approve and can revoke.
- **Your language.** Complete in Danish and English, plus 16 more languages in beta (among them German, Spanish, Swedish, Norwegian, Finnish, Dutch and French) that fall back to English, with a shared glossary so terms stay consistent. See [docs/i18n](docs/i18n/README.md).
- **Teams when you need them.** Organisations, roles, team overview, approvals and audit log.

## Get started

### TimeWren Cloud

TimeWren Cloud is opening soon at [timewren.com](https://timewren.com), with a free plan, hosting in the EU, backups, the official signed apps and support. Paying for Cloud is what funds development. The same service already runs in Danish as [TimeTrack](https://timetrack.dk).

### Run your own instance

One command installs TimeWren with Docker Compose on a Linux server. See [Self-hosting](#self-hosting) below for the other paths, and the [documentation](https://timewren.com/docs) for configuration, upgrades and backups.

### Local development

Requirements: Node.js 22+, Docker and npm.

```bash
cp .env.example .env.local   # at least DATABASE_URL and BETTER_AUTH_SECRET
npm install
npm run docker:up            # PostgreSQL
npm run db:migrate
npm run dev                  # http://localhost:3000
```

`npm run dev:setup` runs the database steps, seeds demo data and starts the dev server in one go.

## Self-hosting

Choose one of four installation paths. All use the same app image and environment variables, run migrations at startup and include scheduled jobs. Docker Engine with Compose v2.24+ must already be installed for the first two paths.

1. **One line**, without cloning this repository:

   ```bash
   curl -fsSL https://timewren.com/install.sh | bash
   # Public HTTPS, with DNS pointing at this server:
   curl -fsSL https://timewren.com/install.sh | bash -s -- --with-caddy --domain time.example.com
   ```

   Run in an empty installation directory, or pass `--dir /path/to/timewren`.
   Use `--version <release-tag>` to choose a release and `--url`/`--port` for
   a custom origin. No prompts, sudo or source build. Existing `.env` stays
   untouched on reruns; edit its image pin and pull to upgrade.

2. **Docker Compose**, with the prebuilt image:

```bash
curl -fsSLO https://raw.githubusercontent.com/timewren/timewren/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/timewren/timewren/main/.env.example
cp .env.example .env
for v in POSTGRES_PASSWORD BETTER_AUTH_SECRET ENCRYPTION_KEY CRON_SECRET; do sed -i "s|^$v=.*|$v=$(openssl rand -hex 32)|" .env; done
docker compose up -d
# open http://localhost:3000, the first account becomes admin
```

3. **Hosting platforms:** [Coolify](deploy/coolify/), [Dokploy](deploy/dokploy/),
   [Railway](deploy/railway/) or [Render](deploy/render/). Railway's repository
   button requires adding the database, storage and scheduler manually until
   the multi-service template is published. Render requires paid services and
   asks for a 64-character hex encryption key.

   [![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new)
   [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/timewren/timewren)

   In Railway, choose **Deploy from GitHub Repo**, then `timewren/timewren`.

4. **Kubernetes:** install the dependency-free [Helm chart](charts/timewren/),
   with bundled or external PostgreSQL and optional Valkey.

See the [deployment comparison](deploy/README.md) and [self-hosting guide](docs/self-hosting.md)
for reverse proxies, TLS, upgrades, backups, mail, file storage and integrations.

## Features

| Area                 | What you get                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Time tracking        | Live timer, manual entries, segments, CSV import, calendar view                                                |
| Prepaid hours        | Packages per client or project, automatic deduction, low-balance alerts, usage history with CSV and PDF export |
| Invoicing            | PDF invoices, email delivery, Billy, Dinero and e-conomic sync                                                 |
| Clients and projects | Lightweight CRM, CVR lookup, rate hierarchy (project, client, default)                                         |
| Tasks                | Kanban board, recurring tasks, email-to-task                                                                   |
| Client portal        | A portal where clients see hours and balances                                                                  |
| Teams                | Organisations, roles, team day and week overview                                                               |
| Integrations         | Billy, Dinero, e-conomic, Google Calendar, REST API, MCP server                                                |

## Apps

| Platform          | Notes                                                             | Your own server                                     |
| ----------------- | ----------------------------------------------------------------- | --------------------------------------------------- |
| Web               | This repository                                                   | Yes                                                 |
| Browser extension | Chrome and Firefox, in [`browser-extension/`](browser-extension/) | Yes: enter your server's address when you sign in   |
| Desktop           | macOS and Windows, written in Rust                                | Planned. Works locally without any server           |
| Mobile            | iOS and Android                                                   | Planned. Builds can point at a server at build time |

## Tech stack

Next.js 16, React 19 and TypeScript · tRPC 11 · Drizzle ORM on PostgreSQL · Better Auth (OAuth, passkeys, 2FA) · Tailwind CSS 4 · Biome · Vitest and Playwright.

## Commands

```bash
npm run dev        # Development server
npm run dev:setup  # Docker + migrate + dev
npm run build      # Production build
npm run lint       # Biome linter
npm run db:studio  # Database GUI
npm test           # Unit tests (Vitest, no database needed)
npm run test:e2e   # E2E tests (Playwright, needs PostgreSQL)
```

## Environment

Copy `.env.example` to `.env.local`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/freelance_crm"
BETTER_AUTH_SECRET="your-secret"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
CRON_SECRET="your-cron-secret"
RESEND_API_KEY=""  # Email via Resend. Or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD; with neither, emails are only logged
REQUIRE_EMAIL_VERIFICATION="true"  # "false" only works without a mail transport (self-hosting); the server warns
ADMIN_EMAIL=""  # Becomes instance admin on sign-up/login; without it, the first user becomes admin
STORAGE_DRIVER=""  # "local" = files on disk under STORAGE_LOCAL_PATH (Docker volume) instead of S3
ENCRYPTION_KEY=""  # 64 hex chars (openssl rand -hex 32): AES-256-GCM key for stored tokens and credentials
EMAIL_SYNC_STORE_ATTACHMENTS="false"  # "true" = IMAP sync uploads attachment files (private S3); default stores metadata only
```

### Brand and marketing pages (self-hosting)

- `NEXT_PUBLIC_BRAND=timewren|timetrack` picks the product name, logo and mail branding. It is runtime configuration: set it as an ordinary environment variable when the container starts (the server reads it per request and hands it to the browser via `/runtime-config.js`), so one image serves any brand and URL without a rebuild. Default (unset) is `timewren`; Mahope's cloud runs with `timetrack`, so set `NEXT_PUBLIC_BRAND=timetrack` in the runtime environment of every TimeTrack Cloud deployment (including beta), or it silently switches to TimeWren.
- `SUPPORT_EMAIL` / `NEXT_PUBLIC_SUPPORT_EMAIL` override the support address shown in the app and mails (default `support@<EMAIL_DOMAIN>`).
- With the `timewren` brand and no `NEXT_PUBLIC_MARKETING_URL`, the marketing site (home, pricing, blog, landing pages) is switched off: `/` redirects to the dashboard and marketing routes return 404. The allowlist lives in `src/lib/marketing-guard.ts`.

### Telemetry (self-hosting)

A self-hosted instance sends **no telemetry, no analytics and no error reports to the maintainers** by default. Nothing points at Mahope's hosts or accounts unless you set it yourself:

- `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL` loads a Plausible script (baked in at build time; also pass it as a Docker build arg). Unset = no analytics script and no analytics host in the CSP.
- `NEXT_PUBLIC_SENTRY_DSN` enables Sentry. Unset = Sentry is a no-op.
- Auth origins come from `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MARKETING_URL` and an optional comma-separated `TRUSTED_ORIGINS`. The mobile/desktop app schemes are always allowed.
- `EMAIL_DOMAIN`, `PERSONAL_FROM_EMAIL`, `PERSONAL_REPLY_TO_EMAIL` and `FEEDBACK_TO_EMAIL` control generated mail addresses. Unset = default sender, no Reply-To, and in-app feedback/trial-extension requests are not mailed (feedback goes to Discord only).
- `TRUSTED_ORIGINS` www-variants are added only for bare two-label domains (`example.com`, not `example.co.uk`); list other variants explicitly.

## Project Structure

```
src/
├── app/              # Next.js routes
├── components/       # React components
└── lib/
    ├── db/           # Drizzle schema
    ├── trpc/         # API routers
    └── integrations/ # Billy, Dinero, e-conomic, calendars
drizzle/              # SQL migrations
browser-extension/    # Browser extension
```

## Contributing

Bug reports, translations, integrations and fixes are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; every commit needs a DCO sign-off (`git commit -s`).

## License

TimeWren is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must make your source code available to its users.

The browser extension in [`browser-extension/`](browser-extension/) is MIT-licensed, so it can be distributed through the browser stores. The desktop and mobile apps are AGPL as well; the mobile app has an [additional permission](licenses/MOBILE-APP-STORE-EXCEPTION.md) for distribution through the Apple App Store and Google Play. See [LICENSE](LICENSE) for the exact paths and [docs/licensing.md](docs/licensing.md) for the terms of the official desktop builds.

The TimeTrack and TimeWren names and logos are not covered by the code license; see [TRADEMARK.md](TRADEMARK.md).

---

**TimeWren** · [timewren.com](https://timewren.com) · made in Denmark by [Mahope](https://mahoje.dk)
