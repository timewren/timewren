import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const rows = JSON.parse(
  readFileSync(".next/diagnostics/route-bundle-stats.json", "utf8"),
);
const sizes = new Map();
const measured = rows.map((row) => ({
  route: row.route,
  rawBytes: row.firstLoadUncompressedJsBytes,
  gzipBytes: row.firstLoadChunkPaths.reduce((total, path) => {
    if (!sizes.has(path)) {
      sizes.set(path, gzipSync(readFileSync(path), { level: 6 }).length);
    }
    return total + sizes.get(path);
  }, 0),
}));
writeFileSync(process.argv[2], `${JSON.stringify(measured, null, 2)}\n`);
console.log(`Measured ${measured.length} routes (gzip level 6).`);
