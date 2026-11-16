TimeTrack's browser JavaScript and local runner image are smaller. The implementation is pushed on `perf/slankere-js-og-image`; nothing was deployed, migrated, merged, or published as an image. Global Biome remains blocked by existing errors on the base commit.

Measurements were taken on agent-worker on 2026-11-04, against base `f5a7d4cd`. Host Node is 22.23.3, npm 10.9.9, Next.js 16.4.3. Both builds used `SENTRY_DISABLED=1`, the same dummy local database URL (`127.0.0.1:1`), and a build-only auth secret. No production credentials were loaded. Browser DSN and analytics build arguments were absent in both variants; enabled error delivery is tested separately with a mock transport.

| Measurement                              |        Before |         After |      Reduction |
| ---------------------------------------- | ------------: | ------------: | -------------: |
| Marketing median, 133 routes, gzip KiB   |        275.90 |        205.48 |          25.5% |
| `/`, gzip KiB                            |        279.85 |        209.43 |          25.2% |
| Dashboard median, 116 routes, gzip KiB   |        468.66 |        398.25 |          15.0% |
| `/dashboard`, gzip KiB                   |        478.65 |        408.24 |          14.7% |
| `/dashboard/clients/[id]`, gzip KiB      |        544.48 |        474.08 |          12.9% |
| Production dependency stage, MiB on disk |      1,828.43 |      1,386.57 |     441.86 MiB |
| Final runner `node_modules`, MiB on disk |      1,829.30 |      1,387.45 |     441.84 MiB |
| Local runner image, bytes                | 2,099,055,708 | 1,664,193,847 |          20.7% |
| Local runner image, MiB                  |      2,001.82 |      1,587.10 |     414.72 MiB |
| Local mobile Lighthouse median TBT, ms   |           502 |           609 | **21% slower** |

The JS and dependency targets are met. Lighthouse does not establish an interaction-performance improvement: TBT was 517/467/502 ms before and 494/609/836 ms after. These are three sequential Lighthouse 13.5.0 mobile/simulated-throttling runs per image on a shared, busy worker. Other builds and disk activity were running, so these results are noisy and should not be treated as a production performance estimate. Chrome Stable ran with its sandbox against localhost only. Both images served `/` successfully with the startup migration script bypassed.

All 296 route measurements, including raw bytes and gzip deltas, are in [the CSV](2026-11-04-first-load.csv). `scripts/measure-first-load.mjs` reads `.next/diagnostics/route-bundle-stats.json`, compresses each unique first-load chunk at gzip level 6, and sums the chunks for each route. It excludes lazy chunks, external scripts, CSS, and HTML. Marketing is every route outside `/dashboard`, `/admin`, `/api`, `/auth`, `/login`, `/register`, `/portal`, `/onboarding`, and `/r` (segment boundaries). Dashboard includes `/dashboard` and its descendants. Medians use the middle two values for an even-sized group; the dashboard middle values are equal here.

Reproduce the bundle measurement after each build:

```sh
DATABASE_URL=postgres://test:test@127.0.0.1:1/test \
BETTER_AUTH_SECRET=local-build-only-not-a-production-secret \
SENTRY_DISABLED=1 npm run build
node scripts/measure-first-load.mjs /tmp/routes.json
```

Images were local measurement images, not registry/deployment images. The unchanged Dockerfile's `deps-prod` target was built with each lockfile (`docker build --target deps-prod`), using its normal `npm ci --omit=dev` command. A temporary copy of the runner stage used the matching host-built `.next/standalone`, `.next/static`, and production-dependency image in place of builder-stage references. All runner instructions, runtime user, and base image were retained. The temporary build context included test source files under `src/lib`, so absolute image sizes include that small extra payload. The baseline and after images used the same measurement method. Disk sizes use `du -sk /app/node_modules` inside each image; overall sizes use Docker image inspect's uncompressed `.Size`, not registry transfer size. Base image digest was `sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914`.

Browser Sentry now constructs `BrowserClient` with only GlobalHandlers, Dedupe, LinkedErrors, and HttpContext, binds the shared current scope, then initializes it. This follows the [upstream minimal-client pattern](https://github.com/getsentry/sentry-javascript/discussions/15645). The existing privacy settings, localhost/third-party/tRPC filters, environment resolver, browser enable flag, and `onRouterTransitionStart` remain. No tracing or replay integration is installed. RouteError, global-error, and FeedbackPanel source is unchanged.

The real browser SDK is exercised with only its transport replaced: marketing and dashboard exceptions produce event envelopes with nonempty stacks and `production` environment; an uncaught browser error produces a `beta` event; the disabled flag suppresses delivery. The emitted envelope types contain only errors. Existing configuration/filter/environment tests also pass. This proves mock-transport delivery, not delivery to a live Sentry project or a visual test of the error/feedback components.

Google Calendar now uses `@googleapis/calendar` and the existing `google-auth-library` OAuth2Client. Account email is fetched through the same authenticated client's direct OAuth2 userinfo REST endpoint. Calendar request bodies and sync logic are retained. Tests exercise the real narrow SDK with mocked OAuth request transport: consent options, token exchange/userinfo, calendar listing, incremental sync pagination, 410 recovery, event update/delete, watch/stop channels, and API failures. Existing encrypted-token persistence and refresh tests pass. A manual beta-account sync was not run; no Google account writes were performed.

Dependency checks before installation:

| Package                       | Findings                                                                                                                                                                                                                                                                                                              | Decision                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `@googleapis/calendar@20.1.0` | Google-maintained package published since March 2021. Release October 3, 2026; previous release September 24. Its sole dependency, `googleapis-common`, was already locked. Published entrypoints construct generated API/auth clients; no HTTP request occurs at import. Package has a development `prepare` script. | Install with `--ignore-scripts` |
| `google-auth-library@11.3.1`  | Existing locked Google-maintained OAuth dependency, released October 15, 2026. Promoted to a direct exact dependency without upgrading. No installation lifecycle script. Auth supports environment-based credential discovery; this integration retains explicit OAuth client credentials and tokens.                | Install with `--ignore-scripts` |
| `@sentry/browser@11.9.0`      | Existing locked Sentry SDK, promoted to direct dependency at the same version as `@sentry/nextjs`. No installation lifecycle script. This change adds no new SDK code; explicit initialization controls its browser hooks and transport.                                                                              | Install with `--ignore-scripts` |

Only one new package path was added to the lockfile (`@googleapis/calendar`); 157 package paths were removed, including platform variants. No retained package versions changed. `react-doctor` was removed because no script or CI job invokes it. The actual production install used the Dockerfile's unchanged lifecycle behavior from the resulting lockfile.

Validation results:

- `npm run build`: passed, including Next's TypeScript check.
- `npx tsc --noEmit`: passed after the final test additions.
- `npm run test:unit -- --maxWorkers=2`: 441 files passed, 14 skipped; 4,528 tests passed, 128 skipped. Two additional browser tests were then added and the full browser test file passed (4 tests). The final tests therefore include two cases beyond that full-suite count.
- Targeted Sentry/calendar run: 23 tests passed before the two additional browser cases.
- `npm run lint`: **failed**, 538 errors, 700 warnings, 23 infos. A clean archive of base `f5a7d4cd`, checked with the same Biome binary and configuration, produced exactly the same counts. Changed code passes Biome with no errors and one existing `useMathMinMax` warning at `google-calendar.ts:972`.
- `git diff --check`: passed.
- The final image contains `tsx` 4.23.15 and neither `googleapis` nor `react-doctor`. `scripts/migrate-safe.ts` and `scripts/startup.sh` SHA-256 hashes match the source exactly. No migration was executed, including during the localhost image smoke/Lighthouse checks.

Existing build warnings include middleware/Edge Runtime deprecation, custom Cache-Control, absent S3 configuration, and refused connections to the intentionally unreachable dummy database. Existing Vitest warns about its CommonJS config. The all-green requirement remains blocked by baseline Biome errors; this branch must not be presented as globally lint-clean. Fresh-context PR review is left for Mads' PC as requested.

Proposed PR title: `Reduce browser JavaScript and trim the runner image`

Proposed PR body:

Replace full browser Sentry initialization with an error-only BrowserClient and verify delivery through a mock transport. Replace googleapis with the narrow Calendar SDK plus authenticated userinfo REST, add Calendar request tests, and remove unused react-doctor.

Marketing median first-load JS falls from 275.9 to 205.5 KiB gzip; dashboard median falls from 468.7 to 398.2 KiB. Runner node_modules falls from 1,829.3 to 1,387.5 MiB, and the local measurement image is 20.7% smaller. Local Lighthouse TBT did not improve (502 to 609 ms median on the shared worker).

Build, typecheck, and Vitest pass. Global Biome fails with the same 538 errors present on the base; changed files introduce no lint errors. No deploy, migration, merge, live Sentry delivery, or manual beta Calendar sync was performed. See this report and the route CSV for methods and limits.

Rollback is a normal revert of this branch's commits before any independently authorized release. No database or runtime configuration rollback is required.
