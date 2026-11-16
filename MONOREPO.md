# TimeWren source monorepo

Web/server is at the root (AGPL), desktop/ and mobile/ are AGPL, browser-extension/ is MIT. Each app currently retains its own lockfile and build commands. The root TypeScript project excludes desktop/ and mobile/; typecheck those apps with their own configurations. Run web Compose from this root.

Reusable MIT crates and standalone SDKs need explicit LICENSE files and dependency-boundary review before importing.
