# Dokploy

Import `docker-compose.yml` and `template.toml` as a custom template. The TOML
generates a domain and four independent 64-character hexadecimal secrets and
routes that domain to app port 3000. Named volumes hold PostgreSQL data and
uploads; `mounts = []` is intentional because no host file is required.

The app and scheduler pull the same published image. Migrations run when the
app starts. Set `TIMEWREN_VERSION` to pin both services to a release. Optional
mail, S3 and integration variables are exposed in Compose; all application
variables use the names in `.env.example`.

Back up both volumes and `ENCRYPTION_KEY`. The first account becomes admin;
register immediately, or set `ADMIN_EMAIL` and mail before exposing the URL.

For an upstream PR, copy this directory's Compose, TOML, metadata and logo to
`blueprints/timewren/` in [Dokploy/templates](https://github.com/Dokploy/templates).
Select a published image tag and update the metadata version before submission.
No template has been submitted by this job.
