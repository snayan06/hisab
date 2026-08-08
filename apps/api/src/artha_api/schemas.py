from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import AccountKind, MerchantMatchType, SettlementDirection, TransactionKind


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def normalize_required_description(description: str) -> str:
    normalized = description.strip()
    if not normalized:
        raise ValueError("description cannot be blank")
    return normalized


class HealthResponse(ApiModel):
    status: str
    version: str


class CaptureContextAccount(ApiModel):
    id: int | str
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["bank", "cash", "wallet", "credit_card", "other"]


class CaptureContextCategory(ApiModel):
    id: int | str
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["expense", "income", "both"]


class CaptureContextResponse(ApiModel):
    accounts: list[CaptureContextAccount]
    categories: list[CaptureContextCategory]


class AccountCreate(ApiModel):
    name: str = Field(min_length=1, max_length=80)
    kind: AccountKind
    opening_balance_paise: int = 0
    credit_limit_paise: int | None = Field(default=None, ge=0)
    statement_day: int | None = Field(default=None, ge=1, le=31)
    payment_due_day: int | None = Field(default=None, ge=1, le=31)

    @model_validator(mode="after")
    def validate_account_kind(self) -> AccountCreate:
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("account name cannot be blank")
        credit_fields = (
            self.credit_limit_paise,
            self.statement_day,
            self.payment_due_day,
        )
        if self.kind is not AccountKind.CREDIT_CARD and any(
            value is not None for value in credit_fields
        ):
            raise ValueError("credit limit and statement dates are only valid for credit cards")
        if self.kind is AccountKind.CREDIT_CARD and self.opening_balance_paise > 0:
            raise ValueError("credit-card outstanding must be a negative opening balance")
        if (
            self.kind is AccountKind.CREDIT_CARD
            and self.credit_limit_paise is not None
            and abs(self.opening_balance_paise) > self.credit_limit_paise
        ):
            raise ValueError("credit-card outstanding cannot exceed the credit limit")
        return self


class AccountSetupRequest(ApiModel):
    accounts: list[AccountCreate] = Field(min_length=1, max_length=20)


class MemberCreate(ApiModel):
    name: str = Field(min_length=1, max_length=80)

    @model_validator(mode="after")
    def normalize_name(self) -> MemberCreate:
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("member name cannot be blank")
        return self


class MemberRead(MemberCreate):
    id: int
    is_archived: bool
    created_at: datetime


class OnboardingSetupRequest(ApiModel):
    accounts: list[AccountCreate] = Field(min_length=1, max_length=20)
    members: list[MemberCreate] = Field(default_factory=list, max_length=20)


class OnboardingSetupResponse(ApiModel):
    accounts: list[AccountRead]
    members: list[MemberRead]


class OpeningBalanceUpdate(ApiModel):
    opening_balance_paise: int


class AccountRead(AccountCreate):
    id: int
    current_balance_paise: int
    is_archived: bool
    created_at: datetime


class MerchantRuleCreate(ApiModel):
    match_type: MerchantMatchType = MerchantMatchType.CONTAINS
    merchant_pattern: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=1, max_length=80)
    account_id: int | None = Field(default=None, gt=0)
    priority: int = Field(default=100, ge=-10_000, le=10_000)
    active: bool = True

    @field_validator("merchant_pattern")
    @classmethod
    def normalize_pattern(cls, value: str) -> str:
        normalized = " ".join(value.casefold().split())
        if len(normalized) < 2:
            raise ValueError("merchant pattern must contain at least two characters")
        return normalized

    @field_validator("category")
    @classmethod
    def normalize_category(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("category cannot be blank")
        return normalized


class MerchantRuleLearnRequest(MerchantRuleCreate):
    pass


class MerchantRuleUpdate(ApiModel):
    match_type: MerchantMatchType | None = None
    merchant_pattern: str | None = Field(default=None, min_length=2, max_length=120)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    account_id: int | None = Field(default=None, gt=0)
    priority: int | None = Field(default=None, ge=-10_000, le=10_000)
    active: bool | None = None

    @field_validator("merchant_pattern")
    @classmethod
    def normalize_optional_pattern(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.casefold().split())
        if len(normalized) < 2:
            raise ValueError("merchant pattern must contain at least two characters")
        return normalized

    @field_validator("category")
    @classmethod
    def normalize_optional_category(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("category cannot be blank")
        return normalized


class MerchantRuleRead(MerchantRuleCreate):
    id: int
    created_at: datetime
    updated_at: datetime


class ParseRequest(ApiModel):
    text: str = Field(min_length=1, max_length=500)
    timezone: str = Field(default="Asia/Kolkata", min_length=1, max_length=64)


class CaptureChoiceResponse(ApiModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=100)
    answer: str = Field(min_length=1, max_length=160)


class CaptureUnderstoodResponse(ApiModel):
    amount_paise: int | None = Field(default=None, gt=0)
    kind: Literal["expense", "income", "transfer"] | None = None
    merchant: str | None = Field(default=None, min_length=1, max_length=160)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    occurred_on: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class CaptureClarificationResponse(ApiModel):
    outcome: Literal["clarification"] = "clarification"
    source_text: str = Field(min_length=1, max_length=500)
    understood: CaptureUnderstoodResponse
    missing_field: Literal[
        "amount_paise",
        "kind",
        "description",
        "source_account_id",
        "destination_account_id",
        "category_id",
        "member_ids",
        "occurred_on",
    ]
    question: str = Field(min_length=1, max_length=240)
    explanation: str = Field(min_length=1, max_length=240)
    choices: list[CaptureChoiceResponse] = Field(default_factory=list, max_length=20)
    warnings: list[str] = Field(default_factory=list, max_length=5)
    parser_source: str = Field(min_length=1, max_length=120)


class TransactionSplitInput(ApiModel):
    member_id: int = Field(gt=0)
    amount_paise: int = Field(gt=0)


class TransactionDraft(ApiModel):
    kind: TransactionKind
    amount_paise: int = Field(gt=0)
    description: str = Field(min_length=1, max_length=240)
    category: str | None = Field(default=None, max_length=80)
    paid_by_member_id: int | None = Field(default=None, gt=0)
    settlement_member_id: int | None = Field(default=None, gt=0)
    personal_share_paise: int = Field(ge=0)
    splits: list[TransactionSplitInput] = Field(default_factory=list, max_length=20)
    source_account_id: int | None = None
    destination_account_id: int | None = None
    settlement_direction: SettlementDirection | None = None
    occurred_at: datetime | None = None
    notes: str | None = None

    @field_validator("description")
    @classmethod
    def normalize_description(cls, description: str) -> str:
        return normalize_required_description(description)

    @model_validator(mode="after")
    def validate_ledger_shape(self) -> TransactionDraft:
        member_ids = [split.member_id for split in self.splits]
        if len(member_ids) != len(set(member_ids)):
            raise ValueError("each household member can appear only once in splits")
        if self.personal_share_paise + sum(
            split.amount_paise for split in self.splits
        ) != self.amount_paise:
            raise ValueError("personal and member splits must add up to the total amount")
        if self.kind in {TransactionKind.EXPENSE, TransactionKind.INCOME}:
            if self.source_account_id is None:
                raise ValueError("expense and income transactions require source_account_id")
            if self.destination_account_id is not None:
                raise ValueError("destination_account_id is only valid for transfers")
            if self.settlement_member_id is not None:
                raise ValueError("settlement_member_id is only valid for settlements")
            if self.kind is TransactionKind.INCOME and (
                self.splits or self.paid_by_member_id is not None
            ):
                raise ValueError("income cannot contain member splits or a member payer")
        elif self.kind is TransactionKind.TRANSFER:
            if self.source_account_id is None or self.destination_account_id is None:
                raise ValueError("transfers require source and destination accounts")
            if self.source_account_id == self.destination_account_id:
                raise ValueError("transfer accounts must be different")
            if self.personal_share_paise != self.amount_paise or self.splits:
                raise ValueError("transfers cannot be shared")
            if self.paid_by_member_id is not None or self.settlement_member_id is not None:
                raise ValueError("transfers cannot reference household members")
        elif self.kind is TransactionKind.SETTLEMENT:
            if (
                self.source_account_id is None
                or self.settlement_direction is None
                or self.settlement_member_id is None
            ):
                raise ValueError("settlements require an account, member, and direction")
            if self.personal_share_paise != self.amount_paise or self.splits:
                raise ValueError("settlements cannot be split as spending")
            if self.paid_by_member_id is not None:
                raise ValueError("paid_by_member_id is only valid for expenses")
        return self


class MemberBalanceDelta(ApiModel):
    member_id: int
    amount_paise: int


class TransactionRead(TransactionDraft):
    id: int
    occurred_at: datetime
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    account_delta_paise: int
    member_balance_deltas: list[MemberBalanceDelta]


class TransactionUpdate(ApiModel):
    amount_paise: int | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, min_length=1, max_length=240)
    category: str | None = Field(default=None, max_length=80)
    paid_by_member_id: int | None = Field(default=None, gt=0)
    settlement_member_id: int | None = Field(default=None, gt=0)
    personal_share_paise: int | None = Field(default=None, ge=0)
    splits: list[TransactionSplitInput] | None = Field(default=None, max_length=20)
    source_account_id: int | None = None
    destination_account_id: int | None = None
    settlement_direction: SettlementDirection | None = None
    occurred_at: datetime | None = None
    notes: str | None = None


class ParseResponse(ApiModel):
    draft: TransactionDraft
    confidence: float = Field(ge=0, le=1)
    warnings: list[str]
    category_source: Literal["merchant_rule", "heuristic"] | None = None
    matched_merchant_rule_id: int | None = None


class BootstrapResponse(ApiModel):
    created: bool
    accounts: list[AccountRead]
    transactions: list[TransactionRead]
    members: list[MemberRead]


class DashboardCategory(ApiModel):
    category: str
    amount_paise: int


class DashboardMonth(ApiModel):
    month: str
    income_paise: int
    spend_paise: int


class DashboardResponse(ApiModel):
    total_balance_paise: int
    spend_paise: int
    income_paise: int
    net_cashflow_paise: int
    member_balances: list[MemberBalance]
    accounts: list[AccountRead]
    spend_by_category: list[DashboardCategory]
    monthly: list[DashboardMonth]
    recent_transactions: list[TransactionRead]


class MemberBalance(ApiModel):
    member_id: int
    member_name: str
    balance_paise: int
    status: str


class SharedBalancesResponse(ApiModel):
    balances: list[MemberBalance]


class DeleteResponse(ApiModel):
    id: int
    deleted: bool
