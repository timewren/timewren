# Contributing to the TimeWren Browser Extension

This package lives in the TimeWren monorepo, so the [main contributing guide](../CONTRIBUTING.md) applies: open an issue before larger changes, sign off every commit (`git commit -s`, we use the DCO, not a CLA), and follow the [Code of Conduct](../CODE_OF_CONDUCT.md).

Extension specifics:

```bash
cd browser-extension
npm ci
npm run typecheck
npx vitest run
```

- Interface text lives in `src/i18n/` for Danish, English, German and Spanish. Every new string must exist in all four; Danish is the source language. See `docs/i18n/glossary.md` in the repository root.
- Do not add permissions or host patterns without an issue that explains why. Keep network access limited to the configured server and its allow-list.
- Code in this directory is MIT-licensed. Do not copy code from the AGPL-licensed web app into it without the copyright holder's agreement.
