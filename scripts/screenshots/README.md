# TimeWren screenshots

All people, organisations and companies in these images are fictional. No CVR,
postal addresses, real mailboxes, external integrations or production data are used.
English, Danish, German and Spanish each have a separate localised demo dataset:
one freelancer/owner and two team members, seven clients, projects, prepaid hours
with linked usage, six weeks of time entries, invoices, tasks and calendar events.

## Recommended: disposable local run

Use a clean checkout without Next.js `.env` files (the supervisor rejects them
so provider credentials cannot be loaded implicitly). With the repository's
locked dependencies installed, Docker available and the
Playwright browser configured, run:

```sh
npm run screenshots:timewren:local
```

The foreground supervisor starts PostgreSQL 18 on a random loopback port,
initialises the existing schema (no migration files are created), starts a
TimeWren `next dev` server on a free port, seeds and captures all 48 images, then
stops both processes and removes its disposable database container. It also
cleans up on failure, SIGINT and SIGTERM. It never runs `next build`.
Before capture it starts with the TimeTrack brand and requests `/docs`, `/llms.txt`
and `/install.sh` with `Host: timetrack.dk`, without following redirects. Docs and
install must return 404; the existing Cloud llms.txt must return 200 with TimeTrack
content without TimeWren references. It then restarts as TimeWren. The missing
routes are checked by status, since Next.js 404 HTML also serialises shared assets.
This checks the actual route responses as well as the middleware unit tests.
On agent-worker, use `~/dev/pw-chrome.sh sync` if the browser revision is missing.
Do not disable the Chromium sandbox.

## Use an already running local dev server

Use a **dedicated, disposable** database named `timewren_screenshots` (or with
that prefix), hosted at **127.0.0.1**. Other URLs are rejected. Start a new empty
database when refreshing on another day, so all dates are relative to that run.
Do not use an existing development database or import a customer backup.

```sh
export DATABASE_URL='postgres://postgres:LOCAL_PASSWORD@127.0.0.1:LOCAL_PORT/timewren_screenshots'
npx drizzle-kit push
export NEXT_PUBLIC_BRAND=timewren
export TIMEWREN_APP_ENABLED=1
export NEXT_PUBLIC_APP_URL=http://127.0.0.1:LOCAL_HTTP_PORT
export BETTER_AUTH_SECRET=LOCAL_RANDOM_SECRET
export MAIL_TRANSPORT=log
npm run dev -- --hostname 127.0.0.1 --port LOCAL_HTTP_PORT
```

From another terminal, with the same database URL:

```sh
export SCREENSHOT_BASE_URL=http://127.0.0.1:LOCAL_HTTP_PORT
npm run screenshots:timewren
```

The capture command seeds automatically, rotating an ephemeral random password
and logging in through Better Auth. No password is printed or saved. For data-only
inspection, `npm run screenshots:seed` creates the same fixtures (without exporting
credentials). No email is sent. Stop your manually started server and database
when finished. Never set billing, analytics, AI, email or calendar provider keys.

## Output and review

`public/brand/timewren/screens/<en|da|de|es>/<scene>.webp`, with the shared scene
names in `demo.ts`. Desktop is 1440×900 CSS pixels at scale 2; mobile is 390×844
at scale 2. Dashboard and prepaid hours also have `-dark` variants. Captures
include the app navigation and content, without browser chrome or development
overlays. WebP starts at quality 82 and adapts down to stay under 250 KiB.
The desktop dashboard uses the app's standard Overview layout, reached through
the navigation after Home loads. The mobile dashboard shows Home, the app's
normal entry screen, with populated quick-start projects.

The calendar fixture has an offline connection with no OAuth tokens and sync
disabled; the app reads only its locally seeded events. The report preset and
task columns are localised too. Alerts are dismissed through the app's controls;
the floating feedback widget is hidden so it does not cover table rows.

The browser clock is fixed at noon UTC on the seed day. Browser locale, profile
language, locale cookie and timezone agree. Font loading, network idle and skeleton
completion and a known demo row in every scene are awaited, including spinners
whose queries start after hydration. Service workers and external browser requests
are blocked, so a previous development shell cannot interfere with the capture. App errors,
incorrect locale and visible TimeTrack/Mahope branding fail the run.
German and Spanish task captures also require the translated sort and column
customisation buttons to be visible, preventing English fallback in those controls.

Review **every** image for language, populated content, errors, skeletons and
brand correctness before committing. The generated review table is
`docs/research/2026-11-09-timewren-screens.md`. Keep the two legacy screenshots
in place until the landing/docs integration removes them. Consumers select the
four supported locales and fall back to `en` for other languages.

```sh
npx vitest run scripts/screenshots
npm test
npm run lint
npx tsc --noEmit
```
