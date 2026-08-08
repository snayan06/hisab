from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from pydantic import ValidationError
from sqlalchemy import case, extract, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import AuthDependency
from .database import get_session
from .ledger import (
    create_transaction,
    replace_entries,
    transaction_to_read,
    transactions_to_read,
    verify_accounts,
)
from .models import (
    Account,
    AccountKind,
    HouseholdMember,
    IdempotencyRecord,
    LedgerEntry,
    MerchantRule,
    SettlementDirection,
    Transaction,
    TransactionKind,
    TransactionSplit,
)
from .parser import ParseError, parse_transaction
from .schemas import (
    AccountCreate,
    AccountRead,
    AccountSetupRequest,
    BootstrapResponse,
    CaptureContextAccount,
    CaptureContextCategory,
    CaptureContextResponse,
    DashboardCategory,
    DashboardMonth,
    DashboardResponse,
    DeleteResponse,
    HealthResponse,
    MemberBalance,
    MemberCreate,
    MemberRead,
    MerchantRuleCreate,
    MerchantRuleLearnRequest,
    MerchantRuleRead,
    MerchantRuleUpdate,
    OnboardingSetupRequest,
    OnboardingSetupResponse,
    OpeningBalanceUpdate,
    ParseRequest,
    ParseResponse,
    SharedBalancesResponse,
    TransactionDraft,
    TransactionRead,
    TransactionSplitInput,
    TransactionUpdate,
)

router = APIRouter()
SessionDependency = Annotated[AsyncSession, Depends(get_session)]

LOCAL_CAPTURE_CATEGORIES = (
    CaptureContextCategory(id="local-groceries", name="Groceries", kind="expense"),
    CaptureContextCategory(
        id="local-food-dining", name="Food & Dining", kind="expense"
    ),
    CaptureContextCategory(id="local-housing", name="Housing", kind="expense"),
    CaptureContextCategory(id="local-transport", name="Transport", kind="expense"),
    CaptureContextCategory(id="local-shopping", name="Shopping", kind="expense"),
    CaptureContextCategory(id="local-salary", name="Salary", kind="income"),
    CaptureContextCategory(id="local-other", name="Other", kind="both"),
)


def normalize_category_name(value: str) -> str:
    return " ".join(value.split()).casefold()


def ground_local_category(payload: TransactionDraft) -> TransactionDraft:
    if payload.kind is TransactionKind.TRANSFER:
        return payload.model_copy(update={"category": "Transfer"})
    if payload.kind not in {TransactionKind.EXPENSE, TransactionKind.INCOME}:
        return payload
    expected_kind = "expense" if payload.kind is TransactionKind.EXPENSE else "income"
    normalized = normalize_category_name(payload.category or "")
    category = next(
        (
            item
            for item in LOCAL_CAPTURE_CATEGORIES
            if normalize_category_name(item.name) == normalized
            and item.kind in {expected_kind, "both"}
        ),
        None,
    )
    if category is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "category is not available for this transaction type",
        )
    return payload.model_copy(update={"category": category.name})


async def account_to_read(session: AsyncSession, account: Account) -> AccountRead:
    movement = await session.scalar(
        select(func.coalesce(func.sum(LedgerEntry.delta_paise), 0))
        .join(Transaction, Transaction.id == LedgerEntry.transaction_id)
        .where(
            LedgerEntry.account_id == account.id,
            Transaction.is_deleted.is_(False),
        )
    )
    return AccountRead.model_validate(
        {
            **{column.name: getattr(account, column.name) for column in Account.__table__.columns},
            "current_balance_paise": account.opening_balance_paise + int(movement or 0),
        }
    )


async def list_account_models(session: AsyncSession, user_id: str) -> list[Account]:
    result = await session.scalars(
        select(Account)
        .where(Account.user_id == user_id, Account.is_archived.is_(False))
        .order_by(Account.created_at, Account.id)
    )
    return list(result.all())


async def list_member_models(session: AsyncSession, user_id: str) -> list[HouseholdMember]:
    result = await session.scalars(
        select(HouseholdMember)
        .where(
            HouseholdMember.user_id == user_id,
            HouseholdMember.is_archived.is_(False),
        )
        .order_by(HouseholdMember.created_at, HouseholdMember.id)
    )
    return list(result.all())


async def list_merchant_rule_models(
    session: AsyncSession, user_id: str, *, active_only: bool = False
) -> list[MerchantRule]:
    query = select(MerchantRule).where(MerchantRule.user_id == user_id)
    if active_only:
        query = query.where(MerchantRule.active.is_(True))
    result = await session.scalars(
        query.order_by(
            MerchantRule.priority.desc(),
            MerchantRule.merchant_pattern,
            MerchantRule.id,
        )
    )
    return list(result.all())


async def list_transaction_models(
    session: AsyncSession, user_id: str, *, limit: int = 100, offset: int = 0
) -> list[Transaction]:
    result = await session.scalars(
        select(Transaction)
        .where(Transaction.user_id == user_id, Transaction.is_deleted.is_(False))
        .order_by(Transaction.occurred_at.desc(), Transaction.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.all())


@router.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version="v1")


@router.get("/api/v1/accounts", response_model=list[AccountRead], tags=["accounts"])
async def list_accounts(session: SessionDependency, auth: AuthDependency) -> list[AccountRead]:
    account_models = await list_account_models(session, auth.user_id)
    return [await account_to_read(session, account) for account in account_models]


@router.get(
    "/api/v1/capture-context",
    response_model=CaptureContextResponse,
    tags=["transactions"],
)
async def capture_context(
    session: SessionDependency,
    auth: AuthDependency,
) -> CaptureContextResponse:
    accounts = await list_account_models(session, auth.user_id)
    return CaptureContextResponse(
        accounts=[
            CaptureContextAccount(
                id=account.id,
                name=account.name,
                kind=account.kind.value,
            )
            for account in accounts
        ],
        categories=sorted(
            LOCAL_CAPTURE_CATEGORIES,
            key=lambda category: (category.name.casefold(), str(category.id)),
        ),
    )


@router.post(
    "/api/v1/accounts",
    response_model=AccountRead,
    status_code=status.HTTP_201_CREATED,
    tags=["accounts"],
)
async def add_account(
    payload: AccountCreate, session: SessionDependency, auth: AuthDependency
) -> AccountRead:
    account = Account(user_id=auth.user_id, **payload.model_dump())
    session.add(account)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "an account with this name already exists"
        ) from error
    await session.refresh(account)
    return await account_to_read(session, account)


@router.post(
    "/api/v1/accounts/setup",
    response_model=list[AccountRead],
    status_code=status.HTTP_201_CREATED,
    tags=["accounts"],
)
async def setup_accounts(
    payload: AccountSetupRequest,
    session: SessionDependency,
    auth: AuthDependency,
) -> list[AccountRead]:
    normalized_names = [account.name.casefold() for account in payload.accounts]
    if len(normalized_names) != len(set(normalized_names)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="account names must be unique within setup",
        )
    existing_names = await session.scalars(
        select(Account.name).where(Account.user_id == auth.user_id)
    )
    existing_normalized = {name.casefold() for name in existing_names.all()}
    duplicates = sorted(set(normalized_names) & existing_normalized)
    if duplicates:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="one or more account names already exist",
        )

    accounts = [
        Account(user_id=auth.user_id, **account.model_dump()) for account in payload.accounts
    ]
    session.add_all(accounts)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="one or more account names already exist",
        ) from error
    for account in accounts:
        await session.refresh(account)
    return [await account_to_read(session, account) for account in accounts]


async def merchant_rule_for_user(
    session: AsyncSession, rule_id: int, user_id: str
) -> MerchantRule:
    rule = await session.scalar(
        select(MerchantRule).where(
            MerchantRule.id == rule_id,
            MerchantRule.user_id == user_id,
        )
    )
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "merchant rule not found")
    return rule


@router.get(
    "/api/v1/merchant-rules",
    response_model=list[MerchantRuleRead],
    tags=["merchant-rules"],
)
async def list_merchant_rules(
    session: SessionDependency, auth: AuthDependency
) -> list[MerchantRuleRead]:
    return [
        MerchantRuleRead.model_validate(rule)
        for rule in await list_merchant_rule_models(session, auth.user_id)
    ]


@router.post(
    "/api/v1/merchant-rules",
    response_model=MerchantRuleRead,
    status_code=status.HTTP_201_CREATED,
    tags=["merchant-rules"],
)
async def add_merchant_rule(
    payload: MerchantRuleCreate,
    session: SessionDependency,
    auth: AuthDependency,
) -> MerchantRuleRead:
    await verify_accounts(session, [payload.account_id], auth.user_id)
    rule = MerchantRule(user_id=auth.user_id, **payload.model_dump())
    session.add(rule)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "merchant rule already exists") from error
    await session.refresh(rule)
    return MerchantRuleRead.model_validate(rule)


@router.post(
    "/api/v1/merchant-rules/learn",
    response_model=MerchantRuleRead,
    tags=["merchant-rules"],
)
async def learn_merchant_rule(
    payload: MerchantRuleLearnRequest,
    session: SessionDependency,
    auth: AuthDependency,
) -> MerchantRuleRead:
    await verify_accounts(session, [payload.account_id], auth.user_id)
    account_condition = (
        MerchantRule.account_id.is_(None)
        if payload.account_id is None
        else MerchantRule.account_id == payload.account_id
    )
    rule = await session.scalar(
        select(MerchantRule).where(
            MerchantRule.user_id == auth.user_id,
            MerchantRule.match_type == payload.match_type,
            MerchantRule.merchant_pattern == payload.merchant_pattern,
            account_condition,
        )
    )
    if rule is None:
        rule = MerchantRule(user_id=auth.user_id, **payload.model_dump())
        session.add(rule)
    else:
        rule.category = payload.category
        rule.priority = payload.priority
        rule.active = payload.active
    await session.commit()
    await session.refresh(rule)
    return MerchantRuleRead.model_validate(rule)


@router.patch(
    "/api/v1/merchant-rules/{rule_id}",
    response_model=MerchantRuleRead,
    tags=["merchant-rules"],
)
async def update_merchant_rule(
    rule_id: int,
    payload: MerchantRuleUpdate,
    session: SessionDependency,
    auth: AuthDependency,
) -> MerchantRuleRead:
    rule = await merchant_rule_for_user(session, rule_id, auth.user_id)
    changes = payload.model_dump(exclude_unset=True)
    invalid_nulls = [
        field
        for field, value in changes.items()
        if value is None and field != "account_id"
    ]
    if invalid_nulls:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"fields cannot be null: {', '.join(sorted(invalid_nulls))}",
        )
    if "account_id" in changes:
        await verify_accounts(session, [changes["account_id"]], auth.user_id)
    for field, value in changes.items():
        setattr(rule, field, value)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "merchant rule already exists") from error
    await session.refresh(rule)
    return MerchantRuleRead.model_validate(rule)


@router.delete(
    "/api/v1/merchant-rules/{rule_id}",
    response_model=DeleteResponse,
    tags=["merchant-rules"],
)
async def delete_merchant_rule(
    rule_id: int, session: SessionDependency, auth: AuthDependency
) -> DeleteResponse:
    rule = await merchant_rule_for_user(session, rule_id, auth.user_id)
    await session.delete(rule)
    await session.commit()
    return DeleteResponse(id=rule_id, deleted=True)


@router.get("/api/v1/members", response_model=list[MemberRead], tags=["members"])
async def list_members(session: SessionDependency, auth: AuthDependency) -> list[MemberRead]:
    return [
        MemberRead.model_validate(member)
        for member in await list_member_models(session, auth.user_id)
    ]


@router.post(
    "/api/v1/members",
    response_model=MemberRead,
    status_code=status.HTTP_201_CREATED,
    tags=["members"],
)
async def add_member(
    payload: MemberCreate, session: SessionDependency, auth: AuthDependency
) -> MemberRead:
    existing_names = await session.scalars(
        select(HouseholdMember.name).where(HouseholdMember.user_id == auth.user_id)
    )
    if payload.name.casefold() in {name.casefold() for name in existing_names.all()}:
        raise HTTPException(status.HTTP_409_CONFLICT, "household member already exists")
    member = HouseholdMember(user_id=auth.user_id, name=payload.name)
    session.add(member)
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "household member already exists") from error
    await session.refresh(member)
    return MemberRead.model_validate(member)


@router.post(
    "/api/v1/onboarding/setup",
    response_model=OnboardingSetupResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["onboarding"],
)
async def setup_onboarding(
    payload: OnboardingSetupRequest,
    session: SessionDependency,
    auth: AuthDependency,
) -> OnboardingSetupResponse:
    account_names = [account.name.casefold() for account in payload.accounts]
    member_names = [member.name.casefold() for member in payload.members]
    if len(account_names) != len(set(account_names)):
        raise HTTPException(status.HTTP_409_CONFLICT, "account names must be unique")
    if len(member_names) != len(set(member_names)):
        raise HTTPException(status.HTTP_409_CONFLICT, "member names must be unique")

    existing_account_names = {
        name.casefold()
        for name in (
            await session.scalars(select(Account.name).where(Account.user_id == auth.user_id))
        ).all()
    }
    existing_member_names = {
        name.casefold()
        for name in (
            await session.scalars(
                select(HouseholdMember.name).where(HouseholdMember.user_id == auth.user_id)
            )
        ).all()
    }
    if set(account_names) & existing_account_names:
        raise HTTPException(status.HTTP_409_CONFLICT, "one or more accounts already exist")
    if set(member_names) & existing_member_names:
        raise HTTPException(status.HTTP_409_CONFLICT, "one or more members already exist")

    accounts = [
        Account(user_id=auth.user_id, **account.model_dump()) for account in payload.accounts
    ]
    members = [
        HouseholdMember(user_id=auth.user_id, name=member.name) for member in payload.members
    ]
    session.add_all([*accounts, *members])
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "onboarding data conflicts with existing records"
        ) from error
    for account in accounts:
        await session.refresh(account)
    for member in members:
        await session.refresh(member)
    return OnboardingSetupResponse(
        accounts=[await account_to_read(session, account) for account in accounts],
        members=[MemberRead.model_validate(member) for member in members],
    )


@router.patch(
    "/api/v1/accounts/{account_id}/opening-balance",
    response_model=AccountRead,
    tags=["accounts"],
)
async def change_opening_balance(
    account_id: int,
    payload: OpeningBalanceUpdate,
    session: SessionDependency,
    auth: AuthDependency,
) -> AccountRead:
    account = await session.scalar(
        select(Account).where(Account.id == account_id, Account.user_id == auth.user_id)
    )
    if account is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "account not found")
    if account.kind is AccountKind.CREDIT_CARD and payload.opening_balance_paise > 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="credit-card outstanding must be a negative opening balance",
        )
    account.opening_balance_paise = payload.opening_balance_paise
    await session.commit()
    await session.refresh(account)
    return await account_to_read(session, account)


@router.post("/api/v1/drafts/parse", response_model=ParseResponse, tags=["transactions"])
async def parse_draft(
    payload: ParseRequest, session: SessionDependency, auth: AuthDependency
) -> ParseResponse:
    try:
        timezone = ZoneInfo(payload.timezone)
        return parse_transaction(
            payload.text,
            await list_account_models(session, auth.user_id),
            await list_member_models(session, auth.user_id),
            await list_merchant_rule_models(session, auth.user_id, active_only=True),
            now=datetime.now(timezone),
        )
    except ZoneInfoNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="timezone must be a valid IANA timezone",
        ) from error
    except ParseError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from error


@router.post(
    "/api/v1/transactions/confirm",
    response_model=TransactionRead,
    status_code=status.HTTP_201_CREATED,
    tags=["transactions"],
)
async def confirm_transaction(
    payload: TransactionDraft,
    session: SessionDependency,
    auth: AuthDependency,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> TransactionRead:
    payload = ground_local_category(payload)
    request_hash = hashlib.sha256(payload.model_dump_json().encode()).hexdigest()
    record = await session.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.user_id == auth.user_id,
            IdempotencyRecord.key == idempotency_key,
        )
    )
    if record is not None:
        if record.request_hash != request_hash:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "idempotency key was already used for another request"
            )
        transaction = await session.get(Transaction, record.transaction_id)
        if transaction is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "idempotency record is invalid")
        return await transaction_to_read(session, transaction)

    transaction = await create_transaction(session, payload, user_id=auth.user_id)
    session.add(
        IdempotencyRecord(
            user_id=auth.user_id,
            key=idempotency_key,
            request_hash=request_hash,
            transaction_id=transaction.id,
        )
    )
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "idempotency key was already used") from error
    await session.refresh(transaction)
    return await transaction_to_read(session, transaction)


@router.get("/api/v1/transactions", response_model=list[TransactionRead], tags=["transactions"])
async def list_transactions(
    session: SessionDependency,
    auth: AuthDependency,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[TransactionRead]:
    return await transactions_to_read(
        session,
        await list_transaction_models(session, auth.user_id, limit=limit, offset=offset),
    )


async def active_transaction(
    session: AsyncSession, transaction_id: int, user_id: str
) -> Transaction:
    transaction = await session.scalar(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.user_id == user_id,
            Transaction.is_deleted.is_(False),
        )
    )
    if transaction is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "transaction not found")
    return transaction


@router.patch(
    "/api/v1/transactions/{transaction_id}",
    response_model=TransactionRead,
    tags=["transactions"],
)
async def edit_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    session: SessionDependency,
    auth: AuthDependency,
) -> TransactionRead:
    transaction = await active_transaction(session, transaction_id, auth.user_id)
    current = {
        key: getattr(transaction, key)
        for key in TransactionDraft.model_fields
        if key != "splits"
    }
    current["splits"] = list(
        (
            await session.scalars(
                select(TransactionSplit)
                .where(TransactionSplit.transaction_id == transaction.id)
                .order_by(TransactionSplit.id)
            )
        ).all()
    )
    current.update(payload.model_dump(exclude_unset=True))
    try:
        draft = TransactionDraft.model_validate(current)
    except ValidationError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.errors()) from error
    await replace_entries(session, transaction, draft)
    await session.commit()
    await session.refresh(transaction)
    return await transaction_to_read(session, transaction)


@router.delete(
    "/api/v1/transactions/{transaction_id}",
    response_model=DeleteResponse,
    tags=["transactions"],
)
async def delete_transaction(
    transaction_id: int, session: SessionDependency, auth: AuthDependency
) -> DeleteResponse:
    transaction = await active_transaction(session, transaction_id, auth.user_id)
    transaction.is_deleted = True
    await session.commit()
    return DeleteResponse(id=transaction.id, deleted=True)


async def member_balances(session: AsyncSession, user_id: str) -> list[MemberBalance]:
    members = await list_member_models(session, user_id)
    totals = {member.id: 0 for member in members}

    user_paid = await session.execute(
        select(TransactionSplit.member_id, func.sum(TransactionSplit.amount_paise))
        .join(Transaction, Transaction.id == TransactionSplit.transaction_id)
        .where(
            Transaction.user_id == user_id,
            Transaction.is_deleted.is_(False),
            Transaction.kind == TransactionKind.EXPENSE,
            Transaction.paid_by_member_id.is_(None),
        )
        .group_by(TransactionSplit.member_id)
    )
    for member_id, amount in user_paid.all():
        totals[int(member_id)] = totals.get(int(member_id), 0) + int(amount)

    member_paid = await session.execute(
        select(Transaction.paid_by_member_id, func.sum(Transaction.personal_share_paise))
        .where(
            Transaction.user_id == user_id,
            Transaction.is_deleted.is_(False),
            Transaction.kind == TransactionKind.EXPENSE,
            Transaction.paid_by_member_id.is_not(None),
        )
        .group_by(Transaction.paid_by_member_id)
    )
    for member_id, amount in member_paid.all():
        if member_id is not None:
            totals[int(member_id)] = totals.get(int(member_id), 0) - int(amount)

    settlement_amount = case(
        (
            Transaction.settlement_direction == SettlementDirection.RECEIVED,
            -Transaction.amount_paise,
        ),
        else_=Transaction.amount_paise,
    )
    settlements = await session.execute(
        select(Transaction.settlement_member_id, func.sum(settlement_amount))
        .where(
            Transaction.user_id == user_id,
            Transaction.is_deleted.is_(False),
            Transaction.kind == TransactionKind.SETTLEMENT,
            Transaction.settlement_member_id.is_not(None),
        )
        .group_by(Transaction.settlement_member_id)
    )
    for member_id, amount in settlements.all():
        if member_id is not None:
            totals[int(member_id)] = totals.get(int(member_id), 0) + int(amount)

    balances: list[MemberBalance] = []
    for member in members:
        balance = totals[member.id]
        if balance > 0:
            label = f"{member.name} owes you"
        elif balance < 0:
            label = f"You owe {member.name}"
        else:
            label = "Settled up"
        balances.append(
            MemberBalance(
                member_id=member.id,
                member_name=member.name,
                balance_paise=balance,
                status=label,
            )
        )
    return balances


@router.get(
    "/api/v1/shared-balances", response_model=SharedBalancesResponse, tags=["dashboard"]
)
async def get_shared_balances(
    session: SessionDependency, auth: AuthDependency
) -> SharedBalancesResponse:
    return SharedBalancesResponse(balances=await member_balances(session, auth.user_id))


@router.get("/api/v1/dashboard", response_model=DashboardResponse, tags=["dashboard"])
async def dashboard(session: SessionDependency, auth: AuthDependency) -> DashboardResponse:
    account_models = await list_account_models(session, auth.user_id)
    accounts = [await account_to_read(session, account) for account in account_models]
    now = datetime.now(UTC)
    current_month_start = datetime(now.year, now.month, 1, tzinfo=UTC)
    if now.month == 12:
        next_month_start = datetime(now.year + 1, 1, 1, tzinfo=UTC)
    else:
        next_month_start = datetime(now.year, now.month + 1, 1, tzinfo=UTC)
    category_label = func.coalesce(Transaction.category, "Uncategorized")
    category_result = await session.execute(
        select(category_label, func.sum(Transaction.personal_share_paise))
        .where(
            Transaction.user_id == auth.user_id,
            Transaction.is_deleted.is_(False),
            Transaction.kind == TransactionKind.EXPENSE,
            Transaction.occurred_at >= current_month_start,
            Transaction.occurred_at < next_month_start,
        )
        .group_by(category_label)
    )
    category_totals = {
        str(category): int(amount) for category, amount in category_result.all()
    }
    income = await session.scalar(
        select(func.coalesce(func.sum(Transaction.personal_share_paise), 0)).where(
            Transaction.user_id == auth.user_id,
            Transaction.is_deleted.is_(False),
            Transaction.kind == TransactionKind.INCOME,
            Transaction.occurred_at >= current_month_start,
            Transaction.occurred_at < next_month_start,
        )
    )
    cashflow = await session.scalar(
        select(func.coalesce(func.sum(LedgerEntry.delta_paise), 0))
        .join(Transaction, Transaction.id == LedgerEntry.transaction_id)
        .where(Transaction.user_id == auth.user_id, Transaction.is_deleted.is_(False))
    )
    month_pairs: list[tuple[int, int]] = []
    year, month = now.year, now.month
    for offset in range(5, -1, -1):
        absolute_month = year * 12 + month - 1 - offset
        month_pairs.append((absolute_month // 12, absolute_month % 12 + 1))
    first_year, first_month = month_pairs[0]
    first_month_start = datetime(first_year, first_month, 1, tzinfo=UTC)
    monthly_result = await session.execute(
        select(
            extract("year", Transaction.occurred_at),
            extract("month", Transaction.occurred_at),
            Transaction.kind,
            func.sum(Transaction.personal_share_paise),
        )
        .where(
            Transaction.user_id == auth.user_id,
            Transaction.is_deleted.is_(False),
            Transaction.kind.in_([TransactionKind.EXPENSE, TransactionKind.INCOME]),
            Transaction.occurred_at >= first_month_start,
            Transaction.occurred_at < next_month_start,
        )
        .group_by(
            extract("year", Transaction.occurred_at),
            extract("month", Transaction.occurred_at),
            Transaction.kind,
        )
    )
    monthly_totals = {
        (int(point_year), int(point_month), kind): int(amount)
        for point_year, point_month, kind, amount in monthly_result.all()
    }
    monthly: list[DashboardMonth] = []
    for point_year, point_month in month_pairs:
        monthly.append(
            DashboardMonth(
                month=datetime(point_year, point_month, 1, tzinfo=UTC).strftime("%b"),
                income_paise=monthly_totals.get(
                    (point_year, point_month, TransactionKind.INCOME), 0
                ),
                spend_paise=monthly_totals.get(
                    (point_year, point_month, TransactionKind.EXPENSE), 0
                ),
            )
        )
    recent_transactions = await list_transaction_models(session, auth.user_id, limit=10)
    return DashboardResponse(
        total_balance_paise=sum(account.current_balance_paise for account in accounts),
        spend_paise=sum(category_totals.values()),
        income_paise=int(income or 0),
        net_cashflow_paise=int(cashflow or 0),
        member_balances=await member_balances(session, auth.user_id),
        accounts=accounts,
        spend_by_category=[
            DashboardCategory(category=category, amount_paise=amount)
            for category, amount in sorted(
                category_totals.items(), key=lambda item: (-item[1], item[0])
            )
        ],
        monthly=monthly,
        recent_transactions=await transactions_to_read(session, recent_transactions),
    )


@router.post(
    "/api/v1/demo/bootstrap", response_model=BootstrapResponse, tags=["demo"]
)
async def bootstrap_demo(
    session: SessionDependency,
    response: Response,
    request: Request,
    auth: AuthDependency,
) -> BootstrapResponse:
    if request.app.state.is_production:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="demo bootstrap is disabled in production",
        )
    # React Strict Mode and multiple browser tabs can bootstrap together. Keep
    # the check-and-seed sequence atomic inside this app process so replaying
    # startup is safe instead of leaking a uniqueness error to the client.
    async with request.app.state.demo_bootstrap_lock:
        existing_accounts = await list_account_models(session, auth.user_id)
        created = not existing_accounts
        if created:
            hdfc = Account(
                user_id=auth.user_id,
                name="HDFC UPI",
                kind="bank",
                opening_balance_paise=1_250_000,
            )
            cash = Account(
                user_id=auth.user_id,
                name="Cash",
                kind="cash",
                opening_balance_paise=25_000,
            )
            sample_member = HouseholdMember(user_id=auth.user_id, name="Avery")
            session.add_all([hdfc, cash, sample_member])
            await session.flush()
            await create_transaction(
                session,
                TransactionDraft(
                    kind=TransactionKind.INCOME,
                    amount_paise=350_000,
                    personal_share_paise=350_000,
                    description="Freelance payment",
                    category="Income",
                    source_account_id=hdfc.id,
                ),
                user_id=auth.user_id,
            )
            await create_transaction(
                session,
                TransactionDraft(
                    kind=TransactionKind.EXPENSE,
                    amount_paise=184_000,
                    personal_share_paise=92_000,
                    splits=[
                        TransactionSplitInput(
                            member_id=sample_member.id,
                            amount_paise=92_000,
                        )
                    ],
                    description="Groceries",
                    category="Groceries",
                    source_account_id=hdfc.id,
                ),
                user_id=auth.user_id,
            )
            await session.commit()
            response.status_code = status.HTTP_201_CREATED
    accounts = [
        await account_to_read(session, account)
        for account in await list_account_models(session, auth.user_id)
    ]
    transactions = await transactions_to_read(
        session, await list_transaction_models(session, auth.user_id)
    )
    members = [
        MemberRead.model_validate(member)
        for member in await list_member_models(session, auth.user_id)
    ]
    return BootstrapResponse(
        created=created,
        accounts=accounts,
        transactions=transactions,
        members=members,
    )
