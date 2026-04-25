# Drizzle + SQLite migration workflow

This repo uses Drizzle to own the SQLite schema contracts for Auralia.

## Paths

- Schema source: `packages/db/drizzle/schema.ts`
- Migration output: `packages/db/drizzle/migrations/`
- Local DB: `data/db/auralia.sqlite`

## Generate baseline migration

```bash
cd ~/repos/auralia
npm --workspace @auralia/db run db:generate
```

## Apply migrations

```bash
cd ~/repos/auralia
npm --workspace @auralia/db run db:migrate
```

## Notes

- Commit generated migration SQL files.
- Keep schema and migrations in sync.
- Frontend should not write directly to SQLite; use API endpoints.
- Migration files consumed by Drizzle/`better-sqlite3` must use statement
  breakpoints between SQL statements. Do not leave a generated migration as one
  multi-statement block, or `drizzle-kit migrate` can fail with `RangeError:
  The supplied SQL string contains more than one statement`.
- Pipeline job tables should expose `created_at`, `updated_at`, and
  `completed_at` where practical. The web UI uses `created_at` from active job
  rows for browser-resumable timers, and completed timestamps are used for
  diagnostics/history.
- Force-rerun migrations or schema changes must preserve the downstream reset
  contract documented in `docs/plans/IMPLEMENTATION_PLAN.md`: segmentation
  invalidates cast detection, attribution, and synthesis outputs; cast
  detection invalidates attribution and synthesis outputs while preserving
  manual cast edits/deletions.
