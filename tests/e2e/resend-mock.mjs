// Lokal Resend-mock til E2E: start dev-serveren med
//   RESEND_API_KEY=re_test RESEND_BASE_URL=http://127.0.0.1:<port>
// og kør `node tests/e2e/resend-mock.mjs <port> <mappe>`. Hver mail gemmes
// som JSON i mappen (læses af auth-login-paths.spec.ts via E2E_MAIL_DIR).
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const port = Number(process.argv[2] ?? 4599);
const dir = process.argv[3] ?? "tests/e2e/.mails";
mkdirSync(dir, { recursive: true });
let n = 0;

createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url?.startsWith("/emails")) {
      const mails = req.url.startsWith("/emails/batch")
        ? JSON.parse(body)
        : [JSON.parse(body)];
      const ids = mails.map((mail) => {
        n += 1;
        const id = `mock-${Date.now()}-${n}`;
        writeFileSync(join(dir, `${id}.json`), JSON.stringify(mail));
        return { id };
      });
      res.end(JSON.stringify(ids.length === 1 ? ids[0] : { data: ids }));
      return;
    }
    res.end(JSON.stringify({ data: [] }));
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`resend-mock på 127.0.0.1:${port} → ${dir}`);
});
