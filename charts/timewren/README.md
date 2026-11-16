# TimeWren Helm chart

Requires Helm 3, Kubernetes 1.27+ (CronJob time zones), and a default StorageClass
or explicitly configured storage classes. No third-party chart dependencies or
Bitnami images are used. This chart does not configure DNS or issue certificates.

```sh
helm upgrade --install timewren ./charts/timewren \
  --namespace timewren --create-namespace \
  --set image.tag=<release-version> \
  --set appUrl=https://time.example.com \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.host=time.example.com
```

Configure `ingress.tls` and the appropriate ingress annotations for your TLS
controller. Without an Ingress, use `kubectl port-forward -n timewren
service/timewren-timewren 3000:3000` and `appUrl=http://localhost:3000`.
The first account becomes admin unless `extraEnv.ADMIN_EMAIL` is set. Mail is
optional; email verification becomes required when a mail transport is configured.

The app waits for PostgreSQL before starting and sets `MIGRATE_ON_START=1`, like
Compose. Migrations run through the image's startup script. Take a database and
file backup before upgrades; an image rollback does not roll back schema changes.

## Secrets and external services

By default the chart generates secrets on first install and uses Helm `lookup`
to retain them on upgrade. `ENCRYPTION_KEY` is exactly 64 hexadecimal characters.
Back up this key: losing it requires reconnecting stored integrations.
Explicit `secrets` values override generated values. Changing a bundled
PostgreSQL password does not change an existing database password automatically.

For GitOps or an external secret manager, use `existingSecret`: offline
`helm template` cannot reuse existing generated secrets. The referenced Secret
must contain these exact environment-variable names:

| Key                  | Required                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Always; when using bundled PostgreSQL, point at `<release>-timewren-postgresql:5432/timewren`, user `timewren` |
| `BETTER_AUTH_SECRET` | Always; use a long random value                                                                                |
| `ENCRYPTION_KEY`     | Always; 64 hexadecimal characters                                                                              |
| `CRON_SECRET`        | Always; same key is used by app and CronJobs                                                                   |
| `POSTGRES_PASSWORD`  | With bundled PostgreSQL; must match the password in `DATABASE_URL`                                             |
| `VALKEY_URL`         | With bundled or external Valkey                                                                                |

```yaml
postgresql:
  enabled: false
valkey:
  enabled: false
existingSecret: timewren-secrets
extraEnv:
  RATE_LIMIT_BACKEND: valkey # only when using external Valkey
```

Alternatively, set `secrets.DATABASE_URL` with `postgresql.enabled=false`. Do not
pass secrets on the command line or commit them into values files. Helm stores
rendered Secrets in release history; use appropriate RBAC and encrypted storage.
Restart the app after updating an external Secret (`kubectl rollout restart`).

`extraEnv` accepts the same variable names as `.env.example`, including SMTP,
S3 and integration settings. Put credential values in `existingSecret` rather
than `extraEnv`. Optional bundled Valkey is enabled with `valkey.enabled=true`;
the chart then sets `VALKEY_URL` and `RATE_LIMIT_BACKEND=valkey`. The bundled
database and Valkey are single-node services for small installations, without
automatic backups, failover or high availability. Use managed services where
those are required. They expose no NodePort or public load balancer.

## Storage

The app uses one replica, `Recreate` updates and a ReadWriteOnce PVC at
`/app/data/storage`. The pod runs as UID/GID 1001 with fsGroup 1001 so mounted
storage is writable. Set `persistence.existingClaim` to reuse a prepared claim,
or `persistence.storageClass` and `persistence.size` to provision one.

For S3-compatible storage, set `persistence.enabled=false` and configure
`STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY` and `S3_BUCKET` through `extraEnv`/`existingSecret`.
Disabling persistence without an external storage driver is not durable.

The app PVC is retained on Helm uninstall (`helm.sh/resource-policy: keep`).
StatefulSet claims are also retained by Kubernetes by default. Remove these
claims manually only after backing up data. PVCs are not backups; schedule
database dumps and storage snapshots separately. Back up the Secret as well.

## Scheduled jobs

`cron.enabled=true` creates one CronJob per endpoint with the schedules from
`cron/entrypoint.sh`, using `Europe/Copenhagen`. Billing jobs are included, and
are no-ops without a billing provider. CronJobs use `concurrencyPolicy: Forbid`,
bounded curl timeouts and a private temporary curl config file, so the bearer
secret is absent from process arguments and logs. Modify `cron.jobs` to override
schedules. Disable cron here if another scheduler already calls the endpoints.

## Validation

```sh
helm lint charts/timewren
helm template test charts/timewren > /tmp/timewren.yaml
helm template test charts/timewren --set valkey.enabled=true --set ingress.enabled=true
helm template test charts/timewren --set postgresql.enabled=false --set existingSecret=timewren-secrets
# Optional Kubernetes schema validation:
kubeconform -strict -summary -kubernetes-version 1.30.0 /tmp/timewren.yaml
```

Rendered manifests include generated secrets. Keep them private and delete them
after validation. No image build or cluster deployment is needed for these checks.
