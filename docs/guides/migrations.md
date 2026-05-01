# Database migrations

Auralia uses Drizzle ORM to own the SQLite schema. Migrations are generated from `packages/db/drizzle/schema.ts` and applied to the local database.

## Paths

- Schema source: `packages/db/drizzle/schema.ts`
- Migration files: `packages/db/drizzle/migrations/`
- Local database: `data/db/auralia.sqlite`

## Commands

Generate a new migration after changing the schema:

```bash
npm --workspace @auralia/db run db:generate
```

Apply all pending migrations:

```bash
npm --workspace @auralia/db run db:migrate
```

Run from the repository root.

## Rules

- **Commit migration SQL files.** They are the canonical schema history and must be committed alongside any schema change.
- **Keep schema and migrations in sync.** Never edit `schema.ts` without generating a migration.
- **Use statement breakpoints.** Migration files consumed by Drizzle/`better-sqlite3` must use `---> statement-breakpoint` between SQL statements. A migration file that is one multi-statement block will fail with `RangeError: The supplied SQL string contains more than one statement`.
- **Frontend does not write directly to SQLite.** All writes go through FastAPI endpoints.

## Job table conventions

Pipeline job tables expose `created_at`, `updated_at`, and `completed_at` where practical:
- The web UI uses `created_at` from active job rows to calculate browser-resumable elapsed timers.
- `completed_at` is used for diagnostics and history.

## Downstream reset contract

Force-rerun migrations or schema changes must preserve the cascade invalidation contract:

- Re-running **Segmentation** resets all downstream derived outputs: generated cast, cast evidence, attribution rows/jobs, synthesis rows/jobs, and cast detection jobs. Manual cast edits/deletions (rows with `manually_edited` or `manually_deleted` set) are preserved.
- Re-running **Cast Detection** resets generated cast/evidence and downstream attribution/synthesis rows/jobs. Manual cast edits/deletions are preserved.
- Re-running **Attribution** deletes existing attribution rows before re-attributing. Synthesis is reset on attribution rerun when synthesis has run.

This contract must be maintained in any migration that changes cascade behavior on these tables.
