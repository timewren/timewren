# Cron-jobs uden betalingsudbyder (#1014)

En selvhostet instans uden betalingsudbyder (hverken `ALUNTA_API_KEY`,
`STRIPE_SECRET_KEY` eller `STORE_BILLING_ENABLED=1`) kalder ingen Alunta-, Stripe-
eller butiks-API og sender ingen mail om prøveperiode eller betaling. Alle ni jobs
står stadig i `cron/entrypoint.sh`; ruten afgør selv. Cloud-env er uændret.

| Job                     | Uden billing-env                                                                                                    | Ændret i #1014                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `seat-reconciliation`   | no-op (`isBillingEnabled`)                                                                                          | kun test                          |
| `store-billing-sweep`   | no-op (`STORE_BILLING_ENABLED` ikke 1)                                                                              | kun test                          |
| `alunta-duplicate-subs` | no-op (kræver `ALUNTA_API_KEY`)                                                                                     | ja: nøgle-tjek før Alunta-kald    |
| `churn-playbooks`       | no-op (`isBillingEnabled`)                                                                                          | ja: billing-tjek                  |
| `drip-emails`           | aktiveringsmails sendes; opgraderings- og win-back-mails springes over                                              | kun test (route.test.ts); uændret |
| `dunning`               | no-op                                                                                                               | kun test                          |
| `trial-reminder`        | no-op                                                                                                               | kun test                          |
| `trial-expire`          | no-op                                                                                                               | kun test                          |
| `admin-digest`          | kører: driftstal (tilmeldinger, mailfejl, webhook-fejl, flaggede, tickets); MRR-, abonnements- og prøvetal udelades | ja: billing-gren                  |

`alunta-duplicate-subs` tjekker `ALUNTA_API_KEY` og ikke `isBillingEnabled()`,
fordi en Stripe- eller butiksinstans ellers ville kalde Alunta uden nøgle.
`admin-digest` er drift og sendes også på selvhost, men uden abonnements- og
betalingstal og uden at læse `subscriptions`.
