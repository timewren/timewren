# Licensing boundaries

Web and server code in this repository is AGPL-3.0-only, including the server's
MCP endpoint and authentication implementation. The browser extension is MIT.
`REUSE.toml` supplies bulk SPDX metadata for first-party source files; explicit
third-party notices retain their original licenses. Assets, fonts and trademarks
must be reviewed separately; bulk source annotations do not relicense them.

The TimeWren monorepo contains web/server (AGPL), desktop (AGPL), mobile (AGPL with an
app store permission) and the browser extension (MIT). Each imported package has its own
LICENSE and package metadata. Do not mark a server router MIT just because it speaks MCP,
or a crate MIT if it depends on AGPL implementation code. Standalone MIT client packages or
crates need a separate decision and the dependency review in
[licensing-client-review.md](licensing-client-review.md).

The metadata guard in `license-policy.json` covers only the web and extension packages present
here.

## Mobile: AGPL with an app store permission

Decision (Mads, 2026-11-06): the mobile app is AGPL-3.0-only, like web, server and desktop,
with an additional permission under AGPL section 7 that allows distribution through the Apple
App Store and Google Play. The text is in
[licenses/MOBILE-APP-STORE-EXCEPTION.md](../licenses/MOBILE-APP-STORE-EXCEPTION.md); the root
LICENSE and the mobile package's LICENSE point to it. Mads approved the wording on 2026-11-16.
It must be in place before the first external contribution to mobile is merged,
because with DCO and no CLA, adding it later needs every contributor's consent.

## Contributions

There is no CLA and no closed `ee/` edition. Contributions use DCO sign-offs as described in
CONTRIBUTING.md and are licensed under the license of the files they change.

## Desktop distribution

Decision (Mads, 2026-11-06, option A): the desktop licence stays, following a Cap-style model.

- Self-built AGPL builds are free for any use.
- Official builds are free for personal use.
- Official builds are included with a TimeTrack or TimeWren account, on every plan including
  Free.
- Business use of an official build without an account needs a desktop licence: 499 kr. once
  (`DESKTOP_LIFETIME_PRICE` in `src/lib/config.ts`), up to three computers and a 30-day refund
  window.
- Existing buyers keep everything they bought: licences, keys, three computers, the refund
  window, offline proof and access to official builds. They get priority support for 24
  months (#969).

This is a condition on the official binaries Mahope distributes. It does not restrict the
rights the AGPL grants to the source code.
