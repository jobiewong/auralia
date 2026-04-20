from __future__ import annotations

import time
from typing import Any

from auralia_api.segmentation.ollama_client import OllamaError, generate_json

from .parser import AttributionParseError, parse_roster_response
from .prompts import ROSTER_SYSTEM_PROMPT, build_roster_user_prompt


def extract_character_roster(
    *,
    document_text: str,
    has_dialogue: bool,
    model: str,
    base_url: str,
    timeout_seconds: float,
    max_retries: int,
) -> tuple[list[dict[str, Any]], dict[str, int | None]]:
    """Run the roster extraction LLM pass with deterministic parsing/validation."""
    if not has_dialogue:
        return [], {"prompt_eval_count": 0, "eval_count": 0, "duration_ms": 0}

    last_error: Exception | None = None
    for attempt in range(max_retries + 1):
        start_ns = time.perf_counter_ns()
        try:
            resp = generate_json(
                base_url=base_url,
                model=model,
                system=ROSTER_SYSTEM_PROMPT,
                prompt=build_roster_user_prompt(document_text),
                timeout_seconds=timeout_seconds,
            )
            roster = parse_roster_response(resp.raw_text, require_non_empty=True)
            duration_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
            return roster, {
                "prompt_eval_count": resp.prompt_eval_count,
                "eval_count": resp.eval_count,
                "duration_ms": duration_ms,
            }
        except (AttributionParseError, OllamaError) as exc:
            last_error = exc
            if attempt >= max_retries:
                break

    assert last_error is not None
    raise last_error
