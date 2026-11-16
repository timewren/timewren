# Versioning and releases

## What has a version

| Component                     | Version source                    | Tag                | Changelog                          |
| ----------------------------- | --------------------------------- | ------------------ | ---------------------------------- |
| Web app, API and Docker image | `package.json`                    | `vX.Y.Z`           | [CHANGELOG.md](../../CHANGELOG.md) |
| Browser extension             | `browser-extension/manifest.json` | `extension-vX.Y.Z` | `browser-extension/CHANGELOG.md`   |
| Desktop app                   | `desktop/` package metadata       | `desktop-vX.Y.Z`   | its own changelog                  |
| Mobile app                    | `mobile/` app config              | `mobile-vX.Y.Z`    | its own changelog                  |

The clients have their own version lines and release when they change, not with every web release. The extension continues its existing numbering (2.x).

TimeTrack Cloud runs released versions too: a merge to `main` builds an image but does not deploy, and production is updated from the same `vX.Y.Z` tags (see [RELEASING.md](../RELEASING.md)). Cloud and self-hosted therefore share one version line.

## Semantic Versioning in 0.x

Versions follow [SemVer 2.0.0](https://semver.org/). The first public release is **0.1.0**. Until 1.0.0:

- **0.MINOR** (0.1.0 to 0.2.0): new features, and breaking changes. A breaking change is anything that needs action from a self-hoster or an API user: a renamed or removed environment variable, a changed API response, a removed feature, a migration that changes existing data. Breaking changes are listed under `### Breaking` in the changelog, with a `### Migration` group in the same release that says exactly what to do.
- **0.x.PATCH** (0.1.0 to 0.1.1): bug fixes and security fixes only, safe to install without reading anything first. A patch release may contain a migration only if a fix needs it and it only adds.
- **Prereleases** (`0.2.0-rc.1`) are optional, for testing larger changes. They never get the `latest` Docker tag.

From 1.0.0 on, breaking changes raise MAJOR instead.

## Database migrations

- Migrations are forward-only. There are no down migrations.
- They run automatically at startup in the Docker setup (`MIGRATE_ON_START=1`), before the web server starts, see [Updating](../self-hosting.md#updating).
- You can upgrade from any earlier 0.x release straight to the newest; migrations run in order.
- Downgrading is not supported. Take a backup before upgrading and restore it to go back.
- Destructive changes (dropping or renaming a column or table) are spread over two minor releases: the first stops using the old column, the second removes it, and both are in the changelog.

## Docker tags

A release `v0.1.0` publishes:

| Tag      | Moves?                                  | Use                                  |
| -------- | --------------------------------------- | ------------------------------------ |
| `0.1.0`  | never                                   | exact pinning                        |
| `0.1`    | to each new `0.1.x` patch               | recommended: fixes without surprises |
| `latest` | to each new stable release, also minors | trying things out                    |

Images are published to `ghcr.io/timewren/timewren` (and Docker Hub when configured) by `.github/workflows/image.yml` from a `v*` tag.

## Client compatibility

- Each client release states the oldest web version it needs in its release notes, as `Requires TimeWren web 0.X.0 or later`, and in a table in its changelog.
- The web app keeps its API working for client versions released alongside the previous minor release. Removing support for an older client is a breaking change.
- A server can refuse outdated clients with `MIN_CLIENT_VERSIONS` (see `.env.example`).

## Making a release

1. `npm run release:next` suggests the next version. It reads the `[Unreleased]` section of `CHANGELOG.md` and the Conventional Commit prefixes since the last tag (`--since <ref>` for another starting point). The bigger of the two wins: `Breaking` or `!` raises MINOR before 1.0.0; `Added`, `Changed`, `Deprecated`, `Removed` or `feat:` raise MINOR; `Fixed`, `Security` or `fix:` raise PATCH. It changes nothing.
2. Move the `[Unreleased]` entries into a new section `## [X.Y.Z] - YYYY-MM-DD` and leave an empty `## [Unreleased]` above it.
3. Set the version: `npm version X.Y.Z --no-git-tag-version`.
4. `npm run release:check` must pass: `package.json`, the newest dated changelog section and any `v*` tag on the commit must agree, sections must be dated and in order, and every `Breaking` group needs a `Migration` group. CI runs it on every pull request, and the image workflow runs it for the tag before building.
5. Commit, sync to `timewren/timewren`, tag the commit there with `vX.Y.Z` and push the tag. The image workflow publishes the Docker image.
6. Create a GitHub release from the tag with the changelog section as notes, and post it in Discussions, Announcements.

## When 1.0.0

1.0.0 is released when all of these hold:

- **Stable interfaces:** the configuration variables, the API used by the clients and the MCP tools are documented, and changes to them follow a deprecation period of at least one minor release.
- **Tested upgrades:** CI upgrades a database with demo data from the first release of every previous minor to the new version, and backup and restore are tested.
- **Real use:** at least 10 self-hosted installations have run for 3 months or more without a critical bug (data loss, broken upgrade or security issue) in the newest minor release.
- **No open `priority: critical` issues**, and the self-hosting guide covers install, upgrade, backup and restore.
