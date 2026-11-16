# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub: **[Report a vulnerability](https://github.com/timewren/timewren/security/advisories/new)** (Security tab, "Report a vulnerability"). If you cannot use GitHub, email **security@timetrack.dk**.

Include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if you have one),
- the version or commit you tested, and whether it was a self-hosted instance or TimeTrack Cloud.

## What happens next

| Step                                           | Target               |
| ---------------------------------------------- | -------------------- |
| Acknowledgement                                | 3 working days       |
| First assessment (severity, affected versions) | 7 working days       |
| Fix for critical and high severity             | 14 days              |
| Fix for medium and low severity                | next planned release |

We work on the fix in a private advisory, credit you in the advisory and the changelog unless you prefer to stay anonymous, and publish the advisory when a fixed release is out. Please give us 90 days, or until a fix is released if that is sooner, before you disclose details publicly.

## Supported versions

TimeWren is in the 0.x series. Security fixes go into the newest minor release only.

| Component                | Supported                                      |
| ------------------------ | ---------------------------------------------- |
| Web app and Docker image | latest `0.MINOR` release (for example `0.4.x`) |
| Browser extension        | latest `extension-v*` release                  |
| Desktop and mobile apps  | latest release in their stores or on GitHub    |
| TimeTrack Cloud          | always runs the current code                   |

Self-hosters should follow the `0.MINOR` Docker tag of the newest release (see [docs/oss/versioning.md](docs/oss/versioning.md)) and read the changelog before upgrading.

## Scope

In scope: the code in this repository (web app, API, MCP server, browser extension, desktop and mobile apps) and TimeTrack Cloud at `timetrack.dk` and `app.timetrack.dk`.

Out of scope:

- denial of service and volumetric attacks,
- social engineering of maintainers or users,
- findings that need a compromised device or browser,
- missing headers or best-practice suggestions without a demonstrable impact,
- problems caused by the configuration of a specific self-hosted instance.

When testing against TimeTrack Cloud, only use accounts you own, never access other users' data, and stop as soon as you have shown the issue.

## Dependencies

Dependency updates are reviewed weekly. New versions are taken in after a cooldown of at least 7 days, majors only by hand. Dependabot security alerts are enabled on this repository; a vulnerable dependency with a known fix is treated like any other report above.
