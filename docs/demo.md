# Public demo (`DEMO_MODE=1`)

The public demo at demo.timewren.com lets anyone try the app without signing up.
It is a separate deployment with its own database, built from this repository.
Every visitor gets a private sandbox: a fresh user and organisation filled with
fictional data, deleted again after 24 hours.

With `DEMO_MODE` unset nothing changes: timetrack.dk, beta and self-hosted
instances behave exactly as before. Every demo behaviour is behind one helper,
`isDemoMode()` in `src/lib/demo/demo-mode.ts`.

## Environment

| Variable              | Value                       | Notes                                                                                         |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| `DEMO_MODE`           | `1`                         | Turns the demo on. Read at runtime; any other value means off.                                |
| `NEXT_PUBLIC_BRAND`   | `timewren`                  | The demo shows the TimeWren brand.                                                            |
| `NEXT_PUBLIC_APP_URL` | `https://demo.timewren.com` | Used for redirects and the origin check on `POST /api/demo/start`.                            |
| `DATABASE_URL`        | its own database            | Never point the demo at a shared database. The cleanup deletes demo accounts for good.        |
| `BETTER_AUTH_SECRET`  | its own secret              | As for any instance.                                                                          |
| `CRON_SECRET`         | its own secret              | Protects `/api/cron/demo-cleanup` and the other cron routes.                                  |
| `ADMIN_EMAIL`         | optional                    | Your own address, if you want an admin account on the demo. Demo visitors never become admin. |

Not needed: `RESEND_API_KEY` or SMTP (mail is never sent), payment keys (`ALUNTA_API_KEY`,
`STRIPE_SECRET_KEY`, `STORE_BILLING_ENABLED`), `OPENAI_API_KEY`, VAPID keys, `MESSAGEBIRD_API_KEY`,
OAuth client ids and accounting or calendar integration keys. If any of them is set by mistake,
demo mode still keeps the feature switched off.

Rate limiting uses the normal limiter. With more than one app container, set
`RATE_LIMIT_BACKEND=valkey` so the per-IP limit is shared.

## Running it

Deploy like any other instance (see `docs/SETUP.MD` and the install guides) with the variables
above, run the migrations, and run the cron sidecar (`cron/`) against it.

Locally:

```bash
DEMO_MODE=1 NEXT_PUBLIC_BRAND=timewren npm run dev
```

Then open `/login` and press "Prøv demoen" / "Try the demo".

## How a visit works

1. `/` leads to `/login`, which shows only the "Prøv demoen" button. `/register` redirects to `/login`.
   Normal login, signup, OAuth, magic link and SMS are hidden, and the matching better-auth
   endpoints answer 403 (`src/lib/demo/blocked.ts`).
2. The button is a plain form POST to `/api/demo/start`. The route:
   - answers 404 unless `DEMO_MODE=1`, and 403 for a form posted from another site;
   - allows 10 new demos per IP per hour (`demoStart` in `src/lib/utils/rate-limiter.ts`);
   - creates the account in one transaction (`createDemoAccount`): a user with `isDemo = true`,
     a random address `demo-<random>@demo.invalid` and a random password that is never shown,
     an organisation where the user is the owner, and the demo data;
   - refuses above 500 live demo accounts (`DEMO_MAX_LIVE_USERS`), checked behind an advisory lock;
   - signs the visitor in with a normal better-auth session and redirects to `/dashboard`.
     When something stops it, the visitor lands on `/login?demo=rate_limited|full|error` with a
     short message.
3. The data (`src/lib/demo/seed-demo-sandbox.ts`) is made up: five clients with invented
   company names and `.example` addresses, six projects, three klippekort (one almost used up),
   six weeks of time entries up to today, four tasks, three invoices (draft, sent, paid) and
   rate history. Seeding takes well under a second.

## Cleanup cron

`/api/cron/demo-cleanup` runs hourly (`15 * * * *` in `cron/entrypoint.sh`), protected by
`CRON_SECRET` like the other cron routes. It deletes every user that has `isDemo = true`, an
address on `@demo.invalid` and was created more than 24 hours ago, together with the
organisation and all its data. It uses the same deletion as account deletion
(`deleteUserAccountCompletely`), after first removing klippekort usage rows, which the
FK-driven organisation deletion cannot remove on its own. Real users (`isDemo` false or null,
or any other address) are never touched.

Without `DEMO_MODE=1` the route is a no-op that does not touch the database, so it can stay in
the shared crontab.

## What is disabled

| Area                                                                  | How                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Mail                                                                  | `sendMail` (`src/lib/email/transport.ts`) sends nothing and logs one technical line.                                    |
| SMS                                                                   | The phone-number OTP sender returns without sending; the endpoints are blocked.                                         |
| Outgoing webhooks                                                     | `deliverWebhook` stops before the request; creating, editing and testing webhooks is blocked.                           |
| Discord, Slack, Teams                                                 | The senders (also the admin notifications) stop before the request; adding or testing them is blocked.                  |
| Push (web and mobile)                                                 | `isPushConfigured()` is false and Expo push sends nothing; subscribing is blocked.                                      |
| AI (paid APIs)                                                        | `isAIEnabled()` and `isAIEnabledForUser()` are false; AI procedures and AI settings are blocked.                        |
| Billing and checkout (Stripe, Alunta, app stores, desktop licence)    | `isBillingEnabled()` is false; checkout, plan changes, refunds and Alunta mappings are blocked.                         |
| Accounting and calendar (Billy, Dinero, e-conomic, Google, Microsoft) | Saving keys, connection tests and OAuth starts are blocked; the start and callback routes redirect back with a message. |
| Client portal on a custom domain                                      | Setting and verifying the domain is blocked.                                                                            |
| API keys                                                              | Creating a key is blocked.                                                                                              |
| Sharing between demo accounts                                         | Inviting members, accepting invitations and importing employees are blocked, so cleanup can always delete the account.  |
| Desktop and extension licence endpoints                               | `/api/desktop/license/*` and `/api/licenses/*` answer 403.                                                              |
| Search engines                                                        | Every page gets `X-Robots-Tag: noindex, nofollow` and `robots` noindex metadata; `/robots.txt` disallows all.           |
| Google Ads                                                            | `getGoogleAdsId()` is empty: no gtag.js, no conversions, no Google Ads line in the cookie banner.                       |
| Realtime (Electric)                                                   | The client never starts the `/api/shapes/timer` shape; the timer syncs over SSE and polling as without Electric.        |
| "Nyheder" (changelog)                                                 | No unread check, no dot and no menu item, so the dialog never opens on the first visit.                                 |
| Automatic product tour                                                | The tour does not start by itself; the banner offers it with a "Se en rundvisning" button.                              |

Blocked tRPC procedures answer `FORBIDDEN` with "Det er ikke muligt i demoen." / "This isn't
available in the demo.", which the app shows as a normal message. The full list is
`DEMO_BLOCKED_PROCEDURES` in `src/lib/demo/blocked.ts`; a test checks that every name exists.

Every app page shows a slim banner that cannot be closed: "Demo: dine data slettes efter 24
timer, og der sendes ingen mails." with links to the GitHub repository and the self-hosting docs, and a button that starts
the product tour.
