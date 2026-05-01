from auralia_api.validators.reports import build_validation_report
from auralia_api.validators.spans import ValidationError


def test_build_validation_report_shape_and_status():
    errors = [
        ValidationError(
            code="OVERLAP",
            message="Detected overlap between adjacent spans",
            span_id="s_2",
            index=1,
            details={"prev_end": 10, "next_start": 9},
        )
    ]

    report = build_validation_report(
        stage="segmentation", text_length=42, errors=errors
    )

    assert report["ok"] is False
    assert report["stage"] == "segmentation"
    assert report["summary"]["error_count"] == 1
    assert report["errors"][0]["code"] == "OVERLAP"


def test_build_validation_report_is_ok_when_no_errors():
    report = build_validation_report(stage="segmentation", text_length=10, errors=[])

    assert report["ok"] is True
    assert report["summary"]["error_count"] == 0
    assert report["errors"] == []
