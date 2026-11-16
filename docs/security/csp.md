# Content-Security-Policy

TimeTrack sends two CSP headers on every page (issue #1121):

| Header                                | Source                                                                                                                                                      | Effect                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Content-Security-Policy`             | `buildContentSecurityPolicy()` in `src/lib/security-headers.ts`, set in `next.config.ts` `headers()`                                                        | **Enforced.** Blocks violations. Unchanged by #1121.                                |
| `Content-Security-Policy-Report-Only` | `buildReportOnlyContentSecurityPolicy()` in the same file, set per request by `withReportOnlyCsp()` (`src/lib/csp-report-only.ts`) from `src/middleware.ts` | **Report only.** Blocks nothing; the browser posts violations to `/api/csp-report`. |

The browser applies both independently. Only the enforced one can break a page,
so the report-only policy can be as strict as we like while we collect data.

## How the stricter policy differs

| Directive       | Enforced                                                                                       | Report-only                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script-src`    | `'self' 'unsafe-inline' 'wasm-unsafe-eval'`, Plausible, `https://cdn.jsdelivr.net`, Google Ads | `'self' 'nonce-…' 'wasm-unsafe-eval'`, Plausible, Google Ads. No `'unsafe-inline'`, no jsdelivr.                                                                                                                                                                          |
| `style-src`     | `'self' 'unsafe-inline' https://cdn.jsdelivr.net`                                              | `'self' 'unsafe-inline'`                                                                                                                                                                                                                                                  |
| `img-src`       | `'self' data: blob: https:`                                                                    | `'self' data: blob:`, the `S3_ENDPOINT` origin, OAuth avatar hosts (`lh3.googleusercontent.com`, `avatars.githubusercontent.com`, `cdn.discordapp.com`), Google Ads pixels (`www.googletagmanager.com`, `www.google.com`, `www.google.dk`, `googleads.g.doubleclick.net`) |
| `font-src`      | `'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com`                              | `'self' data: https://fonts.gstatic.com`                                                                                                                                                                                                                                  |
| everything else |                                                                                                | Identical (built from the enforced policy, so they cannot drift), plus `report-uri /api/csp-report`                                                                                                                                                                       |

`'unsafe-eval'` is added to both only in development (React Fast Refresh).

### Nonce

The middleware makes a fresh nonce per request (`createNonce()`), puts it in the
report-only header and forwards the same policy as the
`content-security-policy-report-only` **request** header. Next.js reads the nonce
from that request header (`parse-request-headers.js` checks
`content-security-policy` first, then the report-only one) and adds it to its own
inline and bootstrap scripts when it renders the page.

This does not make any page dynamic. Pages that are prerendered (static/ISR) are
served from the cache and have no nonce, so their inline scripts show up as
`script-src-elem inline` reports. That is expected and is the main thing to fix
before enforcing (see below).

### jsdelivr

The only current use is the Scalar API reference on `/api/v1/docs`
(`src/app/api/v1/docs/route.ts`), loaded from
`https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.51.0`. The route is outside
the middleware matcher, so it sets its own report-only header with
`scalarApiReference: true`: the exact bundle URL (a CSP path source, so the rest
of the CDN is not allowed) and the hash of its empty inline config script
(`EMPTY_INLINE_SCRIPT_HASH`). The bundle URL is the constant
`SCALAR_API_REFERENCE_SCRIPT`; the route uses it too, so a version bump changes
both. No other page allows jsdelivr in the report-only policy.

## The report endpoint

`POST /api/csp-report` (`src/app/api/csp-report/route.ts`):

- Public (browsers send reports without cookies), rate-limited per IP with the
  shared limiter (`cspReport`: 60 per minute; Valkey when enabled).
- Accepts both `application/csp-report` (`report-uri`) and the Reporting API
  batch format (`application/reports+json`). Bodies over 64 KB get 413, invalid
  JSON 400.
- Logs one line per violation at warn level, with only the directive and the
  blocked host or CSP keyword:

  ```
  [csp-report] { directive: 'script-src-elem', blocked: 'inline' }
  [csp-report] { directive: 'img-src', blocked: 'images.example.net' }
  ```

  The page URL, referrer, script sample, source file and the full blocked URL
  are never read, so ids, tokens and user data do not reach the logs. Anything
  that is not a known keyword or a valid host is logged as `other`/`unknown`.

Read the reports in Grafana (container logs for the app, filter on
`[csp-report]`) and group by `directive` + `blocked`.

## Known reports to expect

These are known gaps between today's code and the strict policy. Each must be
fixed (or deliberately allowed) before enforcing:

1. **Prerendered pages:** Next.js inline scripts without a nonce (see Nonce
   above).
2. **Theme/consent bootstrap script** in `src/components/DocumentLayout.tsx`
   (`dangerouslySetInnerHTML`, no nonce). It is static, so its hash can be
   added to `script-src`, or the layout can pass the nonce from `headers()`
   (that makes the layout dynamic).
3. **Inline `next/script` blocks** in `src/components/GoogleAds.tsx`
   (consent mode and config). They need the `nonce` prop from `headers()`.
4. **Email template preview** (`dashboard/settings/email-templates/[id]`) shows
   images from any URL the user typed. Either proxy them or accept the report.
5. **Scalar** may fetch fonts or other assets from its own hosts on
   `/api/v1/docs`; add only what the reports show.

## Flipping to enforced

Do this once the reports have been quiet (no unexplained directive/host
pairs) for at least a week on production traffic:

1. Fix or allow every item above. Add new hosts to the constants in
   `src/lib/security-headers.ts`, not inline.
2. In `src/middleware.ts` / `withReportOnlyCsp()`, send the policy as
   `Content-Security-Policy` instead of `Content-Security-Policy-Report-Only`
   (keep the request header name, Next.js reads the nonce from either). Do
   the same in `src/app/api/v1/docs/route.ts`.
3. Remove the `Content-Security-Policy` entry from `next.config.ts`
   `headers()`. With two enforced policies a resource must pass both, so the
   old permissive one adds nothing but confusion; keep exactly one.
4. Keep `report-uri` in the enforced policy so blocked resources are still
   reported, and update the tests in `src/lib/security-headers.test.ts`
   (the byte-for-byte test of the old enforced policy goes away with it).
5. Deploy to beta first and click through login, dashboard, timer, invoices,
   the client portal, marketing pages with consent given and refused, and
   `/api/v1/docs`.

Rollback: revert the commit; the old enforced header comes back from
`next.config.ts`.
