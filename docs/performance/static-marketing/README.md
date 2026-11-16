# Static marketing routes

This change separates the Danish marketing document from the request-localized
application document without changing public URLs. Marketing no longer calls
`getLocale()`, `cookies()` or `headers()` through its document layout. The app
keeps the existing next-intl resolver: locale cookie, authenticated profile,
Accept-Language, then Danish. No database schema or production configuration is
changed. No deployment or merge is part of this work.

The two route groups have separate root layouts and reuse `DocumentLayout` for
fonts, metadata, theme initialization, consent, analytics and notifications.
`AttributionCapture` has a Suspense boundary. Navigating across roots loads a new
document, allowing the app language to differ from Danish marketing. Marketing
copy was already Danish; this does not introduce English marketing content.
The portal inherits the app document instead of rendering nested html/body tags.
A marketing catch-all calls `notFound()` so unmatched URLs retain the existing
branded 404 without opting into experimental global-not-found configuration.

Keep route handlers (`api`, `.well-known`, `llms.txt`, `manifest.json`) at their
existing root paths: they do not need document layouts, and discovery tests import
the `.well-known` handlers by their physical path. The Open Graph image convention
belongs to `(marketing)` so Next can resolve its image metadata against that
root's metadataBase; its public `/opengraph-image` URL is unchanged.

The sitemap drift test traverses route groups without including them in URLs.
Copy-lint exception paths and reporting categories follow the moved source files.

## Reproduction

Run from the repository root using the existing lockfile dependencies and Node 24:

```sh
NEXT_PUBLIC_APP_URL=http://localhost:3217 \
NEXT_PUBLIC_BRAND=timetrack \
DATABASE_URL=postgres://test:test@127.0.0.1:1/test \
BETTER_AUTH_SECRET=local-build-only-not-a-production-secret npm run build
NEXT_PUBLIC_APP_URL=http://localhost:3217 npx playwright test -c tests/static-marketing/playwright.config.ts
npm run test:unit
npm run lint
npm run lint:copy
npx tsc --noEmit
```

The dedicated Playwright config starts and stops a local production server. It
uses no real database or account. The settings test intercepts browser auth/tRPC
calls with synthetic fixtures but exercises the real dropdown, mutation handler,
cookie write, page reload, next-intl messages and HTML language. Profile fallback
without a locale cookie is tested in Vitest with isolated auth/database mocks.
For baseline browser expectations use `MARKETING_BASELINE=1`.

## Measurements

Implementation commit: `396e9f8e0840806f01e72e86d31eb2b9fb6e34c2`.

Baseline: `f5a7d4cd`, TimeTrack brand, agent-worker, Node 24.22.0. Build logs and
browser screenshots are captured under `/tmp/tt-static-evidence` during the run.
Build time includes compilation, TypeScript and standalone output tracing. Shared
worker load varies; time differences are not a controlled performance benchmark.

| Metric                               | Before                                                  | After                 |
| ------------------------------------ | ------------------------------------------------------- | --------------------- |
| Static route rows (`○`)              | 3                                                       | 133                   |
| Generated static landing pages (`●`) | 0                                                       | 4                     |
| Dynamic route rows (`ƒ`)             | 455                                                     | 325                   |
| Build wall time                      | 157.521 s                                               | 78.009 s (warm cache) |
| `/`, `/klippekort` Cache-Control     | private, no-cache, no-store, max-age=0, must-revalidate | s-maxage=31536000     |
| `/`, `/klippekort` x-nextjs-cache    | absent                                                  | HIT                   |

The initial exploratory build used the default TimeWren brand; its timing is
excluded because that brand disables marketing. Both compared builds explicitly
use `NEXT_PUBLIC_BRAND=timetrack`. The final after build sets the local app URL to
port 3217 because another worktree owns port 3000. This is a local test setting;
production configuration was not read or changed.

The complete Next build route tables are in [routes-before.txt](routes-before.txt)
and [routes-after.txt](routes-after.txt). There are 130 previously dynamic routes
now marked `○`, plus four generated `/lp` landing pages. The existing dynamic
`/lp/[slug]` row is expanded into its four known URLs; no existing URL is removed.
The only new route pattern is the branded 404 fallback. Unlike the POC, this implementation keeps `/offline` inside the localized app
root; generated landing-page rows are counted separately above. Both changelog and download retain their 3,600-second ISR.
The prerender manifest contains 138 entries, including framework-generated error
content; this is different from counting the build table's page rows.

## Validation status

Before implementation, `npm run lint` failed with **538 errors, 700 warnings and
23 infos** across 2,786 files. This includes existing formatting errors in
workflow YAML, generated AGENTS.md and unrelated application files. No broad
formatting cleanup or rule suppression is included in this change.

Before implementation, copy lint passed with 0 findings in 1,153 files. The
baseline production browser checks passed for cache headers, cookie languages
and cross-page navigation. The baseline portal always emitted `lang="da"`, even
with an English cookie; the new single app document corrects that behavior.

The original route-boundary regression test failed before implementation (both
root layouts were missing). Rendering tests now exercise the real document shell
with request locale mocks, alongside cookie/profile/browser locale tests and the
robots, sitemap and copy-lint tests.

No Lighthouse result or production cache/TTFB measurement is claimed. Live
measurements require a separately authorized deployment. No new dependencies
were installed.

Final checks:

- Production build: passed; no new metadataBase warnings after scoping the OG image to marketing.
- Typecheck (`npx tsc --noEmit`): passed, exit 0.
- Full Vitest: **441 files passed, 14 skipped; 4,528 tests passed, 128 skipped**, 125.42 s.
- Production Playwright: **4 passed**, 10.4 s. Includes da → en → da using the actual settings dropdown, cookie/profile fixtures and translated text, cache checks for both locale cookies, navigation between roots and branded 404.
- `lint:copy`: **0 findings in 1,156 files**.
- Biome on 13 substantively changed files: **0 errors, 3 existing warnings** (literal template placeholder in copy lint, plus head and inline theme script inherited from the old root).
- Full Biome: **538 errors before, 537 after; 700 warnings and 23 infos in both runs**. This is the only requested gate that remains red; no existing rules or checks were weakened.
- React Doctor (existing lockfile package): scanned 416 files, reported **No issues found**. Its separate score was 59/100; this advisory score is not treated as a passing gate.
- `git diff --check`: passed.

The first full Vitest run caught eleven settings-search anchor tests using the old physical dashboard path. Updating that test path restored all 31 settings-search tests; the final full run above is green.

Browser output is saved in [browser-results.txt](browser-results.txt). Before/after
screenshots of the homepage with an English locale cookie are saved alongside
this report; visual inspection showed the same Danish marketing design.

## Suggested pull request

Title: `Make marketing routes static while preserving app locales`

Separate marketing and app root layouts so public Danish pages can be
prerendered while dashboard, auth, admin and portal retain request-specific
language resolution. Reuse the document shell, isolate attribution in Suspense,
remove the portal's nested document, and preserve sitemap/copy-lint coverage.

Validation and remaining baseline failures are recorded above. Review is deferred
to Mads' PC as requested. This branch must not be merged or deployed by this run.
