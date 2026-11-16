# Day-off calendar: remaining fixes from #742 (#763)

The effective calendar remains department > organization > personal > public
holidays. Active employees cannot override HR calendars with a personal calendar.

## Calculations

- The team week overview already removes the remaining norm when approved absence
  overlaps a half day off. `team-day-off.test.ts` exercises that unchanged router.
- Flex, norm-period totals and the timesheet now apply approved absence to the
  hours remaining after a half day off. A full absence leaves zero expected hours.
- Vacation/absence creation, editing, sickness closure and new closure-period
  requests count a half day off as at most half a working day before the existing
  vacation conversion factor. A request that is itself half a day still counts
  half a day, rather than a quarter.
- Team utilization loads schedules, employment periods, plans and calendars in
  batches. Query count does not grow with the number of members. HR employees
  retain their norm; other members retain their personal schedules/calendars.
- Saving or resetting an organization/department calendar recalculates its
  existing flex entries in the same transaction. Failure rolls back the calendar
  change too. Department recalculation is limited to that organization's current
  department members. Personal calendars do not affect employee flex.

## Preset verification (2026-11-03)

The persisted key `ok24` is retained, without a migration. Its display name now
specifies **municipal administration and IT (OK24/OK26)** rather than implying a
rule for all public employees.

Verified against the primary texts:

- [KL/HK 30.11 OK24, §19, pp. 24–25](https://www.kl.dk/media/sydj1gwe/ok24-3011-overenskomst-for-administration-og-it-mv.pdf).
- [KL/HK 30.11 OK26, §20, pp. 25–26](https://www.kl.dk/media/gvqmhxi2/ok26-3011-overenskomst-for-administration-og-it-mv.pdf?format=noformat),
  linked from KL's current administrative agreements overview.

Both provide full days off on Easter Saturday, Christmas Eve and New Year's Eve,
plus time off after noon on May 1 and Constitution Day. Easter Saturday was
missing and is now included. The agreement also has local/specific exceptions
(e.g. Copenhagen, the former FKKA area and ticket-sales staff); administrators
must adjust the optional-day settings to their applicable rules.

TimeTrack models a half day as half the daily norm, not an exact clock interval
ending at noon. The preset does not implement all occupational/local agreements.
The state's rules are different; see [PAV 26.2.8.2–3](https://pav.medst.dk/pav/kapitel-26-tjenestefrihed-mv/).

## Limits

No migration, deployment or production data change is part of this branch.
Calendar edits recalculate existing flex entries, not missing historical dates,
previous vacation ledger postings or previously materialized closure requests.
The recalculation is synchronous and can make saves slower for large histories.
The new router unit tests isolate application rules from authentication middleware
and PostgreSQL; the existing database integration tests remain complementary.

Hourly absence is capped per date at the remaining daily norm. Four hours of absence on a half holiday with an eight-hour daily norm therefore count as 0.5 days, both when creating a request and reporting well. Quarter-day rounding applies after summing the period.
