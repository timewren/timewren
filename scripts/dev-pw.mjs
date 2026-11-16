#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
// `npm run dev:pw`: dev server with registration enabled (Playwright runs).
// Sets the variable from Node so it works in cmd, PowerShell and sh alike
// (`set X=1&& cmd` only works in cmd.exe).
import { spawn } from "node:child_process";

const child = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NEXT_PUBLIC_REGISTRATION_ENABLED: "true" },
});
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
