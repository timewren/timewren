# Optional server access for self-hosting

TimeTrack defaults to TimeTrack Cloud. Users who operate a self-hosted
TimeTrack/TimeWren server can choose “Use own server” (Danish: “Brug egen server”) on the login screen or
under Settings → Advanced.

The manifest declares `https://*/*` and `http://*/*` only under
`optional_host_permissions`. HTTP is accepted only for localhost, loopback and
private IPv4 addresses in development-mode builds, with a visible warning about
unencrypted credentials and data. Production builds accept HTTPS only.
There is no `<all_urls>` permission. Access is requested only when the user
clicks “Connect to server” (Danish: “Forbind til server”), using `chrome.permissions.request` with the exact
selected origin (`https://their-server.example/*`). Existing mandatory Cloud
permissions are unchanged. The optional permission is used to read public
server discovery and to send authenticated time-tracking API requests and
realtime requests to that server. It does not add page-reading content scripts.

Discovery verifies the protocol, compatible API version and same-origin API
URLs before changing the saved server. Tokens are bound to the selected origin,
and authenticated fetches reject redirects. Switching servers removes previous
account data and restarts the extension to discard in-memory caches and live
connections. Offline entries must be synchronised before switching. Users can
switch back to TimeTrack Cloud. The extension revokes the optional host access
when a server is rejected or the user switches away from it, and users can also
revoke it in their browser.

To review, use a test server from the accompanying web repository exposing
`/.well-known/timetrack.json` with API version 1. Select its HTTPS origin, grant
the optional permission, reopen the extension and sign in. The selected host is
shown in Settings → Advanced. Denying the permission or entering an unrelated
HTTPS server leaves the previous server and its credentials unchanged.
