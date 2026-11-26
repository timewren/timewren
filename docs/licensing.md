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
- Business use of an official build without an account needs a desktop licence, up to three
  computers and a 30-day refund window. TimeTrack: 499 kr. once (`DESKTOP_LIFETIME_PRICE` in
  `src/lib/config.ts`). TimeWren: 69 euros once (`TIMEWREN_DESKTOP_LIFETIME_PRICE_EUR`, Mads,
  2026-11-20), see [TimeWren Desktop licence](#timewren-desktop-licence).
- Existing buyers keep everything they bought: licences, keys, three computers, the refund
  window, offline proof and access to official builds. They get priority support for 24
  months (#969).

### TimeWren Desktop licence

The same model as TimeTrack, sold in euros on timewren.com/desktop (a plain HTML form, no
client JavaScript). The buyer needs no account: an email address, Stripe Checkout in EUR, and
the key arrives by email.

- **Price:** 69 euros once, excl. VAT like the TimeWren Cloud prices. Stripe Tax is always on for
  this checkout, as for Cloud. The price is not in the code as an id: Stripe holds a one-time
  EUR price with the lookup key `timewren_desktop_lifetime_eur`, and the checkout refuses to sell
  it unless it is one-time, EUR and exactly `TIMEWREN_DESKTOP_LIFETIME_PRICE_EUR` (69).
- **Same Stripe account and webhook** as TimeTrack's desktop licence and TimeWren Cloud. The
  checkout session carries `metadata.desktop_brand=timewren`, deliberately not `brand`: events
  with `metadata.brand` go to the Cloud handler, and the licence is issued by the desktop path.
- **Keys:** `TW-XXXX-XXXX-XXXX-XXXX`. The prefix is what scopes a licence to its brand, so the
  schema is unchanged (no migration). Every existing key is `TT-`.
- **No shared licences.** `/api/desktop/license/activate`, `/verify` and `/deactivate` (and the
  old `/api/licenses/*` shims, which delegate to them) answer "not found" when the key's brand
  differs from the brand of the `Host` header: a TimeTrack key does not work on timewren.com and
  a TimeWren key does not work on timetrack.dk. The brand comes from the host through
  `MULTIBRAND_ENABLED=1` only (not `TIMEWREN_APP_ENABLED`), because the licence routes must work
  while only the marketing site is open. Without `MULTIBRAND_ENABLED=1` every host is TimeTrack,
  so a `TW-` key is refused (fail closed). The scope covers the licence API on the desktop host.
  Account-bound paths (the TimeTrack dashboard auto-link by email, the device login and the
  self-service refund form on timetrack.dk) do not check the key prefix; a `TW-` key bought with
  a TimeTrack account email can therefore also show on that account. Known and accepted.
- **Mail and refund:** the key mail is sent as TimeWren (sender, logo, texts, in the buyer's site
  language). TimeWren has no refund page, so the mail and the site tell the buyer to write to
  support within 30 days; the refund itself is done in Stripe (the webhook revokes the key on
  `charge.refunded`, as for TimeTrack). The TimeTrack refund form also accepts a `TW-` key.
- **Admin report:** the revenue report in `/admin/desktop` is in DKK, so `TW-` licences are left
  out of it (no DKK amount is stored for them). Their revenue is in Stripe.
- **Download:** the sales page and the key mail link to the site's `/download` page. It links the installers of the `timewren-stable` release (never the repo's latest release, which is TimeTrack) in the releases repo: `mahope/timetrack-releases` on the TimeTrack build, otherwise `NEXT_PUBLIC_DESKTOP_RELEASES_REPO` (build arg). Without a repo the page shows no installers.
- **Setup (Mads):** see the report for the Stripe product and price. No new environment
  variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MULTIBRAND_ENABLED=1` and the existing
  `checkout.session.completed` and `charge.refunded` webhook events are enough.
- **App:** the desktop app opens `https://timewren.com/desktop#buy` to buy and activates against
  `https://timewren.com/api/desktop/license`.

This is a condition on the official binaries Mahope distributes. It does not restrict the
rights the AGPL grants to the source code.
