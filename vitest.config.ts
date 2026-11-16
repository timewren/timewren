import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Filer der kører mod en rigtig Postgres (TEST_DATABASE_URL). De bygger hver
// et schema og åbner egne forbindelser; når alle kører samtidig med resten af
// suiten på en delt runner, sulter Postgres, og hooks overskrider 30 s eller
// forbindelsen giver `CONNECT_TIMEOUT`. De får derfor eget projekt med få
// workers og længere timeouts.
// Alle DB-tests hedder `*.integration.test.ts`; nye filer med TEST_DATABASE_URL
// skal følge navnet, ellers havner de i unit-projektet, og forbinde via
// `testPostgres`/`connectTestDb` fra src/test/test-db.ts.
const dbTests = ["src/**/*.integration.test.ts"];

// Unit-projektet bruger lokalt vitests standard (kerner - 1). På CI's delte
// runner-maskiner tog det alle CPU'er fra nabojobbenes Postgres og Docker-build,
// så checks.yml sætter TT_UNIT_MAX_WORKERS (docs/ci.md). Ikke VITEST_MAX_WORKERS:
// den overskriver også integration-projektets 2.
const unitMaxWorkers = Number(process.env.TT_UNIT_MAX_WORKERS || Number.NaN);

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // Extensionens rene moduler testes her, så pengenær logik (klippekort-
          // udvælgelse) har et testhjem uden at extensionen skal have egen runner.
          include: [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "browser-extension/src/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
          exclude: [...configDefaults.exclude, ...dbTests],
          ...(Number.isInteger(unitMaxWorkers) && unitMaxWorkers > 0
            ? { maxWorkers: unitMaxWorkers }
            : {}),
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: dbTests,
          maxWorkers: 2,
          // Egen gruppe, der kører efter unit-projektet (kræves, når maxWorkers
          // er forskellig), så DB-filerne ikke konkurrerer med de ~560 andre.
          sequence: { groupOrder: 1 },
          testTimeout: 90_000,
          hookTimeout: 90_000,
        },
      },
    ],
    environment: "node",
    // Første import af store moduler (i18n-kataloger, sider) kan overskride 5 s,
    // når hele suiten kører parallelt; enkeltkørt tager de få sekunder.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Testene dækker TimeTrack Cloud-adfærden (planer og grænser gælder, brandet
    // er TimeTrack). Selvhost uden betalingsudbyder (#962) og TimeWren-brandet
    // (#968) testes eksplicit med vi.stubEnv.
    env: {
      ALUNTA_API_KEY: "test-billing-enabled",
      // Eksplicit testværdi: koden har ingen signerings-fallback (#1013).
      BETTER_AUTH_SECRET: "test-only-signing-secret",
      NEXT_PUBLIC_BRAND: "timetrack",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
