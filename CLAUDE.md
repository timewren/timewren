# CLAUDE.md

Guidance for Claude Code when working in this repository (TimeWren).

## Project overview

TimeWren is a self-hostable CRM and time tracking system for freelancers. Its core feature is the **klippekort**: a prepaid block of hours that time entries deduct from. It also covers clients, projects, tasks, invoicing and a client portal.

## Commands

```bash
npm run dev              # dev server (Turbopack)
npm run build            # production build
npm run lint             # Biome (check only)
npm test                 # Vitest unit tests (same as test:unit, no database needed)
npm run test:e2e         # Playwright E2E (needs PostgreSQL)
npm run typecheck        # type check (tsc --noEmit)
npm run check            # local CI gates: typecheck, lint, lint:copy, migration journal, i18n:check, tests
npm run i18n:check       # message catalogs (src/i18n/messages)
npm run db:generate      # generate Drizzle migrations after schema changes
npm run db:migrate       # run migrations
npm run docker:up        # start the PostgreSQL container
npm run dev:setup        # docker + migrate + seed + dev server
```

## Architecture

- **Next.js 16** (App Router), **React 19**, **TypeScript 7** strict.
- **tRPC 11** with superjson; routers in `src/lib/trpc/routers/`, registered in `index.ts`. Procedure bases are defined in `src/lib/trpc/trpc.ts`: `publicProcedure`, `protectedProcedure` (reads), `subscribedProcedure` (writes chain on this), `moduleWriteProcedure(key)` / `moduleReadProcedure(key)`, `orgAdminProcedure`, `subscribedOrgAdminProcedure`, `supporterProcedure`, `adminProcedure`.
- **Drizzle ORM** with one schema file: `src/lib/db/schema.ts`. Migrations are in `drizzle/`.
- **Better-Auth** for authentication (`src/lib/auth.ts`, client hooks in `src/lib/auth-client.ts`).
- **Tailwind CSS 4** and **Biome**. Zustand for client state, TanStack Query for server state.
- Cron endpoints live in `src/app/api/cron/`. The browser extension is a separate codebase in `browser-extension/`.

## Conventions

- Biome only; path alias `@/*` maps to `src/*`; 2-space indentation.
- Dashboard pages are client components using tRPC hooks; use `ctx.session.user.id` and `ctx.orgId` in procedures.
- Archive over delete: use `isArchived`, never hard-delete user data.
- Rate hierarchy: project rate, then client rate, then the user's global rate.
- Multi-tenant by `organizationId` (with `userId` as fallback).
- Forms: React Hook Form + Zod. Toasts: Sonner. Icons: Lucide (outline).
- UI text is Danish and lives in the message catalogs in `src/i18n/messages/<language>/`, never hardcoded. New text needs `da` and `en`; run `npm run i18n:check` (see `docs/i18n/README.md`).
- Never run `biome check --write` or `biome format` on whole directories.
- When fixing a bug, write a failing test first, then fix it minimally and run the full suite.

## Environment

Required in `.env.local`: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`. See `.env.example` for optional integrations. Never commit secrets or real customer data.

## Git

- Commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
- Sign off every commit with `git commit -s` (Developer Certificate of Origin, https://developercertificate.org).
- Do not add AI attribution trailers to commits or pull requests.

## Reference docs

`docs/SETUP.MD` (setup), `docs/DESIGN-GUIDE.md` (UI patterns), `docs/FEATURES.md` (features), `docs/architecture/` (architecture notes).
