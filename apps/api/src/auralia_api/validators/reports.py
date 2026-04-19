from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from .spans import ValidationError


def build_validation_report(
    *, stage: str, text_length: int, errors: Iterable[ValidationError]
) -> dict:
    error_list = [e.to_dict() for e in errors]

    return {
        "ok": len(error_list) == 0,
        "stage": stage,
        "timestamp": datetime.now(UTC).isoformat(),
        "summary": {
            "error_count": len(error_list),
            "text_length": text_length,
        },
        "errors": error_list,
    }
