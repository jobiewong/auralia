from __future__ import annotations

import time
from typing import Any
from uuid import uuid4

from auralia_api.attribution.parser import AttributionParseError
from auralia_api.segmentation.ollama_client import OllamaError, generate_json

from .harvester import (
    CastCandidateEvidence,
    build_deterministic_cast,
    harvest_explicit_speaker_candidates,
    summarize_candidates,
)
from .parser import parse_cast_response
from .prompts import (
    CAST_CANONICALIZATION_SYSTEM_PROMPT,
    build_cast_canonicalization_prompt,
)
from .storage import (
    AlreadyCastDetectedError,
    DocumentNotFoundError,
    delete_generated_cast_for_document,
    document_has_active_cast,
    insert_cast_detection_job,
    load_document_with_spans,
    update_cast_detection_job,
    upsert_cast_members_with_evidence,
)


class CastDetectionError(RuntimeError):
    def __init__(self, report: dict[str, Any], job_id: str):
        super().__init__("cast detection failed")
        self.report = report
        self.job_id = job_id


def detect_cast(
    *,
    document_id: str,
    sqlite_path: str,
    model_name: str,
    base_url: str,
    timeout_seconds: float,
    max_retries: int,
    force: bool = False,
    use_llm: bool = False,
) -> dict[str, Any]:
    document = load_document_with_spans(
        sqlite_path=sqlite_path, document_id=document_id
    )
    force_wipe: dict[str, int] | None = None
    has_active_cast = document_has_active_cast(
        sqlite_path=sqlite_path, document_id=document_id
    )
    if has_active_cast and not force:
        raise AlreadyCastDetectedError(f"document already has cast: {document_id}")
    if force:
        force_wipe = delete_generated_cast_for_document(
            sqlite_path=sqlite_path, document_id=document_id
        )

    job_id = f"cast_{uuid4().hex[:12]}"
    insert_cast_detection_job(
        sqlite_path=sqlite_path,
        job_id=job_id,
        document_id=document_id,
        status="running",
        model_name=model_name if use_llm else None,
        stats=None,
        error_report=None,
    )

    timings_ms = {"harvest": 0, "canonicalization": 0, "persist": 0}
    try:
        harvest_start = time.perf_counter_ns()
        harvested = harvest_explicit_speaker_candidates(document["spans"])
        deterministic_cast = build_deterministic_cast(harvested)
        timings_ms["harvest"] = int(
            (time.perf_counter_ns() - harvest_start) / 1_000_000
        )

        canonical_start = time.perf_counter_ns()
        usage: dict[str, int | None] = {"prompt_eval_count": 0, "eval_count": 0}
        cast = deterministic_cast
        if use_llm and deterministic_cast:
            cast, usage = _canonicalize_with_llm(
                deterministic_cast=deterministic_cast,
                harvested=harvested,
                model_name=model_name,
                base_url=base_url,
                timeout_seconds=timeout_seconds,
                max_retries=max_retries,
            )
        timings_ms["canonicalization"] = int(
            (time.perf_counter_ns() - canonical_start) / 1_000_000
        )

        evidence_rows = _evidence_rows_for_cast(cast=cast, harvested=harvested)
        persist_start = time.perf_counter_ns()
        persisted_cast, persisted_evidence = upsert_cast_members_with_evidence(
            sqlite_path=sqlite_path,
            document_id=document_id,
            cast=cast,
            evidence=evidence_rows,
        )
        timings_ms["persist"] = int(
            (time.perf_counter_ns() - persist_start) / 1_000_000
        )

        stats = _build_stats(
            model_name=model_name if use_llm else None,
            use_llm=use_llm,
            explicit_evidence_count=len(harvested),
            deterministic_candidates=len(deterministic_cast),
            cast_count=len(persisted_cast),
            needs_review_count=sum(1 for row in persisted_cast if row["needs_review"]),
            prompt_eval_count=int(usage.get("prompt_eval_count") or 0),
            eval_count=int(usage.get("eval_count") or 0),
            timings_ms=timings_ms,
        )
        update_cast_detection_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            status="completed",
            stats=stats,
            error_report=None,
        )

        return {
            "cast_detection_job": {
                "id": job_id,
                "document_id": document_id,
                "status": "completed",
                "model_name": model_name if use_llm else None,
                "stats": stats,
            },
            "cast": persisted_cast,
            "evidence": persisted_evidence,
            "force_wipe": force_wipe,
        }
    except (DocumentNotFoundError, AlreadyCastDetectedError):
        raise
    except OllamaError:
        update_cast_detection_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            status="failed",
            stats=None,
            error_report={"message": "ollama unavailable"},
        )
        raise
    except Exception as exc:
        report = {"message": str(exc), "type": type(exc).__name__}
        update_cast_detection_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            status="failed",
            stats=None,
            error_report=report,
        )
        raise CastDetectionError(report=report, job_id=job_id) from exc


def _canonicalize_with_llm(
    *,
    deterministic_cast: list[dict[str, Any]],
    harvested: list[CastCandidateEvidence],
    model_name: str,
    base_url: str,
    timeout_seconds: float,
    max_retries: int,
) -> tuple[list[dict[str, Any]], dict[str, int | None]]:
    surface_candidates = summarize_candidates(harvested)
    evidence_snippets = list(dict.fromkeys(row.evidence_text for row in harvested))
    last_error: AttributionParseError | None = None
    last_raw: str | None = None

    for attempt in range(max_retries + 1):
        retry_feedback = None
        if last_error is not None:
            retry_feedback = (
                f"Previous attempt failed: {last_error}. "
                f"Previous output (truncated): {(last_raw or '')[:400]}"
            )
        try:
            resp = generate_json(
                base_url=base_url,
                model=model_name,
                system=CAST_CANONICALIZATION_SYSTEM_PROMPT,
                prompt=build_cast_canonicalization_prompt(
                    surface_candidates=surface_candidates,
                    evidence_snippets=evidence_snippets,
                    retry_feedback=retry_feedback,
                ),
                timeout_seconds=timeout_seconds,
            )
            last_raw = resp.raw_text
            parsed = parse_cast_response(resp.raw_text)
            return _merge_deterministic_evidence(deterministic_cast, parsed), {
                "prompt_eval_count": resp.prompt_eval_count,
                "eval_count": resp.eval_count,
            }
        except AttributionParseError as exc:
            last_error = exc
            if exc.raw_response is not None:
                last_raw = exc.raw_response
            if attempt >= max_retries:
                break

    if last_error is not None:
        raise last_error
    return deterministic_cast, {"prompt_eval_count": 0, "eval_count": 0}


def _merge_deterministic_evidence(
    deterministic_cast: list[dict[str, Any]], llm_cast: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not llm_cast:
        return deterministic_cast
    surfaces = {
        alias.lower(): row
        for row in deterministic_cast
        for alias in [row["canonical_name"], *row.get("aliases", [])]
    }
    merged: list[dict[str, Any]] = []
    consumed: set[str] = set()
    for row in llm_cast:
        aliases = list(dict.fromkeys([row["canonical_name"], *row.get("aliases", [])]))
        evidence_ids: set[str] = set()
        for alias in aliases:
            existing = surfaces.get(alias.lower())
            if existing is None:
                continue
            consumed.add(str(existing["canonical_name"]).lower())
            evidence_ids.update(existing.get("evidence_span_ids", []))
        merged.append(
            {
                **row,
                "aliases": aliases,
                "evidence_span_ids": sorted(evidence_ids),
            }
        )
    for row in deterministic_cast:
        if str(row["canonical_name"]).lower() not in consumed:
            merged.append(row)
    return sorted(merged, key=lambda item: str(item["canonical_name"]).lower())


def _evidence_rows_for_cast(
    *, cast: list[dict[str, Any]], harvested: list[CastCandidateEvidence]
) -> list[dict[str, Any]]:
    alias_to_canonical: dict[str, str] = {}
    for row in cast:
        canonical = str(row["canonical_name"])
        alias_to_canonical[canonical.lower()] = canonical
        for alias in row.get("aliases", []):
            alias_to_canonical[str(alias).lower()] = canonical

    rows: list[dict[str, Any]] = []
    for item in harvested:
        canonical = alias_to_canonical.get(item.surface.lower(), item.surface)
        rows.append(
            {
                "canonical_name": canonical,
                "span_id": item.span_id,
                "related_dialogue_span_id": item.related_dialogue_span_id,
                "evidence_type": item.evidence_type,
                "surface_text": item.surface_text,
                "evidence_text": item.evidence_text,
                "confidence": item.confidence,
            }
        )
    return rows


def _build_stats(
    *,
    model_name: str | None,
    use_llm: bool,
    explicit_evidence_count: int,
    deterministic_candidates: int,
    cast_count: int,
    needs_review_count: int,
    prompt_eval_count: int,
    eval_count: int,
    timings_ms: dict[str, int],
) -> dict[str, Any]:
    return {
        "model_name": model_name,
        "use_llm": use_llm,
        "explicit_evidence_count": explicit_evidence_count,
        "deterministic_candidates": deterministic_candidates,
        "cast_count": cast_count,
        "needs_review_count": needs_review_count,
        "tokens": {"prompt": prompt_eval_count, "completion": eval_count},
        "timings_ms": timings_ms,
    }


__all__ = [
    "AlreadyCastDetectedError",
    "CastDetectionError",
    "DocumentNotFoundError",
    "detect_cast",
]
