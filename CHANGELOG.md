# Changelog

All notable changes to the TimeWren web app, API and Docker image are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/) as described in [docs/oss/versioning.md](docs/oss/versioning.md).
The browser extension, desktop app and mobile app have their own changelogs and version numbers.

Groups: `Breaking` (needs a `Migration` group in the same release), `Added`, `Changed`, `Deprecated`,
`Removed`, `Fixed`, `Security`.

## [Unreleased]

## [0.37.4] - 2026-11-25

### Added

- Bulk actions on Time: move selected entries to a project, remove them from their projects (the time stays on the client, and klippekort deductions are reconciled), or link up to 200 entries of one client to an active klippekort with the same balance and overdraft rules as on the card.
- The client page shows hours used in a chosen period (this month, last month, this year, last year or custom), in total and per project, including time without a project. The totals use the same scope and rounding as the reports, and report totals link to the matching time entries.
- Reports can be grouped per klippekort. Time can sit on a project and be deducted from a card at the same time, so the card totals can differ from the project totals. Time without a card is grouped under "Uden klippekort".

### Changed

- The overdraft policy (block, allow or invoice) and the overdraft rate can be changed on an existing klippekort, not only when it is created.

### Fixed

- A klippekort that allows overdraft (allow or invoice) can be chosen at zero balance in every picker in the web app and the browser extension. Automatic choice still prefers a card with balance left.
- A deduction that is an exact number of clips is no longer charged 0.01 h too much because of float rounding (for example six 24-minute clips were drawn as 2.41 h instead of 2.40 h), and an entry stored in hundredths of an hour costs the clips it actually covers (40 minutes, stored as 0.67 h, is two 20-minute clips, not three). The timer, save and quick-entry pickers show the same rounding as the server.
- The dialog for linking time to a klippekort says how much time the card can cover in one entry, using the same per-entry rounding as the server, and why an entry is blocked. Project budgets (total and monthly) are explained in text, not only by colour.
- Every refused klippekort deduction carries the language-neutral error code `PREPAID_DEDUCTION_FAILED`, so the browser extension saves the time without the card in every language instead of rejecting the stop.

## [0.37.3] - 2026-11-23

### Added

- Google Calendar per brand: TimeWren accounts connect Google Calendar through TimeWren's own OAuth client, and each connection remembers which brand's client issued its tokens, so refresh, sync and webhooks use the same client.
- Outlook calendar through Microsoft Graph, shown only when the Microsoft client is configured.

### Changed

- Disconnecting Google Calendar or deleting the account revokes the Google grant only when no other connection (any user, any brand) uses the same Google account. Otherwise the connection is removed locally only, so one user's disconnect cannot break another user's calendar sync. Revocation runs after the local delete is committed, and logs only a status code and a fixed reason.
- Reconnecting within seconds of a disconnect may need a second reconnect, because Google applies a revocation with a delay.

### Database

- `0164_calendar_oauth_brand` and `0165_calendar_provider_account_sub`: two additive, re-runnable columns on `calendar_connections`.

## [0.37.2] - 2026-11-23

### Changed

- Sending an invoice by mail through Billy or Dinero checks the confirmed invoice on the server (number, total incl. VAT, currency, line count and recipient) and runs one send at a time per invoice, so a double click or a retry cannot mail the customer twice. When the provider's answer is unclear (timeout or server error), further sends are blocked until the user marks whether the provider sent it. The send dialog shows the line count.
- The invoice sync only removes a link on a 404 when the invoice was exported to the same accounting account, and releases drafts that were deleted in Billy or Dinero so they can be exported again.

### Fixed

- Time entries saved from a timer get a start time that matches their hours (start = end minus hours) when the timer was resumed or had time added. Before, the entry kept the last resume time as its start, so it showed at the wrong time in reports and the timeline, and the stability watch flagged it. Manual, API and import entries are not changed.
- `updated_at` on time entries is set on every update, so desktop sync and conflict checks see edits made by billing, prepaid packages, approvals and quick edits.
- Umami tool events work behind the same-origin Cloud proxy.
- The synthetic checks keep running when the runner's package sources or network hiccup, and only fail when production does.

### Security

- Dependency updates: tiptap patch releases (web) and Sentry, TanStack Query, zustand and Tailwind patch releases (browser extension).

## [0.37.1] - 2026-11-22

### Changed

- "I am VAT registered" turns on by itself when a Danish company enters a full CVR number, until the user makes their own choice. Without a CVR it stays off, and a choice the user has made is never overridden. A company profile update that leaves out `vatRegistered` (web or device API) no longer stores `false`; it follows the same rule. Migration `0163` adds `company_profiles.vat_registered_chosen` and marks existing profiles as chosen when they are already VAT registered or already have a full CVR number, so their stored setting stays as it is.
- The invoice send dialog says "Amount (no VAT)" when the invoice has no VAT line.
- The desktop app is no longer labelled beta.

## [0.37.0] - 2026-11-22

### Added

- Add a download page that detects the visitor's device and points to the right app: iOS (App Store), Android, macOS, Windows and the browser extension, for both TimeTrack and TimeWren. TimeWren's desktop links now point to TimeWren's own release channel instead of TimeTrack's.
- Give the device API (`extension.*`) the procedures desktop needs to match the web app: invoice VAT totals, PDF link, delete, credit notes, mail status and an optional recipient on send; accounting integration status and export options; user and company settings; task delete, subtasks and assignee; organization members and `device.me`. All of them call the web app's own procedures with the same access checks.
- Remind the user when a timer has run for 10 hours.

### Changed

- Rework the TimeTrack and TimeWren landing pages.
- TimeWren sets currency and country from the sign-up language, shows the CVR lookup only for Danish organizations, and every new workspace (also extra workspaces and the demo) gets the same region defaults. Draft numbers follow the language, and new Danish organizations get invoice numbers without a prefix.
- Require company details before an organization's first invoice on the web. The desktop app, the API and existing organizations are not affected.
- Make the client optional on new time entries, like the timer; a new client counts as active only. Danish sentence case for headings and buttons. Hide team overview and resource plan in one-person organizations.
- Recurring-invoice reminders, scheduled report mails and shared report links use the organization's currency.
- Calculate invoice VAT in one place for both PDF engines, the send dialog and the device API.
- Read the VAT period from the organization's company profile (falling back to the user's own setting), so the VAT overview shows the period chosen under Settings → Company.
- New company profiles inherit the user's "has employees" choice. Migration `0162` drops the default on `company_profiles.has_employees` and clears it where the profile said no but its creator's user row said yes.
- Email activity in an organization hides the user's personal account mails (welcome, sign-in, magic link and similar) and checks invoice module and client access for every business mail, so a member with restricted client access does not see other clients' mails.
- Speed up the time entry list (about 17 ms to 9 ms on the reference data set).

### Fixed

- Accept non-EU tax numbers on foreign clients (for example a US EIN). The EU VAT format is only checked for clients in EU member states.
- The device PDF route now has the same module and role checks as the web PDF route.
- Deleting draft invoices and creating credit notes check client access; subtasks follow the organization.
- Close the long-timer reminder when the time tracking bar unmounts.
- Alert on Valkey only after 60 seconds without a connection, return 204 for aborted CSP reports, and run each cron job once at a time.

## [0.36.1] - 2026-11-22

### Security

- Upgrade Better Auth to 1.7.27. It closes an account takeover in the Expo integration (GHSA-4wq4-2ppv-q3hg, critical), a flaw in phone number sign-in (GHSA-q747-mqgr-4gh7) and the Magic Link and OAuth state takeover (GHSA-965c-763c-88jm). No database changes. Magic links and social sign-ins that were in progress during the upgrade must be started again.

## [0.36.0] - 2026-11-22

### Added

- Add Danish pages with the number of working days and working hours for 2024-2028: one page per year (`/arbejdsdage-<year>`), one per month (`/arbejdsdage-<year>/<month>`) with a day-by-day table and hours at 30-40 hours a week, and one per year with working hours (`/arbejdstimer-<year>`). A hub at `/arbejdsdage` links to all of them, and they are in the sitemap. The existing 2026 and 2027 pages keep their URLs.

## [0.35.2] - 2026-11-22

### Fixed

- Make the TimeWren.com marketing pages indexable by default. They sent `X-Robots-Tag: noindex, nofollow` unless `TIMEWREN_INDEXABLE=1` was set, so search engines dropped them. Set `TIMEWREN_INDEXABLE=0` to keep a staging host out of search results. The app and the Markdown representations stay noindex.

## [0.35.1] - 2026-11-21

### Fixed

- Make account deletion instructions available on TimeWren.com. The page explains how to request account deletion by email or from the app, what is deleted and what may be retained. It is available in English, Danish, German and Spanish.

## [0.35.0] - 2026-11-20

### Breaking

- The published image is built with the new `BUILD_PROFILE=selfhost`, which leaves the Cloud marketing site and the TimeWren website out of the build. The standalone output is about 31% smaller and the build uses less memory and time. The app and the instance pages (cookies, contact, download, account deletion, privacy, GDPR, terms and data processing) are unchanged. `NEXT_PUBLIC_MARKETING_URL` only enables marketing pages in a build made with `BUILD_PROFILE=full`, the default for `npm run build` and for TimeTrack Cloud (#1100). On a prebuilt image, `/` now redirects to the dashboard and marketing paths return 404 even with `NEXT_PUBLIC_MARKETING_URL` set.

### Migration

- To keep marketing pages on a self-hosted instance, build the image yourself with `BUILD_PROFILE=full` (build argument) instead of using the prebuilt image.

### Added

- TimeWren Desktop business licence: 69 euros once, sold on timewren.com/desktop with Stripe Checkout in EUR (price found by lookup key `timewren_desktop_lifetime_eur`, no price ids in the code). The key is a `TW-` key and the mail is sent as TimeWren. Licences are not shared between brands: a TimeTrack key does not activate on timewren.com and a TimeWren key does not activate on timetrack.dk. No migration; see [docs/licensing.md](docs/licensing.md).

### Changed

- Upgrade note: without `redirect_uri`, device login now answers with the instance brand's scheme. A self-hosted instance that runs the default compose file has brand TimeWren and so answers `timewren://auth/callback`. Older TimeTrack Desktop builds send no `redirect_uri`; for them set `DEVICE_CALLBACK_URL=timetrack://auth/callback` or update the app. `timetrack://auth/callback` and `timewren://auth/callback` are always accepted as `redirect_uri`.
- New public demo sandboxes use English sample data and EUR, and keep the language selected by the visitor.
- App CI runs when its workflows change and reuses Docker build layers from GHCR (#1097, #1099).
- Manual Docker validation uses read-only GHCR access and can start with a fresh builder to measure registry cache reuse (#1099).
- Link time can move uninvoiced entries between a client's prepaid packages, with project and date filters, pagination, and a preview of the remaining balance and any billable overflow (#1235).

### Fixed

- Device login (`/api/ext/device/approve`, `/api/desktop/auth/approve`) sends the app reply to the scheme the client asks for with `redirect_uri` (`timetrack://` or `timewren://`), validated against the existing app-scheme allowlist. A missing or unknown value falls back to the instance brand, so TimeWren desktop and mobile can sign in to TimeWren Cloud and self-hosted instances; web URLs and other schemes are never used.
- Cloud onboarding waits for the workspace subscription before opening dashboard pages. The core-flow browser test also verifies client creation for a regular user whose session has no active organization (#1037).
- Cloud onboarding offers a retry when workspace access, subscription, or plan options cannot be loaded.


- Initialize empty databases from versioned SQL, restore test-account flags from the audit log when a migration creates the flag column, and from the older metadata marker plus a latest audit entry when a database that recorded 0160 still has every flag at its default (saved flags are never lowered or rewritten, whichever migration command or versioned SQL runs), and run migrations in both database CI jobs (#1119).
- Preserve Cloud editorial claims, article attribution, and social cards with runtime marketing URLs, and limit the Cloud agreement PDF to Cloud instances (#1017).
- Use runtime URLs and branding metadata on opted-in marketing pages, preserve Cloud policies on Cloud domains, and pin desktop downloads to the build configuration (#1017).
- Render self-hosted instance pages and crawler metadata with the running URL and brand. Require marketing opt-in on self-hosted domains, direct legal and support questions to the instance operator, and keep desktop downloads consistent across runtime brand changes (#1017). Every `timetrack.dk` subdomain (including `beta`) counts as TimeTrack Cloud.
- Prepaid time moves show each card’s rounded amount, exclude locked periods, and acquire card locks in a consistent order (#1238). The preview credits back only balance-funded hours and shows recorded time for entries without a card. Prepaid time writes acquire card locks before updating tasks or shifting segments, and edits lock multiple cards and tasks in ID order. Editing and deleting time entries now use the same lock order as task deletion, including entries without a prepaid package. Extension timer saves and desktop entry creation lock cards before timer or task rows. Stale desktop updates return the current server entry even when their task was deleted.
- Include hours from the entire final day on recurring invoices, store timesheet grid dates at UTC midnight, and match desktop Stripe updates to the affected subscription. Signed Alunta redeliveries can retry recorded failures after the normal delivery window. Billy and Dinero deduplicate identical signed deliveries (#1123).

- Use Danish calendar dates throughout the timesheet, check the current Alunta subscription before replaying a delayed payment failure, and allow signed Billy and Dinero payment deliveries to retry after the external invoice is linked (#1123).

- Apply Danish week boundaries to timesheet approval and edit locks, and read list and board tasks in bounded pages (#1123).

- Show tasks as each page loads, use task cursors that tolerate insertions and deletions, and apply REST task sorting and pagination in the database. Use Danish dates for the rolling timesheet lock and weekday auto-lock (#1123).
- Document and test how explicit-locale translations choose the brand on static pages and shared multibrand instances (#1133).
- Keep TimeWren Cloud on its governing Stripe subscription when payment is overdue, reject overlapping checkout requests, and process Stripe calls and billing emails outside webhook database transactions (#1228).
- Protect TimeWren seat purchases during webhook sync, retry cancellation emails on Stripe redelivery, and preserve TimeTrack dashboard payment grace (#1228).
- Correct the translation catalog path in the strategy docs and compare TimeTrack marketing snapshots using normalized DOM (#1132, #1134).
- Welcome and trial-ending emails, including Alunta reminders, continue when the test-account lookup fails. Lifecycle and mail transport logs omit recipient addresses, message contents, and raw delivery errors, including when Resend SDK debugging is enabled (#1226).

## [0.34.1] - 2026-11-18

### Fixed

- TimeWren Cloud's Stripe Checkout page shows TimeWren as the merchant name instead of the Stripe account's name (#1233).

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
