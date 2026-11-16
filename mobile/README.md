# TimeWren Mobile

**Time tracking, prepaid hours and invoicing on your phone (iOS and Android).**

TimeWren Mobile is the mobile client of [TimeWren](https://github.com/timewren/timewren), built with Expo and React Native. It works without an account for local tracking, and syncs with TimeWren Cloud when you sign in. Builds can be pointed at a self-hosted server at build time (see below); choosing a server inside the app depends on a pending change.

## Features

- Start/stop timer, manual entries, day/week/month views
- Clients, projects, tasks and prepaid hour packages ("klippekort")
- Invoice drafts and reports, push notifications, light and dark theme
- Interface languages: Danish, English, German and Spanish

## Develop

Requirements: Node.js (see `.nvmrc`) and [pnpm](https://pnpm.io). Android Studio for local Android runs.

```bash
pnpm install --frozen-lockfile
EXPO_PUBLIC_API_URL=https://your-server.example pnpm start
pnpm test
```

Point the app at your own server with `EXPO_PUBLIC_API_URL`. The bundle IDs and URL schemes in `env.ts` belong to the official store listings: change them before you build your own binaries. Official store builds, signing and store listings are not part of this repository.

## Contributing, security, license

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md)

Licensed under the [GNU Affero General Public License v3.0](LICENSE), with an [additional permission](licenses/MOBILE-APP-STORE-EXCEPTION.md) for distribution through the Apple App Store and Google Play. Parts of the app derive from the MIT-licensed Obytes starter; its notice is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The TimeTrack and TimeWren names and logos are not covered by the license.
