# Railway

The root `railway.json` configures the web service. Its Dockerfile only pulls
the published image: it does not compile the app. For a pinned release, change
the Dockerfile's `FROM` tag. `cron.json` configures a second, always-running
scheduler service using that same image. Valkey is optional and is not needed
for a single app replica.

Railway config-as-code describes one service, not an entire project. Until a
maintainer publishes the multi-service template, the README button opens the
repository deployment flow and the following setup is required:

1. Add PostgreSQL to the project. Deploy the web service from this repository
   with `/railway.json` as the config path. Mount a volume at
   `/app/data/storage`. Keep one replica.
2. Set these web variables (Railway references are literal values):

   | Variable                     | Value                                                          |
   | ---------------------------- | -------------------------------------------------------------- |
   | `DATABASE_URL`               | `${{Postgres.DATABASE_URL}}` (match the database service name) |
   | `BETTER_AUTH_SECRET`         | Independent random secret                                      |
   | `ENCRYPTION_KEY`             | Output of `openssl rand -hex 32`                               |
   | `CRON_SECRET`                | Independent random secret                                      |
   | `NEXT_PUBLIC_APP_URL`        | Public HTTPS URL, without a trailing slash                     |
   | `NEXT_PUBLIC_BRAND`          | `timewren`                                                     |
   | `MIGRATE_ON_START`           | `1`                                                            |
   | `STORAGE_DRIVER`             | `local`                                                        |
   | `STORAGE_LOCAL_PATH`         | `/app/data/storage`                                            |
   | `REQUIRE_EMAIL_VERIFICATION` | `false` until mail is configured                               |
   | `HOSTNAME`                   | `0.0.0.0`                                                      |
   | `PORT`                       | `3000`                                                         |

3. Generate a public domain for the web service. Set `NEXT_PUBLIC_APP_URL` to
   that HTTPS URL, then redeploy. Add optional mail/integration values from
   `.env.example` before using those features.
4. Add a second service from the same repo, select
   `/deploy/railway/cron.json` as its config path, and set `CRON_SECRET` to
   `${{TimeWren.CRON_SECRET}}` and `APP_URL` to
   `http://${{TimeWren.RAILWAY_PRIVATE_DOMAIN}}:3000` (replace `TimeWren` with
   the actual web service name). Keep one scheduler replica, no public domain,
   no volume and no serverless sleeping.

Do not omit the scheduler: exports, imports, syncs and reminders need it. It
uses the full application schedule in `scripts/cron.mjs`. The scheduler never
needs database credentials. Migrations run only in the web service at startup.

The first registered account becomes admin. Set `ADMIN_EMAIL` and mail before
exposing the service if you need to reserve that account. Back up the database,
storage volume and encryption key.

Only the maintainer can publish a Railway project template containing these
three services, variables, volume and domains, then replace the repository
button with its generated template URL. Nothing has been published here.

References: [config as code](https://docs.railway.com/config-as-code),
[creating templates](https://docs.railway.com/templates/create).
