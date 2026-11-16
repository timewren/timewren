# Coolify

Use `deploy/coolify/docker-compose.yml` as the Compose path in a new Docker
Compose resource. `docker-compose.coolify.yml` is a compatibility symlink to
that file, so there is only one template to maintain. Nothing is built locally.

Coolify generates the public app URL, database password, session secret, cron
secret and 64-character hexadecimal encryption key. Set the app domain and
deploy. Back up the generated secrets and both named volumes. Optional mail,
S3 and integration variables are listed in the Compose file; additional app
environment variables use the names in `.env.example`.

The first account becomes admin. Create it immediately after deployment, or
set `ADMIN_EMAIL` and a mail transport before exposing the instance. Changing
the database password later does not rotate the password stored in Postgres.

For an upstream submission, copy the Compose template to Coolify's
`templates/compose/timewren.yaml` and the included logo to
`templates/compose/svgs/timewren.svg`. This repository does not submit it.

Format reference: [Coolify Docker Compose](https://coolify.io/docs/knowledge-base/docker/compose).
