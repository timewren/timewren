## What and why

<!-- What does this change, and which problem does it solve? Link the issue: "Fixes #123". -->

## How it was tested

<!-- Commands you ran. For UI changes add before and after screenshots (demo data only, no real client data). -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`, see CONTRIBUTING.md)
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run i18n:check` pass
- [ ] Tests added or updated for changed behaviour
- [ ] A line under `## [Unreleased]` in `CHANGELOG.md` (skip for internal changes)
- [ ] Breaking changes are listed under `### Breaking` with migration notes
- [ ] New user-facing text is in `en` and `da` (other languages may be missing)
- [ ] Screenshots for UI changes
- [ ] Database changes come with a forward-only Drizzle migration
- [ ] No feature is limited by plan, license key or brand
