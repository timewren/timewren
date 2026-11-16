# TimeWren Desktop

**Private, local time tracking for freelancers: it notices what you work on and turns it into time entries.**

TimeWren Desktop is the desktop client of [TimeWren](https://github.com/timewren/timewren). It records the active window and app on your machine, classifies the activity (optionally with an AI provider you bring yourself, or a local model), and lets you review the result in a calendar, a timeline and prepaid hour packages ("klippekort"). Raw activity data never leaves your computer.

## Features

- Automatic local tracking of active apps and windows
- Optional AI classification with your own API key (OpenAI, Claude, Gemini, OpenRouter, ...) or a fully local model through Ollama
- Calendar, timeline, customers, projects, invoicing drafts (CSV and HTML)
- Prepaid hour packages with automatic deduction
- Optional sync with TimeWren Cloud. Choosing your own self-hosted server inside the app depends on a pending change; the app works without any account
- Interface languages: Danish, English, German and Spanish

## Status

Pre-release. The source is prepared for publication; official signed builds are distributed separately from this repository. See [LICENSE](LICENSE) for the source license and `LICENSES.md` for third-party notices.

## Official builds and licences

- Builds you make yourself from this source are free for any use under the AGPL.
- Official builds are free for personal use.
- Official builds are included with a TimeWren or TimeTrack account, on every plan including Free.
- Business use of an official build without an account needs a one-time desktop licence.

The licence is a condition on the official binaries, not on the source code: it does not restrict the rights the AGPL gives you.

## Build from source

Requirements: Node.js 22+, a stable Rust toolchain, and the platform prerequisites for your OS.

```bash
npm ci
npm run dev          # frontend
cargo test --workspace
```

The Rust workspace lives in `crates/` (core logic, data, tracker, matcher, AI) and `crates/tt-app` (the desktop app). `src-tauri/` and `src/` hold the legacy Tauri shell. See `docs/` for user guides.

## Contributing, security, license

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

Licensed under the [GNU Affero General Public License v3.0](LICENSE). The TimeTrack and TimeWren names and logos are not covered by the license.
