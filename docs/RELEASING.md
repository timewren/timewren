# Releasing

Production follows released versions, not `main`.

- Merge to `main`: pushes `:main` and `:<sha>`. No deploy.
- Tag `vX.Y.Z`: pushes `:vX.Y.Z`, `:X.Y`, `:latest` and `:<sha>`, then deploys
  production (Dokploy redeploys `:latest`, plus the cron sidecar).

The same tags exist for `ghcr.io/mahope/timetrack-cron` (`:vX.Y.Z`, `:latest`, `:main`, `:<sha>`).

`:latest` only moves when a release is tagged, so a production restart never
picks up unreleased code.

## Version numbers

Semantic versioning, one version line for TimeTrack Cloud and self-hosted
TimeWren ([oss/versioning.md](oss/versioning.md)). It continues from the last
published release of this repository (v0.30.0), so the first versioned
release is v0.31.0. Never reuse or go below a published version.

- `PATCH` (0.31.1): fixes only.
- `MINOR` (0.32.0): new features, or a migration.
- `MAJOR`: reserved for 1.0.

The version lives in `package.json`. The release workflow fails if the tag and
`package.json` disagree. The image is built with
`NEXT_PUBLIC_APP_VERSION=<version>-<short sha>`, which the feedback panel and
the "new version, reload" prompt read.

## Cutting a release

1. Make sure `main` is green (CI/CD on the last merge).
2. Take a database backup on the production server.
3. Point beta at `main` and smoke-test it. Beta shares the production
   database, so migrations on `main` must be expand-only (add columns and
   tables, never drop or rename) until the release that uses them is out.
4. In a PR (`chore: Release vX.Y.Z`): move the `[Unreleased]` entries of
   `CHANGELOG.md` into `## [X.Y.Z] - YYYY-MM-DD`, run
   `npm version X.Y.Z --no-git-tag-version`, and check with
   `npm run release:check` (see [oss/versioning.md](oss/versioning.md)). Merge it.
5. Tag the merge commit and push the tag:

   ```bash
   git fetch origin
   git tag -a vX.Y.Z origin/main -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

6. CI/CD runs checks, model tests and the build, then deploys. Verify:
   the running container's image label `org.opencontainers.image.revision`
   matches the tag's commit, `/api/health` is healthy, migrations ran, and
   Sentry shows no new errors.
7. Draft the GitHub release notes and the in-app "Nyhed". Both are published
   by the maintainer.

Re-running a release: `gh workflow run ci.yml --ref vX.Y.Z`.

## Rollback

Point the Dokploy production app (and the cron sidecar) at the previous
version's image, for example `ghcr.io/mahope/timetrack:v0.31.0`, and redeploy.
A migration is not rolled back automatically, which is why migrations between
releases are expand-only.
