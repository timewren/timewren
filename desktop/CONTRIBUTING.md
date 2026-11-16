# Contributing to TimeWren Desktop

Thanks for helping. Bug reports with steps to reproduce, fixes, translations and docs are welcome. Open an issue before larger changes. Security problems go to [SECURITY.md](SECURITY.md), never to a public issue.

## Setup

Requirements: Node.js 22+, stable Rust, and the platform prerequisites for your OS.

```bash
npm ci
cargo test --workspace
npm run lint
npm run test:unit
```

## Making a change

1. Fork, branch off `main`, keep one fix or feature per pull request.
2. Run the checks above before you push; add tests when you change behaviour.
3. Interface text lives in `crates/tt-app/locales/<language>/` (Danish, English, German, Spanish). Add every new string to all four languages; Danish is the source language. See the glossary in the main TimeWren repository (`docs/i18n/glossary.md`).
4. Commit messages are short and imperative (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).

## Developer Certificate of Origin

We use the [DCO](https://developercertificate.org/), not a CLA. Sign off every commit with `git commit -s`. Fix a forgotten sign-off with `git commit --amend -s --no-edit`.

## License

Contributions are licensed under the [AGPL-3.0](LICENSE). The TimeTrack and TimeWren names and logos are not covered by the license. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
