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
