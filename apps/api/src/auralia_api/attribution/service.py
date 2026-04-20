from __future__ import annotations

import time
from typing import Any
from uuid import uuid4

from auralia_api.segmentation.ollama_client import OllamaError, generate_json
from auralia_api.validators.reports import build_validation_report

from .parser import AttributionParseError, parse_window_attributions
from .pre_pass import resolve_dialogue_spans_deterministically
from .prompts import WINDOW_SYSTEM_PROMPT, build_window_user_prompt
from .roster import extract_character_roster
from .storage import (
    AlreadyAttributedError,
    DocumentNotFoundError,
    document_has_attributions,
    insert_attribution_job,
    insert_attributions,
    load_document_with_spans,
)
from .validators import run_all_attribution_validators
from .windower import build_attribution_windows


class AttributionValidationError(RuntimeError):
    """Raised when attribution output fails deterministic validation."""

    def __init__(self, report: dict[str, Any], job_id: str):
        super().__init__("attribution output failed validation")
        self.report = report
        self.job_id = job_id


def attribute_document(
    *,
    document_id: str,
    sqlite_path: str,
    model_name: str,
    base_url: str,
    timeout_seconds: float,
    confidence_threshold: float,
    max_window_dialogues: int,
    max_window_chars: int,
    max_gap_chars: int,
    max_retries: int,
) -> dict[str, Any]:
    document = load_document_with_spans(
        sqlite_path=sqlite_path, document_id=document_id
    )
    if document_has_attributions(sqlite_path=sqlite_path, document_id=document_id):
        raise AlreadyAttributedError(f"document already attributed: {document_id}")

    spans: list[dict[str, Any]] = document["spans"]
    dialogue_ids = [s["id"] for s in spans if s.get("type") == "dialogue"]
    has_dialogue = bool(dialogue_ids)

    job_id = f"attr_{uuid4().hex[:12]}"
    stage_timings_ms: dict[str, int] = {"roster": 0, "pre_pass": 0, "windowed": 0}

    try:
        roster_start = time.perf_counter_ns()
        roster, roster_usage = extract_character_roster(
            document_text=document["text"],
            has_dialogue=has_dialogue,
            model=model_name,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
        )
        stage_timings_ms["roster"] = int(
            (time.perf_counter_ns() - roster_start) / 1_000_000
        )

        pre_start = time.perf_counter_ns()
        resolved, unresolved = resolve_dialogue_spans_deterministically(
            spans=spans,
            roster=roster,
        )
        stage_timings_ms["pre_pass"] = int(
            (time.perf_counter_ns() - pre_start) / 1_000_000
        )

        window_start = time.perf_counter_ns()
        windows = build_attribution_windows(
            spans=spans,
            resolved=resolved,
            max_gap_chars=max_gap_chars,
            max_window_dialogues=max_window_dialogues,
            max_window_chars=max_window_chars,
            pre_context_chars=200,
            post_context_chars=100,
        )

        llm_rows: dict[str, dict[str, Any]] = {}
        llm_prompt_eval = int(roster_usage.get("prompt_eval_count") or 0)
        llm_eval = int(roster_usage.get("eval_count") or 0)

        for window in windows:
            parsed_rows, usage = _attribute_window_with_retries(
                roster=roster,
                window=window,
                model_name=model_name,
                base_url=base_url,
                timeout_seconds=timeout_seconds,
                max_retries=max_retries,
            )
            llm_prompt_eval += int(usage.get("prompt_eval_count") or 0)
            llm_eval += int(usage.get("eval_count") or 0)
            for row in parsed_rows:
                span_id = row["id"]
                if span_id in resolved:
                    continue
                llm_rows[span_id] = {
                    "speaker": row["speaker"],
                    "speaker_confidence": float(row["speaker_confidence"]),
                    "source": "llm_windowed",
                    "needs_review": (
                        row["speaker"] == "UNKNOWN"
                        or float(row["speaker_confidence"]) < confidence_threshold
                    ),
                }

        stage_timings_ms["windowed"] = int(
            (time.perf_counter_ns() - window_start) / 1_000_000
        )

        merged = _merge_attributions(
            dialogue_ids=dialogue_ids,
            resolved=resolved,
            llm_rows=llm_rows,
            confidence_threshold=confidence_threshold,
        )

        roster_names = {str(row["canonical_name"]) for row in roster}
        errors = run_all_attribution_validators(
            spans=spans,
            attributions=merged,
            roster_names=roster_names,
            threshold=confidence_threshold,
        )
        if errors:
            report = build_validation_report(
                stage="attribution",
                text_length=len(document["text"]),
                errors=errors,
            )
            stats = _build_stats(
                model_name=model_name,
                roster_size=len(roster),
                dialogue_count=len(dialogue_ids),
                deterministic_resolved=len(resolved),
                llm_resolved=len(merged) - len(resolved),
                windows=len(windows),
                prompt_eval_count=llm_prompt_eval,
                eval_count=llm_eval,
                timings_ms=stage_timings_ms,
            )
            insert_attribution_job(
                sqlite_path=sqlite_path,
                job_id=job_id,
                document_id=document["id"],
                status="failed",
                model_name=model_name,
                stats=stats,
                error_report=report,
            )
            raise AttributionValidationError(report=report, job_id=job_id)

        persisted_rows = [
            {
                "id": f"attr_{span['span_id']}",
                "span_id": span["span_id"],
                "speaker": span["speaker"],
                "speaker_confidence": span["speaker_confidence"],
                "needs_review": span["needs_review"],
            }
            for span in merged
        ]
        insert_attributions(sqlite_path=sqlite_path, attributions=persisted_rows)

        stats = _build_stats(
            model_name=model_name,
            roster_size=len(roster),
            dialogue_count=len(dialogue_ids),
            deterministic_resolved=len(resolved),
            llm_resolved=len(merged) - len(resolved),
            windows=len(windows),
            prompt_eval_count=llm_prompt_eval,
            eval_count=llm_eval,
            timings_ms=stage_timings_ms,
        )
        insert_attribution_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            document_id=document["id"],
            status="completed",
            model_name=model_name,
            stats=stats,
            error_report=None,
        )

        return {
            "attribution_job": {
                "id": job_id,
                "document_id": document["id"],
                "status": "completed",
                "model_name": model_name,
                "stats": stats,
            },
            "roster": roster,
            "attributions": merged,
        }
    except (DocumentNotFoundError, AlreadyAttributedError, AttributionValidationError):
        raise
    except OllamaError:
        insert_attribution_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            document_id=document["id"],
            status="failed",
            model_name=model_name,
            stats=None,
            error_report={"message": "ollama unavailable"},
        )
        raise
    except AttributionParseError as exc:
        report = {
            "message": str(exc),
            "type": type(exc).__name__,
        }
        if exc.raw_response is not None:
            report["raw_response_snippet"] = exc.raw_response[:1000]
        insert_attribution_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            document_id=document["id"],
            status="failed",
            model_name=model_name,
            stats=None,
            error_report=report,
        )
        raise AttributionValidationError(report=report, job_id=job_id) from exc
    except Exception as exc:
        report = {"message": str(exc), "type": type(exc).__name__}
        insert_attribution_job(
            sqlite_path=sqlite_path,
            job_id=job_id,
            document_id=document["id"],
            status="failed",
            model_name=model_name,
            stats=None,
            error_report=report,
        )
        raise AttributionValidationError(report=report, job_id=job_id) from exc


def _attribute_window_with_retries(
    *,
    roster: list[dict[str, Any]],
    window: dict[str, Any],
    model_name: str,
    base_url: str,
    timeout_seconds: float,
    max_retries: int,
) -> tuple[list[dict[str, Any]], dict[str, int | None]]:
    dialogue_ids = [b["id"] for b in window["blocks"] if b.get("type") == "dialogue"]
    locked_speakers = {
        b["id"]: b["speaker"]
        for b in window["blocks"]
        if b.get("type") == "dialogue" and b.get("locked")
    }
    roster_names = {str(c["canonical_name"]) for c in roster}
    alias_to_canonical: dict[str, str] = {}
    for character in roster:
        canonical = str(character["canonical_name"])
        for alias in character.get("aliases") or []:
            alias_to_canonical[str(alias)] = canonical

    last_error: AttributionParseError | None = None
    last_raw: str | None = None
    for attempt in range(max_retries + 1):
        retry_feedback: str | None = None
        if last_error is not None:
            snippet = (last_raw or "")[:400]
            retry_feedback = (
                f"Previous attempt failed: {last_error}. "
                f"Previous output (truncated): {snippet}"
            )
        try:
            resp = generate_json(
                base_url=base_url,
                model=model_name,
                system=WINDOW_SYSTEM_PROMPT,
                prompt=build_window_user_prompt(
                    roster=roster,
                    pre_context_text=window.get("pre_context", ""),
                    blocks=window["blocks"],
                    post_context_text=window.get("post_context", ""),
                    retry_feedback=retry_feedback,
                ),
                timeout_seconds=timeout_seconds,
            )
            last_raw = resp.raw_text
            rows = parse_window_attributions(
                resp.raw_text,
                dialogue_ids=dialogue_ids,
                locked_speakers=locked_speakers,
                roster_names=roster_names,
                alias_to_canonical=alias_to_canonical,
            )
            return rows, {
                "prompt_eval_count": resp.prompt_eval_count,
                "eval_count": resp.eval_count,
            }
        except AttributionParseError as exc:
            last_error = exc
            if exc.raw_response is not None:
                last_raw = exc.raw_response
            if attempt >= max_retries:
                break
    assert last_error is not None
    if last_error.raw_response is None and last_raw is not None:
        last_error.raw_response = last_raw
    raise last_error


def _merge_attributions(
    *,
    dialogue_ids: list[str],
    resolved: dict[str, dict[str, Any]],
    llm_rows: dict[str, dict[str, Any]],
    confidence_threshold: float,
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for span_id in dialogue_ids:
        if span_id in resolved:
            merged.append(
                {
                    "span_id": span_id,
                    "speaker": resolved[span_id]["speaker"],
                    "speaker_confidence": 1.0,
                    "needs_review": False,
                    "source": "deterministic_tag",
                }
            )
            continue

        if span_id not in llm_rows:
            merged.append(
                {
                    "span_id": span_id,
                    "speaker": "UNKNOWN",
                    "speaker_confidence": 0.0,
                    "needs_review": True,
                    "source": "llm_windowed",
                }
            )
            continue

        row = llm_rows[span_id]
        conf = float(row["speaker_confidence"])
        speaker = str(row["speaker"])
        merged.append(
            {
                "span_id": span_id,
                "speaker": speaker,
                "speaker_confidence": conf,
                "needs_review": speaker == "UNKNOWN" or conf < confidence_threshold,
                "source": "llm_windowed",
            }
        )
    return merged


def _build_stats(
    *,
    model_name: str,
    roster_size: int,
    dialogue_count: int,
    deterministic_resolved: int,
    llm_resolved: int,
    windows: int,
    prompt_eval_count: int,
    eval_count: int,
    timings_ms: dict[str, int],
) -> dict[str, Any]:
    return {
        "model_name": model_name,
        "roster_size": roster_size,
        "dialogue_count": dialogue_count,
        "deterministic_resolved": deterministic_resolved,
        "llm_resolved": llm_resolved,
        "windows": windows,
        "tokens": {
            "prompt": prompt_eval_count,
            "completion": eval_count,
        },
        "timings_ms": timings_ms,
    }


__all__ = [
    "AlreadyAttributedError",
    "AttributionValidationError",
    "DocumentNotFoundError",
    "attribute_document",
]
