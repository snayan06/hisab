from __future__ import annotations

import pytest

from artha_api.ai_policy import AiAccessPolicy, AiDataPolicy

DEMO_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PERSONAL_USER_ID = "22222222-2222-4222-8222-222222222222"


def test_sample_only_allows_only_configured_demo_uuid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ARTHA_AI_DATA_POLICY", "sample_only")
    monkeypatch.setenv("ARTHA_DEMO_ACCOUNT_USER_ID", DEMO_USER_ID)

    policy = AiAccessPolicy.from_env()

    assert policy.is_demo(DEMO_USER_ID) is True
    assert policy.can_send_financial_text(DEMO_USER_ID) is True
    assert policy.is_demo(PERSONAL_USER_ID) is False
    assert policy.can_send_financial_text(PERSONAL_USER_ID) is False


def test_private_approved_allows_authenticated_users(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ARTHA_AI_DATA_POLICY", "private_approved")
    monkeypatch.delenv("ARTHA_DEMO_ACCOUNT_USER_ID", raising=False)

    policy = AiAccessPolicy.from_env()

    assert policy.is_demo(PERSONAL_USER_ID) is False
    assert policy.can_send_financial_text(PERSONAL_USER_ID) is True


@pytest.mark.parametrize("raw_policy", ["", "unknown", "PRIVATE", "free"])
def test_invalid_policy_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    raw_policy: str,
) -> None:
    monkeypatch.setenv("ARTHA_AI_DATA_POLICY", raw_policy)
    monkeypatch.setenv("ARTHA_DEMO_ACCOUNT_USER_ID", "")

    policy = AiAccessPolicy.from_env()

    assert policy.data_policy is AiDataPolicy.SAMPLE_ONLY
    assert policy.demo_user_id is None
    assert policy.can_send_financial_text(PERSONAL_USER_ID) is False


def test_demo_uuid_comparison_is_exact(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARTHA_AI_DATA_POLICY", "sample_only")
    monkeypatch.setenv("ARTHA_DEMO_ACCOUNT_USER_ID", DEMO_USER_ID.upper())

    policy = AiAccessPolicy.from_env()

    assert policy.is_demo(DEMO_USER_ID) is False
    assert policy.is_demo(DEMO_USER_ID.upper()) is True
