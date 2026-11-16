# Review follow-up

The review contains one P2 finding and no P1 or P3 findings. The missing branded
fallback is valid: `/r/` followed by 65 `a` characters returns a 404 before the
report database query, but the initial response included Next's English default
not-found content after the root layouts were split.

Both the app group and the framework's root error fallback now reuse the existing
marketing not-found component and metadata. The root fallback imports the shared
stylesheet because Next supplies its minimal built-in document for this route.
No root locale lookup, configuration change or new dependency is introduced.

The review's description needs one qualification: after hydration the browser
already displayed the report-specific “Rapporten kan ikke vises” page. That
intentional page asks the recipient to contact the sender and is preserved.
The regression test checks the raw response for the branded fallback, navigation
content and absence of the English default; it separately checks the hydrated
report page and document language with both `da` and `en` cookies.

The first attempt with only an app-group boundary still failed the raw-response
assertion. Next's root not-found fallback must also be supplied when the app uses
multiple root layouts. No review finding was rejected or left unaddressed.

No merge, deployment, migration or production configuration change was performed.

## Validation

- Production build: passed. Route counts remain 133 static rows, four generated
  landing pages and 325 dynamic rows, unchanged from the original branch.
- Targeted document-layout tests: three passed.
- Final full Vitest: 441 files passed, 14 skipped; 4,528 tests passed, 128 skipped.
- Production Playwright: five passed, including invalid report links with both
  locale cookies, the existing settings language switch and marketing cache checks.
  Report screenshots are `/tmp/tt-static-evidence/report-404-{da,en}.png`.
- The generated framework `_not-found.html` includes stylesheet links and branded
  content, and excludes the English default error text.
- Typecheck: `npx tsc --noEmit` passed.
- Changed-file Biome: three files checked, no findings.
- Full Biome: still fails with the previously recorded 537 errors, 700 warnings
  and 23 infos. Unrelated baseline formatting/lint debt is outside this fix.
- Copy lint: zero findings. `git diff --check`: passed.

Existing middleware/Edge deprecation warnings and local-only auth/storage warnings
remain. Tests use an unreachable dummy database and synthetic auth fixtures;
there is no claim of testing a real expired or revoked database record. The
overlong-token case exercises the same `notFound()` handling without customer data.
