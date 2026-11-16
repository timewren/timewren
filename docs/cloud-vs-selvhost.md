# Cloud vs. self-hosting

**No locked features by design. Cloud sells operations, not code.**

TimeTrack Cloud and a self-hosted instance run the same code base. What differs is who runs it, how much of it you can use, and who answers when something breaks. This page sorts every difference into one of three kinds, so you can judge the promise yourself.

| Kind                    | Examples                                                                                          | Rule                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Feature**             | invoicing, klippekort (prepaid hours), enterprise module, SSO, API, export, reports, integrations | In the code, and meant to work in every edition. Never gated by plan, subscription, brand or license key     |
| **Capacity**            | number of users, active clients, storage, backup retention                                        | May be limited and priced in Cloud, because it costs money to run. A self-hosted instance has no such limits |
| **Operations and keys** | hosting, updates, backups, mail delivery, SMS, AI key, approved OAuth apps, support               | What Cloud sells. The code works with your own keys; Cloud supplies them ready-made                          |

## Comparison

| Area                      | Cloud                                                                 | Self-hosted                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Features                  | Same code base                                                        | Same code base                                                                                                                      |
| Users and active clients  | Limited by plan (the Free plan: 3 users and 3 active clients)         | No limits                                                                                                                           |
| Trial period and billing  | Yes: trial, subscriptions, invoices for the subscription              | None. Billing is off unless you configure a payment provider yourself                                                               |
| Hosting                   | Run by Mahope                                                         | You run it (Docker Compose, or the Coolify file)                                                                                    |
| Updates and migrations    | Rolled out by Mahope                                                  | Manual: `git pull`, then `docker compose up -d --build`. Migrations run at app start                                                |
| Backup and restore        | Run by Mahope. Retention period: not decided                          | You run it. Step-by-step recipe in [self-hosting.md](self-hosting.md#backup-and-restore)                                            |
| Mail delivery             | Pre-configured                                                        | Your own SMTP or Resend key. Without one, mails are not sent                                                                        |
| OAuth apps, AI, CVR       | Pre-configured by Mahope                                              | Your own keys in `.env`. Without a key the integration is off ([list](self-hosting.md#integrations-that-need-your-own-credentials)) |
| File storage              | Run by Mahope. Storage quota: not decided                             | Local disk volume or any S3-compatible bucket                                                                                       |
| Telemetry                 | Plausible and Sentry run only when their build-time variables are set | None by default ([details](self-hosting.md#telemetry))                                                                              |
| Data processing agreement | [DPA](DPA.md)                                                         | You are the controller and processor                                                                                                |
| Support                   | Support level and response times: not decided                         | No direct support. Optional support agreement: not decided                                                                          |
| SLA                       | Not decided                                                           | None                                                                                                                                |
| Price                     | Not decided here. The current plans are listed in the app             | Free                                                                                                                                |
| License                   | Same source code                                                      | Same source code                                                                                                                    |

## What Cloud sells

- Hosting and operation in the EU, kept running by Mahope.
- Automatic updates and migrations.
- Backups, restore and retention. Retention is capacity.
- Mail delivery, SMS and domain setup, pre-configured.
- Approved OAuth apps (Google, Microsoft), CVR lookups and an AI key. Every integration also works with your own keys.
- Support. Service levels and response times are not decided.
- A data processing agreement and EU data location.

Cloud does not sell modules, integrations, reports or "Pro" features.

## Billing and the code

Whether payments exist at all is decided by one function, `isBillingEnabled()` in `src/lib/billing/billing-enabled.ts`. It is on when a payment provider is configured through the environment (`ALUNTA_API_KEY`, `STRIPE_SECRET_KEY` or `STORE_BILLING_ENABLED=1`). Without any of them there are no limits, no expiring trial, no upgrade buttons and no price walls. The billing code stays in the public source tree and is inactive without keys.

The intended rule is that billing controls invoicing for the subscription, the trial and capacity, and nothing else.

## Known differences today

None by feature. Billing controls invoicing for the subscription, the trial and capacity (users and active clients), and nothing else: no module, integration or report is gated by plan, subscription or brand (`src/lib/billing/plan-gate.ts`, `seedNewOrgModules()` in `src/lib/modules/bundles.ts`). If you find a feature that behaves differently in Cloud for a reason other than operation or capacity, please [open an issue](https://github.com/timewren/timewren/issues).
