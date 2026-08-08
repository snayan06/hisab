from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from hmac import compare_digest
from os import getenv


class AiDataPolicy(StrEnum):
    SAMPLE_ONLY = "sample_only"
    PRIVATE_APPROVED = "private_approved"


@dataclass(frozen=True, slots=True)
class AiAccessPolicy:
    data_policy: AiDataPolicy
    demo_user_id: str | None

    @classmethod
    def from_env(cls) -> AiAccessPolicy:
        raw_policy = getenv("ARTHA_AI_DATA_POLICY", "sample_only").strip().casefold()
        try:
            data_policy = AiDataPolicy(raw_policy)
        except ValueError:
            data_policy = AiDataPolicy.SAMPLE_ONLY
        demo_user_id = getenv("ARTHA_DEMO_ACCOUNT_USER_ID", "").strip() or None
        return cls(data_policy=data_policy, demo_user_id=demo_user_id)

    def is_demo(self, user_id: str) -> bool:
        return self.demo_user_id is not None and compare_digest(
            self.demo_user_id, user_id
        )

    def can_send_financial_text(self, user_id: str) -> bool:
        return (
            self.data_policy is AiDataPolicy.PRIVATE_APPROVED
            or self.is_demo(user_id)
        )
