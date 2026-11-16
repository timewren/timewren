# Render

Deploy the root `render.yaml` Blueprint. It pulls the published image for a web
service and a scheduler worker, creates managed PostgreSQL 18, and attaches a
10 GB persistent disk to `/app/data/storage`. No application image is built and
Valkey is not required for a single app replica. Both compute services and the
database use paid plans; review Render's cost estimate before deployment.

At creation, enter `ENCRYPTION_KEY` as exactly 64 hexadecimal characters
(`openssl rand -hex 32`). Render generates the session and cron secrets. Its
secret generator emits base64, which is why it cannot generate the encryption
key. Back up that key with the database and uploads.

The default public app URL is taken from `RENDER_EXTERNAL_URL`. If you add a
custom domain later, set `NEXT_PUBLIC_APP_URL` to its HTTPS URL without a
trailing slash. Optional mail and integration variables use `.env.example`'s
names. The first account becomes admin; create it immediately, or configure
`ADMIN_EMAIL` and mail before exposing the service.

Migrations run on web-service startup. The always-running worker calls the web
service over Render's private network using the shared `CRON_SECRET`, following
the schedule in `scripts/cron.mjs`. It has no disk or database credentials. Do
not scale either service beyond one replica. A disk-backed web service briefly
stops during redeploys; Render cannot do rolling deployments with that disk.

The Blueprint has been validated against the official JSON schema, but has
not been deployed to a Render account. Confirm registration, upload/download
and a scheduled export after the first deployment. Pin both image URLs to the
same published release tag before an operational rollout.

References: [Blueprint specification](https://render.com/docs/blueprint-spec),
[persistent disks](https://render.com/docs/disks).
