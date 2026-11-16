# Client license and dependency review (2026-11-05)

Decision (Mads, 2026-11-05): AGPL-3.0-only for web, server and desktop; MIT for the browser
extension. Mobile and any standalone client package stay **AGPL until this review has been
read and accepted**; they only become MIT through a separate, explicit decision. This
document is the review. It is evidence for that decision, not a legal opinion.

Update (Mads, 2026-11-06): mobile stays AGPL, with an additional permission under section 7 for
the Apple App Store and Google Play instead of MIT. See [licensing.md](licensing.md). The MIT
conditions below remain relevant only for standalone client packages and crates.

## Method

Lockfile-based, no scripts executed (`--ignore-scripts`), run on a job machine against the
cleaned exports of the pinned revisions below.

| Package                  | Source revision | Tooling                                                                 | Result                                 |
| ------------------------ | --------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| Mobile (`timetrack-app`) | `722d57f7bbe2`  | `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm licenses list` | 1,475 package versions (dev + runtime) |
| Desktop frontend         | `fe2d6b190535`  | `npm ci --ignore-scripts`, license field of each installed package      | 291 packages                           |
| Desktop Rust             | `fe2d6b190535`  | `cargo metadata --locked`                                               | 872 third-party crates, 6 first-party  |
| Web                      | this branch     | license field of each installed package                                 | see "Web notes"                        |

## Mobile (1,475 package versions)

MIT 1,286 · ISC 53 · Apache-2.0 42 · BSD-3-Clause 32 · BSD-2-Clause 28 · BlueOak-1.0.0 10 ·
MPL-2.0 4 · Unlicense 3 · CC0-1.0 4 · 0BSD 2 · others 10 (dual or combined permissive licenses).

- **No GPL, AGPL or LGPL package** in the tree. `node-forge` is `(BSD-3-Clause OR GPL-2.0)`: we use the BSD option.
- **MPL-2.0** (`lightningcss`, build tool, file-level copyleft only): no obligation for our code; keep unmodified.
- **Attribution/other:** `@expo-google-fonts/inter` is `MIT AND OFL-1.1` (font licence travels with the font);
  `caniuse-lite` CC-BY-4.0 and `spdx-exceptions` CC-BY-3.0 are data used at build time.
- The app structure derives from the Obytes starter (MIT, 2021); its notice is kept in `THIRD_PARTY_NOTICES.md`.
- **First-party overlap with web:** several mobile modules mirror web business rules (timer, prepaid, invoices,
  recurring, timesheet). Mahope owns the copyright in both, so Mahope can license the mobile copy under MIT.
  This stops being true for any _external contribution_ to the AGPL web code that is later ported: such code is
  only available under AGPL (DCO, no CLA).

**Conclusion:** no dependency blocks MIT for mobile. Two conditions before MIT is approved: (1) a written rule
that web code with external contributions is not ported into mobile without the contributor's consent, and
(2) a store-terms check for the official store binaries (the reason to prefer MIT is that AGPL and Apple's
store terms are in tension). Until Mads accepts both, mobile is AGPL (`--mobile-license agpl`, the default).

## Desktop

Frontend (291 npm packages): permissive (MIT 227, ISC 21, Apache-2.0 and dual 16, BSD 6, other permissive).
Only `lightningcss` (MPL-2.0, build tool) is copyleft.

Rust (872 crates): MIT, Apache-2.0, dual `MIT OR Apache-2.0`, Zlib, Unicode-3.0, BSD, ISC, Unlicense.
Copyleft appears only as MPL-2.0 (`cbindgen`, `dwrote`, `option-ext`) or as one alternative of a dual licence
(`r-efi`: `MIT OR Apache-2.0 OR LGPL-2.1-or-later`; `self_cell`: `Apache-2.0 OR GPL-2.0-only`), where the
permissive option applies.

The six first-party crates had no licence (`UNLICENSED` or missing). The export now sets
`license = "AGPL-3.0-only"` on all of them and in `package.json`. Standalone MIT extraction of `tt-core`,
`tt-matcher`, `tt-tracker`, `tt-data` or `tt-ai` is **not** approved: `tt-core` states that it mirrors web
business rules, and none has an own LICENSE file or independent release process. Same conditions as mobile apply.

## Web notes (found while checking)

- `react-doctor` (devDependency) is "Modified MIT": it requires permission for AI-training use and for
  selling it as a hosted service. It is a development tool, not distributed, but it is not an OSI licence.
  **Recommendation:** remove it from the public package.json (or confirm acceptance).
- `sentry@0.45.0` (pulled in by `@sentry/nextjs` through its bundler plugin) is `FSL-1.1-Apache-2.0`. It runs at
  build time. **Recommendation:** confirm it is acceptable for self-builders; Sentry itself is optional.
- `@img/sharp-libvips-*` is LGPL-3.0-or-later (prebuilt shared library used by `sharp`). The Docker image must keep
  its licence file; check `licenses/` in the runtime image.
- `ical.js`, `web-push` and `lightningcss` are MPL-2.0 (file-level). `jszip` is `MIT OR GPL-3.0-or-later` (MIT chosen).
- `buffers` and `png-js` declare no licence field; upstream states MIT (README / LICENSE file respectively).

## Not covered

Images, fonts, store listings, screenshots and third-party terms (Apple, Google, accounting APIs) are separate
reviews. The review reads licence metadata, not licence texts, and cannot see code vendored inside packages. Rerun it on the final tree: `scripts/oss/export-client.sh` followed by
the commands above.
