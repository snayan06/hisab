from __future__ import annotations

import argparse
import asyncio
import json
from collections import Counter, defaultdict
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, cast

from pydantic import ValidationError

from artha_api.assistant import (
    AssistantSettings,
    CaptureContext,
    CaptureFailureKind,
    CaptureInterpretation,
    CaptureInterpretationError,
    CaptureInterpretationResponse,
    LlmProvider,
    LocalFinancialAssistant,
)

REPORT_VERSION = "capture-model-eval-v2"
CHECKPOINT_VERSION = "capture-model-checkpoint-v1"
VALID_OUTCOMES = {"draft", "clarify", "reject"}
UNORDERED_LIST_FIELDS = {"member_ids", "missing"}
UNSCORED_EXPECTED_FIELDS = {"reason"}


@dataclass(frozen=True, slots=True)
class CaptureEvalCase:
    id: str
    context_id: str
    utterance: str
    outcome: str
    expected: dict[str, object]
    tags: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CaptureEvalSuite:
    dataset_path: Path
    context_path: Path
    context_id: str
    context: CaptureContext
    cases: tuple[CaptureEvalCase, ...]


@dataclass(frozen=True, slots=True)
class FieldMismatch:
    field: str
    expected: object
    actual: object


@dataclass(frozen=True, slots=True)
class CaseScore:
    case_id: str
    tags: tuple[str, ...]
    expected_outcome: str
    actual_outcome: str | None
    provider: str | None
    model: str | None
    attempts: int
    passed: bool | None
    compared_fields: tuple[str, ...]
    mismatches: tuple[FieldMismatch, ...]
    actual: dict[str, object] | None
    failure_kind: CaptureFailureKind | None = None


class CaptureInterpreter(Protocol):
    async def interpret_capture(
        self, message: str, context: CaptureContext
    ) -> CaptureInterpretationResponse | None: ...


class DiagnosticCaptureInterpreter(Protocol):
    async def interpret_capture_or_raise(
        self, message: str, context: CaptureContext
    ) -> CaptureInterpretationResponse: ...


def _object(value: object, *, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return cast(dict[str, Any], value)


def _string(value: object, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _string_list(value: object, *, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or any(
        not isinstance(item, str) or not item.strip() for item in value
    ):
        raise ValueError(f"{label} must be a list of non-empty strings")
    return tuple(cast(list[str], value))


def _number(value: object, *, label: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise TypeError(f"{label} must be numeric")
    return float(value)


def _integer(value: object, *, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise TypeError(f"{label} must be an integer")
    return value


def load_capture_eval_suite(
    dataset_path: Path,
    context_path: Path,
    *,
    minimum_cases: int = 50,
) -> CaptureEvalSuite:
    context_payload = _object(
        json.loads(context_path.read_text(encoding="utf-8")), label=str(context_path)
    )
    context_id = _string(context_payload.get("id"), label="context.id")
    try:
        context = CaptureContext.model_validate(
            {key: value for key, value in context_payload.items() if key != "id"}
        )
    except ValidationError as error:
        raise ValueError(f"invalid capture context: {error}") from error

    account_ids = {account.id for account in context.accounts}
    category_ids = {category.id for category in context.categories}
    member_ids = {member.id for member in context.members}
    cases: list[CaptureEvalCase] = []
    seen_ids: set[str] = set()

    for line_number, line in enumerate(
        dataset_path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not line.strip():
            continue
        payload = _object(json.loads(line), label=f"dataset line {line_number}")
        case_id = _string(payload.get("id"), label=f"line {line_number}.id")
        if case_id in seen_ids:
            raise ValueError(f"duplicate capture evaluation case ID: {case_id}")
        seen_ids.add(case_id)

        case_context = _string(
            payload.get("context"), label=f"{case_id}.context"
        )
        if case_context != context_id:
            raise ValueError(f"{case_id}: unknown context {case_context!r}")
        outcome = _string(payload.get("outcome"), label=f"{case_id}.outcome")
        if outcome not in VALID_OUTCOMES:
            raise ValueError(f"{case_id}: invalid outcome {outcome!r}")
        expected = _object(payload.get("expected"), label=f"{case_id}.expected")
        if not expected:
            raise ValueError(f"{case_id}: expected fields are required")
        tags = _string_list(payload.get("tags"), label=f"{case_id}.tags")
        if not tags:
            raise ValueError(f"{case_id}: at least one tag is required")

        if outcome == "draft":
            amount = expected.get("amount_paise")
            if (
                not isinstance(amount, int)
                or isinstance(amount, bool)
                or amount <= 0
            ):
                raise ValueError(f"{case_id}: amount_paise must be a positive integer")
            if expected.get("source_account_id") not in account_ids:
                raise ValueError(f"{case_id}: source account is not allow-listed")
            destination_id = expected.get("destination_account_id")
            if destination_id is not None and destination_id not in account_ids:
                raise ValueError(f"{case_id}: destination account is not allow-listed")
            if expected.get("kind") == "transfer" and (
                destination_id is None
                or destination_id == expected.get("source_account_id")
            ):
                raise ValueError(f"{case_id}: transfer accounts must be distinct")
            category_id = expected.get("category_id")
            if category_id is not None and category_id not in category_ids:
                raise ValueError(f"{case_id}: category is not allow-listed")
            expected_members = expected.get("member_ids", [])
            if not isinstance(expected_members, list) or any(
                item not in member_ids for item in expected_members
            ):
                raise ValueError(f"{case_id}: member is not allow-listed")

        cases.append(
            CaptureEvalCase(
                id=case_id,
                context_id=case_context,
                utterance=_string(
                    payload.get("utterance"), label=f"{case_id}.utterance"
                ),
                outcome=outcome,
                expected=expected,
                tags=tags,
            )
        )

    if len(cases) < minimum_cases:
        raise ValueError(
            f"capture evaluation dataset must contain at least {minimum_cases} cases"
        )
    return CaptureEvalSuite(
        dataset_path=dataset_path,
        context_path=context_path,
        context_id=context_id,
        context=context,
        cases=tuple(cases),
    )


def _normalized_value(field: str, value: object) -> object:
    if field in UNORDERED_LIST_FIELDS and isinstance(value, list):
        return sorted(value)
    return value


def _safe_actual(result: CaptureInterpretation) -> dict[str, object]:
    """Persist only constrained fields; omit all model-generated free text."""
    raw = result.model_dump(mode="json")
    allowed_fields = {
        "outcome",
        "kind",
        "amount_paise",
        "platform",
        "subcategory",
        "category_id",
        "source_account_id",
        "destination_account_id",
        "member_ids",
        "split_equally",
        "occurred_on",
        "missing",
    }
    safe = {key: value for key, value in raw.items() if key in allowed_fields}
    attributes = raw.get("attributes")
    if isinstance(attributes, list):
        safe["attributes"] = [
            {"key": item.get("key"), "value": item.get("value")}
            for item in attributes
            if isinstance(item, dict)
        ]
    tags = raw.get("tags")
    if isinstance(tags, list):
        safe["tags"] = [
            item.get("name") for item in tags if isinstance(item, dict)
        ]
    return safe


def score_capture_case(
    case: CaptureEvalCase,
    response: CaptureInterpretationResponse | None,
    *,
    attempts: int,
    failure_kind: CaptureFailureKind | None = None,
) -> CaseScore:
    if response is None:
        return CaseScore(
            case_id=case.id,
            tags=case.tags,
            expected_outcome=case.outcome,
            actual_outcome=None,
            provider=None,
            model=None,
            attempts=attempts,
            passed=None,
            compared_fields=(),
            mismatches=(),
            actual=None,
            failure_kind=failure_kind or CaptureFailureKind.UNKNOWN,
        )

    actual = _safe_actual(response.result) if response is not None else None
    actual_outcome = (
        cast(str, actual["outcome"])
        if actual is not None and isinstance(actual.get("outcome"), str)
        else None
    )
    compared_fields = ["outcome"]
    mismatches: list[FieldMismatch] = []
    if actual_outcome != case.outcome:
        mismatches.append(
            FieldMismatch(
                field="outcome", expected=case.outcome, actual=actual_outcome
            )
        )
    for field, expected in case.expected.items():
        if field in UNSCORED_EXPECTED_FIELDS:
            continue
        compared_fields.append(field)
        actual_value = actual.get(field) if actual is not None else None
        if _normalized_value(field, actual_value) != _normalized_value(
            field, expected
        ):
            mismatches.append(
                FieldMismatch(field=field, expected=expected, actual=actual_value)
            )

    return CaseScore(
        case_id=case.id,
        tags=case.tags,
        expected_outcome=case.outcome,
        actual_outcome=actual_outcome,
        provider=str(response.provider) if response is not None else None,
        model=response.model if response is not None else None,
        attempts=attempts,
        passed=not mismatches,
        compared_fields=tuple(compared_fields),
        mismatches=tuple(mismatches),
        actual=actual,
        failure_kind=None,
    )


def _score_record(score: CaseScore) -> dict[str, object]:
    return {
        "case_id": score.case_id,
        "actual_outcome": score.actual_outcome,
        "provider": score.provider,
        "model": score.model,
        "attempts": score.attempts,
        "passed": score.passed,
        "compared_fields": list(score.compared_fields),
        "mismatches": [
            {
                "field": mismatch.field,
                "expected": mismatch.expected,
                "actual": mismatch.actual,
            }
            for mismatch in score.mismatches
        ],
        "actual": score.actual,
        "failure_kind": (
            score.failure_kind.value if score.failure_kind is not None else None
        ),
    }


def write_checkpoint(
    suite: CaptureEvalSuite, scores: Sequence[CaseScore], path: Path
) -> None:
    """Atomically persist resumable structured results without capture/model prose."""

    payload = {
        "checkpoint_version": CHECKPOINT_VERSION,
        "dataset": suite.dataset_path.name,
        "context": suite.context_id,
        "scores": [_score_record(score) for score in scores],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.tmp")
    temporary_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary_path.replace(path)


def load_checkpoint(suite: CaptureEvalSuite, path: Path) -> tuple[CaseScore, ...]:
    payload = _object(json.loads(path.read_text(encoding="utf-8")), label=str(path))
    if payload.get("checkpoint_version") != CHECKPOINT_VERSION:
        raise ValueError("unsupported capture evaluation checkpoint version")
    if payload.get("dataset") != suite.dataset_path.name:
        raise ValueError("capture evaluation checkpoint dataset does not match")
    if payload.get("context") != suite.context_id:
        raise ValueError("capture evaluation checkpoint context does not match")
    raw_scores = payload.get("scores")
    if not isinstance(raw_scores, list):
        raise ValueError("capture evaluation checkpoint scores must be a list")

    cases = {case.id: case for case in suite.cases}
    scores: list[CaseScore] = []
    seen: set[str] = set()
    allowed_actual_fields = {
        "outcome",
        "kind",
        "amount_paise",
        "platform",
        "subcategory",
        "attributes",
        "tags",
        "category_id",
        "source_account_id",
        "destination_account_id",
        "member_ids",
        "split_equally",
        "occurred_on",
        "missing",
    }
    for index, raw_score in enumerate(raw_scores):
        record = _object(raw_score, label=f"checkpoint score {index}")
        case_id = _string(record.get("case_id"), label=f"checkpoint score {index}.case_id")
        if case_id not in cases or case_id in seen:
            raise ValueError("capture evaluation checkpoint contains an unknown or duplicate case")
        seen.add(case_id)
        case = cases[case_id]
        raw_mismatches = record.get("mismatches")
        if not isinstance(raw_mismatches, list):
            raise ValueError("capture evaluation checkpoint mismatches must be a list")
        mismatches = tuple(
            FieldMismatch(
                field=_string(
                    _object(item, label="checkpoint mismatch").get("field"),
                    label="checkpoint mismatch.field",
                ),
                expected=_object(item, label="checkpoint mismatch").get("expected"),
                actual=_object(item, label="checkpoint mismatch").get("actual"),
            )
            for item in raw_mismatches
        )
        raw_actual = record.get("actual")
        actual = None
        if raw_actual is not None:
            actual_object = _object(raw_actual, label="checkpoint actual")
            if any(key not in allowed_actual_fields for key in actual_object):
                raise ValueError("capture evaluation checkpoint contains unsafe actual fields")
            platform = actual_object.get("platform")
            if platform is not None and (
                not isinstance(platform, str) or not platform.strip() or len(platform) > 100
            ):
                raise ValueError("capture evaluation checkpoint contains an unsafe platform")
            subcategory = actual_object.get("subcategory")
            if subcategory is not None and (
                not isinstance(subcategory, str)
                or not subcategory.strip()
                or len(subcategory) > 80
            ):
                raise ValueError("capture evaluation checkpoint contains an unsafe subcategory")
            attributes = actual_object.get("attributes", [])
            if not isinstance(attributes, list) or len(attributes) > 8:
                raise ValueError("capture evaluation checkpoint contains unsafe attributes")
            for item in attributes:
                attribute = _object(item, label="checkpoint attribute")
                if set(attribute) != {"key", "value"} or attribute.get("key") not in {
                    "meal_occasion",
                    "order_channel",
                }:
                    raise ValueError("capture evaluation checkpoint contains unsafe attributes")
                value = attribute.get("value")
                if not isinstance(value, str) or not value.strip() or len(value) > 80:
                    raise ValueError("capture evaluation checkpoint contains unsafe attributes")
            tags = actual_object.get("tags", [])
            if (
                not isinstance(tags, list)
                or len(tags) > 8
                or any(
                    not isinstance(item, str) or not item.strip() or len(item) > 60
                    for item in tags
                )
            ):
                raise ValueError("capture evaluation checkpoint contains unsafe tags")
            actual = cast(dict[str, object], actual_object)
        raw_failure = record.get("failure_kind")
        failure_kind = (
            CaptureFailureKind(_string(raw_failure, label="checkpoint failure_kind"))
            if raw_failure is not None
            else None
        )
        passed = record.get("passed")
        if passed is not None and not isinstance(passed, bool):
            raise ValueError("capture evaluation checkpoint passed must be boolean or null")
        compared_fields = _string_list(
            record.get("compared_fields"), label="checkpoint compared_fields"
        )
        attempts = _integer(record.get("attempts"), label="checkpoint attempts")
        if attempts < 1:
            raise ValueError("capture evaluation checkpoint attempts must be positive")
        scores.append(
            CaseScore(
                case_id=case_id,
                tags=case.tags,
                expected_outcome=case.outcome,
                actual_outcome=cast(str | None, record.get("actual_outcome")),
                provider=cast(str | None, record.get("provider")),
                model=cast(str | None, record.get("model")),
                attempts=attempts,
                passed=passed,
                compared_fields=compared_fields,
                mismatches=mismatches,
                actual=actual,
                failure_kind=failure_kind,
            )
        )
    return tuple(scores)


async def _interpret_with_diagnostics(
    interpreter: CaptureInterpreter,
    case: CaptureEvalCase,
    context: CaptureContext,
) -> CaptureInterpretationResponse:
    diagnostic_method = getattr(interpreter, "interpret_capture_or_raise", None)
    if diagnostic_method is not None:
        typed_method = cast(
            Callable[
                [str, CaptureContext], Awaitable[CaptureInterpretationResponse]
            ],
            diagnostic_method,
        )
        return await typed_method(case.utterance, context)
    response = await interpreter.interpret_capture(case.utterance, context)
    if response is None:
        raise CaptureInterpretationError(
            CaptureFailureKind.UNKNOWN, retryable=True
        )
    return response


async def evaluate_capture_suite(
    suite: CaptureEvalSuite,
    interpreter: CaptureInterpreter,
    *,
    max_attempts: int = 2,
    delay_seconds: float = 1.0,
    max_retry_delay_seconds: float = 60.0,
    initial_scores: Sequence[CaseScore] = (),
    checkpoint_path: Path | None = None,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> tuple[CaseScore, ...]:
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least one")
    if delay_seconds < 0:
        raise ValueError("delay_seconds cannot be negative")
    if max_retry_delay_seconds < 0:
        raise ValueError("max_retry_delay_seconds cannot be negative")

    reusable = {
        score.case_id: score
        for score in initial_scores
        if score.failure_kind is None and score.passed is not None
    }
    scores: list[CaseScore] = []
    for index, case in enumerate(suite.cases):
        if case.id in reusable:
            scores.append(reusable[case.id])
            continue
        response: CaptureInterpretationResponse | None = None
        attempts = 0
        failure: CaptureInterpretationError | None = None
        while response is None and attempts < max_attempts:
            attempts += 1
            try:
                response = await _interpret_with_diagnostics(
                    interpreter, case, suite.context
                )
            except CaptureInterpretationError as error:
                failure = error
                if not error.retryable or attempts >= max_attempts:
                    break
                retry_delay = (
                    error.retry_after_seconds
                    if error.retry_after_seconds is not None
                    else delay_seconds * (2 ** (attempts - 1))
                )
                await sleep(min(retry_delay, max_retry_delay_seconds))
        score = score_capture_case(
            case,
            response,
            attempts=attempts,
            failure_kind=(failure.kind if failure is not None else None),
        )
        scores.append(score)
        if checkpoint_path is not None:
            write_checkpoint(suite, scores, checkpoint_path)
        if delay_seconds and index < len(suite.cases) - 1:
            await sleep(delay_seconds)
    return tuple(scores)


def _slice(scores: Sequence[CaseScore]) -> dict[str, object]:
    evaluated = [score for score in scores if score.passed is not None]
    passed = sum(score.passed is True for score in evaluated)
    total = len(scores)
    return {
        "total": total,
        "evaluated": len(evaluated),
        "unavailable": total - len(evaluated),
        "passed": passed,
        "failed": len(evaluated) - passed,
        "pass_rate": passed / len(evaluated) if evaluated else 0.0,
        "coverage": len(evaluated) / total if total else 0.0,
    }


def build_evaluation_report(
    suite: CaptureEvalSuite,
    scores: Sequence[CaseScore],
    *,
    started_at: datetime,
    finished_at: datetime,
) -> dict[str, object]:
    field_totals: Counter[str] = Counter()
    field_failures: Counter[str] = Counter()
    outcome_scores: dict[str, list[CaseScore]] = defaultdict(list)
    tag_scores: dict[str, list[CaseScore]] = defaultdict(list)
    providers: Counter[str] = Counter()
    models: Counter[str] = Counter()

    for score in scores:
        for field in score.compared_fields:
            field_totals[field] += 1
        for mismatch in score.mismatches:
            field_failures[mismatch.field] += 1
        outcome_scores[score.expected_outcome].append(score)
        for tag in score.tags:
            tag_scores[tag].append(score)
        if score.provider:
            providers[score.provider] += 1
        if score.model:
            models[score.model] += 1

    field_slices = {
        field: {
            "total": total,
            "passed": total - field_failures[field],
            "failed": field_failures[field],
            "pass_rate": (total - field_failures[field]) / total,
        }
        for field, total in sorted(field_totals.items())
    }
    failures = [
        {
            "case_id": score.case_id,
            "tags": list(score.tags),
            "expected_outcome": score.expected_outcome,
            "actual_outcome": score.actual_outcome,
            "attempts": score.attempts,
            "mismatches": [
                {
                    "field": mismatch.field,
                    "expected": mismatch.expected,
                    "actual": mismatch.actual,
                }
                for mismatch in score.mismatches
            ],
            "actual": score.actual,
        }
        for score in scores
        if score.passed is False
    ]
    unavailable = [
        {
            "case_id": score.case_id,
            "tags": list(score.tags),
            "expected_outcome": score.expected_outcome,
            "attempts": score.attempts,
            "failure_kind": (
                score.failure_kind.value
                if score.failure_kind is not None
                else CaptureFailureKind.UNKNOWN.value
            ),
        }
        for score in scores
        if score.passed is None
    ]
    failure_kinds = Counter(
        item["failure_kind"] for item in unavailable
    )
    compared_fields = sum(field_totals.values())
    failed_fields = sum(field_failures.values())
    summary_slice = _slice(scores)
    return {
        "report_version": REPORT_VERSION,
        "mode": "model",
        "started_at": started_at.astimezone(UTC).isoformat(),
        "finished_at": finished_at.astimezone(UTC).isoformat(),
        "dataset": suite.dataset_path.name,
        "context": suite.context_id,
        "summary": {
            **summary_slice,
            "compared_fields": compared_fields,
            "failed_fields": failed_fields,
            "field_pass_rate": (
                (compared_fields - failed_fields) / compared_fields
                if compared_fields
                else 0.0
            ),
            "provider_unavailable_cases": summary_slice["unavailable"],
        },
        "unavailable_failure_kinds": dict(sorted(failure_kinds.items())),
        "providers": dict(sorted(providers.items())),
        "models": dict(sorted(models.items())),
        "outcome_slices": {
            key: _slice(value) for key, value in sorted(outcome_scores.items())
        },
        "field_slices": field_slices,
        "tag_slices": {
            key: _slice(value) for key, value in sorted(tag_scores.items())
        },
        "failures": failures,
        "unavailable_cases": unavailable,
    }


def build_validation_report(suite: CaptureEvalSuite) -> dict[str, object]:
    outcomes = Counter(case.outcome for case in suite.cases)
    tags = Counter(tag for case in suite.cases for tag in case.tags)
    return {
        "report_version": REPORT_VERSION,
        "mode": "validation",
        "status": "valid",
        "dataset": suite.dataset_path.name,
        "context": suite.context_id,
        "total_cases": len(suite.cases),
        "outcomes": dict(sorted(outcomes.items())),
        "tags": dict(sorted(tags.items())),
        "failures": [],
    }


def render_evaluation_markdown(report: dict[str, object]) -> str:
    if report.get("mode") == "validation":
        return (
            "# Capture evaluation validation\n\n"
            f"- Dataset: `{report['dataset']}`\n"
            f"- Context: `{report['context']}`\n"
            f"- Cases: {report['total_cases']}\n"
            "- Status: valid\n\n"
            "No model was called and no credential was required.\n"
        )

    summary = cast(dict[str, object], report["summary"])
    outcome_slices = cast(dict[str, dict[str, object]], report["outcome_slices"])
    field_slices = cast(dict[str, dict[str, object]], report["field_slices"])
    tag_slices = cast(dict[str, dict[str, object]], report["tag_slices"])
    failures = cast(list[dict[str, object]], report["failures"])
    unavailable_cases = cast(
        list[dict[str, object]], report.get("unavailable_cases", [])
    )
    unavailable_failure_kinds = cast(
        dict[str, int], report.get("unavailable_failure_kinds", {})
    )
    lines = [
        "# Hosted capture model evaluation",
        "",
        f"- Dataset: `{report['dataset']}`",
        f"- Context: `{report['context']}`",
        f"- Evaluated cases passed: {summary['passed']}/{summary['evaluated']}",
        f"- Evaluated-case pass rate: {_number(summary['pass_rate'], label='pass_rate'):.1%}",
        f"- Evaluation coverage: {_number(summary['coverage'], label='coverage'):.1%} "
        f"({summary['evaluated']}/{summary['total']})",
        "- Structured-field pass rate: "
        f"{_number(summary['field_pass_rate'], label='field_pass_rate'):.1%}",
        f"- Provider-unavailable cases: {summary['provider_unavailable_cases']}",
        "",
        "## Outcome slices",
        "",
        "| Expected outcome | Passed | Evaluated | Unavailable | Pass rate |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for outcome, item in outcome_slices.items():
        lines.append(
            f"| {outcome} | {item['passed']} | {item['evaluated']} | "
            f"{item['unavailable']} | "
            f"{_number(item['pass_rate'], label='outcome pass_rate'):.1%} |"
        )
    lines.extend(
        [
            "",
            "## Structured-field slices",
            "",
            "| Field | Passed | Total | Pass rate |",
            "| --- | ---: | ---: | ---: |",
        ]
    )
    for field, item in field_slices.items():
        lines.append(
            f"| {field} | {item['passed']} | {item['total']} | "
            f"{_number(item['pass_rate'], label='field pass_rate'):.1%} |"
        )

    failing_tags = [
        (tag, item)
        for tag, item in tag_slices.items()
        if _integer(item["failed"], label="tag failed") > 0
    ]
    lines.extend(
        [
            "",
            "## Failing tag slices",
            "",
            "| Tag | Failed | Total | Pass rate |",
            "| --- | ---: | ---: | ---: |",
        ]
    )
    if failing_tags:
        for tag, item in failing_tags:
            lines.append(
                f"| {tag} | {item['failed']} | {item['total']} | "
                f"{_number(item['pass_rate'], label='tag pass_rate'):.1%} |"
            )
    else:
        lines.append("| None | 0 | 0 | 100.0% |")

    lines.extend(
        [
            "",
            "## Failed cases",
            "",
            "Free-text utterances and model explanations are intentionally omitted.",
            "",
            "| Case | Tags | Mismatched fields | Actual outcome |",
            "| --- | --- | --- | --- |",
        ]
    )
    if failures:
        for failure in failures:
            mismatches = cast(list[dict[str, object]], failure["mismatches"])
            fields = ", ".join(str(item["field"]) for item in mismatches)
            tags = ", ".join(cast(list[str], failure["tags"]))
            lines.append(
                f"| {failure['case_id']} | {tags} | {fields} | "
                f"{failure['actual_outcome'] or 'unavailable'} |"
            )
    else:
        lines.append("| None | - | - | - |")
    lines.extend(
        [
            "",
            "## Unavailable cases",
            "",
            "Provider failures are excluded from model-accuracy denominators.",
            "Only sanitized failure classes are persisted.",
            "",
            "| Failure class | Cases |",
            "| --- | ---: |",
        ]
    )
    if unavailable_failure_kinds:
        for failure_kind, count in unavailable_failure_kinds.items():
            lines.append(f"| {failure_kind} | {count} |")
    else:
        lines.append("| None | 0 |")
    if unavailable_cases:
        lines.extend(
            [
                "",
                "Resume from the sanitized checkpoint to evaluate these cases later.",
            ]
        )
    lines.append("")
    return "\n".join(lines)


def write_reports(
    report: dict[str, object], output_dir: Path, *, stem: str
) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"{stem}.json"
    markdown_path = output_dir / f"{stem}.md"
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    markdown_path.write_text(render_evaluation_markdown(report), encoding="utf-8")
    return json_path, markdown_path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _display_path(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return path.name


def _parser() -> argparse.ArgumentParser:
    root = _repo_root()
    parser = argparse.ArgumentParser(
        description="Validate or run Artha's fictional capture-model benchmark."
    )
    parser.add_argument("--mode", choices=("validate", "run"), default="validate")
    parser.add_argument(
        "--output-dir", type=Path, default=root / "evals" / "reports"
    )
    parser.add_argument("--attempts", type=int, default=2)
    parser.add_argument("--delay-seconds", type=float, default=1.0)
    parser.add_argument("--max-retry-delay-seconds", type=float, default=60.0)
    parser.add_argument("--minimum-pass-rate", type=float, default=1.0)
    parser.add_argument("--minimum-coverage", type=float, default=1.0)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=root / "evals" / "reports" / "capture-model.checkpoint.json",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Reuse evaluated cases from --checkpoint and retry unavailable cases.",
    )
    return parser


async def _run_model_evaluation(
    suite: CaptureEvalSuite,
    *,
    max_attempts: int,
    delay_seconds: float,
    max_retry_delay_seconds: float,
    checkpoint_path: Path,
    resume: bool,
) -> dict[str, object]:
    settings = AssistantSettings.from_env()
    if settings.provider is LlmProvider.DISABLED:
        raise RuntimeError(
            "capture model is disabled; configure the server-side provider or use --mode validate"
        )
    if settings.provider is LlmProvider.GEMINI and not settings.gemini_api_key:
        raise RuntimeError(
            "Gemini is selected but its server-side key is missing; use --mode validate"
        )
    assistant = LocalFinancialAssistant(settings)
    initial_scores: tuple[CaseScore, ...] = ()
    if resume:
        try:
            initial_scores = await asyncio.to_thread(
                load_checkpoint, suite, checkpoint_path
            )
        except FileNotFoundError as error:
            raise ValueError("--resume requires an existing checkpoint") from error
    started_at = datetime.now(UTC)
    scores = await evaluate_capture_suite(
        suite,
        assistant,
        max_attempts=max_attempts,
        delay_seconds=delay_seconds,
        max_retry_delay_seconds=max_retry_delay_seconds,
        initial_scores=initial_scores,
        checkpoint_path=checkpoint_path,
    )
    return build_evaluation_report(
        suite, scores, started_at=started_at, finished_at=datetime.now(UTC)
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    root = _repo_root()
    try:
        suite = load_capture_eval_suite(
            root / "evals" / "capture-parser-v1.jsonl",
            root / "evals" / "capture-context-v1.json",
        )
        if args.mode == "validate":
            report = build_validation_report(suite)
            stem = "capture-validation"
        else:
            if not 0 <= args.minimum_pass_rate <= 1:
                raise ValueError("minimum-pass-rate must be between zero and one")
            if not 0 <= args.minimum_coverage <= 1:
                raise ValueError("minimum-coverage must be between zero and one")
            report = asyncio.run(
                _run_model_evaluation(
                    suite,
                    max_attempts=args.attempts,
                    delay_seconds=args.delay_seconds,
                    max_retry_delay_seconds=args.max_retry_delay_seconds,
                    checkpoint_path=args.checkpoint,
                    resume=args.resume,
                )
            )
            timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            stem = f"capture-model-{timestamp}"
        json_path, markdown_path = write_reports(
            report, args.output_dir, stem=stem
        )
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"capture eval failed: {error}")
        return 2

    if args.mode == "validate":
        print(f"capture evals: {len(suite.cases)} cases valid; model not called")
        print(
            "reports: "
            f"{_display_path(json_path, root)} and "
            f"{_display_path(markdown_path, root)}"
        )
        return 0

    summary = cast(dict[str, object], report["summary"])
    pass_rate = _number(summary["pass_rate"], label="pass_rate")
    coverage = _number(summary["coverage"], label="coverage")
    print(
        "capture model eval: "
        f"{summary['passed']}/{summary['evaluated']} evaluated cases passed; "
        f"coverage {coverage:.1%}"
    )
    print(
        "reports: "
        f"{_display_path(json_path, root)} and "
        f"{_display_path(markdown_path, root)}"
    )
    if _integer(summary["provider_unavailable_cases"], label="unavailable") == 0:
        args.checkpoint.unlink(missing_ok=True)
    return (
        0
        if pass_rate >= args.minimum_pass_rate
        and coverage >= args.minimum_coverage
        else 1
    )


if __name__ == "__main__":
    raise SystemExit(main())
