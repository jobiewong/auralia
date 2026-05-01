from __future__ import annotations

import json
import sqlite3
from typing import Any


def reset_after_segmentation_rerun(
    conn: sqlite3.Connection, *, document_id: str
) -> dict[str, int]:
    """Reset derived data that depends on segmentation spans."""
    counts: dict[str, int] = {}
    counts.update(reset_synthesis_for_document(conn, document_id=document_id))
    counts.update(reset_attribution_for_document(conn, document_id=document_id))
    counts.update(
        reset_cast_for_document(
            conn,
            document_id=document_id,
            delete_cast_jobs=True,
        )
    )
    return counts


def reset_after_cast_detection_rerun(
    conn: sqlite3.Connection, *, document_id: str
) -> dict[str, int]:
    """Reset derived data that depends on the cast roster."""
    counts: dict[str, int] = {}
    counts.update(reset_synthesis_for_document(conn, document_id=document_id))
    counts.update(reset_attribution_for_document(conn, document_id=document_id))
    counts.update(
        reset_cast_for_document(
            conn,
            document_id=document_id,
            delete_cast_jobs=False,
        )
    )
    return counts


def reset_attribution_for_document(
    conn: sqlite3.Connection, *, document_id: str
) -> dict[str, int]:
    counts: dict[str, int] = {}
    if _table_exists(conn, "attributions") and _table_exists(conn, "spans"):
        cur = conn.execute(
            """
            DELETE FROM attributions
            WHERE span_id IN (SELECT id FROM spans WHERE document_id = ?)
            """,
            (document_id,),
        )
        counts["attributions_deleted"] = cur.rowcount

    if _table_exists(conn, "attribution_jobs"):
        cur = conn.execute(
            "DELETE FROM attribution_jobs WHERE document_id = ?",
            (document_id,),
        )
        counts["attribution_jobs_deleted"] = cur.rowcount

    return counts


def reset_synthesis_for_document(
    conn: sqlite3.Connection, *, document_id: str
) -> dict[str, int]:
    counts: dict[str, int] = {}
    synthesis_job_ids: list[str] = []
    if _table_exists(conn, "synthesis_jobs"):
        synthesis_job_ids = [
            str(row["id"])
            for row in conn.execute(
                "SELECT id FROM synthesis_jobs WHERE document_id = ?",
                (document_id,),
            )
        ]

    if _table_exists(conn, "synthesis_segments"):
        deleted_segments = 0
        for job_id in synthesis_job_ids:
            cur = conn.execute(
                "DELETE FROM synthesis_segments WHERE job_id = ?",
                (job_id,),
            )
            deleted_segments += cur.rowcount
        if _table_exists(conn, "spans"):
            cur = conn.execute(
                """
                DELETE FROM synthesis_segments
                WHERE span_id IN (SELECT id FROM spans WHERE document_id = ?)
                """,
                (document_id,),
            )
            deleted_segments += cur.rowcount
        counts["synthesis_segments_deleted"] = deleted_segments

    if _table_exists(conn, "synthesis_jobs"):
        cur = conn.execute(
            "DELETE FROM synthesis_jobs WHERE document_id = ?",
            (document_id,),
        )
        counts["synthesis_jobs_deleted"] = cur.rowcount

    return counts


def reset_cast_for_document(
    conn: sqlite3.Connection, *, document_id: str, delete_cast_jobs: bool
) -> dict[str, int]:
    counts: dict[str, int] = {}
    if _table_exists(conn, "cast_member_evidence"):
        cur = conn.execute(
            "DELETE FROM cast_member_evidence WHERE document_id = ?",
            (document_id,),
        )
        counts["cast_evidence_deleted"] = cur.rowcount

    if _table_exists(conn, "document_cast_members"):
        cur = conn.execute(
            """
            DELETE FROM document_cast_members
            WHERE document_id = ?
              AND manually_edited = 0
              AND manually_deleted = 0
            """,
            (document_id,),
        )
        counts["generated_cast_deleted"] = cur.rowcount
        _sync_document_roster(conn, document_id=document_id)

    if delete_cast_jobs and _table_exists(conn, "cast_detection_jobs"):
        cur = conn.execute(
            "DELETE FROM cast_detection_jobs WHERE document_id = ?",
            (document_id,),
        )
        counts["cast_detection_jobs_deleted"] = cur.rowcount

    return counts


def _sync_document_roster(conn: sqlite3.Connection, *, document_id: str) -> None:
    if not _table_exists(conn, "documents") or not _table_exists(
        conn, "document_cast_members"
    ):
        return
    if not _column_exists(conn, "documents", "roster"):
        return
    cast = [
        _cast_row_to_dict(row)
        for row in conn.execute(
            """
            SELECT canonical_name, aliases, descriptor
            FROM document_cast_members
            WHERE document_id = ? AND manually_deleted = 0
            ORDER BY canonical_name
            """,
            (document_id,),
        )
    ]
    conn.execute(
        "UPDATE documents SET roster = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (_serialize_roster(cast), document_id),
    )


def _cast_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "canonical_name": row["canonical_name"],
        "aliases": _parse_aliases(row["aliases"]),
        "descriptor": row["descriptor"] or "",
    }


def _serialize_roster(cast: list[dict[str, Any]]) -> str:
    return json.dumps(
        {
            "characters": [
                {
                    "canonical_name": row["canonical_name"],
                    "aliases": row["aliases"],
                    "descriptor": row.get("descriptor", ""),
                }
                for row in cast
            ]
        }
    )


def _parse_aliases(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        value = parsed
    if not isinstance(value, list):
        return []
    return [str(alias) for alias in value if isinstance(alias, str)]


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _column_exists(
    conn: sqlite3.Connection, table_name: str, column_name: str
) -> bool:
    return any(
        row["name"] == column_name
        for row in conn.execute(f"PRAGMA table_info({table_name});")
    )
