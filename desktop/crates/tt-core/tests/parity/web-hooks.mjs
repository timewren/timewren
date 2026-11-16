// Node-resolve-hook, så web-repoets TypeScript kan importeres direkte af
// generate.ts uden npm install: "@/x" peger på <WEB>/src/x, og importer uden
// filendelse får ".ts"/".tsx" eller "/index.ts" på. Node 23+ stripper selv
// typerne. Registreres synkront af register.mjs (module.registerHooks).
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const web = process.env.WEB;
if (!web) throw new Error("Sæt WEB=<sti til en klon af mahope/timetrack>");
const webSrc = path.resolve(web, "src");

function withExtension(base) {
  for (const ext of ["", ".ts", ".tsx", "/index.ts"]) {
    const candidate = base + ext;
    if (existsSync(candidate) && (ext !== "" || path.extname(candidate))) {
      return candidate;
    }
  }
  return null;
}

export function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = path.join(webSrc, specifier.slice(2));
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    base = path.resolve(path.dirname(new URL(context.parentURL).pathname), specifier);
  }
  if (base) {
    const file = withExtension(base);
    if (file) return next(pathToFileURL(file).href, context);
  }
  return next(specifier, context);
}
