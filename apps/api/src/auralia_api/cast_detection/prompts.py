from __future__ import annotations

import json
from typing import Any

CAST_CANONICALIZATION_SYSTEM_PROMPT = """
You normalize a cast roster from explicit dialogue-tag evidence.

Rules:
1. Use only supplied surface_candidates and evidence_snippets.
2. Merge aliases only when the evidence strongly implies the same character.
3. Prefer separate cast entries with needs_review=true over risky merges.
4. Do not invent characters.
5. Return JSON only with this shape:
   {"characters": [{"canonical_name": str, "aliases": [str],
                    "descriptor": str, "confidence": number,
                    "needs_review": bool}]}
"""


def build_cast_canonicalization_prompt(
    *,
    surface_candidates: list[dict[str, Any]],
    evidence_snippets: list[str],
    retry_feedback: str | None = None,
) -> str:
    payload = {
        "surface_candidates": surface_candidates,
        "evidence_snippets": evidence_snippets[:80],
    }
    lines = ["CAST_EVIDENCE:", json.dumps(payload, ensure_ascii=False)]
    if retry_feedback:
        lines.extend(["", f"RETRY_NOTE: {retry_feedback}"])
    lines.append("")
    lines.append("Return JSON only.")
    return "\n".join(lines)
