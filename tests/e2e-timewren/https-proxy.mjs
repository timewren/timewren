// HTTPS foran den lokale app til TimeWren-E2E (tests/e2e-timewren/README.md).
// Browseren åbner https://timewren.com, som Chromium sender hertil
// (--host-resolver-rules). Proxyen bevarer Host-headeren, så appen vælger
// TimeWren-instansen præcis som bag Traefik i prod.
//
//   node tests/e2e-timewren/https-proxy.mjs <lytteport> <app-port> <key.pem> <cert.pem>
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { connect } from "node:net";

const [listenPort, appPort, keyFile, certFile] = process.argv.slice(2);

const server = createServer(
  { key: readFileSync(keyFile), cert: readFileSync(certFile) },
  (req, res) => {
    const upstream = request(
      {
        host: "127.0.0.1",
        port: Number(appPort),
        method: req.method,
        path: req.url,
        headers: { ...req.headers, "x-forwarded-proto": "https" },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.rawHeaders);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end("upstream error");
    });
    req.pipe(upstream);
  },
);

// WebSockets (fx realtime) videresendes råt.
server.on("upgrade", (req, socket, head) => {
  const up = connect(Number(appPort), "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    up.write(`${lines.join("\r\n")}\r\n\r\n`);
    up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on("error", () => socket.destroy());
});

server.listen(Number(listenPort), "127.0.0.1", () => {
  console.log(`https-proxy på 127.0.0.1:${listenPort} → 127.0.0.1:${appPort}`);
});
