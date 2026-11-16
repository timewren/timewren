# Install TimeWren

All methods use `ghcr.io/timewren/timewren:<version>`; the Docker Hub mirror name
is `docker.io/mahoje/timewren:<version>`. Images must be published before use.
Pin a release for controlled upgrades.
All app services set `MIGRATE_ON_START=1`. PostgreSQL is required; Valkey is
optional for one replica. Local file storage needs a persistent volume.

| Method          | Files                                      | Notes                                                                                          | Guide                                                               |
| --------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| One line        | `scripts/install.sh`                       | Downloads release files, generates secrets, pulls images; Docker required                      | [Quick install](https://timewren.com/docs/install/quick)            |
| Docker Compose  | `docker-compose.yml`, `.env.example`       | App, PostgreSQL, scheduler; optional Valkey profile                                            | [Compose](https://timewren.com/docs/install/docker-compose)         |
| Automatic HTTPS | `docker-compose.caddy.yml`                 | Overlay; `CADDY_DOMAIN`, public DNS and TCP 80/443 required                                    | [Reverse proxy](https://timewren.com/docs/operations/reverse-proxy) |
| Coolify         | [coolify/](coolify/)                       | Generated secrets and service domain; root Compose file is a compatibility symlink             | [Coolify](https://timewren.com/docs/install/coolify)                |
| Dokploy         | [dokploy/](dokploy/)                       | Compose, template variables, generated domain and volumes                                      | [Dokploy](https://timewren.com/docs/install/dokploy)                |
| Railway         | [railway/](railway/), `railway.json`       | Repository button needs manual database, volume and scheduler setup until template publication | [Railway](https://timewren.com/docs/install/railway)                |
| Render          | [render/](render/), `render.yaml`          | Paid web disk, scheduler worker and managed PostgreSQL; encryption key entered at deployment   | [Render](https://timewren.com/docs/install/render)                  |
| Kubernetes      | [../charts/timewren/](../charts/timewren/) | Helm; external or simple bundled PostgreSQL/Valkey, PVC, CronJobs                              | [Kubernetes](https://timewren.com/docs/install/kubernetes)          |

Configure mail, integrations and S3 with the names in [`.env.example`](../.env.example).
The scheduler uses `APP_URL` internally to reach the app; public links and auth
use `NEXT_PUBLIC_APP_URL`. Keep exactly one scheduler (or one set of Helm
CronJobs). The image includes `scripts/cron.mjs`, which reads the existing cron
schedule without executing shell commands and runs as the app's unprivileged user.
The old source-built `cron/` container remains available for source deployments.

## Upgrades and persistence

Back up PostgreSQL, uploaded files and `.env`/the platform secrets before an
upgrade. Preserve `ENCRYPTION_KEY`: replacing it makes saved integration tokens
unreadable. Keep one app replica when using local storage. Migration failure
behavior is inherited from the image: the app currently starts after reporting
a failed migration, so inspect startup logs during upgrades.

For Compose, change `TIMEWREN_VERSION` in `.env`, then run `docker compose pull`
and `docker compose up -d`. The installer never overwrites an existing `.env`.
The installer rebuilds on each run when the installation directory contains
`Dockerfile` and `package.json`; standalone installations only pull images.
Cron schedules always use Europe/Copenhagen, independently of the app's `TZ`.

For source builds, use the commented build block in `docker-compose.yml` or
the [development instructions](../README.md#local-development).

## Maintainer publication

The files here do not publish or deploy anything. The maintainer must publish
the release images and tags, enable public pulls for the GHCR/Docker Hub
organisation, publish Railway's multi-service template and update its button,
and submit the Coolify/Dokploy templates. Validate an actual deployment on each
platform after publication. Render's button uses the repository Blueprint.

Template sources and schemas are linked in each platform README; these files
are staging artifacts for upstream submission, not claims of marketplace listing.
