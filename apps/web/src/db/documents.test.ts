import Database from 'better-sqlite3'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { updateSpanTextQuery } from './documents'

let sqlite: Database.Database

beforeAll(() => {
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), 'auralia-web-')), 'test.sqlite')
  process.env.AURALIA_SQLITE_PATH = dbPath
  sqlite = new Database(dbPath)
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(`
    CREATE TABLE works (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      authors TEXT,
      source_metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE documents (
      id TEXT PRIMARY KEY NOT NULL,
      work_id TEXT REFERENCES works(id) ON DELETE SET NULL,
      source_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      title TEXT,
      text TEXT NOT NULL,
      text_length INTEGER NOT NULL,
      normalization TEXT NOT NULL,
      source_metadata TEXT,
      roster TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE spans (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE attributions (
      id TEXT PRIMARY KEY NOT NULL,
      span_id TEXT NOT NULL REFERENCES spans(id) ON DELETE CASCADE,
      speaker TEXT NOT NULL,
      speaker_confidence REAL NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE voices (
      id TEXT PRIMARY KEY NOT NULL,
      display_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE voice_mappings (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      speaker TEXT NOT NULL,
      voice_id TEXT NOT NULL REFERENCES voices(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE synthesis_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      output_path TEXT,
      manifest_path TEXT,
      stats TEXT,
      error_report TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE synthesis_segments (
      id TEXT PRIMARY KEY NOT NULL,
      job_id TEXT NOT NULL REFERENCES synthesis_jobs(id) ON DELETE CASCADE,
      span_id TEXT NOT NULL REFERENCES spans(id) ON DELETE RESTRICT,
      voice_id TEXT NOT NULL REFERENCES voices(id) ON DELETE RESTRICT,
      audio_path TEXT NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      cache_key TEXT,
      text_hash TEXT,
      chunk_count INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
})

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM synthesis_segments;
    DELETE FROM synthesis_jobs;
    DELETE FROM voice_mappings;
    DELETE FROM voices;
    DELETE FROM attributions;
    DELETE FROM spans;
    DELETE FROM documents;
    DELETE FROM works;
  `)
  seedDocument()
})

describe('updateSpanTextQuery', () => {
  it('updates span text exactly and leaves source offsets unchanged', async () => {
    const result = await updateSpanTextQuery({
      spanId: 'span-1',
      text: '  "Hello there."  ',
    })

    const span = getRow<{
      text: string
      start: number
      end: number
      updated_at: string
    }>('SELECT text, start, end, updated_at FROM spans WHERE id = ?', 'span-1')

    expect(result).toMatchObject({
      spanId: 'span-1',
      text: '  "Hello there."  ',
      start: 4,
      end: 12,
    })
    expect(span).toMatchObject({
      text: '  "Hello there."  ',
      start: 4,
      end: 12,
    })
    expect(span.updated_at).not.toBe('2000-01-01T00:00:00.000Z')
  })

  it('touches document and work timestamps', async () => {
    await updateSpanTextQuery({ spanId: 'span-1', text: '"Hello."' })

    const document = getRow<{ updated_at: string }>(
      'SELECT updated_at FROM documents WHERE id = ?',
      'doc-1',
    )
    const work = getRow<{ updated_at: string }>(
      'SELECT updated_at FROM works WHERE id = ?',
      'work-1',
    )

    expect(document.updated_at).not.toBe('2000-01-01T00:00:00.000Z')
    expect(work.updated_at).not.toBe('2000-01-01T00:00:00.000Z')
  })

  it('invalidates existing synthesis rows but preserves attribution and voice mapping rows', async () => {
    await updateSpanTextQuery({ spanId: 'span-1', text: '"Hello."' })

    expect(countRows('synthesis_segments')).toBe(0)
    expect(countRows('synthesis_jobs')).toBe(0)
    expect(countRows('attributions')).toBe(1)
    expect(countRows('voice_mappings')).toBe(1)
  })

  it('rejects blank span text', async () => {
    await expect(
      updateSpanTextQuery({ spanId: 'span-1', text: '   ' }),
    ).rejects.toThrow('Span text cannot be blank')

    const span = getRow<{ text: string }>(
      'SELECT text FROM spans WHERE id = ?',
      'span-1',
    )
    expect(span.text).toBe('"Hello"')
  })

  it('rejects edits while the latest synthesis job is running', async () => {
    sqlite
      .prepare('UPDATE synthesis_jobs SET status = ?, updated_at = ? WHERE id = ?')
      .run('running', '2020-01-01T00:00:00.000Z', 'synth-1')

    await expect(
      updateSpanTextQuery({ spanId: 'span-1', text: '"Hello."' }),
    ).rejects.toThrow('Cannot edit span text while synthesis is running')

    const span = getRow<{ text: string }>(
      'SELECT text FROM spans WHERE id = ?',
      'span-1',
    )
    expect(span.text).toBe('"Hello"')
    expect(countRows('synthesis_jobs')).toBe(1)
    expect(countRows('synthesis_segments')).toBe(1)
  })
})

function seedDocument() {
  const old = '2000-01-01T00:00:00.000Z'
  sqlite
    .prepare(
      `
        INSERT INTO works (
          id, slug, title, source_type, source_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run('work-1', 'book', 'Book', 'ao3', 'source-1', old, old)
  sqlite
    .prepare(
      `
        INSERT INTO documents (
          id, work_id, source_id, chapter_id, title, text, text_length,
          normalization, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      'doc-1',
      'work-1',
      'source-1',
      '1',
      'Chapter',
      'She "Hello" said.',
      17,
      '{}',
      old,
      old,
    )
  sqlite
    .prepare(
      `
        INSERT INTO spans (
          id, document_id, type, text, start, end, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run('span-1', 'doc-1', 'dialogue', '"Hello"', 4, 12, old, old)
  sqlite
    .prepare(
      `
        INSERT INTO attributions (
          id, span_id, speaker, speaker_confidence, needs_review, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run('attr-1', 'span-1', 'Alice', 0.8, 1, old, old)
  sqlite
    .prepare(
      `
        INSERT INTO voices (
          id, display_name, mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run('voice-1', 'Voice', 'designed', old, old)
  sqlite
    .prepare(
      `
        INSERT INTO voice_mappings (
          id, document_id, speaker, voice_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .run('mapping-1', 'doc-1', 'Alice', 'voice-1', old, old)
  sqlite
    .prepare(
      `
        INSERT INTO synthesis_jobs (
          id, document_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
    )
    .run('synth-1', 'doc-1', 'completed', old, old)
  sqlite
    .prepare(
      `
        INSERT INTO synthesis_segments (
          id, job_id, span_id, voice_id, audio_path, start, end, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run('segment-1', 'synth-1', 'span-1', 'voice-1', '/tmp/span.wav', 4, 12, old, old)
}

function countRows(tableName: string) {
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get() as { count: number }
  return row.count
}

function getRow<T>(sql: string, ...values: unknown[]) {
  const row = sqlite.prepare(sql).get(...values) as T | undefined
  if (!row) {
    throw new Error(`Expected row for query: ${sql}`)
  }
  return row
}
