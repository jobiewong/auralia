from __future__ import annotations

import json
from typing import Any

ROSTER_SYSTEM_PROMPT = """You extract a canonical character roster from chapter prose.

Rules:
1. Return JSON only with this shape:
   {"characters": [{"canonical_name": str, "aliases": [str], "descriptor": str}]}
2. canonical_name should be the shortest unambiguous name used in the text.
3. aliases include full names, surnames, honorifics, and nicknames from the text.
4. Do not include pronouns as aliases.
5. Include minor speaking characters when present.
"""

WINDOW_SYSTEM_PROMPT = """You assign speakers to dialogue spans.

Rules:
1. Pick speaker from ROSTER canonical_name values only;
   if uncertain, use "UNKNOWN".
2. speaker_confidence must be in [0,1].
3. Entries marked locked=true must keep their provided speaker unchanged.
4. Rapid exchanges may follow strict alternation when evidence supports it.
5. Output JSON only with this shape:
   {
     "attributions": [
       {"id": string, "speaker": string, "speaker_confidence": number,
        "reasoning_brief": string}
     ]
   }
"""

def build_roster_user_prompt(
    document_text: str,
    *,
    retry_feedback: str | None = None,
) -> str:
    if retry_feedback:
        return (
            f"DOCUMENT_TEXT:\n{document_text}\n\n"
            f"RETRY_NOTE: {retry_feedback}\n\n"
            "Return JSON only with the exact shape "
            '{"characters": [{"canonical_name": str, "aliases": [str], '
            '"descriptor": str}]}.'
        )
    return f"DOCUMENT_TEXT:\n{document_text}\n\nReturn JSON only."


def build_window_user_prompt(
    *,
    roster: list[dict[str, Any]],
    pre_context_text: str,
    blocks: list[dict[str, Any]],
    post_context_text: str,
    retry_feedback: str | None = None,
) -> str:
    lines: list[str] = []
    lines.append("ROSTER:")
    lines.append(json.dumps(roster, ensure_ascii=False))
    lines.append("")
    lines.append("PRIOR_NARRATION:")
    lines.append(pre_context_text)
    lines.append("")
    lines.append(
        "WINDOW (in document order; locked entries already have correct speaker):"
    )

    for block in blocks:
        if block.get("type") == "dialogue":
            locked_str = str(bool(block.get("locked", False))).lower()
            header = (
                f"[id={block['id']}, type=dialogue, "
                f"locked={locked_str}"
            )
            if block.get("locked"):
                header += f", speaker={block['speaker']}"
            header += "]"
            lines.append(header)
            lines.append(f"text: {block['text']}")
            lines.append("")
        else:
            lines.append(f"[id={block['id']}, type=narration]")
            lines.append(f"text: {block['text']}")
            lines.append("")

    lines.append("POST_NARRATION:")
    lines.append(post_context_text)
    lines.append("")
    lines.append("Return an attributions array with one entry per dialogue id above.")
    if retry_feedback:
        lines.append("")
        lines.append(f"RETRY_NOTE: {retry_feedback}")

    return "\n".join(lines)
