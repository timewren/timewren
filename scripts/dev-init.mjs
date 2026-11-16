#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
// Creates .env.local for local development with fresh random secrets and the
// database from docker-compose.dev.yml. Never overwrites an existing file.
// Used by `npm run setup` (CONTRIBUTING.md). Node built-ins only, so it runs
// before `npm install`.
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function devEnv(random = (n) => randomBytes(n).toString("hex")) {
  return [
    "# Local development only. Created by scripts/dev-init.mjs; see .env.example for every option.",
    "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/freelance_crm",
    `BETTER_AUTH_SECRET=${random(32)}`,
    `ENCRYPTION_KEY=${random(32)}`,
    `CRON_SECRET=${random(32)}`,
    "NEXT_PUBLIC_APP_URL=http://localhost:3000",
    "",
  ].join("\n");
}

export function initDevEnv(dir) {
  const file = join(dir, ".env.local");
  if (existsSync(file)) return { file, created: false };
  writeFileSync(file, devEnv(), { flag: "wx", mode: 0o600 });
  return { file, created: true };
}

// pathToFileURL/fileURLToPath, ikke streng-sammenligning: virker med Windows-
// stier (file:///C:/...), mellemrum og specialtegn.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { created } = initDevEnv(root);
  console.log(
    created
      ? "Created .env.local with local development secrets."
      : ".env.local exists, left unchanged.",
  );
}
