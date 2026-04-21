import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const dbPackageDir = path.resolve(packageDir, '..')
const repoRoot = path.resolve(dbPackageDir, '../..')
const configuredDbPath =
  process.env.AURALIA_SQLITE_PATH ??
  process.env.DATABASE_URL ??
  'data/db/auralia.sqlite'
const dbPath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.join(repoRoot, configuredDbPath)
const migrationsDir = path.join(dbPackageDir, 'drizzle/migrations')
const journalPath = path.join(migrationsDir, 'meta/_journal.json')

if (!fs.existsSync(dbPath)) {
  process.exit(0)
}

const db = new Database(dbPath)

try {
  baselineExistingBootstrap(db)
} finally {
  db.close()
}

function baselineExistingBootstrap(db) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  )

  if (!tables.has('documents')) {
    return
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `)

  const lastMigration = db
    .prepare(
      'SELECT id, hash, created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
    )
    .get()

  if (lastMigration) {
    return
  }

  completePreWorksSchema(db)

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  const completedTags = new Set([
    '0000_m1_baseline',
    '0001_m2_documents_source_metadata',
    '0002_m2_ingestion_jobs',
    '0003_m3_segmentation_jobs',
    '0004_m4_attribution_jobs',
    '0005_m4_documents_roster',
  ])
  const insertMigration = db.prepare(
    'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
  )

  const tx = db.transaction(() => {
    for (const entry of journal.entries) {
      if (!completedTags.has(entry.tag)) {
        continue
      }
      const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`)
      const query = fs.readFileSync(sqlPath, 'utf8')
      const hash = crypto.createHash('sha256').update(query).digest('hex')
      insertMigration.run(hash, entry.when)
    }
  })
  tx()

  console.log(
    '[auralia-db] Baseline recorded existing SQLite schema through 0005; '
      + 'Drizzle will apply newer migrations.',
  )
}

function completePreWorksSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS spans (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CHECK (type IN ('narration', 'dialogue'))
    );

    CREATE TABLE IF NOT EXISTS attributions (
      id TEXT PRIMARY KEY NOT NULL,
      span_id TEXT NOT NULL,
      speaker TEXT NOT NULL,
      speaker_confidence REAL NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS voices (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      control_text TEXT,
      reference_audio_path TEXT,
      prompt_audio_path TEXT,
      prompt_text TEXT,
      cfg_value REAL NOT NULL DEFAULT 2.0,
      inference_timesteps INTEGER NOT NULL DEFAULT 10,
      is_canonical INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (mode IN ('designed', 'clone', 'hifi_clone'))
    );

    CREATE TABLE IF NOT EXISTS voice_mappings (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      speaker TEXT NOT NULL,
      voice_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (voice_id) REFERENCES voices(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS synthesis_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      output_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CHECK (status IN ('pending', 'running', 'failed', 'completed'))
    );

    CREATE TABLE IF NOT EXISTS synthesis_segments (
      id TEXT PRIMARY KEY NOT NULL,
      job_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      voice_id TEXT NOT NULL,
      audio_path TEXT NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES synthesis_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE RESTRICT,
      FOREIGN KEY (voice_id) REFERENCES voices(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS ingestion_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      status TEXT NOT NULL,
      document_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS segmentation_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      chunk_count INTEGER NOT NULL DEFAULT 0,
      model_name TEXT,
      stats TEXT,
      error_report TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CHECK (status IN ('pending', 'running', 'failed', 'completed'))
    );

    CREATE TABLE IF NOT EXISTS attribution_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      model_name TEXT,
      stats TEXT,
      error_report TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      CHECK (status IN ('pending', 'running', 'failed', 'completed'))
    );

    CREATE INDEX IF NOT EXISTS idx_spans_document_offsets
      ON spans (document_id, start, end);
    CREATE INDEX IF NOT EXISTS idx_attributions_span_id
      ON attributions (span_id);
    CREATE INDEX IF NOT EXISTS idx_voice_mappings_document_speaker
      ON voice_mappings (document_id, speaker);
    CREATE INDEX IF NOT EXISTS idx_synthesis_jobs_document_status
      ON synthesis_jobs (document_id, status);
    CREATE INDEX IF NOT EXISTS idx_synthesis_segments_job_start
      ON synthesis_segments (job_id, start);
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_document_id
      ON ingestion_jobs (document_id);
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status
      ON ingestion_jobs (status);
    CREATE INDEX IF NOT EXISTS idx_segmentation_jobs_document_status
      ON segmentation_jobs (document_id, status);
    CREATE INDEX IF NOT EXISTS idx_attribution_jobs_document_status
      ON attribution_jobs (document_id, status);
  `)

  const documentCols = new Set(
    db.prepare('PRAGMA table_info(documents)').all().map((row) => row.name),
  )
  if (!documentCols.has('source_metadata')) {
    db.exec('ALTER TABLE documents ADD COLUMN source_metadata TEXT;')
  }
  if (!documentCols.has('roster')) {
    db.exec('ALTER TABLE documents ADD COLUMN roster TEXT;')
  }
}
