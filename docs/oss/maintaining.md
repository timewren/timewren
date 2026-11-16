# Maintaining TimeWren

How issues and pull requests are handled in `timewren/timewren`. Contributors only need [CONTRIBUTING.md](../../CONTRIBUTING.md); this page is the maintainer side, written down so the process is predictable.

## Where the code lives

`timewren/timewren` is the public repository: issues, Discussions, pull requests and releases happen there. The code is developed in a private source repository at Mahope, which also runs TimeTrack Cloud. The public tree is exported from it, without internal operations files and with fresh history.

So a merged pull request has to travel into the source repository and come back with the next export. How that works without losing the contributor's commits is under [Syncing contributions](#syncing-contributions).

## Triage

Every new issue starts with `needs-triage` (set by the issue forms). A maintainer:

1. Checks it is in the right place: questions go to Discussions, vulnerabilities to a private advisory (move or close with a saved reply).
2. Sets one `type:` label and one or more `area:` labels, and removes `needs-triage`.
3. For bugs: tries to reproduce. If that is not possible from the report, sets `needs-repro` and asks for the missing piece.
4. Sets a `priority:` label. `priority: critical` is data loss, a security issue or a broken install, and is worked on before anything else.
5. For features that need a scope or design choice: sets `needs-decision` and writes the decision in the issue when it is made.
6. Marks small, well described issues `good first issue` and issues a maintainer will not get to soon, but would merge, `help wanted`.

Issues with `needs-repro` and no answer for 30 days are closed with the "stale" reply. They can be reopened at any time.

### Labels

Labels are defined in [`.github/labels.yml`](../../.github/labels.yml): `type:`, `area:`, `priority:`, and the status labels `needs-triage`, `needs-repro`, `needs-decision`, `good first issue`, `help wanted`, `security`, `breaking`, `duplicate`, `out of scope`, `dependencies`. The file is the source of truth; labels are created from it by a maintainer script in the source repository (dry run by default). Do not create labels by hand that are not in the file.

### Response targets

| What                                       | Target         |
| ------------------------------------------ | -------------- |
| First reply on a new issue or pull request | 3 working days |
| Security report acknowledged               | 3 working days |
| Review of a pull request that passes CI    | 5 working days |

A first reply can be a label and a question; it does not have to be a fix.

### Saved replies

Keep these as GitHub saved replies and adjust the details.

**Duplicate**

> Thanks for the report. This is tracked in #N, so I'm closing this one as a duplicate. Please add any extra details there.

**Missing reproduction**

> Thanks. I could not reproduce this yet. Could you add the version, installation type (Docker image, source or Cloud) and the exact steps from a fresh account or demo data? Server logs (`docker compose logs app`) with secrets and names removed help a lot. I've labelled this `needs-repro`.

**Out of scope**

> Thanks for the suggestion. This is outside what TimeWren aims to do (time tracking, prepaid hours and invoicing for freelancers and small agencies), so I'm closing it as out of scope. An integration through the API or MCP server may cover it; happy to help in Discussions.

**Feature idea, move to Discussions**

> Thanks. This is an idea that needs input from more users before it becomes a concrete issue, so I've moved it to Discussions, Ideas. Once we agree on the shape, a maintainer opens an issue for it.

**Question, not a bug**

> This looks like a question about setup rather than a bug, so I've moved it to Discussions, Q&A, where answers help the next person too.

**Stale**

> Closing because we couldn't reproduce this and there has been no reply for 30 days. Comment with the missing details and I'll reopen it.

**Security report in public**

> Thanks for reporting. Please don't post security details in public: I've hidden this issue. Report it privately through a security advisory (Security tab, "Report a vulnerability"), see SECURITY.md.

## What a pull request needs

A pull request is merged when all of these hold:

- **DCO:** every commit carries the author's `Signed-off-by` (the `DCO` check).
- **Green CI:** the `Source checks` workflow (install, typecheck, license policy, lint, migration journal, i18n check, release check, unit and model tests, build).
- **Tests** for changed behaviour, at the lowest level that proves it.
- **No locked features:** nothing is switched on or off by plan, license key, brand or billing configuration. Everything is in open source; there is no paid-only code path.
- **Changelog:** a line under `## [Unreleased]` in `CHANGELOG.md` for anything a user or self-hoster notices. Breaking changes go under `### Breaking` with a `### Migration` group in the same release.
- **Screenshots** before and after for UI changes, with demo data.
- **i18n:** new user-facing text in `en` and `da`. Other languages may be missing (they fall back to English).
- **Migrations** are forward-only Drizzle migrations that run at startup.
- **No merge commits** inside the branch (rebase on `main`), so the commits import cleanly.

Merge with a **merge commit** (not squash or rebase) so the contributor's commits, authorship and sign-off stay intact in both repositories.

## Review

1. **Automatic review.** CodeRabbit reviews every pull request with the `assertive` profile in English (`.coderabbit.yaml`). It comments only; it never approves or merges.
2. **Maintainer review.** A maintainer reads the diff, the CodeRabbit comments and the CI result, and approves or requests changes. Only a maintainer merges.

### AI agents

The maintainer uses AI agents to help with triage and review. The rules:

- Agents **suggest**: labels, a draft reply, review comments, a reproduction. A maintainer decides and posts.
- Agents **never merge** external pull requests, never approve them, and never push to a contributor's branch without being asked.
- Agents **never run unknown code with secrets.** Pull request code runs only in CI on `pull_request` with a read-only token and no secrets, or in a sandbox without credentials. `pull_request_target` workflows that check out pull request code are forbidden, and the export check rejects any `pull_request_target` workflow.
- Agents do not paste personal data from issues, logs or screenshots into prompts or comments.

### First-time contributors

Set Actions to require approval before workflows run for outside contributors. Read the diff, including workflow files and `package.json` scripts, before approving a run.

## Syncing contributions

The public repository receives the pull request; the source repository is where it must land. The flow, with what is manual:

1. **Review and merge in `timewren/timewren`** (manual). Merge commit only.
2. **Import into the source repository** (script, run by a maintainer): `scripts/oss/import-pr.sh <PR number>` in the source repository. It fetches the pull request, checks that it is merged or approved, that every commit is signed off, that it has no merge commits, and that it does not touch paths the export replaces or leaves out. It then applies the commits with `git am` on a new branch `oss/import-pr-<N>`. Author, author date and `Signed-off-by` are kept; each commit gets an `Imported-from: <PR url>` trailer. Nothing is pushed.
3. **Land in the source repository** (manual): push the branch, open a pull request there, wait for CI, merge.
4. **Export and sync** (script plus manual push): run the export, then `scripts/oss/sync-public.sh <export tree> <clone of timewren> --source-commit <sha>`. It replaces the tree in a clean clone of `main` with the export and adds one signed-off commit "Sync from source repository" with a `Source-Commit:` trailer. It never rewrites history, so the contributor's original commits stay in `timewren`. It refuses to run if the new tree would undo any change merged in `timewren` since the last sync (a pull request that has not been imported yet). The push to `timewren` is manual (a maintainer pushes past the branch protection, or opens the sync commit as a pull request).

Manual cases the scripts refuse and print a reason for:

- Pull requests that touch `desktop/` or `mobile/`: those apps live in their own source repositories. Apply them there with `git format-patch --relative=desktop/` (or `mobile/`) and `git am`, keeping the same rules.
- Pull requests that touch files the export replaces (workflows, `AGENTS.md`, `CLAUDE.md` and a few others): port the change by hand to the private counterpart.
- Conflicts in `git am`: resolve by hand, keeping the original author.

## Security

- Private vulnerability reporting is enabled; handling and targets are in [SECURITY.md](../../SECURITY.md).
- A fix is developed in the private advisory or the source repository, released, and then the advisory is published with credit.
- Issues that are hardening without an exploitable vulnerability get the `security` label and are handled in public.

### Dependencies

- Dependabot version updates run in the source repository: weekly, at most a few open pull requests, a cooldown of 7 days after a release, minor and patch only. Majors are upgraded by hand. Updates reach `timewren` with the next sync.
- The public repository has Dependabot **alerts** enabled but no version-update configuration, so updates are not done twice.
- Renovate is not used.
- New packages are checked before they are added: maintainer, age of the latest release, install scripts and the number of new transitive dependencies.

## Discussions

Categories:

| Category      | Use                                          | Format       |
| ------------- | -------------------------------------------- | ------------ |
| Announcements | Releases and project news (maintainers post) | Announcement |
| Q&A           | Installing, configuring and using TimeWren   | Question     |
| Ideas         | Feature ideas before they become issues      | Open         |
| Self-hosting  | Setups, reverse proxies, backups, upgrades   | Open         |
| Translations  | Wording, glossary and new languages          | Open         |
| Show and tell | Integrations and workflows built on TimeWren | Open         |

The Ideas form is in `.github/DISCUSSION_TEMPLATE/ideas.yml`.

## Repository settings (manual, once)

- Discussions on, with the categories above.
- Private vulnerability reporting on; Dependabot alerts on.
- Labels created from `.github/labels.yml`.
- Branch protection on `main`: pull request required, checks `Source checks` and `DCO` required, no force pushes, no deletions.
- Merge button: merge commits only; auto-merge off.
- Actions: default token read-only, approval required for outside contributors.
- CodeRabbit app installed for the repository.
