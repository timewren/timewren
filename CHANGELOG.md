# Changelog

All notable changes to the TimeWren web app, API and Docker image are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/) as described in [docs/oss/versioning.md](docs/oss/versioning.md).
The browser extension, desktop app and mobile app have their own changelogs and version numbers.

Groups: `Breaking` (needs a `Migration` group in the same release), `Added`, `Changed`, `Deprecated`,
`Removed`, `Fixed`, `Security`.

## [Unreleased]

## [0.34.0] - 2026-11-18

### Added

- TimeWren Cloud takes payment: Personal, Solo, Team and Business through Stripe Checkout in EUR with VAT handled by Stripe Tax, a 14-day trial on Solo, Team and Business, and the Stripe customer portal for plan, seats, card and invoices. Self-hosted installs and TimeTrack Cloud are unchanged (#1227).
- Six Danish TimeTrack calculators for overtime, holiday pay, flex balances, invoice rounding, project budgets, and effective hourly rates (#1219).

### Changed

- Sending an invoice from the web app now asks for confirmation first and shows the invoice number, client, recipient, total and due date. This covers the invoice list and page, the create-invoice panel, "approve and send" on prepaid renewal requests, and mail through Billy and Dinero (#1224).
- Admin business metrics (MRR, ARR, signups, active organizations, trials) leave out test and demo accounts by default, with a toggle to show them. Test accounts no longer receive lifecycle e-mails (#1225).
- TimeTrack’s homepage and working-hours pages make time tracking, monthly norms, and calendar assumptions easier to find (#1219).

### Migration

- 0160 and 0161 add `organizations.is_test_account` (default false) and a table of Alunta IDs kept from deleted test accounts. Both are additive and run at startup (#1225).

### Fixed

- Release images are tagged on Docker Hub (`mahoje/timewren`) as well as GHCR (#1218).

### Security

- `invoices.sendEmail` checks the member's client access, as the other invoice procedures do (#1224).
- Trivy ignores CVE-2026-112366 in picomatch (no fixed release; only reached from build tooling with fixed patterns) until 2026-12-31 (#1221).

## [0.33.0] - 2026-11-17

### Added

- A public demo mode (`DEMO_MODE=1`) for demo.timewren.com: one-click demo accounts with invented clients, time, klippekort and invoices, a banner, no outgoing e-mail, and an hourly cleanup of demo accounts older than 24 hours (#1206, #1214).

### Changed

- The app version is read at runtime instead of being baked into the build, and the shared client bundle is smaller: about 48 % less initial JavaScript on the front page and 42 % on the dashboard (#1205).
- The TimeWren name policy in TRADEMARK.md and the AGPL section 7 app store permission for the mobile app are approved and no longer drafts (#1196, #1197).
- Runtime dependency updates, including the AWS SDK, Sentry and React Email (#1192, #1193).

### Fixed

- Deleting an account no longer fails when the account has used klippekort (#1208).
- Outgoing e-mail through Resend times out after 15 seconds instead of hanging (#1203).
- Alunta: GET requests are retried on 5xx, 429 and network errors, but not on our own timeout, and 429 counts as an upstream error (#1191, #1201).
- Rate limits return 429 instead of a server error, server-side error messages get readable titles in Sentry, and the weekly time report page no longer has a week number mismatch between server and browser (#1191).

### Security

- Team live timers and time entry templates only show data from your own organisation (#1209).

## [0.32.0] - 2026-11-13

### Added

- The browser extension can connect to your own server: a server field at sign-in and in settings, tokens bound to the server, and a `/.well-known/timetrack.json` discovery endpoint (#916, #1186).

### Changed

- The resource plan is open on every plan; no feature is locked behind a plan tier (#1010, #1175).
- One wording for the trial everywhere: 30 days free without a payment card, after which the account continues on the free plan (#1163, #1168).
- Licence and trademark texts: TRADEMARK.md hosting rule and Cloud names, an AGPL §7 app store permission for the mobile app (draft), and the desktop licence model on /desktop (#1176).
- The dashboard and admin no longer send server-only translation catalogues to the browser, about 170 KB less per page (#1182).
- Faster cash flow forecast (one query per type instead of one per client) and indexes for the invoice list and recent time entries (migration 0159) (#1181).

### Fixed

- Accounting integrations (Billy, Dinero, e-conomic) only retry idempotent requests, so a timeout can no longer create a duplicate invoice or contact (#1184).
- Timeouts on outbound calls (Alunta, push, Dokploy, Discord, Slack, Plausible, OpenAI) and a guard that skips a cron run while the previous run of the same job is still going (#1184).

### Security

- Next.js 16.4.6 (#1171).
- glob 14 and minimatch 11 for react-email and the Sentry bundler (#1178).
- Closed cross-tenant holes in CSV import, e-mail tasks, the extension, subtasks, absence requests and employee profiles; a portal domain can only be removed by the organisation that verified it; open redirects after portal login and sign-up are closed; magic link and SMS are rate-limited like password reset (#1187).

## [0.31.0] - 2026-11-11

The first versioned release. Production now follows `vX.Y.Z` tags instead of every merge to `main` (#1102, docs/RELEASING.md).

### Added

- Time tracking with a live timer, manual entries, a week view and a calendar.
- Clients, projects and prepaid hour packages ("klippekort") with balance alerts and a client portal.
- Invoices as PDF and through Billy, Dinero and e-conomic, with payment status synced back.
- Organisations with roles, team overview, approvals and an audit log.
- An MCP server with OAuth scopes for AI assistants.
- Self-hosting with Docker Compose: app, PostgreSQL and cron, no telemetry, all features open.
- Danish and English, plus beta translations that fall back to English.
- Prepaid integrity findings (time entries without a usage row) in the admin digest (#985).
- A stricter Content-Security-Policy sent as `Content-Security-Policy-Report-Only` next to the enforced policy, with a rate-limited `/api/csp-report` endpoint (#1158).
- A launch e-mail component for existing customers (#1146).

### Changed

- Faster client page, cron scans and client portal: N+1 queries removed and one new index (#1140).
- Invoice e-mails sent through `POST /api/invoices/[id]/send` are throttled per organisation (60 per hour) and fall back to the client's registered address when no recipient is given (#1154).
- Expected errors in the integrations and client portal APIs return proper tRPC codes instead of HTTP 500 (#1153).
- A user's primary organisation is picked by one shared rule (owner first, then oldest) in cron, inbound mail, webhooks and extension sign-in (#1151).
- `next build` no longer initialises better-auth or the database (#1130).
- Same-repository pull requests run `next build` on boat-large before merge (#1149, #1145).
- CI runs on warm Boat runners instead of a new VM per job (#1160).
- The Content-Security-Policy and the browser extension allow the self-hosted error reporting endpoint (#1161).
- Developer setup on Windows, agent docs and a `typecheck` script (#1129, #1152).

### Fixed

- Invoice status transitions are locked, so a concurrent issue and delete cannot both succeed, and `invoice.paid` from accounting sync marks invoices as paid (#1137, #1157).
- Time entries: lock checks on every change, copies keep approval status and cost rate; marking approved time as billed is still allowed (#1125).
- Recurring time entries and reminder e-mails are deduplicated and written atomically (#1124, #1141).
- Timesheet cell edits, the Effihub import and prepaid deletion are atomic (#1138).
- Module permissions are enforced on all reads and on e-mail templates, while time tracking can still pick tasks and prepaid packages (#1135).
- The Stripe webhook retries after failures (#1126).
- The TimeWren app's URL scheme is a trusted origin for TimeWren sign-in (#1109).

### Security

- Outgoing webhooks: the SSRF guard follows redirects, and retries back off (#1136).
- The Stripe webhook no longer logs licence keys or e-mail addresses (#1126).
- Invoice REST routes check module access, subscription and role like the tRPC API (#1127).
- Uploads have size, rate and pixel limits; the desktop and extension rate limiter uses the rightmost `X-Forwarded-For` hop; Discord account linking requires a verified e-mail (#1150).
- Self-hosting: the obsolete `docker-compose.prod.yml` with default secrets is removed, the Alunta webhook fails closed without a secret, and desktop licence endpoints are rate limited (#1128).
- CSV exports guard against spreadsheet formulas in one shared helper; numbers and phone numbers are unchanged, and XLSX text cells get no prefix (#1155).
- The owner's personal e-mail address is removed from the public code, `security.txt` reads the brand's contact (#1131).

### Migration

- One new index (expand-only), applied automatically at start-up (#1140).
