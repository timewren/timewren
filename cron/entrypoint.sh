#!/bin/sh
# SPDX-FileCopyrightText: 2025-present Mahope
# SPDX-License-Identifier: AGPL-3.0-only
set -e

export TZ=Europe/Copenhagen

if [ -z "$CRON_SECRET" ]; then
  echo "ERROR: CRON_SECRET is not set"
  exit 1
fi

if [ -z "$APP_URL" ]; then
  echo "ERROR: APP_URL is not set"
  exit 1
fi

# Write crontab with env vars expanded. Runs as the non-root "cron" user via
# supercronic (busybox crond can't load/run jobs without root), so the file
# lives in /tmp instead of /etc/crontabs.
# Hemmeligheden må ikke stå i selve crontab-linjen: supercronic logger
# job.command ordret ved hver kørsel, og "cat $CRONTAB" nedenfor printer
# den ved opstart. curl læser i stedet headeren fra en 0600-fil.
CURL_AUTH=/tmp/curl-auth
umask 077
printf 'header = "Authorization: Bearer %s"
' "$CRON_SECRET" > "$CURL_AUTH"
umask 022

# --max-time 300: supercronic starter ikke et job igen, mens det forrige kører.
# Et curl-kald der hænger (fx når appen redeployes midt i et kald) ville
# ellers blokere jobbet på ubestemt tid. Det længste job (email-sync) tager
# op til ca. 80 s.
CRONTAB=/tmp/crontab
cat > "$CRONTAB" << EOF
# Every 2 minutes
*/2 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/data-export
# Imports med over 50 poster behandles kun her (mindre imports kører inline)
*/2 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/import

# Every 5 minutes
*/5 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/timer-cleanup
*/5 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/webhook-retry
*/5 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/email-sync
# Forny Dinero-tokens der udløber inden for 10 min
*/5 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/refresh-tokens

# Every 15 minutes
*/15 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/calendar-sync
*/15 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/invoice-sync
*/15 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/end-of-day
*/15 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/idle-warning
# Stabilitetsvagten: timer-/datafejl, realtime og tavse cron-jobs (alarmer ved tilstandsskift)
*/15 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/stability-watch

# Every hour
0 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/recurring
30 * * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/migration-drift

# Betalingsjobs (#1014): seat-reconciliation, store-billing-sweep,
# alunta-duplicate-subs, churn-playbooks, drip-emails, dunning, trial-reminder,
# trial-expire og admin-digest står i crontab på alle instanser. Uden
# betalingsudbyder (hverken ALUNTA_API_KEY, STRIPE_SECRET_KEY eller
# STORE_BILLING_ENABLED) er de no-ops i selve ruten: ingen Alunta-, Stripe- eller
# butikskald og ingen prøve- eller betalingsmails. Se docs/cron-uden-betaling.md.

# Daily
# Planlagte satsændringer: anvend forfaldne ændringer lige efter midnat
5 0 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/scheduled-rates
0 8 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/daily-digest
0 3 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/webhook-cleanup
0 3 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/calendar-webhook-renew
0 9 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/prepaid-alerts
45 8 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/budget-alerts
15 6 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/invoice-overdue
5 7 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/report-schedules
30 5 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/manager-digest
0 6 * * 5 curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/compliance-forecast
20 7 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/seat-reconciliation
# Køb i appen: butiksrækker over perioden uden notifikation (mørk uden flag)
15 5 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/store-billing-sweep
40 6 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/alunta-duplicate-subs
10 8 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/client-status-report
45 6 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/prepaid-renewals
# Gentagne fakturaer (#198): kladder for forfaldne skabeloner, efter fornyelserne
50 6 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/recurring-invoices
40 7 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/invoice-reminders
30 8 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/churn-playbooks
30 8 * * 1-5 curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/ai-suggestions
0 9 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/deadline-alerts
0 9 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/drip-emails
0 10 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/inactivity-check
0 10 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/dunning
# Ufaktureret-påmindelse (#622): kører dagligt, routen afgør pr. bruger om der
# skal sendes i dag (daily = hverdage, weekly = fredag, monthly = sidste hverdag)
0 10 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/unbilled-reminder
# Dækningsgrad (#679): påmindelse når gårsdagens loggede tid var under
# brugerens egen tærskel — kun brugere der har slået det til
30 6 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/coverage-reminder
0 9 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/trial-reminder
0 2 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/trial-expire

# Weekly (Monday)
0 8 * * 1 curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/weekly-summary
0 8 * * 1 curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/admin-digest

# Weekly (Friday) — enterprise timeseddel-påmindelse kl. 12:00 dansk tid (TZ=Europe/Copenhagen)
0 12 * * 5 curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/timesheet-reminder

# Daily — enterprise ferie-årsskifte (#461): udløbne ferieår uden rollover
30 4 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/vacation-year-rollover

# Daily — periodeafslutning (#518): opgørelser for den senest afsluttede
# måned/kvartal (idempotent, indhenter en mistet dag)
45 4 * * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/period-closing

# Monthly (1st)
0 9 1 * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/monthly-summary
# Monthly (1st) — enterprise ferieoptjening 2,08 dage × FTE for forrige måned (#461)
15 4 1 * * curl -sf --max-time 300 -K "$CURL_AUTH" ${APP_URL}/api/cron/vacation-accrual
EOF

echo "Cron jobs installed for ${APP_URL}:"
cat "$CRONTAB"
echo "Starting supercronic..."
# No exec: supercronic's PID-1 process reaping crashes on startup, so keep
# this shell as PID 1 (same setup as the old `crond -f` invocation).
supercronic "$CRONTAB"
