# TimeWren Browser Extension

Track time without leaving the browser. Start and stop a timer, add time entries and see the status of your prepaid hour packages ("klippekort"). Works with TimeWren Cloud and with your own self-hosted server.

Licensed under the [MIT License](LICENSE). The rest of the TimeWren monorepo is AGPL-3.0, see the root `LICENSE`.

## Features

- Timer with start, pause and stop
- Quick time entry with project and client pickers
- Prepaid hour package status
- Sync with the TimeWren web app
- Keyboard shortcuts: Alt+Shift+T opens the popup, Alt+Shift+S toggles the timer
- Interface languages: Danish, English, German and Spanish

## New tab

The extension replaces the browser's new tab (`chrome_url_overrides.newtab`).
Users can turn it off with **Open TimeTrack on new tabs** in the popup settings
or under the settings on the new tab itself. An override cannot hand the tab
back to the browser, so `src/newtab/boot.ts` decides what to show from
`chrome.storage` before React loads:

| Browser | New tab with the setting off |
| --- | --- |
| Google Chrome | The tab goes to `chrome://new-tab-page/`, Chrome's own new tab with search and shortcuts. The address bar stays empty. The back button is active, and going back lands on Chrome's new tab again. |
| Edge, Firefox, Brave, Opera, Vivaldi and others | A simple page with a search box that uses the browser's default search engine (`chrome.search.query`), plus links to the web app and the settings. The results open in the tab the search came from (its id is passed as `tabId`; Firefox would otherwise bind `CURRENT_TAB` to whichever tab is active when the search service answers). If the tab's id cannot be read, the page does not search at all rather than risk another tab. If the browser refuses the search, for example because a policy removed the default search engine, a message under the box says to use the address bar. |

Chrome always gets `chrome://new-tab-page/`, Chrome's Google new tab page,
also when the default search engine is not Google. Chrome itself would then
show `chrome://new-tab-page-third-party/` or the search provider's own page.
The extension cannot read the default search engine without extra
permissions, and `chrome://newtab` would load the override again. The page
still reads "Search Google", but in a test with Bing as the default search
engine its search box sent the query to Bing, so the help text in Chrome only
promises Chrome's own new tab in its Google version, also when the default
search engine is a different one, and says nothing about which engine searches.

Browser test: `npm run build && node scripts/verify-newtab.mjs [dist] [screenshot-dir]`
(13 checks, both states; Playwright comes from the repo root). It uses
Playwright `launchPersistentContext` with `--load-extension` and
`--disable-extensions-except` as in
[Playwright's guide](https://playwright.dev/docs/chrome-extensions), with
Chrome's sandbox on and `channel: "chromium"`: without it, headless Playwright
picks `chromium-headless-shell`, which cannot load extensions. Playwright's own Chromium (Chrome for Testing) loads the
extension with the flag. Google Chrome Stable ignores `--load-extension` since
Chrome 137, also with `--disable-features=DisableLoadExtensionCommandLineSwitch`,
so when no service worker appears, the test logs it, starts again without
`--disable-extensions-except` and loads the same folder over the browser CDP
session (`Extensions.loadUnpacked`, needs `--enable-unsafe-extension-debugging`).

Verified so far: Google Chrome 158.0.8127.36, 13/13, with the extension loaded
over CDP. The run with Playwright's own Chromium has not been made, because the
test machine (agent-worker) does not allow it: its Chromium folders in
`~/.cache/ms-playwright` are deliberately links to Google Chrome Stable, as
early Chromium builds have had sandbox escapes. `npx playwright install
chromium` therefore reports the browser as installed and does nothing, and a
real download (`--force`) is replaced by Chrome Stable again within 10 minutes.
Run the script on a machine with Playwright's own Chromium to cover
`--load-extension` itself; until then that run is still open for #1322. Edge was only emulated by making Chrome report the
Edge brand, so Chrome still ran `search.query`. Real Edge and Firefox,
including focus after a physical Ctrl+T, have not been tested yet.

Why not the browser's own page everywhere:

- Edge's own new tab (`edge://newtab`) is the page the extension overrides, so
  it would load TimeTrack again. `https://ntp.msn.com/edge/ntp` is not used
  because it has not been verified in Edge.
- Firefox does not let extensions open privileged `about:` pages, and
  `about:newtab` is overridden as well.
- Brave, Opera and Vivaldi have their own new tab pages, and a redirect to them
  has not been verified. Only Google Chrome (the `Google Chrome` brand) is
  redirected; Vivaldi reports only `Chromium` and gets the search page.

The browser is detected with `navigator.userAgentData.brands`, without extra
permissions. `chrome.tabs.getCurrent` and `chrome.tabs.update` work without the
`tabs` permission, which would warn "Read your browsing history". The
`search` permission gives no install warning in Chrome, checked with
`chrome.management.getPermissionWarningsByManifest`, and needs no prompt in
Firefox (`OptionalPermissionNoPrompt`), so updating does not ask users to
approve the extension again.

## Connect to your own server

On the sign-in screen, or under Settings → Advanced, choose **Use own server**
(**Brug egen server** in Danish). Enter the public HTTPS address of your instance, for example
`https://tid.example.com`, and select **Connect to server**. The browser asks
for access to that one address only. The extension then checks
`/.well-known/timetrack.json` before it saves the address. The server must
support API version 1.

Switching servers signs you out, clears local account data and restarts the
extension. Reopen it and sign in on the new server. Synchronise pending offline
entries first. Settings such as the theme are kept. Choose **Use TimeTrack
Cloud** to return to the default server.

Access tokens are bound to the origin of the server. API calls and the Electric
stream do not follow redirects with a token. If the permission is missing or
revoked, the call stops; the extension never sends the token to Cloud instead.

Browsers do not tell an invalid certificate apart from other network errors, so
the error text asks you to check both the address and the certificate.

The server side (`CORS_ALLOWED_ORIGINS`, `TRUSTED_ORIGINS`) is described in the
[browser extension docs](../content/docs/en/apps/browser-extension.mdx).
The store-review justification for the optional permissions is in
[STORE_REVIEW.md](STORE_REVIEW.md).

## Development

```bash
npm install              # inside browser-extension/
npm run dev              # Chrome, watch mode
npm run build            # Chrome, production build in dist/
npm run build:firefox    # Firefox build in dist-firefox/
npm run typecheck
```

Development builds (`--mode development`) also allow HTTP on localhost, loopback
and private IPv4 addresses. The field shows a warning about unencrypted sign-in
and data. The exact address needs the same optional browser permission and
discovery as HTTPS. Public HTTP addresses are rejected, and production builds
require HTTPS. For a local Firefox test, copy `manifest.firefox.json` to
`dist/manifest.json` after the development build.

### Load the extension

Chrome: run `npm run build`, open `chrome://extensions/`, enable Developer mode, choose "Load unpacked" and select `dist/`.

Firefox: run `npm run build:firefox`, open `about:debugging#/runtime/this-firefox`, choose "Load Temporary Add-on" and select `dist-firefox/manifest.json`.

## Authentication

1. Open your TimeWren web app.
2. Go to Settings, then Integrations, and find the browser extension section.
3. Generate a new token and paste it into the extension popup.

The extension currently only talks to TimeWren Cloud and `localhost`. Pointing it at any server you host yourself depends on the pending "own server URL" change.

## Contributing and security

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · Privacy: [PRIVACY_POLICY.md](PRIVACY_POLICY.md)
