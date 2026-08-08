from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime
from typing import Annotated, Any, Literal, cast
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .ai_policy import AiAccessPolicy
from .assistant import (
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantFinancialContext,
    AssistantStatus,
    AssistantUnavailableError,
    CaptureAccount,
    CaptureCategory,
    CaptureClarification,
    CaptureContext,
    CaptureDraftInterpretation,
    CaptureMember,
    CaptureRejection,
    ContextCategory,
    ContextMemberBalance,
    ContextMonth,
    ContextTransaction,
    LocalFinancialAssistant,
    TagCategory,
    TagSuggestionRequest,
    TagSuggestionResponse,
)
from .auth import AuthContext, AuthDependency
from .recovery import RecoveryBundle
from .schemas import (
    AccountCreate,
    CaptureChoiceResponse,
    CaptureClarificationResponse,
    CaptureContextAccount,
    CaptureContextCategory,
    CaptureContextResponse,
    CaptureUnderstoodResponse,
    MemberCreate,
    ParseRequest,
    normalize_required_description,
)
from .supabase_rest import SupabaseRestClient, rest_client_for_request
from .transaction_metadata import (
    SAFE_TAG_PHRASES,
    ReviewedMetadata,
    SuggestedTag,
    normalize_key,
    normalize_label,
    suggest_transaction_metadata,
)

router = APIRouter()


async def production_client(
    request: Request,
    auth: AuthDependency,
) -> SupabaseRestClient:
    return rest_client_for_request(request, auth)


ClientDependency = Annotated[SupabaseRestClient, Depends(production_client)]


CAPTURE_MISSING_PRIORITY = (
    "amount_paise",
    "kind",
    "description",
    "source_account_id",
    "destination_account_id",
    "category_id",
    "member_ids",
    "occurred_on",
)


def capture_clarification_response(
    result: CaptureClarification,
    *,
    source_text: str,
    accounts: list[dict[str, Any]],
    parser_source: str,
) -> dict[str, Any]:
    missing_field = next(
        field for field in CAPTURE_MISSING_PRIORITY if field in result.missing
    )
    merchant = result.description
    choices: list[CaptureChoiceResponse] = []
    if missing_field in {"source_account_id", "destination_account_id"}:
        for account in accounts:
            account_id = str(account["id"])
            if (
                missing_field == "destination_account_id"
                and result.source_account_id == account_id
            ):
                continue
            label = safe_label(account["name"], "Account")
            if missing_field == "destination_account_id":
                answer = f"transferred to {label}"
            elif result.kind == "income":
                answer = f"received in {label}"
            elif result.kind == "transfer":
                answer = f"transferred from {label}"
            else:
                answer = f"paid from {label}"
            choices.append(CaptureChoiceResponse(id=account_id, label=label, answer=answer))

    if missing_field == "source_account_id":
        if result.kind == "income":
            question = "Which account received this money?"
        elif result.kind == "transfer":
            question = "Which account did the money move from?"
        else:
            question = f"How did you pay for {merchant}?" if merchant else "How did you pay?"
        explanation = (
            "Choose one so Artha updates the correct balance. Nothing has been saved."
        )
    elif missing_field == "destination_account_id":
        question = "Which account did the money move to?"
        explanation = (
            "Choose the receiving account so both balances stay correct. "
            "Nothing has been saved."
        )
    elif missing_field == "amount_paise":
        question = "How much was this transaction?"
        explanation = "Add the amount to continue. Nothing has been saved."
    elif missing_field == "kind":
        question = "Was this money spent, received, or transferred?"
        explanation = (
            "Open the form below and choose the movement type. Nothing has been saved."
        )
    elif missing_field == "description":
        question = "What was this transaction for?"
        explanation = "Add a short description to continue. Nothing has been saved."
    elif missing_field == "occurred_on":
        question = "When did this happen?"
        explanation = "Open the form below and enter the date. Nothing has been saved."
    elif missing_field == "category_id":
        question = "Which category fits this transaction?"
        explanation = "Open the form below and choose a category. Nothing has been saved."
    else:
        question = "Who was this shared with?"
        explanation = "Open the form below and select the people involved. Nothing has been saved."

    response = CaptureClarificationResponse(
        source_text=source_text,
        understood=CaptureUnderstoodResponse(
            amount_paise=result.amount_paise,
            kind=result.kind,
            merchant=merchant,
            category=result.category_name,
            occurred_on=result.occurred_on,
        ),
        missing_field=cast(Any, missing_field),
        question=question,
        explanation=explanation,
        choices=choices,
        warnings=result.warnings,
        parser_source=parser_source,
    )
    return response.model_dump(mode="json", exclude_none=True)


def require_ai_access(auth: AuthContext) -> AiAccessPolicy:
    policy = AiAccessPolicy.from_env()
    if not policy.can_send_financial_text(auth.user_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "AI features are not enabled for personal financial data in this "
            "deployment; use manual entry.",
        )
    return policy


class ProductionOnboardingRequest(BaseModel):
    display_name: str = Field(default="You", min_length=1, max_length=100)
    household_name: str = Field(default="My household", min_length=1, max_length=100)
    accounts: list[AccountCreate] = Field(min_length=1, max_length=20)
    members: list[MemberCreate] = Field(default_factory=list, max_length=20)


class ProductionSplit(BaseModel):
    member_id: UUID
    amount_paise: int = Field(gt=0)


class ProductionTagSuggestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    description: str = Field(min_length=1, max_length=160)
    amount_paise: int = Field(gt=0)
    direction: Literal["expense", "income"]

    @field_validator("description")
    @classmethod
    def normalize_description(cls, description: str) -> str:
        normalized = " ".join(description.split())
        if not normalized:
            raise ValueError("description cannot be blank")
        return normalized


class ProductionDraft(BaseModel):
    kind: Literal["expense", "income", "transfer"]
    amount_paise: int = Field(gt=0)
    description: str = Field(min_length=1, max_length=240)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    paid_by_member_id: UUID | None = None
    personal_share_paise: int = Field(ge=0)
    splits: list[ProductionSplit] = Field(default_factory=list, max_length=20)
    source_account_id: UUID
    destination_account_id: UUID | None = None
    occurred_at: datetime | None = None
    notes: str | None = Field(default=None, max_length=1000)
    platform: str | None = Field(default=None, min_length=1, max_length=100)
    subcategory: str | None = Field(default=None, min_length=1, max_length=80)
    metadata: ReviewedMetadata | None = None
    tags: list[SuggestedTag] = Field(default_factory=list, max_length=8)

    @field_validator("description")
    @classmethod
    def normalize_description(cls, description: str) -> str:
        return normalize_required_description(description)

    @field_validator("platform", "subcategory")
    @classmethod
    def normalize_optional_metadata_label(cls, value: str | None, info: Any) -> str | None:
        if value is None:
            return None
        normalized = normalize_label(value)
        if not normalized:
            raise ValueError(f"{info.field_name} cannot be blank")
        return normalized

    @model_validator(mode="after")
    def split_total_matches(self) -> ProductionDraft:
        if self.personal_share_paise + sum(item.amount_paise for item in self.splits) != (
            self.amount_paise
        ):
            raise ValueError("personal and member splits must add up to the total")
        if self.kind == "income" and self.splits:
            raise ValueError("income cannot contain household splits")
        if self.kind == "transfer":
            if self.destination_account_id is None:
                raise ValueError("transfer requires a destination account")
            if self.destination_account_id == self.source_account_id:
                raise ValueError("transfer accounts must be different")
            if self.splits or self.paid_by_member_id is not None:
                raise ValueError("transfer cannot contain household splits")
            if self.platform or self.subcategory or self.metadata or self.tags:
                raise ValueError("transfer cannot contain metadata or tags")
        elif self.destination_account_id is not None:
            raise ValueError("destination account is only valid for a transfer")
        if self.kind == "income" and (
            self.platform or self.subcategory or self.metadata or self.tags
        ):
            raise ValueError("income cannot contain expense metadata or tags")
        if self.kind != "transfer" and self.category is None:
            raise ValueError("expense and income require a category")
        if self.metadata is None and (self.platform or self.subcategory or self.tags):
            raise ValueError("structured fields require metadata")
        review_statuses = [
            *(item.review_status for item in (self.metadata.attributes if self.metadata else [])),
            *(
                item.review_status
                for item in (self.metadata.evidence.values() if self.metadata else [])
            ),
            *(item.review_status for item in self.tags),
        ]
        if any(review_status != "reviewed" for review_status in review_statuses):
            raise ValueError("metadata must be reviewed before confirmation")
        provenance_sources = [
            *(item.source for item in (self.metadata.evidence.values() if self.metadata else [])),
            *(item.source for item in (self.metadata.attributes if self.metadata else [])),
            *(item.source for item in self.tags),
        ]
        if any(source != "user_corrected" for source in provenance_sources):
            raise ValueError(
                "reviewed metadata provenance must be user-corrected at confirmation"
            )
        if self.metadata is not None:
            if "platform" in self.metadata.evidence and self.platform is None:
                raise ValueError("platform evidence requires a platform")
            if "subcategory" in self.metadata.evidence and self.subcategory is None:
                raise ValueError("subcategory evidence requires a subcategory")
        tag_names = [tag.normalized_name for tag in self.tags]
        if len(tag_names) != len(set(tag_names)):
            raise ValueError("transaction tags must be unique")
        allowed_tag_names = {normalize_key(name) for name in SAFE_TAG_PHRASES}
        if any(tag.normalized_name not in allowed_tag_names for tag in self.tags):
            raise ValueError("transaction tag is not in the server allow-list")
        reserved = {
            normalize_key(value)
            for value in (
                self.description,
                self.category or "",
                self.platform or "",
                self.subcategory or "",
            )
            if value
        }
        if any(tag.normalized_name in reserved for tag in self.tags):
            raise ValueError("tag duplicates a transaction field")
        return self


async def current_household(client: SupabaseRestClient, *, required: bool = True) -> str | None:
    household_id = await client.rpc("get_current_household")
    if household_id is None and required:
        raise HTTPException(status.HTTP_409_CONFLICT, "complete household onboarding first")
    return str(household_id) if household_id is not None else None


async def member_rows(client: SupabaseRestClient, household_id: str) -> list[dict[str, Any]]:
    rows = await client.request(
        "GET",
        "household_members",
        params={
            "household_id": f"eq.{household_id}",
            "is_active": "eq.true",
            "select": "id,profile_id,display_name,member_type,role,is_active,created_at",
            "order": "created_at.asc,id.asc",
        },
    )
    return list(rows or [])


async def owner_member(
    client: SupabaseRestClient,
    household_id: str,
    user_id: str,
) -> dict[str, Any]:
    rows = await member_rows(client, household_id)
    owner = next(
        (
            row
            for row in rows
            if row.get("profile_id") == user_id and row.get("role") == "owner"
        ),
        None,
    )
    if owner is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "active household owner was not found")
    return owner


async def account_rows(client: SupabaseRestClient, household_id: str) -> list[dict[str, Any]]:
    accounts = await client.request(
        "GET",
        "accounts",
        params={
            "household_id": f"eq.{household_id}",
            "is_archived": "eq.false",
            "select": (
                "id,name,account_type,currency,opening_balance_paise,"
                "credit_limit_paise,statement_day,payment_due_day,is_archived,created_at"
            ),
            "order": "created_at.asc,id.asc",
        },
    )
    balances = await client.rpc("get_account_balances", {"p_household_id": household_id})
    balance_by_id = {str(row["account_id"]): int(row["balance_paise"]) for row in balances}
    return [
        {
            **row,
            "kind": row["account_type"],
            "current_balance_paise": balance_by_id.get(
                str(row["id"]), int(row["opening_balance_paise"])
            ),
        }
        for row in accounts
    ]


def public_member(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["display_name"],
        "is_archived": not bool(row["is_active"]),
        "created_at": row["created_at"],
    }


@router.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "version": "v1-production"}


@router.get("/api/v1/accounts", tags=["accounts"])
async def list_accounts(client: ClientDependency) -> list[dict[str, Any]]:
    household_id = await current_household(client)
    assert household_id is not None
    return await account_rows(client, household_id)


@router.get(
    "/api/v1/capture-context",
    response_model=CaptureContextResponse,
    tags=["transactions"],
)
async def capture_context(
    client: ClientDependency,
    auth: AuthDependency,
) -> CaptureContextResponse:
    household_id = await current_household(client)
    assert household_id is not None
    await owner_member(client, household_id, auth.user_id)
    accounts = await account_rows(client, household_id)
    categories = sorted(
        (await categories_by_id(client, household_id)).values(),
        key=lambda category: (str(category["name"]).casefold(), str(category["id"])),
    )
    return CaptureContextResponse(
        accounts=[
            CaptureContextAccount(
                id=str(account["id"]),
                name=str(account["name"]),
                kind=cast(
                    Literal["bank", "cash", "wallet", "credit_card", "other"],
                    str(account["kind"]),
                ),
            )
            for account in accounts
        ],
        categories=[
            CaptureContextCategory(
                id=str(category["id"]),
                name=str(category["name"]),
                kind=cast(
                    Literal["expense", "income", "both"],
                    str(category["category_type"]),
                ),
            )
            for category in categories
            if category.get("category_type") in {"expense", "income", "both"}
        ],
    )


@router.get("/api/v1/members", tags=["members"])
async def list_members(client: ClientDependency) -> list[dict[str, Any]]:
    household_id = await current_household(client)
    assert household_id is not None
    return [public_member(row) for row in await member_rows(client, household_id)]


@router.get("/api/v1/profile", tags=["profile"])
async def profile(
    client: ClientDependency,
    auth: AuthDependency,
) -> dict[str, Any]:
    household_id = await current_household(client)
    assert household_id is not None
    owner = await owner_member(client, household_id, auth.user_id)
    households = await client.request(
        "GET",
        "households",
        params={
            "id": f"eq.{household_id}",
            "select": "id,name",
            "limit": "1",
        },
    )
    if not households:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "household was not found")
    members = await member_rows(client, household_id)
    return {
        "display_name": owner["display_name"],
        "household_name": households[0]["name"],
        "is_demo": AiAccessPolicy.from_env().is_demo(auth.user_id),
        "members": [
            public_member(member)
            for member in members
            if str(member["id"]) != str(owner["id"])
        ],
    }


@router.post(
    "/api/v1/onboarding/setup",
    status_code=status.HTTP_201_CREATED,
    tags=["onboarding"],
)
async def setup_onboarding(
    payload: ProductionOnboardingRequest,
    client: ClientDependency,
) -> dict[str, Any]:
    await client.rpc(
        "setup_household",
        {
            "p_display_name": payload.display_name.strip(),
            "p_household_name": payload.household_name.strip(),
            "p_members": [{"name": member.name} for member in payload.members],
            "p_accounts": [
                {
                    "name": account.name,
                    "account_type": account.kind.value,
                    "currency": "INR",
                    "opening_balance_paise": account.opening_balance_paise,
                    "credit_limit_paise": account.credit_limit_paise,
                    "statement_day": account.statement_day,
                    "payment_due_day": account.payment_due_day,
                }
                for account in payload.accounts
            ],
        },
    )
    household_id = await current_household(client)
    assert household_id is not None
    return {
        "accounts": await account_rows(client, household_id),
        "members": [public_member(row) for row in await member_rows(client, household_id)],
    }


async def categories_by_id(
    client: SupabaseRestClient, household_id: str
) -> dict[str, dict[str, Any]]:
    rows = await client.request(
        "GET",
        "categories",
        params={
            "household_id": f"eq.{household_id}",
            "is_archived": "eq.false",
            "select": "id,name,category_type,is_archived",
            "order": "name.asc,id.asc",
        },
    )
    return {str(row["id"]): row for row in rows}


async def merchant_rule_rows(
    client: SupabaseRestClient, household_id: str
) -> list[dict[str, Any]]:
    rows = await client.request(
        "GET",
        "merchant_rules",
        params={
            "household_id": f"eq.{household_id}",
            "is_active": "eq.true",
            "select": (
                "id,match_type,merchant_pattern,category_id,account_id,"
                "priority,is_active"
            ),
            "order": "priority.desc,id.asc",
        },
    )
    return list(rows or [])


def normalize_category_name(value: str) -> str:
    return " ".join(value.split()).casefold()


async def grounded_category(
    client: SupabaseRestClient,
    household_id: str,
    name: str,
    direction: Literal["expense", "income"],
) -> dict[str, Any]:
    normalized = normalize_category_name(name)
    category = next(
        (
            row
            for row in (await categories_by_id(client, household_id)).values()
            if row.get("is_archived") is not True
            and row.get("category_type") in {direction, "both"}
            and normalize_category_name(str(row.get("name", ""))) == normalized
        ),
        None,
    )
    if category is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "category is not available for this transaction type",
        )
    return category


async def transaction_rows(
    client: SupabaseRestClient,
    household_id: str,
    *,
    limit: int = 200,
    offset: int = 0,
) -> list[dict[str, Any]]:
    rows = await client.request(
        "GET",
        "transactions",
        params={
            "household_id": f"eq.{household_id}",
            "status": "eq.posted",
            "select": (
                "id,account_id,category_id,paid_by_member_id,direction,amount_paise,"
                "currency,occurred_at,merchant,note,status,created_at,"
                "transaction_splits(member_id,amount_paise)"
            ),
            "order": "occurred_at.desc,id.desc",
            "limit": str(limit),
            "offset": str(offset),
        },
    )
    return list(rows or [])


async def ledger_activity_rows(
    client: SupabaseRestClient,
    household_id: str,
    *,
    limit: int,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Page already-collapsed logical activity inside Postgres.

    Transfers use two transaction rows. The database RPC joins each pair before
    applying limit/offset, so a page boundary can never hide half of a transfer.
    """
    rows = await client.rpc(
        "list_ledger_activity",
        {
            "p_household_id": household_id,
            "p_limit": limit,
            "p_offset": offset,
        },
    )
    return list(rows or [])


def transaction_view(
    row: dict[str, Any],
    owner_id: str,
    categories: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    all_splits = list(row.get("transaction_splits") or [])
    personal_share = next(
        (
            int(split["amount_paise"])
            for split in all_splits
            if str(split["member_id"]) == owner_id
        ),
        0,
    )
    shared_splits = [split for split in all_splits if str(split["member_id"]) != owner_id]
    category = categories.get(str(row.get("category_id")), {}).get("name")
    direction = str(row["direction"])
    return {
        "id": row["id"],
        "kind": "income" if direction == "income" else "expense",
        "amount_paise": int(row["amount_paise"]),
        "personal_share_paise": personal_share,
        "description": row.get("merchant") or ("Income" if direction == "income" else "Expense"),
        "category": category,
        "paid_by_member_id": row.get("paid_by_member_id"),
        "source_account_id": row["account_id"],
        "destination_account_id": None,
        "settlement_member_id": None,
        "settlement_direction": None,
        "occurred_at": row["occurred_at"],
        "notes": row.get("note"),
        "splits": shared_splits,
        "is_deleted": False,
        "created_at": row["created_at"],
        "updated_at": row["created_at"],
        "account_delta_paise": int(row["amount_paise"]) * (1 if direction == "income" else -1),
        "member_balance_deltas": [
            {"member_id": split["member_id"], "amount_paise": int(split["amount_paise"])}
            for split in shared_splits
        ],
    }


@router.get("/api/v1/transactions", tags=["transactions"])
async def list_transactions(
    client: ClientDependency,
    auth: AuthDependency,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0, le=2000)] = 0,
) -> list[dict[str, Any]]:
    household_id = await current_household(client)
    assert household_id is not None
    await owner_member(client, household_id, auth.user_id)
    return await ledger_activity_rows(
        client,
        household_id,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/api/v1/transactions/confirm",
    status_code=status.HTTP_201_CREATED,
    tags=["transactions"],
)
async def confirm_transaction(
    payload: ProductionDraft,
    client: ClientDependency,
    auth: AuthDependency,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> dict[str, Any]:
    household_id = await current_household(client)
    assert household_id is not None
    owner = await owner_member(client, household_id, auth.user_id)
    owner_id = str(owner["id"])
    occurred_at = payload.occurred_at or datetime.now(UTC)
    if payload.kind == "transfer":
        transfer_result = await client.rpc(
            "create_transfer",
            {
                "p_household_id": household_id,
                "p_from_account_id": str(payload.source_account_id),
                "p_to_account_id": str(payload.destination_account_id),
                "p_amount_paise": payload.amount_paise,
                "p_currency": "INR",
                "p_occurred_at": occurred_at.isoformat(),
                "p_idempotency_key": idempotency_key,
                "p_note": payload.notes or payload.description,
            },
        )
        transfer_row = transfer_result[0] if isinstance(transfer_result, list) else transfer_result
        return {
            "id": transfer_row["transfer_link_id"],
            "kind": "transfer",
            "amount_paise": payload.amount_paise,
            "personal_share_paise": payload.amount_paise,
            "description": payload.description,
            "category": "Transfer",
            "paid_by_member_id": None,
            "source_account_id": str(payload.source_account_id),
            "destination_account_id": str(payload.destination_account_id),
            "occurred_at": occurred_at.isoformat(),
            "notes": payload.notes,
            "splits": [],
            "is_deleted": False,
        }
    assert payload.category is not None
    category = await grounded_category(
        client,
        household_id,
        payload.category,
        payload.kind,
    )
    paid_by_member_id = str(payload.paid_by_member_id or owner_id)
    splits = [split.model_dump(mode="json") for split in payload.splits]
    if payload.personal_share_paise:
        splits.append({"member_id": owner_id, "amount_paise": payload.personal_share_paise})
    result = await client.rpc(
        "confirm_transaction",
        {
            "p_household_id": household_id,
            "p_account_id": str(payload.source_account_id),
            "p_category_id": str(category["id"]),
            "p_paid_by_member_id": paid_by_member_id,
            "p_direction": payload.kind,
            "p_amount_paise": payload.amount_paise,
            "p_currency": "INR",
            "p_occurred_at": occurred_at.isoformat(),
            "p_splits": splits,
            "p_idempotency_key": idempotency_key,
            "p_merchant": payload.description,
            "p_note": payload.notes,
            "p_metadata": {
                "source": "artha-api",
                **(
                    {
                        "version": 1,
                        "platform": payload.platform,
                        "subcategory": payload.subcategory,
                        "evidence": payload.metadata.model_dump(mode="json")[
                            "evidence"
                        ],
                        "attributes": payload.metadata.model_dump(mode="json")[
                            "attributes"
                        ],
                        "tags": [tag.model_dump(mode="json") for tag in payload.tags],
                    }
                    if payload.metadata is not None
                    else {}
                ),
            },
        },
    )
    result["transaction_splits"] = splits
    result["created_at"] = result.get("created_at") or datetime.now(UTC).isoformat()
    return transaction_view(result, owner_id, {str(category["id"]): category})


def member_balances(
    rows: list[dict[str, Any]], members: list[dict[str, Any]], owner_id: str
) -> list[dict[str, Any]]:
    balances: dict[str, int] = defaultdict(int)
    for row in rows:
        if row["direction"] != "expense":
            continue
        paid_by = str(row.get("paid_by_member_id"))
        splits = list(row.get("transaction_splits") or [])
        if paid_by == owner_id:
            for split in splits:
                member_id = str(split["member_id"])
                if member_id != owner_id:
                    balances[member_id] += int(split["amount_paise"])
        else:
            owner_share = next(
                (
                    int(split["amount_paise"])
                    for split in splits
                    if str(split["member_id"]) == owner_id
                ),
                0,
            )
            balances[paid_by] -= owner_share
    return [
        {
            "member_id": member["id"],
            "member_name": member["display_name"],
            "balance_paise": balances[str(member["id"])],
            "status": "owes you" if balances[str(member["id"])] > 0 else "you owe",
        }
        for member in members
        if str(member["id"]) != owner_id and balances[str(member["id"])] != 0
    ]


@router.get("/api/v1/dashboard", tags=["dashboard"])
async def dashboard(client: ClientDependency, auth: AuthDependency) -> dict[str, Any]:
    household_id = await current_household(client)
    assert household_id is not None
    owner = await owner_member(client, household_id, auth.user_id)
    owner_id = str(owner["id"])
    members = await member_rows(client, household_id)
    accounts = await account_rows(client, household_id)
    rows = await transaction_rows(client, household_id, limit=1000)
    views = await ledger_activity_rows(client, household_id, limit=1000)
    now = datetime.now(UTC)
    month_key = now.strftime("%Y-%m")
    current = [view for view in views if str(view["occurred_at"]).startswith(month_key)]
    category_totals: dict[str, int] = defaultdict(int)
    for view in current:
        if view["kind"] == "expense":
            category_totals[str(view["category"] or "Uncategorized")] += int(
                view["personal_share_paise"]
            )
    monthly: list[dict[str, Any]] = []
    for months_back in range(5, -1, -1):
        absolute = now.year * 12 + now.month - 1 - months_back
        year, month_index = divmod(absolute, 12)
        key = f"{year:04d}-{month_index + 1:02d}"
        matching = [view for view in views if str(view["occurred_at"]).startswith(key)]
        monthly.append(
            {
                "month": datetime(year, month_index + 1, 1, tzinfo=UTC).strftime("%b"),
                "income_paise": sum(
                    int(view["personal_share_paise"])
                    for view in matching
                    if view["kind"] == "income"
                ),
                "spend_paise": sum(
                    int(view["personal_share_paise"])
                    for view in matching
                    if view["kind"] == "expense"
                ),
            }
        )
    return {
        "total_balance_paise": sum(int(account["current_balance_paise"]) for account in accounts),
        "spend_paise": sum(category_totals.values()),
        "income_paise": sum(
            int(view["personal_share_paise"])
            for view in current
            if view["kind"] == "income"
        ),
        "net_cashflow_paise": sum(
            int(view["amount_paise"])
            * (1 if view["kind"] == "income" else -1 if view["kind"] == "expense" else 0)
            for view in views
        ),
        "member_balances": member_balances(rows, members, owner_id),
        "accounts": accounts,
        "spend_by_category": [
            {"category": name, "amount_paise": amount}
            for name, amount in sorted(
                category_totals.items(), key=lambda item: (-item[1], item[0])
            )
        ],
        "monthly": monthly,
        "recent_transactions": views[:10],
    }


@router.get("/api/v1/recovery/export", tags=["recovery"])
async def export_recovery_bundle(
    client: ClientDependency,
    auth: AuthDependency,
) -> dict[str, Any]:
    household_id = await current_household(client)
    assert household_id is not None
    await owner_member(client, household_id, auth.user_id)
    raw = await client.rpc("export_household_bundle")
    bundle = RecoveryBundle.model_validate(raw)
    return bundle.model_dump(mode="json")


@router.post("/api/v1/recovery/preview", tags=["recovery"])
async def preview_recovery_bundle(
    bundle: RecoveryBundle,
    client: ClientDependency,
) -> dict[str, Any]:
    existing_household_id = await current_household(client, required=False)
    return {
        **bundle.summary(),
        "household_name": bundle.household.name,
        "eligible": existing_household_id is None,
        "blocker": (
            None
            if existing_household_id is None
            else "Restore requires a new account with no existing household."
        ),
    }


@router.post(
    "/api/v1/recovery/restore",
    status_code=status.HTTP_201_CREATED,
    tags=["recovery"],
)
async def restore_recovery_bundle(
    bundle: RecoveryBundle,
    client: ClientDependency,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=8, max_length=128),
    ],
) -> dict[str, Any]:
    result = await client.rpc(
        "restore_household_bundle",
        {
            "p_bundle": bundle.model_dump(mode="json"),
            "p_idempotency_key": idempotency_key,
        },
    )
    return {**dict(result), "sha256": bundle.summary()["sha256"]}


@router.post("/api/v1/drafts/parse", tags=["transactions"])
async def parse_draft(
    payload: ParseRequest,
    client: ClientDependency,
    auth: AuthDependency,
) -> dict[str, Any]:
    require_ai_access(auth)
    household_id = await current_household(client)
    assert household_id is not None
    accounts = await account_rows(client, household_id)
    members = await member_rows(client, household_id)
    owner = await owner_member(client, household_id, auth.user_id)
    categories = list((await categories_by_id(client, household_id)).values())
    try:
        today = datetime.now(ZoneInfo(payload.timezone)).date().isoformat()
    except ZoneInfoNotFoundError as error:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "timezone must be a valid IANA timezone",
        ) from error
    context = CaptureContext(
        today=today,
        timezone=payload.timezone,
        accounts=[
            CaptureAccount(
                id=str(account["id"]),
                name=str(account["name"]),
                kind=cast(
                    Literal["bank", "cash", "wallet", "credit_card", "other"],
                    str(account["account_type"]),
                ),
            )
            for account in accounts
        ],
        members=[
            CaptureMember(id=str(member["id"]), name=str(member["display_name"]))
            for member in members
            if str(member["id"]) != str(owner["id"])
        ],
        categories=[
            CaptureCategory(
                id=str(category["id"]),
                name=str(category["name"]),
                kind=cast(
                    Literal["expense", "income", "both"],
                    str(category["category_type"]),
                ),
            )
            for category in categories
            if category["category_type"] in {"expense", "income", "both"}
        ],
    )
    interpreted = await LocalFinancialAssistant().interpret_capture(payload.text, context)
    if interpreted is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Automatic interpretation is temporarily unavailable; "
            "review the details manually.",
        )
    result = interpreted.result
    if isinstance(result, CaptureClarification):
        return capture_clarification_response(
            result,
            source_text=payload.text,
            accounts=accounts,
            parser_source=f"{interpreted.provider}:{interpreted.model}",
        )
    if isinstance(result, CaptureRejection):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, result.reason)
    assert isinstance(result, CaptureDraftInterpretation)
    if result.occurred_on is not None:
        try:
            occurred_at = datetime.combine(
                date.fromisoformat(result.occurred_on),
                datetime.min.time(),
                tzinfo=UTC,
            )
        except ValueError as error:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "interpreted date is invalid",
            ) from error
    else:
        occurred_at = None
    selected_members = list(result.member_ids) if result.kind == "expense" else []
    if selected_members and result.split_equally:
        base_share, remainder = divmod(result.amount_paise, len(selected_members) + 1)
        personal_share = base_share + (1 if remainder else 0)
        remaining_remainder = max(0, remainder - 1)
        splits = [
            {
                "member_id": member_id,
                "amount_paise": base_share + (1 if index < remaining_remainder else 0),
            }
            for index, member_id in enumerate(selected_members)
        ]
    else:
        personal_share = result.amount_paise
        splits = []
    account_names = {str(account["id"]): str(account["name"]) for account in accounts}
    category_name = result.category_name
    platform: str | None = None
    subcategory: str | None = None
    category_suggestion: dict[str, Any] | None = None
    metadata: dict[str, Any] = {"version": 1, "evidence": {}, "attributes": []}
    tag_suggestions: list[dict[str, Any]] = []
    if result.kind == "expense":
        suggestion = suggest_transaction_metadata(
            source_text=payload.text,
            merchant=result.description,
            platform=result.platform,
            model_category_id=result.category_id,
            model_category_name=result.category_name,
            model_subcategory=result.subcategory,
            model_attributes=result.attributes,
            model_tags=result.tags,
            categories=categories,
            merchant_rules=await merchant_rule_rows(client, household_id),
        )
        category_name = suggestion.category_name
        platform = suggestion.platform
        subcategory = suggestion.subcategory
        evidence_by_field = {
            evidence.field: {
                "source": evidence.source,
                "confidence": evidence.confidence,
                "review_status": "needs_review",
            }
            for evidence in result.field_evidence
        }
        metadata["evidence"] = {
            "merchant": evidence_by_field.get(
                "merchant",
                {
                    "source": "model_suggested",
                    "confidence": result.confidence,
                    "review_status": "needs_review",
                },
            ),
        }
        if platform:
            metadata["evidence"]["platform"] = evidence_by_field.get(
                "platform",
                {
                    "source": "model_suggested",
                    "confidence": result.confidence,
                    "review_status": "needs_review",
                },
            )
        if suggestion.category_source is not None:
            category_evidence = {
                "source": suggestion.category_source,
                "confidence": suggestion.category_confidence,
                "review_status": "needs_review",
            }
            metadata["evidence"]["category"] = category_evidence
            category_suggestion = {
                "source": suggestion.category_source,
                "confidence": suggestion.category_confidence,
                "reason": suggestion.category_reason,
            }
        if subcategory:
            metadata["evidence"]["subcategory"] = evidence_by_field.get(
                "subcategory",
                {
                    "source": "safe_catalog",
                    "confidence": 1.0,
                    "review_status": "needs_review",
                },
            )
        metadata["attributes"] = [
            attribute.model_dump(mode="json") for attribute in suggestion.attributes
        ]
        tag_suggestions = [
            tag.model_dump(mode="json") for tag in suggestion.tags
        ]
    return {
        "outcome": "draft",
        "draft": {
            "kind": result.kind,
            "amount_paise": result.amount_paise,
            "description": result.description,
            "category": category_name
            or ("Transfer" if result.kind == "transfer" else "Other"),
            "subcategory": subcategory,
            "platform": platform,
            "category_suggestion": category_suggestion,
            "metadata": metadata,
            "tag_suggestions": tag_suggestions,
            "paid_by_member_id": None,
            "personal_share_paise": personal_share,
            "splits": splits,
            "source_account_id": result.source_account_id,
            "account_name": account_names[result.source_account_id],
            "destination_account_id": result.destination_account_id,
            "destination_account_name": account_names.get(result.destination_account_id or ""),
            "occurred_at": occurred_at.isoformat() if occurred_at else None,
            "notes": None,
        },
        "confidence": result.confidence,
        "warnings": result.warnings,
        "parser_source": f"{interpreted.provider}:{interpreted.model}",
    }


def safe_label(value: Any, fallback: str = "Uncategorized") -> str:
    printable = "".join(character for character in str(value or "") if character.isprintable())
    return printable.strip()[:40] or fallback


@router.get("/api/v1/assistant/status", response_model=AssistantStatus, tags=["assistant"])
async def assistant_status(auth: AuthDependency) -> AssistantStatus:
    status_response = await LocalFinancialAssistant().status()
    policy = AiAccessPolicy.from_env()
    return status_response.model_copy(
        update={
            "data_policy": policy.data_policy.value,
            "personal_data_enabled": policy.data_policy.value == "private_approved",
            "is_demo": policy.is_demo(auth.user_id),
        }
    )


@router.post(
    "/api/v1/assistant/chat",
    response_model=AssistantChatResponse,
    tags=["assistant"],
)
async def assistant_chat(
    payload: AssistantChatRequest,
    client: ClientDependency,
    auth: AuthDependency,
) -> AssistantChatResponse:
    require_ai_access(auth)
    summary = await dashboard(client, auth)
    context = AssistantFinancialContext(
        total_balance_paise=int(summary["total_balance_paise"]),
        current_month_spend_paise=int(summary["spend_paise"]),
        current_month_income_paise=int(summary["income_paise"]),
        member_balances=[
            ContextMemberBalance(
                member_name=safe_label(row["member_name"], "Household member"),
                balance_paise=int(row["balance_paise"]),
            )
            for row in list(summary["member_balances"])[:20]
        ],
        top_categories=[
            ContextCategory(
                category=safe_label(row["category"]),
                amount_paise=int(row["amount_paise"]),
            )
            for row in list(summary["spend_by_category"])[:5]
        ],
        monthly=[
            ContextMonth(
                month=safe_label(row["month"])[:12],
                income_paise=int(row["income_paise"]),
                spend_paise=int(row["spend_paise"]),
            )
            for row in list(summary["monthly"])[-6:]
        ],
        recent_transactions=[
            ContextTransaction(
                occurred_on=str(row["occurred_at"])[:10],
                kind=cast(
                    Literal["expense", "income", "transfer", "settlement"],
                    str(row["kind"]),
                ),
                personal_share_paise=int(row["personal_share_paise"]),
                category=safe_label(row.get("category")),
            )
            for row in list(summary["recent_transactions"])[:8]
        ],
    )
    try:
        return await LocalFinancialAssistant().chat(payload.message, context)
    except AssistantUnavailableError as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI is temporarily unavailable; the ledger was not changed.",
        ) from error


@router.post(
    "/api/v1/assistant/tag-suggestion",
    response_model=TagSuggestionResponse,
    tags=["assistant"],
)
async def assistant_tag_suggestion(
    payload: ProductionTagSuggestionRequest,
    client: ClientDependency,
    auth: AuthDependency,
) -> TagSuggestionResponse:
    require_ai_access(auth)
    household_id = await current_household(client)
    assert household_id is not None
    category_types = {payload.direction, "both"}
    allowed_categories = [
        TagCategory(id=category_id, name=str(category["name"]))
        for category_id, category in (await categories_by_id(client, household_id)).items()
        if category.get("category_type") in category_types
    ]
    if not allowed_categories:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "no eligible household categories are available for this direction",
        )
    request = TagSuggestionRequest(
        description=payload.description,
        amount_paise=payload.amount_paise,
        direction=payload.direction,
        allowed_categories=allowed_categories,
    )
    try:
        return await LocalFinancialAssistant().suggest_tag(request)
    except AssistantUnavailableError as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            (
                "AI category suggestion is temporarily unavailable; "
                "the ledger was not changed."
            ),
        ) from error
