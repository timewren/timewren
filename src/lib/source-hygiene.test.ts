import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Usynlige kontroltegn (fx U+0001) i JSX bliver vist som en tom firkant i
// knapper og overskrifter, som det skete på "+ Kunde" på kundelisten.
// Tab (9), linjeskift (10) og vognretur (13) er tilladt. Kun .tsx tjekkes:
// .ts-moduler må bruge fx NUL som bevidst skilletegn i nøgler.
function hasControlChar(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127)
      return true;
  }
  return false;
}

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry.name) ? [path] : [];
  });
}

describe("komponentfiler", () => {
  it("indeholder ingen usynlige kontroltegn", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          hasControlChar(line) ? [`${relative(SRC, file)}:${i + 1}`] : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});
