from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest
from google.genai._gaos.lib import compat_errors as interaction_errors
from pydantic import ValidationError

from artha_api.assistant import (
    ASSISTANT_INTENT_MESSAGES,
    AssistantCompletion,
    AssistantFinancialContext,
    AssistantIntent,
    AssistantSettings,
    AssistantUnavailableError,
    CaptureAccount,
    CaptureCategory,
    CaptureContext,
    CaptureFailureKind,
    CaptureInterpretationError,
    ContextCategory,
    ContextMemberBalance,
    ContextMonth,
    ContextTransaction,
    LlmProvider,
    LocalFinancialAssistant,
    MetricWidget,
    TagCategory,
    TagSuggestionRequest,
    _allowed_widgets_for_intent,
    _ground_completion,
)


class FakeGeminiInteractions:
    def __init__(self, output_text: str) -> None:
        self.output_text = output_text
        self.calls: list[dict[str, object]] = []

    async def create(self, **body: object) -> SimpleNamespace:
        self.calls.append(body)
        return SimpleNamespace(output_text=self.output_text, status="completed")


class FakeGeminiModels:
    def __init__(self) -> None:
        self.requested: list[str] = []

    async def get(self, *, model: str) -> SimpleNamespace:
        self.requested.append(model)
        return SimpleNamespace(name=model)


class FakeGeminiClient:
    def __init__(self, output_text: str) -> None:
        self.aio = SimpleNamespace(
            interactions=FakeGeminiInteractions(output_text),
            models=FakeGeminiModels(),
        )


class RateLimitedGeminiInteractions:
    async def create(self, **_body: object) -> SimpleNamespace:
        request = httpx.Request("POST", "https://gemini.invalid/interactions")
        response = httpx.Response(
            429,
            request=request,
            headers={"Retry-After": "23"},
        )
        raise interaction_errors.RateLimitError(
            "sensitive provider quota response",
            response=response,
            body={"error": "must not escape"},
        )


class RateLimitedGeminiClient:
    def __init__(self) -> None:
        self.aio = SimpleNamespace(
            interactions=RateLimitedGeminiInteractions(),
            models=FakeGeminiModels(),
        )


class FailingGeminiInteractions:
    def __init__(self, error: Exception) -> None:
        self.error = error

    async def create(self, **_body: object) -> SimpleNamespace:
        raise self.error


class FailingGeminiClient:
    def __init__(self, error: Exception) -> None:
        self.aio = SimpleNamespace(
            interactions=FailingGeminiInteractions(error),
            models=FakeGeminiModels(),
        )


def test_groq_provider_is_rejected_as_unsupported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ARTHA_LLM_PROVIDER", "groq")

    with pytest.raises(ValueError, match="unsupported LLM provider: groq"):
        AssistantSettings.from_env()


def test_legacy_groq_key_does_not_auto_select_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ARTHA_LLM_PROVIDER", raising=False)
    monkeypatch.delenv("ARTHA_GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("ARTHA_GROQ_API_KEY", "legacy-key")

    assert AssistantSettings.from_env().provider is LlmProvider.DISABLED


def test_gemini_defaults_to_flash_lite_and_wins_auto_detection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ARTHA_LLM_PROVIDER", raising=False)
    monkeypatch.setenv("ARTHA_GEMINI_API_KEY", "gemini-test-key")
    monkeypatch.delenv("ARTHA_GEMINI_MODEL", raising=False)

    direct = AssistantSettings(
        provider=LlmProvider.GEMINI, gemini_api_key="gemini-test-key"
    )
    from_env = AssistantSettings.from_env()

    assert direct.gemini_model == "gemini-3.5-flash-lite"
    assert from_env.provider is LlmProvider.GEMINI
    assert from_env.gemini_model == "gemini-3.5-flash-lite"
    assert "gemini-test-key" not in repr(direct)


def test_explicit_ollama_selection_remains_supported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ARTHA_ENV", "development")
    monkeypatch.setenv("ARTHA_LLM_PROVIDER", "ollama")
    monkeypatch.delenv("ARTHA_GEMINI_API_KEY", raising=False)

    assert AssistantSettings.from_env().provider is LlmProvider.OLLAMA


@pytest.mark.parametrize("provider", ["disabled", "ollama"])
def test_production_requires_gemini_provider(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
) -> None:
    monkeypatch.setenv("ARTHA_ENV", "production")
    monkeypatch.setenv("ARTHA_LLM_PROVIDER", provider)

    with pytest.raises(ValueError, match="production requires the Gemini provider"):
        AssistantSettings.from_env()


def test_production_forbids_ollama_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ARTHA_ENV", "production")
    monkeypatch.setenv("ARTHA_LLM_PROVIDER", "gemini")
    monkeypatch.setenv("ARTHA_GEMINI_API_KEY", "gemini-test-key")
    monkeypatch.setenv("ARTHA_OLLAMA_FALLBACK", "true")

    with pytest.raises(ValueError, match="production forbids Ollama fallback"):
        AssistantSettings.from_env()


def test_production_requires_gemini_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ARTHA_ENV", "production")
    monkeypatch.setenv("ARTHA_LLM_PROVIDER", "gemini")
    monkeypatch.delenv("ARTHA_GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("ARTHA_OLLAMA_FALLBACK", "false")

    with pytest.raises(ValueError, match="production requires a Gemini API key"):
        AssistantSettings.from_env()


@pytest.fixture
def financial_context() -> AssistantFinancialContext:
    return AssistantFinancialContext(
        total_balance_paise=1_500_000,
        current_month_spend_paise=250_000,
        current_month_income_paise=800_000,
        member_balances=[
            ContextMemberBalance(member_name="Avery", balance_paise=40_000),
            ContextMemberBalance(member_name="Blair", balance_paise=-15_000),
        ],
        top_categories=[ContextCategory(category="Food", amount_paise=120_000)],
        monthly=[ContextMonth(month="Aug", income_paise=800_000, spend_paise=250_000)],
        recent_transactions=[
            ContextTransaction(
                occurred_on="2026-08-04",
                kind="expense",
                personal_share_paise=42_000,
                category="Food",
            )
        ],
    )


def canonical_widgets(
    intent: AssistantIntent,
    context: AssistantFinancialContext,
) -> list[dict[str, object]]:
    bundles: dict[AssistantIntent, list[dict[str, object]]] = {
        AssistantIntent.SUMMARY: [
            {
                "type": "metric",
                "title": "Total account balance",
                "value_paise": context.total_balance_paise,
                "caption": None,
                "tone": "neutral",
            },
            {
                "type": "metric",
                "title": "Spending this month",
                "value_paise": context.current_month_spend_paise,
                "caption": None,
                "tone": "warning",
            },
            {
                "type": "metric",
                "title": "Income this month",
                "value_paise": context.current_month_income_paise,
                "caption": None,
                "tone": "positive",
            },
        ],
        AssistantIntent.SPENDING: [
            {
                "type": "metric",
                "title": "Spending this month",
                "value_paise": context.current_month_spend_paise,
                "caption": None,
                "tone": "warning",
            },
            {
                "type": "chart",
                "title": "Top spending categories",
                "chart_type": "bar",
                "points": [
                    {"label": item.category, "value_paise": item.amount_paise}
                    for item in context.top_categories
                ],
            },
        ],
        AssistantIntent.INCOME: [
            {
                "type": "metric",
                "title": "Income this month",
                "value_paise": context.current_month_income_paise,
                "caption": None,
                "tone": "positive",
            }
        ],
        AssistantIntent.CASHFLOW: [
            {
                "type": "chart",
                "title": "Monthly income",
                "chart_type": "line",
                "points": [
                    {"label": item.month, "value_paise": item.income_paise}
                    for item in context.monthly
                ],
            },
            {
                "type": "chart",
                "title": "Monthly spending",
                "chart_type": "line",
                "points": [
                    {"label": item.month, "value_paise": item.spend_paise}
                    for item in context.monthly
                ],
            },
        ],
        AssistantIntent.SHARED: [
            {
                "type": "table",
                "title": "Household balances",
                "rows": [
                    {
                        "label": item.member_name,
                        "amount_paise": item.balance_paise,
                        "date": None,
                        "kind": None,
                    }
                    for item in context.member_balances
                ],
            }
        ],
        AssistantIntent.TRANSACTIONS: [
            {
                "type": "table",
                "title": "Recent activity",
                "rows": [
                    {
                        "label": item.category,
                        "amount_paise": item.personal_share_paise,
                        "date": item.occurred_on,
                        "kind": item.kind,
                    }
                    for item in context.recent_transactions
                ],
            }
        ],
        AssistantIntent.CLARIFICATION: [
            {
                "type": "clarification",
                "question": "What would you like to review?",
                "choices": [
                    "Account balance",
                    "Monthly spending",
                    "Income",
                    "Shared balances",
                ],
            }
        ],
        AssistantIntent.UNSUPPORTED: [
            {
                "type": "clarification",
                "question": "Would you like to review your ledger instead?",
                "choices": ["Account balance", "Monthly spending", "Recent activity"],
            }
        ],
    }
    return bundles[intent]


def completion_with_widgets(
    intent: AssistantIntent,
    widgets: list[dict[str, object]],
) -> AssistantCompletion:
    return AssistantCompletion.model_validate(
        {
            "message": ASSISTANT_INTENT_MESSAGES[intent],
            "intent": intent,
            "widgets": widgets,
        }
    )


@pytest.mark.parametrize(
    "message",
    [
        pytest.param(None, id="missing"),
        pytest.param("   \n\t", id="blank"),
        pytest.param("x" * 401, id="too-long"),
    ],
)
def test_assistant_completion_requires_a_nonblank_bounded_model_message(
    message: str | None,
) -> None:
    payload: dict[str, object] = {
        "intent": AssistantIntent.SUMMARY,
        "widgets": [
            MetricWidget(
                type="metric",
                title="Available balance",
                value_paise=1_500_000,
            )
        ],
    }
    if message is not None:
        payload["message"] = message

    with pytest.raises(ValidationError):
        AssistantCompletion.model_validate(payload)


def test_assistant_completion_keeps_the_400_character_schema_bound() -> None:
    assert AssistantCompletion.model_json_schema()["properties"]["message"]["maxLength"] == 400


def test_assistant_completion_schema_advertises_only_approved_messages() -> None:
    message_schema = AssistantCompletion.model_json_schema()["properties"]["message"]

    assert set(message_schema["enum"]) == {
        "Here is your current account overview.",
        "Here is your spending overview.",
        "Here is your income overview.",
        "Here is your cash-flow overview.",
        "Here are your shared balances.",
        "Here is your recent ledger activity.",
        "I need a little more detail to answer that.",
        "I can only help with read-only ledger questions.",
    }


def test_assistant_completion_schema_rejects_the_ungrounded_insight_channel() -> None:
    with pytest.raises(ValidationError):
        AssistantCompletion.model_validate(
            {
                "message": ASSISTANT_INTENT_MESSAGES[AssistantIntent.SUMMARY],
                "intent": "summary",
                "widgets": [
                    {
                        "type": "insight",
                        "title": "Model narrative",
                        "body": "An arbitrary second narrative channel.",
                    }
                ],
            }
        )


@pytest.mark.parametrize(
    "message",
    [
        "Your balance is 99 crore.",
        "Your balance is ninety nine crore.",
        "Your balance is ninety-nine crore.",
        "Your balance is ९९ crore.",
        "Your balance is a dollar.",
        "Your balance is a euro.",
        "Your balance is a grand.",
        "The weather outside is pleasant.",
        "Your balance is one lakh rupees.",
        "Your savings rate is fifty percent.",
        "INR one hundred is shown below.",
        "Your balance is ₹crore.",
        "Your balance is $high.",
        "Your balance is €high.",
        "Your balance is £high.",
        "Your savings rate is %high.",
    ],
)
def test_assistant_completion_rejects_unapproved_narrative(
    message: str,
) -> None:
    with pytest.raises(ValidationError):
        AssistantCompletion(
            message=message,
            intent=AssistantIntent.SUMMARY,
            widgets=[
                MetricWidget(
                    type="metric",
                    title="Available balance",
                    value_paise=1_500_000,
                )
            ],
        )


@pytest.mark.parametrize(("intent", "message"), ASSISTANT_INTENT_MESSAGES.items())
def test_assistant_completion_accepts_only_the_message_for_its_intent(
    intent: AssistantIntent,
    message: str,
) -> None:
    completion = AssistantCompletion(
        message=message,
        intent=intent,
        widgets=[
            MetricWidget(
                type="metric",
                title="Available balance",
                value_paise=1_500_000,
            )
        ],
    )

    assert completion.message == message


def test_every_assistant_intent_has_one_approved_message() -> None:
    assert set(ASSISTANT_INTENT_MESSAGES) == set(AssistantIntent)


@pytest.mark.asyncio
async def test_disabled_assistant_is_unavailable(
    financial_context: AssistantFinancialContext,
) -> None:
    assistant = LocalFinancialAssistant(AssistantSettings(provider=LlmProvider.DISABLED))

    status = await assistant.status()
    assert status.model_dump() == {
        "configured": False,
        "provider": "disabled",
        "model": None,
        "available": False,
        "active_provider": None,
        "ollama_fallback_enabled": False,
        "detail": "disabled",
        "data_policy": "sample_only",
        "personal_data_enabled": False,
        "is_demo": False,
    }
    with pytest.raises(
        AssistantUnavailableError, match="AI assistant is unavailable"
    ):
        await assistant.chat("How much did I spend?", financial_context)


@pytest.mark.asyncio
async def test_gemini_uses_private_stateless_structured_output(
    financial_context: AssistantFinancialContext,
) -> None:
    completion = {
        "message": ASSISTANT_INTENT_MESSAGES[AssistantIntent.SPENDING],
        "intent": "spending",
        "widgets": canonical_widgets(AssistantIntent.SPENDING, financial_context),
    }
    gemini = FakeGeminiClient(json.dumps(completion))

    assistant = LocalFinancialAssistant(
        AssistantSettings(
            provider=LlmProvider.GEMINI, gemini_api_key="gemini-test-key"
        ),
        gemini_client=gemini,
    )
    response = await assistant.chat("Show spending", financial_context)

    assert response.mode == "model"
    assert response.provider == "gemini"
    assert response.result.message == ASSISTANT_INTENT_MESSAGES[AssistantIntent.SPENDING]
    body = gemini.aio.interactions.calls[0]
    assert body["model"] == "gemini-3.5-flash-lite"
    assert body["store"] is False
    assert body["generation_config"]["thinking_level"] == "minimal"
    assert body["response_format"]["mime_type"] == "application/json"
    assert "schema" not in body["response_format"]
    assert "intent=unsupported" in body["system_instruction"]
    normalized_prompt = " ".join(body["system_instruction"].casefold().split())
    assert "top spending categories must use a chart" in normalized_prompt
    assert "cashflow comparison must use a chart" in normalized_prompt
    assert "return exactly its approved message" in normalized_prompt
    assert "financial numbers only in allow-listed widgets" in normalized_prompt
    for intent, message in ASSISTANT_INTENT_MESSAGES.items():
        assert f'intent={intent.value}: message="{message.casefold()}"' in normalized_prompt
    assert "tools" not in body
    assert "Allowed widget bundles by intent" in body["input"]
    assert '"spending":[{"type":"metric","title":"Spending this month"' in body["input"]


@pytest.mark.parametrize(
    "widget",
    [
        {"type": "metric", "title": "Invented", "value_paise": 999_999},
        {
            "type": "chart",
            "title": "Categories",
            "chart_type": "bar",
            "points": [{"label": "Invented", "value_paise": 120_000}],
        },
        {
            "type": "chart",
            "title": "Categories",
            "chart_type": "bar",
            "points": [{"label": "Food", "value_paise": 999_999}],
        },
        {
            "type": "table",
            "title": "Activity",
            "rows": [
                {
                    "label": "Invented",
                    "amount_paise": 42_000,
                    "date": "2026-08-04",
                    "kind": "expense",
                }
            ],
        },
        {
            "type": "table",
            "title": "Activity",
            "rows": [
                {
                    "label": "Food",
                    "amount_paise": 999_999,
                    "date": "2026-08-04",
                    "kind": "expense",
                }
            ],
        },
    ],
)
@pytest.mark.asyncio
async def test_chat_rejects_ungrounded_model_widgets(
    widget: dict[str, object],
    financial_context: AssistantFinancialContext,
) -> None:
    completion = {
        "message": ASSISTANT_INTENT_MESSAGES[AssistantIntent.SUMMARY],
        "intent": "summary",
        "widgets": [widget],
    }
    assistant = LocalFinancialAssistant(
        AssistantSettings(
            provider=LlmProvider.GEMINI,
            gemini_api_key="gemini-test-key",
        ),
        gemini_client=FakeGeminiClient(json.dumps(completion)),
    )

    with pytest.raises(AssistantUnavailableError, match="AI assistant is unavailable"):
        await assistant.chat("Show my ledger", financial_context)


@pytest.mark.parametrize("intent", list(AssistantIntent))
def test_grounding_accepts_the_exact_canonical_bundle_for_every_intent(
    intent: AssistantIntent,
    financial_context: AssistantFinancialContext,
) -> None:
    completion = completion_with_widgets(
        intent,
        canonical_widgets(intent, financial_context),
    )
    allowed = _allowed_widgets_for_intent(intent, financial_context)

    assert [item.model_dump(mode="json") for item in allowed] == canonical_widgets(
        intent, financial_context
    )
    assert _ground_completion(completion, financial_context) is completion


@pytest.mark.parametrize(
    ("intent", "widgets"),
    [
        (
            AssistantIntent.SUMMARY,
            [
                {
                    "type": "metric",
                    "title": "Total account balance",
                    "value_paise": 250_000,
                    "tone": "neutral",
                },
                {
                    "type": "metric",
                    "title": "Spending this month",
                    "value_paise": 1_500_000,
                    "tone": "warning",
                },
                {
                    "type": "metric",
                    "title": "Income this month",
                    "value_paise": 800_000,
                    "tone": "positive",
                },
            ],
        ),
        (
            AssistantIntent.INCOME,
            [
                {
                    "type": "metric",
                    "title": "Income this month",
                    "value_paise": 800_000,
                    "caption": "Invented caption",
                    "tone": "positive",
                }
            ],
        ),
        (
            AssistantIntent.SPENDING,
            [
                {
                    "type": "metric",
                    "title": "Spending this month",
                    "value_paise": 250_000,
                    "tone": "warning",
                },
                {
                    "type": "chart",
                    "title": "Renamed categories",
                    "chart_type": "bar",
                    "points": [
                        {"label": "Food", "value_paise": 120_000},
                        {"label": "Transport", "value_paise": 80_000},
                        {"label": "Bills", "value_paise": 50_000},
                    ],
                },
            ],
        ),
        (
            AssistantIntent.SHARED,
            [
                {
                    "type": "table",
                    "title": "Renamed balances",
                    "rows": [
                        {"label": "Avery", "amount_paise": 40_000},
                    ],
                }
            ],
        ),
        (
            AssistantIntent.SPENDING,
            [
                {
                    "type": "metric",
                    "title": "Spending this month",
                    "value_paise": 250_000,
                    "tone": "warning",
                },
                {
                    "type": "chart",
                    "title": "Top spending categories",
                    "chart_type": "bar",
                    "points": [
                        {"label": "Food", "value_paise": 120_000},
                        {"label": "Food", "value_paise": 120_000},
                        {"label": "Transport", "value_paise": 80_000},
                        {"label": "Bills", "value_paise": 50_000},
                    ],
                },
            ],
        ),
        (
            AssistantIntent.TRANSACTIONS,
            [
                {
                    "type": "table",
                    "title": "Recent activity",
                    "rows": [
                        {
                            "label": "Food",
                            "amount_paise": 42_000,
                            "date": "2026-08-04",
                            "kind": "expense",
                        },
                        {
                            "label": "Food",
                            "amount_paise": 42_000,
                            "date": "2026-08-04",
                            "kind": "expense",
                        },
                    ],
                }
            ],
        ),
        (
            AssistantIntent.SPENDING,
            [
                {
                    "type": "metric",
                    "title": "Spending this month",
                    "value_paise": 250_000,
                    "tone": "warning",
                },
                {
                    "type": "chart",
                    "title": "Top spending categories",
                    "chart_type": "bar",
                    "points": [
                        {"label": "Food", "value_paise": 120_000},
                        {"label": "Transport", "value_paise": 80_000},
                    ],
                },
            ],
        ),
        (
            AssistantIntent.SHARED,
            [
                {
                    "type": "table",
                    "title": "Household balances",
                    "rows": [{"label": "Avery", "amount_paise": 40_000}],
                }
            ],
        ),
        (
            AssistantIntent.SPENDING,
            [
                {
                    "type": "metric",
                    "title": "Spending this month",
                    "value_paise": 250_000,
                    "tone": "warning",
                },
                {
                    "type": "chart",
                    "title": "Top spending categories",
                    "chart_type": "bar",
                    "points": [
                        {"label": "Bills", "value_paise": 50_000},
                        {"label": "Transport", "value_paise": 80_000},
                        {"label": "Food", "value_paise": 120_000},
                    ],
                },
            ],
        ),
        (
            AssistantIntent.SHARED,
            [
                {
                    "type": "table",
                    "title": "Household balances",
                    "rows": [
                        {"label": "Blair", "amount_paise": -15_000},
                        {"label": "Avery", "amount_paise": 40_000},
                    ],
                }
            ],
        ),
        (
            AssistantIntent.SPENDING,
            [
                {
                    "type": "metric",
                    "title": "Spending this month",
                    "value_paise": 250_000,
                    "tone": "warning",
                },
                {
                    "type": "chart",
                    "title": "Top spending categories",
                    "chart_type": "bar",
                    "points": [
                        {"label": "Food", "value_paise": 120_000},
                        {"label": "Aug", "value_paise": 800_000},
                    ],
                },
            ],
        ),
        (
            AssistantIntent.SUMMARY,
            [
                {
                    "type": "metric",
                    "title": "Total account balance",
                    "value_paise": 1_500_000,
                    "tone": "neutral",
                }
            ],
        ),
        (
            AssistantIntent.INCOME,
            [
                {
                    "type": "metric",
                    "title": "Income this month",
                    "value_paise": 800_000,
                    "tone": "positive",
                },
                {
                    "type": "metric",
                    "title": "Income this month",
                    "value_paise": 800_000,
                    "tone": "positive",
                },
            ],
        ),
        (
            AssistantIntent.CASHFLOW,
            [
                {
                    "type": "chart",
                    "title": "Monthly cash flow",
                    "chart_type": "line",
                    "points": [
                        {"label": "Jul", "value_paise": 750_000},
                        {"label": "Jul", "value_paise": 300_000},
                        {"label": "Aug", "value_paise": 800_000},
                        {"label": "Aug", "value_paise": 250_000},
                    ],
                }
            ],
        ),
        (
            AssistantIntent.CLARIFICATION,
            [
                {
                    "type": "clarification",
                    "question": "Tell me anything.",
                    "choices": ["Everything"],
                }
            ],
        ),
    ],
)
def test_grounding_rejects_semantic_widget_mutations(
    intent: AssistantIntent,
    widgets: list[dict[str, object]],
    financial_context: AssistantFinancialContext,
) -> None:
    completion = completion_with_widgets(intent, widgets)

    with pytest.raises(ValueError, match="canonical bundle"):
        _ground_completion(completion, financial_context)


@pytest.mark.parametrize(
    ("intent", "question"),
    [
        (
            AssistantIntent.SHARED,
            "No household balances are available. What would you like to review?",
        ),
        (
            AssistantIntent.TRANSACTIONS,
            "No recent activity is available. What would you like to review?",
        ),
    ],
)
def test_empty_context_uses_exact_safe_clarification_bundle(
    intent: AssistantIntent,
    question: str,
    financial_context: AssistantFinancialContext,
) -> None:
    empty_context = financial_context.model_copy(
        update={
            "member_balances": []
            if intent is AssistantIntent.SHARED
            else financial_context.member_balances,
            "recent_transactions": []
            if intent is AssistantIntent.TRANSACTIONS
            else financial_context.recent_transactions,
        }
    )
    completion = completion_with_widgets(
        intent,
        [
            {
                "type": "clarification",
                "question": question,
                "choices": ["Account balance", "Monthly spending"],
            }
        ],
    )

    assert _ground_completion(completion, empty_context) is completion


def test_shared_bundle_includes_all_twenty_bounded_context_members(
    financial_context: AssistantFinancialContext,
) -> None:
    context = financial_context.model_copy(
        update={
            "member_balances": [
                ContextMemberBalance(member_name=f"Member {index}", balance_paise=index)
                for index in range(20)
            ]
        }
    )

    widgets = _allowed_widgets_for_intent(AssistantIntent.SHARED, context)

    assert len(widgets) == 1
    assert len(widgets[0].model_dump(mode="json")["rows"]) == 20


@pytest.mark.asyncio
async def test_gemini_capture_interpretation_resolves_25k_transfer() -> None:
    context = CaptureContext(
        today="2026-08-04",
        timezone="Asia/Kolkata",
        accounts=[
            CaptureAccount(id="icici-id", name="ICICI Bank", kind="bank"),
            CaptureAccount(id="hdfc-id", name="HDFC Bank", kind="bank"),
        ],
        categories=[CaptureCategory(id="other-id", name="Other", kind="both")],
    )

    interpretation = {
        "outcome": "draft",
        "kind": "transfer",
        "amount_paise": 2_500_000,
        "description": "Self transfer",
        "category_id": None,
        "category_name": None,
        "source_account_id": "icici-id",
        "destination_account_id": "hdfc-id",
        "member_ids": [],
        "split_equally": False,
        "occurred_on": "2026-08-04",
        "confidence": 0.99,
        "warnings": [],
    }
    gemini = FakeGeminiClient(json.dumps({"result": interpretation}))

    assistant = LocalFinancialAssistant(
        AssistantSettings(
            provider=LlmProvider.GEMINI, gemini_api_key="gemini-test-key"
        ),
        gemini_client=gemini,
    )
    response = await assistant.interpret_capture(
        "self transfer 25k ICICI -> HDFC", context
    )

    assert response is not None
    assert response.provider == "gemini"
    assert response.result.amount_paise == 2_500_000
    assert response.result.source_account_id == "icici-id"
    assert response.result.destination_account_id == "hdfc-id"
    body = gemini.aio.interactions.calls[0]
    assert body["store"] is False
    assert "25k means 25,000 rupees" in body["system_instruction"]
    normalized_prompt = " ".join(body["system_instruction"].casefold().split())
    assert "loans, lending, borrowing, and emis" in normalized_prompt
    assert "exact schema field identifiers" in normalized_prompt
    assert "freelance income, refunds, and interest" in normalized_prompt
    assert "named date such as 2 aug" in normalized_prompt
    assert "payment to a person" in normalized_prompt


@pytest.mark.asyncio
async def test_capture_diagnostics_classify_rate_limit_without_provider_text() -> None:
    context = CaptureContext(
        today="2026-08-04",
        timezone="Asia/Kolkata",
        accounts=[CaptureAccount(id="known-id", name="Known Bank", kind="bank")],
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            headers={"Retry-After": "7"},
            json={"error": "sensitive provider response must not escape"},
        )

    assistant = LocalFinancialAssistant(
        AssistantSettings(provider=LlmProvider.OLLAMA),
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(CaptureInterpretationError) as captured:
        await assistant.interpret_capture_or_raise("fictional capture", context)

    assert captured.value.kind is CaptureFailureKind.RATE_LIMITED
    assert captured.value.retryable is True
    assert captured.value.retry_after_seconds == 7.0
    assert str(captured.value) == "rate_limited"


@pytest.mark.asyncio
async def test_interactions_rate_limit_is_sanitized_for_capture() -> None:
    assistant = LocalFinancialAssistant(
        AssistantSettings(
            provider=LlmProvider.GEMINI,
            gemini_api_key="gemini-test-key",
        ),
        gemini_client=RateLimitedGeminiClient(),
    )
    context = CaptureContext(
        today="2026-08-04",
        timezone="Asia/Kolkata",
        accounts=[CaptureAccount(id="known-id", name="Known Bank", kind="bank")],
    )

    with pytest.raises(CaptureInterpretationError) as captured:
        await assistant.interpret_capture_or_raise("fictional capture", context)

    assert captured.value.kind is CaptureFailureKind.RATE_LIMITED
    assert captured.value.retryable is True
    assert captured.value.retry_after_seconds == 23.0
    assert str(captured.value) == "rate_limited"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider_error", "expected_kind"),
    [
        (
            interaction_errors.APITimeoutError(
                httpx.Request("POST", "https://gemini.invalid/interactions")
            ),
            CaptureFailureKind.TIMEOUT,
        ),
        (
            interaction_errors.APIConnectionError(
                request=httpx.Request(
                    "POST", "https://gemini.invalid/interactions"
                )
            ),
            CaptureFailureKind.NETWORK,
        ),
    ],
)
async def test_interactions_transport_failures_are_retryable_for_capture(
    provider_error: Exception,
    expected_kind: CaptureFailureKind,
) -> None:
    assistant = LocalFinancialAssistant(
        AssistantSettings(
            provider=LlmProvider.GEMINI,
            gemini_api_key="gemini-test-key",
        ),
        gemini_client=FailingGeminiClient(provider_error),
    )
    context = CaptureContext(
        today="2026-08-04",
        timezone="Asia/Kolkata",
        accounts=[CaptureAccount(id="known-id", name="Known Bank", kind="bank")],
    )

    with pytest.raises(CaptureInterpretationError) as captured:
        await assistant.interpret_capture_or_raise("fictional capture", context)

    assert captured.value.kind is expected_kind
    assert captured.value.retryable is True
    assert captured.value.retry_after_seconds is None
    assert str(captured.value) == expected_kind.value


@pytest.mark.asyncio
async def test_capture_interpretation_rejects_invented_account_id() -> None:
    context = CaptureContext(
        today="2026-08-04",
        timezone="Asia/Kolkata",
        accounts=[CaptureAccount(id="known-id", name="Known Bank", kind="bank")],
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        interpretation = {
            "outcome": "draft",
            "kind": "expense",
            "amount_paise": 10_000,
            "description": "Coffee",
            "category_id": None,
            "category_name": None,
            "source_account_id": "invented-id",
            "destination_account_id": None,
            "member_ids": [],
            "split_equally": False,
            "occurred_on": None,
            "confidence": 0.9,
            "warnings": [],
        }
        return httpx.Response(
            200, json={"message": {"content": json.dumps(interpretation)}}
        )

    assistant = LocalFinancialAssistant(
        AssistantSettings(provider=LlmProvider.OLLAMA),
        transport=httpx.MockTransport(handler),
    )

    assert await assistant.interpret_capture("coffee 100", context) is None


@pytest.mark.asyncio
async def test_capture_interpretation_can_request_clarification_without_a_draft() -> None:
    context = CaptureContext(
        today="2026-08-04",
        timezone="Asia/Kolkata",
        accounts=[CaptureAccount(id="known-id", name="Known Bank", kind="bank")],
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        result = {
            "outcome": "clarify",
            "question": "Which account should this use?",
            "missing": ["source_account_id"],
            "warnings": [],
        }
        return httpx.Response(200, json={"message": {"content": json.dumps(result)}})

    assistant = LocalFinancialAssistant(
        AssistantSettings(provider=LlmProvider.OLLAMA),
        transport=httpx.MockTransport(handler),
    )
    response = await assistant.interpret_capture("25k", context)

    assert response is not None
    assert response.result.outcome == "clarify"
    assert response.result.question == "Which account should this use?"


@pytest.mark.asyncio
async def test_gemini_failure_can_use_opt_in_ollama_fallback(
    financial_context: AssistantFinancialContext,
) -> None:
    requested_hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_hosts.append(request.url.host or "")
        completion = {
            "message": ASSISTANT_INTENT_MESSAGES[AssistantIntent.SHARED],
            "intent": "shared",
            "widgets": canonical_widgets(AssistantIntent.SHARED, financial_context),
        }
        return httpx.Response(
            200,
            json={"message": {"content": json.dumps(completion)}},
        )

    assistant = LocalFinancialAssistant(
        AssistantSettings(
            provider=LlmProvider.GEMINI,
            gemini_api_key="test-key",
            ollama_fallback_enabled=True,
        ),
        transport=httpx.MockTransport(handler),
        gemini_client=FakeGeminiClient("invalid model response"),
    )
    response = await assistant.chat("What is the shared balance?", financial_context)

    assert requested_hosts == ["127.0.0.1"]
    assert response.mode == "model"
    assert response.provider == "ollama"
    assert response.model == "qwen3:4b-instruct"
    assert response.result.message == ASSISTANT_INTENT_MESSAGES[AssistantIntent.SHARED]


@pytest.mark.asyncio
async def test_invalid_model_payload_makes_assistant_unavailable(
    financial_context: AssistantFinancialContext,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/chat"
        return httpx.Response(
            200,
            json={
                "message": {
                    "content": json.dumps(
                        {
                            "message": ASSISTANT_INTENT_MESSAGES[AssistantIntent.SPENDING],
                            "intent": "spending",
                            "widgets": [
                                {
                                    "type": "metric",
                                    "title": "Unsafe extra field",
                                    "value_paise": 1,
                                    "caption": None,
                                    "tone": "neutral",
                                    "sql": "delete from transactions",
                                }
                            ],
                        }
                    )
                }
            },
        )

    assistant = LocalFinancialAssistant(
        AssistantSettings(provider=LlmProvider.OLLAMA),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(
        AssistantUnavailableError, match="AI assistant is unavailable"
    ):
        await assistant.chat("Show spending", financial_context)


@pytest.mark.asyncio
async def test_interactions_rate_limit_makes_assistant_unavailable(
    financial_context: AssistantFinancialContext,
) -> None:
    assistant = LocalFinancialAssistant(
        AssistantSettings(
            provider=LlmProvider.GEMINI,
            gemini_api_key="gemini-test-key",
        ),
        gemini_client=RateLimitedGeminiClient(),
    )

    with pytest.raises(
        AssistantUnavailableError, match="AI assistant is unavailable"
    ):
        await assistant.chat("Show spending", financial_context)


@pytest.mark.asyncio
async def test_gemini_tag_suggestion_is_grounded_in_allowed_categories() -> None:
    suggestion = {
        "category_id": "food",
        "category_name": "Food",
        "confidence": 0.91,
        "reason": "The merchant is a restaurant.",
    }
    gemini = FakeGeminiClient(json.dumps(suggestion))

    assistant = LocalFinancialAssistant(
        AssistantSettings(
            provider=LlmProvider.GEMINI, gemini_api_key="gemini-test-key"
        ),
        gemini_client=gemini,
    )
    response = await assistant.suggest_tag(
        TagSuggestionRequest(
            description="Corner restaurant",
            amount_paise=85000,
            direction="expense",
            allowed_categories=[
                TagCategory(id="food", name="Food"),
                TagCategory(id="travel", name="Travel"),
            ],
        )
    )

    assert response.mode == "model"
    assert response.provider == "gemini"
    assert response.result.category_id == "food"
    body = gemini.aio.interactions.calls[0]
    assert body["response_format"]["mime_type"] == "application/json"
    assert "generic payment" in body["system_instruction"]


def test_tag_suggestion_request_accepts_production_category_capacity() -> None:
    categories = [
        TagCategory(id=f"category-{index}", name=f"Category {index}")
        for index in range(200)
    ]

    request = TagSuggestionRequest(
        description="Household transaction",
        amount_paise=1_000,
        direction="expense",
        allowed_categories=categories,
    )

    assert len(request.allowed_categories) == 200

    with pytest.raises(ValidationError, match="List should have at most 200 items"):
        TagSuggestionRequest(
            description="Household transaction",
            amount_paise=1_000,
            direction="expense",
            allowed_categories=[
                *categories,
                TagCategory(id="category-200", name="Category 200"),
            ],
        )


@pytest.mark.asyncio
async def test_invented_tag_makes_category_suggestion_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/chat"
        suggestion = {
            "category_id": "invented",
            "category_name": "Crypto",
            "confidence": 1.0,
            "reason": "Invented by model.",
        }
        return httpx.Response(
            200,
            json={"message": {"content": json.dumps(suggestion)}},
        )

    assistant = LocalFinancialAssistant(
        AssistantSettings(provider=LlmProvider.OLLAMA),
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(
        AssistantUnavailableError, match="AI category suggestion is unavailable"
    ):
        await assistant.suggest_tag(
            TagSuggestionRequest(
                description="Unknown merchant",
                amount_paise=5000,
                direction="expense",
                allowed_categories=[TagCategory(id="food", name="Food")],
            )
        )


@pytest.mark.asyncio
async def test_interactions_rate_limit_makes_tag_suggestion_unavailable() -> None:
    assistant = LocalFinancialAssistant(
        AssistantSettings(
            provider=LlmProvider.GEMINI,
            gemini_api_key="gemini-test-key",
        ),
        gemini_client=RateLimitedGeminiClient(),
    )

    with pytest.raises(
        AssistantUnavailableError, match="AI category suggestion is unavailable"
    ):
        await assistant.suggest_tag(
            TagSuggestionRequest(
                description="Unknown merchant",
                amount_paise=5000,
                direction="expense",
                allowed_categories=[TagCategory(id="food", name="Food")],
            )
        )


@pytest.mark.asyncio
async def test_disabled_assistant_endpoints_return_503_without_changing_ledger(
    client: httpx.AsyncClient,
    bootstrapped: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert bootstrapped["created"] is True
    monkeypatch.setenv("ARTHA_LLM_PROVIDER", "disabled")
    before = (await client.get("/api/v1/transactions")).json()

    status_response = await client.get("/api/v1/assistant/status")
    chat_response = await client.post(
        "/api/v1/assistant/chat", json={"message": "Show my spending"}
    )
    tag_response = await client.post(
        "/api/v1/assistant/tag-suggestion",
        json={
            "description": "Food purchase",
            "amount_paise": 12000,
            "direction": "expense",
            "allowed_categories": [{"id": "food", "name": "Food"}],
        },
    )
    after = (await client.get("/api/v1/transactions")).json()

    assert status_response.status_code == 200
    assert status_response.json()["detail"] == "disabled"
    assert chat_response.status_code == 503
    assert chat_response.json() == {
        "detail": "AI is temporarily unavailable; the ledger was not changed."
    }
    assert tag_response.status_code == 503
    assert tag_response.json() == {
        "detail": (
            "AI category suggestion is temporarily unavailable; "
            "the ledger was not changed."
        )
    }
    assert before == after
