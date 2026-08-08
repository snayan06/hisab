from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from artha_api.assistant import (
    CaptureDraftInterpretation,
    CaptureFailureKind,
    CaptureInterpretationError,
    CaptureInterpretationResponse,
    LlmProvider,
)
from artha_api.capture_evals import (
    CaptureEvalCase,
    CaptureInterpreter,
    build_evaluation_report,
    build_validation_report,
    evaluate_capture_suite,
    load_capture_eval_suite,
    load_checkpoint,
    main,
    render_evaluation_markdown,
    score_capture_case,
    write_reports,
)
from artha_api.transaction_metadata import ModelAttribute, ModelTag

ROOT = Path(__file__).resolve().parents[3]


def _suite():
    return load_capture_eval_suite(
        ROOT / "evals" / "capture-parser-v1.jsonl",
        ROOT / "evals" / "capture-context-v1.json",
    )


def _response(**updates: object) -> CaptureInterpretationResponse:
    payload: dict[str, object] = {
        "outcome": "draft",
        "kind": "transfer",
        "amount_paise": 2_500_000,
        "description": "Model free text must not be persisted",
        "category_id": None,
        "category_name": None,
        "source_account_id": "acct-icici-bank",
        "destination_account_id": "acct-hdfc-upi",
        "member_ids": [],
        "split_equally": False,
        "occurred_on": None,
        "confidence": 0.98,
        "warnings": ["Model free text must not be persisted"],
    }
    payload.update(updates)
    return CaptureInterpretationResponse(
        provider=LlmProvider.GEMINI,
        model="test-model",
        result=CaptureDraftInterpretation.model_validate(payload),
    )


def test_versioned_suite_loads_and_validates_without_a_provider() -> None:
    suite = _suite()
    report = build_validation_report(suite)

    assert len(suite.cases) == 60
    assert report["mode"] == "validation"
    assert report["total_cases"] == 60
    assert report["failures"] == []


def test_scoring_compares_structured_subset_and_omits_free_text() -> None:
    case = CaptureEvalCase(
        id="CAP-TEST",
        context_id="standard-household",
        utterance="fictional input",
        outcome="draft",
        expected={
            "kind": "transfer",
            "amount_paise": 2_500_000,
            "source_account_id": "acct-icici-bank",
            "destination_account_id": "acct-hdfc-upi",
        },
        tags=("transfer",),
    )

    score = score_capture_case(case, _response(), attempts=1)

    assert score.passed is True
    assert score.actual is not None
    assert "description" not in score.actual
    assert "warnings" not in score.actual
    assert "confidence" not in score.actual


def test_scoring_compares_safe_structured_transaction_metadata() -> None:
    case = CaptureEvalCase(
        id="CAP-METADATA",
        context_id="standard-household",
        utterance="fictional metadata input",
        outcome="draft",
        expected={
            "kind": "expense",
            "amount_paise": 68_000,
            "source_account_id": "acct-hdfc-upi",
            "platform": "Zomato",
            "attributes": [{"key": "meal_occasion", "value": "Dinner"}],
            "tags": ["Date Night"],
        },
        tags=("metadata", "merchant-platform"),
    )
    response = _response(
        kind="expense",
        amount_paise=68_000,
        description="Fictional merchant",
        source_account_id="acct-hdfc-upi",
        destination_account_id=None,
        platform="Zomato",
        attributes=[
            ModelAttribute(
                key="meal_occasion",
                value="Dinner",
                source="user_explicit",
                confidence=0.99,
            )
        ],
        tags=[
            ModelTag(
                name="Date Night",
                source="user_explicit",
                confidence=0.98,
            )
        ],
    )

    score = score_capture_case(case, response, attempts=1)

    assert score.passed is True
    assert score.actual is not None
    assert score.actual["platform"] == "Zomato"
    assert score.actual["attributes"] == [
        {"key": "meal_occasion", "value": "Dinner"}
    ]
    assert score.actual["tags"] == ["Date Night"]


def test_scoring_reports_field_and_outcome_mismatches() -> None:
    field_case = CaptureEvalCase(
        id="CAP-FIELD",
        context_id="standard-household",
        utterance="fictional input",
        outcome="draft",
        expected={"kind": "transfer", "amount_paise": 2_500_000},
        tags=("transfer", "amount"),
    )
    field_score = score_capture_case(
        field_case, _response(amount_paise=250_000), attempts=1
    )
    unavailable_score = score_capture_case(field_case, None, attempts=2)

    assert field_score.passed is False
    assert [item.field for item in field_score.mismatches] == ["amount_paise"]
    assert unavailable_score.actual_outcome is None
    assert unavailable_score.passed is None
    assert unavailable_score.failure_kind is CaptureFailureKind.UNKNOWN
    assert unavailable_score.mismatches == ()


class _RetryingInterpreter(CaptureInterpreter):
    def __init__(self) -> None:
        self.calls = 0

    async def interpret_capture(self, message, context):  # type: ignore[no-untyped-def]
        del message, context
        self.calls += 1
        return None if self.calls == 1 else _response()


class _RateLimitedInterpreter(CaptureInterpreter):
    def __init__(self) -> None:
        self.calls = 0

    async def interpret_capture(self, message, context):  # type: ignore[no-untyped-def]
        del message, context
        return None

    async def interpret_capture_or_raise(self, message, context):  # type: ignore[no-untyped-def]
        del message, context
        self.calls += 1
        if self.calls == 1:
            raise CaptureInterpretationError(
                CaptureFailureKind.RATE_LIMITED,
                retryable=True,
                retry_after_seconds=7.0,
            )
        return _response()


@pytest.mark.asyncio
async def test_evaluator_retries_adapter_unavailability_without_logging_payload() -> None:
    suite = _suite()
    one_case_suite = type(suite)(
        dataset_path=suite.dataset_path,
        context_path=suite.context_path,
        context_id=suite.context_id,
        context=suite.context,
        cases=(suite.cases[0],),
    )
    interpreter = _RetryingInterpreter()

    scores = await evaluate_capture_suite(
        one_case_suite, interpreter, max_attempts=2, delay_seconds=0
    )

    assert interpreter.calls == 2
    assert scores[0].passed is True
    assert scores[0].attempts == 2


@pytest.mark.asyncio
async def test_evaluator_honors_retry_after_and_writes_sanitized_checkpoint(
    tmp_path: Path,
) -> None:
    suite = _suite()
    one_case_suite = type(suite)(
        dataset_path=suite.dataset_path,
        context_path=suite.context_path,
        context_id=suite.context_id,
        context=suite.context,
        cases=(suite.cases[0],),
    )
    interpreter = _RateLimitedInterpreter()
    sleeps: list[float] = []

    async def record_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    checkpoint_path = tmp_path / "capture.checkpoint.json"
    scores = await evaluate_capture_suite(
        one_case_suite,
        interpreter,
        max_attempts=2,
        delay_seconds=0,
        checkpoint_path=checkpoint_path,
        sleep=record_sleep,
    )

    assert scores[0].passed is True
    assert sleeps == [7.0]
    checkpoint_text = checkpoint_path.read_text(encoding="utf-8")
    assert one_case_suite.cases[0].utterance not in checkpoint_text
    assert "Model free text must not be persisted" not in checkpoint_text
    assert load_checkpoint(one_case_suite, checkpoint_path) == scores


@pytest.mark.asyncio
async def test_resume_retries_only_unavailable_checkpoint_cases(tmp_path: Path) -> None:
    suite = _suite()
    one_case_suite = type(suite)(
        dataset_path=suite.dataset_path,
        context_path=suite.context_path,
        context_id=suite.context_id,
        context=suite.context,
        cases=(suite.cases[0],),
    )
    checkpoint_path = tmp_path / "capture.checkpoint.json"
    interpreter = _RateLimitedInterpreter()

    unavailable_scores = await evaluate_capture_suite(
        one_case_suite,
        interpreter,
        max_attempts=1,
        delay_seconds=0,
        checkpoint_path=checkpoint_path,
    )
    assert unavailable_scores[0].failure_kind is CaptureFailureKind.RATE_LIMITED

    completed_scores = await evaluate_capture_suite(
        one_case_suite,
        interpreter,
        max_attempts=1,
        delay_seconds=0,
        initial_scores=load_checkpoint(one_case_suite, checkpoint_path),
        checkpoint_path=checkpoint_path,
    )
    assert completed_scores[0].passed is True
    assert interpreter.calls == 2

    should_not_be_called = _RateLimitedInterpreter()
    resumed_scores = await evaluate_capture_suite(
        one_case_suite,
        should_not_be_called,
        max_attempts=1,
        delay_seconds=0,
        initial_scores=load_checkpoint(one_case_suite, checkpoint_path),
    )
    assert resumed_scores == completed_scores
    assert should_not_be_called.calls == 0


def test_reports_include_error_slices_and_exclude_utterances(tmp_path: Path) -> None:
    suite = _suite()
    case = suite.cases[0]
    score = score_capture_case(case, _response(amount_paise=25_000), attempts=1)
    unavailable = score_capture_case(
        suite.cases[1],
        None,
        attempts=2,
        failure_kind=CaptureFailureKind.RATE_LIMITED,
    )
    report = build_evaluation_report(
        suite,
        [score, unavailable],
        started_at=datetime(2026, 8, 5, tzinfo=UTC),
        finished_at=datetime(2026, 8, 5, 0, 0, 1, tzinfo=UTC),
    )
    json_path, markdown_path = write_reports(report, tmp_path, stem="report")
    machine = json.loads(json_path.read_text(encoding="utf-8"))
    human = markdown_path.read_text(encoding="utf-8")

    assert machine["field_slices"]["amount_paise"]["failed"] == 1
    assert machine["tag_slices"]["transfer"]["failed"] == 1
    assert machine["failures"][0]["case_id"] == "CAP-001"
    assert machine["summary"]["evaluated"] == 1
    assert machine["summary"]["failed"] == 1
    assert machine["summary"]["provider_unavailable_cases"] == 1
    assert machine["unavailable_failure_kinds"] == {"rate_limited": 1}
    assert "mismatches" not in machine["unavailable_cases"][0]
    for evaluated_case in suite.cases[:2]:
        assert evaluated_case.utterance not in json_path.read_text(encoding="utf-8")
        assert evaluated_case.utterance not in human
    assert "Mismatched fields" in human
    assert "amount_paise" in human
    assert "rate_limited" in human


def test_validation_markdown_states_that_no_model_was_called() -> None:
    markdown = render_evaluation_markdown(build_validation_report(_suite()))

    assert "No model was called" in markdown
    assert "60" in markdown


def test_run_mode_fails_closed_without_a_provider_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("ARTHA_LLM_PROVIDER", "gemini")
    monkeypatch.delenv("ARTHA_GEMINI_API_KEY", raising=False)

    exit_code = main(
        [
            "--mode",
            "run",
            "--output-dir",
            str(tmp_path),
        ]
    )

    output = capsys.readouterr().out
    assert exit_code == 2
    assert "Gemini is selected but its server-side key is missing" in output
    assert not list(tmp_path.iterdir())
