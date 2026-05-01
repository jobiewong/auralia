import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import path from 'node:path'

import * as schema from './schema.ts'

type SqliteDatabase = ReturnType<typeof Database>

const repoRoot = new URL('../../../..', import.meta.url).pathname
const configuredDbPath =
  process.env.AURALIA_SQLITE_PATH ?? 'data/db/auralia.sqlite'
const sqlitePath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.join(repoRoot, configuredDbPath)

const sqlite = new Database(sqlitePath)
ensureSynthesisDiagnosticsSchema(sqlite)

export const db = drizzle<typeof schema>(sqlite, {
  schema,
})

function ensureSynthesisDiagnosticsSchema(sqlite: SqliteDatabase) {
  const synthesisJobColumns = tableColumns(sqlite, 'synthesis_jobs')
  if (synthesisJobColumns.size > 0) {
    addColumnIfMissing(
      sqlite,
      synthesisJobColumns,
      'manifest_path',
      'ALTER TABLE synthesis_jobs ADD COLUMN manifest_path TEXT',
    )
    addColumnIfMissing(
      sqlite,
      synthesisJobColumns,
      'stats',
      'ALTER TABLE synthesis_jobs ADD COLUMN stats TEXT',
    )
    addColumnIfMissing(
      sqlite,
      synthesisJobColumns,
      'error_report',
      'ALTER TABLE synthesis_jobs ADD COLUMN error_report TEXT',
    )
  }

  const synthesisSegmentColumns = tableColumns(sqlite, 'synthesis_segments')
  if (synthesisSegmentColumns.size > 0) {
    addColumnIfMissing(
      sqlite,
      synthesisSegmentColumns,
      'cache_key',
      'ALTER TABLE synthesis_segments ADD COLUMN cache_key TEXT',
    )
    addColumnIfMissing(
      sqlite,
      synthesisSegmentColumns,
      'text_hash',
      'ALTER TABLE synthesis_segments ADD COLUMN text_hash TEXT',
    )
    addColumnIfMissing(
      sqlite,
      synthesisSegmentColumns,
      'chunk_count',
      [
        'ALTER TABLE synthesis_segments ADD COLUMN',
        'chunk_count INTEGER NOT NULL DEFAULT 1',
      ].join(' '),
    )
    addColumnIfMissing(
      sqlite,
      synthesisSegmentColumns,
      'duration_ms',
      'ALTER TABLE synthesis_segments ADD COLUMN duration_ms INTEGER',
    )
  }
}

function tableColumns(sqlite: SqliteDatabase, tableName: string) {
  return new Set(
    sqlite
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  )
}

function addColumnIfMissing(
  sqlite: SqliteDatabase,
  columns: Set<string>,
  column: string,
  ddl: string,
) {
  if (!columns.has(column)) {
    sqlite.exec(ddl)
    columns.add(column)
  }
}
