from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

MIGRATION_SQL = """
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
  preview_audio_path TEXT,
  preview_sentence TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (mode IN ('designed', 'clone', 'hifi_clone'))
);
CREATE INDEX IF NOT EXISTS idx_voices_display_name ON voices (display_name);
CREATE INDEX IF NOT EXISTS idx_voices_mode ON voices (mode);

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_mappings_document_speaker_unique
  ON voice_mappings (document_id, speaker);
CREATE INDEX IF NOT EXISTS idx_voice_mappings_voice_id
  ON voice_mappings (voice_id);
"""


class VoiceNotFoundError(LookupError):
    pass


class VoiceDeleteBlockedError(RuntimeError):
    pass


def connect(sqlite_path: str) -> sqlite3.Connection:
    db_path = Path(sqlite_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(MIGRATION_SQL)
    _add_columns_if_missing(conn)
    return conn


def _add_columns_if_missing(conn: sqlite3.Connection) -> None:
    existing = {row[1] for row in conn.execute("PRAGMA table_info(voices)").fetchall()}
    if "preview_audio_path" not in existing:
        conn.execute("ALTER TABLE voices ADD COLUMN preview_audio_path TEXT")
    if "preview_sentence" not in existing:
        conn.execute("ALTER TABLE voices ADD COLUMN preview_sentence TEXT")


def insert_voice(*, sqlite_path: str, voice: dict[str, Any]) -> dict[str, Any]:
    with connect(sqlite_path) as conn:
        conn.execute(
            """
            INSERT INTO voices (
              id, display_name, mode, control_text, reference_audio_path,
              prompt_audio_path, prompt_text, cfg_value, inference_timesteps,
              is_canonical, preview_audio_path, preview_sentence,
              created_at, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            """,
            (
                voice["id"],
                voice["display_name"],
                voice["mode"],
                voice.get("control_text"),
                voice.get("reference_audio_path"),
                voice.get("prompt_audio_path"),
                voice.get("prompt_text"),
                voice["cfg_value"],
                voice["inference_timesteps"],
                1 if voice.get("is_canonical", True) else 0,
                voice.get("preview_audio_path"),
                voice.get("preview_sentence"),
            ),
        )
        return get_voice(conn=conn, voice_id=voice["id"])


def list_voices(*, sqlite_path: str) -> list[dict[str, Any]]:
    with connect(sqlite_path) as conn:
        rows = conn.execute(
            "SELECT * FROM voices ORDER BY display_name COLLATE NOCASE, created_at"
        ).fetchall()
        return [_row_to_voice(row) for row in rows]


def get_voice_by_id(*, sqlite_path: str, voice_id: str) -> dict[str, Any]:
    with connect(sqlite_path) as conn:
        return get_voice(conn=conn, voice_id=voice_id)


def get_voice(*, conn: sqlite3.Connection, voice_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM voices WHERE id = ?", (voice_id,)).fetchone()
    if row is None:
        raise VoiceNotFoundError(f"voice not found: {voice_id}")
    return _row_to_voice(row)


def update_voice(
    *, sqlite_path: str, voice_id: str, fields: dict[str, Any]
) -> dict[str, Any]:
    if not fields:
        return get_voice_by_id(sqlite_path=sqlite_path, voice_id=voice_id)
    allowed = {
        "display_name",
        "mode",
        "control_text",
        "reference_audio_path",
        "prompt_audio_path",
        "prompt_text",
        "cfg_value",
        "inference_timesteps",
        "is_canonical",
        "preview_audio_path",
        "preview_sentence",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    assignments = ", ".join(f"{key} = ?" for key in updates)
    values = [
        1 if key == "is_canonical" and value else 0 if key == "is_canonical" else value
        for key, value in updates.items()
    ]
    with connect(sqlite_path) as conn:
        get_voice(conn=conn, voice_id=voice_id)
        conn.execute(
            (
                f"UPDATE voices SET {assignments},"
                " updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            ),
            (*values, voice_id),
        )
        return get_voice(conn=conn, voice_id=voice_id)


def delete_voice(*, sqlite_path: str, voice_id: str, force: bool) -> dict[str, Any]:
    with connect(sqlite_path) as conn:
        get_voice(conn=conn, voice_id=voice_id)
        mapping_count = conn.execute(
            "SELECT COUNT(*) AS count FROM voice_mappings WHERE voice_id = ?",
            (voice_id,),
        ).fetchone()["count"]
        if mapping_count and not force:
            raise VoiceDeleteBlockedError(
                f"voice has {mapping_count} document mapping(s)"
            )
        if force:
            conn.execute("DELETE FROM voice_mappings WHERE voice_id = ?", (voice_id,))
        conn.execute("DELETE FROM voices WHERE id = ?", (voice_id,))
        return {"deleted": 1, "removed_mappings": int(mapping_count) if force else 0}


def _row_to_voice(row: sqlite3.Row) -> dict[str, Any]:
    data = dict(row)
    data["is_canonical"] = bool(data["is_canonical"])
    return data
