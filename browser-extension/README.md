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
