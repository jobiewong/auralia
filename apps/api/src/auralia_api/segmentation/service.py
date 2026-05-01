from __future__ import annotations

from typing import Any
from uuid import uuid4

from auralia_api.validators.reports import build_validation_report
from auralia_api.validators.spans import run_all_span_validators

from .quote_segmenter import SpanInterval, segment_text_by_quotes
from .storage import (
    AlreadySegmentedError,
    DocumentNotFoundError,
    delete_spans_for_document,
    document_has_spans,
    insert_segmentation_job,
    insert_spans,
    load_document,
    update_segmentation_job,
)

SEGMENTATION_METHOD = "deterministic_quote_v1"


class SegmentationValidationError(RuntimeError):
    """Raised when deterministic spans fail post-segmentation validators."""

    def __init__(self, report: dict[str, Any], job_id: str):
        super().__init__("segmentation output failed validators")
        self.report = report
        self.job_id = job_id


def segment_document(
    *,
    document_id: str,
    sqlite_path: str,
    force: bool = False,
) -> dict[str, Any]:
    """Run deterministic quote-based segmentation for an ingested document.

    On success: persists spans + a completed segmentation_jobs row and returns
    {segmentation_job, spans}. On validator failure (which would indicate a
    bug in the segmenter itself, since the algorithm is deterministic): persists
    a failed segmentation_jobs row with the report and raises
    SegmentationValidationError.

    When ``force`` is True and spans already exist, the prior spans are deleted
    (cascading to any attributions via FK) and the run proceeds.
    """
    document = load_document(sqlite_path=sqlite_path, document_id=document_id)
    force_wipe: dict[str, int] | None = None
    if document_has_spans(sqlite_path=sqlite_path, document_id=document_id):
        if not force:
            raise AlreadySegmentedError(
                f"document already segmented: {document_id}"
            )
        (
            spans_deleted,
            attrs_cascaded,
            downstream_counts,
        ) = delete_spans_for_document(
            sqlite_path=sqlite_path, document_id=document_id
        )
        force_wipe = {
            "spans_deleted": spans_deleted,
            "attributions_cascaded": attrs_cascaded,
            **downstream_counts,
        }

    source_text: str = document["text"]
    intervals = segment_text_by_quotes(source_text)
    spans = _intervals_to_api_spans(
        document_id=document["id"],
        source_text=source_text,
        intervals=intervals,
    )

    job_id = f"seg_{uuid4().hex[:12]}"
    insert_segmentation_job(
        sqlite_path=sqlite_path,
        job_id=job_id,
        document_id=document["id"],
        status="running",
        chunk_count=0,
        model_name=None,
        stats=None,
        error_report=None,
    )
    stats = _build_stats(intervals)

    validation_payload = {
        "source_id": document["source_id"],
        "chapter_id": document["chapter_id"],
        "text": source_text,
        "spans": spans,
    }
    errors = run_all_span_validators(validation_payload)
    if errors:
        report = build_validation_report(
            stage="segmentation.deterministic",
            text_length=len(source_text),
            errors=errors,
        )
        update_segmentation_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            status="failed",
            chunk_count=0,
            model_name=None,
            stats=stats,
            error_report=report,
        )
        raise SegmentationValidationError(report=report, job_id=job_id)

    insert_spans(
        sqlite_path=sqlite_path,
        document_id=document["id"],
        spans=spans,
    )
    update_segmentation_job(
        sqlite_path=sqlite_path,
        job_id=job_id,
        status="completed",
        chunk_count=0,
        model_name=None,
        stats=stats,
        error_report=None,
    )

    return {
        "segmentation_job": {
            "id": job_id,
            "document_id": document["id"],
            "status": "completed",
            "chunk_count": 0,
            "model_name": None,
            "stats": stats,
        },
        "spans": spans,
        "force_wipe": force_wipe,
    }


def _intervals_to_api_spans(
    *,
    document_id: str,
    source_text: str,
    intervals: list[SpanInterval],
) -> list[dict[str, Any]]:
    return [
        {
            "id": f"span_{document_id}_{i:04d}",
            "type": interval.type,
            "text": source_text[interval.start : interval.end],
            "start": interval.start,
            "end": interval.end,
        }
        for i, interval in enumerate(intervals)
    ]


def _build_stats(intervals: list[SpanInterval]) -> dict[str, Any]:
    narration = sum(1 for iv in intervals if iv.type == "narration")
    dialogue = sum(1 for iv in intervals if iv.type == "dialogue")
    return {
        "method": SEGMENTATION_METHOD,
        "span_counts": {
            "total": len(intervals),
            "narration": narration,
            "dialogue": dialogue,
        },
    }


__all__ = [
    "AlreadySegmentedError",
    "DocumentNotFoundError",
    "SEGMENTATION_METHOD",
    "SegmentationValidationError",
    "segment_document",
]
