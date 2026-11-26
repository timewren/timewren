# Self-hosting TimeWren

The self-hosting guide has moved to the TimeWren documentation at **https://timewren.com/docs**. The sources are in [`content/docs/en/`](../content/docs/en/) in this repository (with Danish, German and Spanish translations next to it).

Instance pages follow the running app URL and brand. Self-hosted instances of either brand must explicitly set `NEXT_PUBLIC_MARKETING_URL` to enable marketing pages. The privacy, GDPR, terms, and data processing pages direct users to the instance operator. Desktop downloads keep the repository selected at build time. With marketing enabled, shared navigation and site metadata use the running marketing URL and brand. Editorial metadata and page copy describe TimeTrack Cloud, including its pricing and publisher. The public Cloud data processing agreement PDF is only available on TimeTrack Cloud. See the environment variable guide below.

| Topic                                                                      | Page                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Requirements and first start                                               | [Quickstart](https://timewren.com/docs/quickstart)                           |
| One-line installer (`scripts/install.sh`)                                  | [One-line install](https://timewren.com/docs/install/quick)                  |
| Docker Compose, Coolify, Dokploy, Railway, Render, Kubernetes, from source | [Install](https://timewren.com/docs/install/docker-compose)                  |
| Every environment variable                                                 | [Environment variables](https://timewren.com/docs/configuration/environment) |
| Mail (SMTP, Resend)                                                        | [Email](https://timewren.com/docs/configuration/email)                       |
| Local disk and S3-compatible storage                                       | [File storage](https://timewren.com/docs/configuration/storage)              |
| Login providers, passkeys, 2FA                                             | [Authentication](https://timewren.com/docs/configuration/authentication)     |
| Caddy, Traefik, nginx and TLS                                              | [Reverse proxy and TLS](https://timewren.com/docs/operations/reverse-proxy)  |
| Updates and migrations                                                     | [Upgrading](https://timewren.com/docs/operations/upgrading)                  |
| `scripts/backup.sh`, `scripts/restore.sh`                                  | [Backup and restore](https://timewren.com/docs/operations/backup-restore)    |
| Common problems                                                            | [Troubleshooting](https://timewren.com/docs/operations/troubleshooting)      |
| Billy, Dinero, e-conomic, calendars, CVR                                   | [Integrations](https://timewren.com/docs/integrations/billy)                 |
| REST API, webhooks, MCP                                                    | [API](https://timewren.com/docs/api/rest)                                    |

## Build profiles

`npm run build` takes `BUILD_PROFILE` (`scripts/build.mjs`):

- `full` (default): the whole app. This is TimeTrack Cloud: marketing pages, blog, landing pages and the TimeWren website.
- `selfhost`: leaves `src/app/(marketing)` and `src/app/(timewren)` out of `next build`. The published image and the compose build example use it (`BUILD_PROFILE` is a Docker build argument). The app, the instance pages (cookies, contact, download, account deletion, and the operator pages for privacy, GDPR, terms and data processing) and the middleware are the same in both profiles.

The profile script moves the two directories to `.build-profile-stash/` for the build and always moves them back, also when the build fails or is interrupted. After a hard kill, the next `npm run build` (or `npm run build:restore`) restores them first. The selfhost type check uses `tsconfig.selfhost.json`, which leaves out tests and aliases `src/lib/instance-marketing-loader.ts` to its stand-in `instance-marketing-loader.selfhost.ts`.

Shared pages that a selfhost build needs live in `src/components/instance-pages/` (the marketing routes re-export them, so Cloud URLs and layouts are unchanged). `npm run check:build-profile` (part of `npm run check` and run by the profile build) fails on any import from app code into the two omitted directories; the loader module above is the only exception.

A selfhost build has no marketing pages, so `NEXT_PUBLIC_MARKETING_URL` has nothing to enable there. Build with `BUILD_PROFILE=full` for that.

Measured on the CI-class runner (16 CPUs, shared, typecheck on): see [research/2026-11-18-selfhost-image-measurement.md](research/2026-11-18-selfhost-image-measurement.md), section "Selfhost build profile (#1100)".

Telemetry and outbound connections are listed in [telemetry.md](telemetry.md).

For AI agents: https://timewren.com/llms-full.txt has the whole documentation in one Markdown file, and every page is also available as Markdown by adding `.md` to its URL. See [Use these docs with your LLM](https://timewren.com/docs/llm).
