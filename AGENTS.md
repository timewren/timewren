# AGENTS.md

Guidelines for AI and code agents working in this repository (TimeWren).

## Quick context

- **Project:** TimeWren, a self-hostable CRM and time tracking system for freelancers, with prepaid hour packages ("klippekort"), invoicing, tasks and a client portal.
- **Stack:** Next.js 16 (App Router) + React 19 + TypeScript (strict) + tRPC + Drizzle ORM + PostgreSQL + Better-Auth + Tailwind CSS 4.
- **Code quality:** Biome only. Do not add ESLint or Prettier.
- **User-facing text** is Danish. Code, comments and commit messages are in English or Danish; follow the surrounding file.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # Biome (check only)
npm test             # Vitest unit tests (same as test:unit, no database needed)
npm run test:e2e     # Playwright E2E (needs PostgreSQL)
npm run typecheck    # tsc --noEmit
npm run i18n:check   # message catalogs (src/i18n/messages)
npm run check        # local CI gates
npm run db:generate  # generate Drizzle migration after a schema change
npm run db:migrate   # run migrations
```

## Conventions

- Prefer server components by default; dashboard pages are client components that call tRPC hooks.
- Use the `@/*` alias for imports and 2-space indentation (Biome enforces both).
- Writes (mutations) chain on `subscribedProcedure` or `moduleWriteProcedure(key)`, not bare `protectedProcedure` (see `src/lib/trpc/trpc.ts`).
- User-facing text goes in the message catalogs (`src/i18n/messages/<language>/`, `da` and `en` required); run `npm run i18n:check`.
- Keep migrations additive. Never edit a migration that has been released.
- Archive instead of deleting user data (`isArchived`).
- Multi-tenant by `organizationId`; filter every query by it.
- Never run `biome check --write` or `biome format` on whole directories; format only the files you changed.
- Add or update tests with every behavior change. Fix a bug by writing a failing test first.

## Environment variables (core)

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `ENCRYPTION_KEY`. See `.env.example` for the full list. Never commit secrets or real customer data.

## Contributing

Sign off every commit (`git commit -s`) to certify the Developer Certificate of Origin (https://developercertificate.org). Do not add AI attribution trailers to commits.

## Documentation for agents (TimeWren docs)

The user documentation lives at https://timewren.com/docs and is written to be read by agents:

- `https://timewren.com/llms.txt`: index of every page, each linked as Markdown.
- `https://timewren.com/llms-full.txt`: the whole English documentation in one Markdown file.
- Any docs page as Markdown: add `.md` to its URL (e.g. `https://timewren.com/docs/configuration/environment.md`) or send `Accept: text/markdown`.

Read the relevant page before installing, upgrading or configuring a TimeWren instance, and before changing behaviour the docs describe (environment variables, install artifacts, API, MCP).

The sources are in `content/docs/<locale>/` (MDX: plain Markdown + GFM, the only component is `<Screenshot name="..." alt="..." />`). English (`en`) is the source; `da`, `de` and `es` are full translations, and every page must exist in all four. When you change behaviour, update the English page and its translations in the same change. Rendering, Markdown and `llms*.txt` routes: `src/lib/timewren-docs/` and `src/app/(timewren)/timewren-site/docs*`. `src/lib/timewren-docs/__tests__/content.test.ts` fails if an environment variable the code reads is missing from `configuration/environment`, or if a docs link points to a page that does not exist.
