# Contributing to TimeWren

Thanks for wanting to help. TimeWren is time tracking and a lightweight CRM for freelancers and small agencies, with prepaid hour packages ("klippekort"), invoicing and Danish accounting integrations. Bug fixes, translations, integrations and docs are all welcome.

## Before you start

- **Bugs:** search the existing issues first, then open one with steps to reproduce.
- **Features and larger changes:** open an issue or a thread in Discussions, Ideas, before writing code, so we can agree on the approach. It saves both of us time.
- **Security issues:** never in public. See [SECURITY.md](SECURITY.md).
- Issues labelled `good first issue` are a good place to begin; `help wanted` means a pull request is welcome.

How issues and pull requests are handled is described in [docs/oss/maintaining.md](docs/oss/maintaining.md).

## Local setup

Requirements: Node.js 22+, Docker (for PostgreSQL 18) and npm. Works on Linux, macOS and Windows. If you have an older local PostgreSQL 16 volume from `docker-compose.dev.yml`, the new one is a separate volume (`postgres18_data`); the old one can be removed.

```bash
npm run setup
```

This creates `.env.local` with local secrets (an existing file is left alone), installs dependencies, starts PostgreSQL in Docker, runs the migrations, seeds demo data and starts the dev server in the background on http://localhost:3000 (log in `.next/dev.log`, stop with `npm run dev:stop`). Afterwards `npm run dev` starts the server in the foreground.

Optional services (S3 storage, email, Valkey, payments, accounting integrations) are configured in `.env.local`; `.env.example` lists every option. Leave them empty when you don't need them.

## Making a change

1. Fork the repository and branch off `main`.
2. Keep the change focused: one fix or feature per pull request.
3. Run the checks before you push:

   ```bash
   npm run lint          # Biome
   npx tsc --noEmit      # types
   npm test              # unit tests (Vitest), no database needed
   npm run i18n:check    # message catalogs
   npm run lint:copy     # user-facing wording rules (docs/BRAND.md)
   node scripts/check-migration-journal.mjs   # every drizzle/*.sql is in the journal
   ```

   `npm run check` runs all of these in one go (`npm run typecheck` is the type check alone). CI additionally runs the date and time logic under `TZ=Europe/Copenhagen` and the timer model tests against PostgreSQL (`npm run test:model`, see [docs/testing/timer-model-tests.md](docs/testing/timer-model-tests.md)).

   `npm run test:e2e` runs the Playwright tests against a local database (see `tests/e2e/README.md`).

4. Add or update tests when you change behaviour. Database changes go through Drizzle (`src/lib/db/schema.ts`, then `npm run db:generate`). Migrations are forward-only: add columns and tables, don't drop or rename them in the same release.
5. Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a user or self-hoster would notice.
6. Open the pull request against `main` and fill in the template. Add before and after screenshots for UI changes, using demo data.

What a pull request needs before it can be merged is listed in [docs/oss/maintaining.md](docs/oss/maintaining.md#what-a-pull-request-needs).

## Conventions

- Formatting and linting are Biome only (no ESLint or Prettier).
- User-facing text lives in `src/i18n/messages/<language>/`, never hardcoded. New text needs `en` and `da`; other languages may be missing and fall back to English. Browser extension store texts (`browser-extension/_locales/`) must be complete in every folder that exists. Run `npm run i18n:check`; see [docs/i18n/README.md](docs/i18n/README.md) and the [glossary](docs/i18n/glossary.md).
- No feature may depend on a plan, license key, brand or billing setting. Billing only controls invoicing, trials and capacity.
- Commit messages are short, in the imperative mood, and use [Conventional Commits](https://www.conventionalcommits.org/) prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Mark breaking changes with `!` (`feat!: ...`). The prefixes feed the release tooling ([docs/oss/versioning.md](docs/oss/versioning.md)).

## Developer Certificate of Origin (DCO)

TimeWren uses the [Developer Certificate of Origin](https://developercertificate.org/) instead of a CLA. By signing off a commit you certify that you wrote the change or otherwise have the right to submit it under the project's license.

Sign off every commit with `-s`:

```bash
git commit -s -m "fix: round klippekort balance correctly"
```

This adds a line like the one below, using your real name and the email from your git config:

```
Signed-off-by: Jane Doe <jane@example.com>
```

Forgot? Fix the last commit with `git commit --amend -s --no-edit`, or a whole branch with `git rebase --signoff main`, then force-push your branch. Pull requests with unsigned commits cannot be merged. Please rebase instead of merging `main` into your branch.

## License

TimeWren is licensed under the [GNU Affero General Public License v3.0](LICENSE), except the paths listed as MIT in that file (such as `browser-extension/`). Your contributions are licensed under the license of the files you change; contributions to the mobile app also carry its [app store permission](licenses/MOBILE-APP-STORE-EXCEPTION.md). The TimeWren name and logo are not covered by the code license, see [TRADEMARK.md](TRADEMARK.md).

## Code of Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
