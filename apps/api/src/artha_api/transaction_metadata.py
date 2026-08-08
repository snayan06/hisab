from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ModelEvidenceSource = Literal["user_explicit", "model_suggested"]
EvidenceSource = Literal[
    "user_explicit",
    "household_rule",
    "safe_catalog",
    "model_suggested",
    "user_corrected",
]
ReviewStatus = Literal["needs_review", "reviewed"]
AttributeKey = Literal["meal_occasion", "order_channel"]
EvidenceField = Literal[
    "amount",
    "merchant",
    "platform",
    "category",
    "subcategory",
    "occurred_on",
]


class StrictMetadataModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


def normalize_label(value: str) -> str:
    return " ".join(value.split())


def normalize_key(value: str) -> str:
    return normalize_label(value).casefold()


class ModelAttribute(StrictMetadataModel):
    key: AttributeKey
    value: str = Field(min_length=1, max_length=80)
    source: ModelEvidenceSource
    confidence: float = Field(ge=0, le=1)

    @field_validator("value")
    @classmethod
    def normalize_value(cls, value: str) -> str:
        normalized = normalize_label(value)
        if not normalized:
            raise ValueError("attribute value cannot be blank")
        return normalized


class ModelTag(StrictMetadataModel):
    name: str = Field(min_length=1, max_length=60)
    source: ModelEvidenceSource
    confidence: float = Field(ge=0, le=1)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = normalize_label(value)
        if not normalized:
            raise ValueError("tag name cannot be blank")
        return normalized


class ModelFieldEvidence(StrictMetadataModel):
    field: EvidenceField
    source: ModelEvidenceSource
    confidence: float = Field(ge=0, le=1)


class ReviewedAttribute(StrictMetadataModel):
    key: AttributeKey
    value: str = Field(min_length=1, max_length=80)
    source: EvidenceSource
    confidence: float = Field(ge=0, le=1)
    review_status: ReviewStatus = "needs_review"

    @field_validator("value")
    @classmethod
    def normalize_value(cls, value: str) -> str:
        normalized = normalize_label(value)
        if not normalized:
            raise ValueError("attribute value cannot be blank")
        return normalized


class ReviewedEvidence(StrictMetadataModel):
    source: EvidenceSource
    confidence: float = Field(ge=0, le=1)
    review_status: ReviewStatus = "needs_review"


class SuggestedTag(StrictMetadataModel):
    name: str = Field(min_length=1, max_length=60)
    normalized_name: str = Field(min_length=1, max_length=60)
    source: EvidenceSource
    confidence: float = Field(ge=0, le=1)
    review_status: ReviewStatus = "needs_review"

    @field_validator("name")
    @classmethod
    def normalize_display_name(cls, value: str) -> str:
        normalized = normalize_label(value)
        if not normalized:
            raise ValueError("tag name cannot be blank")
        return normalized

    @field_validator("normalized_name")
    @classmethod
    def normalize_stored_name(cls, value: str) -> str:
        normalized = normalize_key(value)
        if not normalized:
            raise ValueError("normalized tag name cannot be blank")
        return normalized

    @model_validator(mode="after")
    def normalized_name_matches(self) -> SuggestedTag:
        if self.normalized_name != normalize_key(self.name):
            raise ValueError("normalized tag name must match the tag name")
        return self


class ReviewedMetadata(StrictMetadataModel):
    version: Literal[1] = 1
    evidence: dict[EvidenceField, ReviewedEvidence] = Field(
        default_factory=dict, max_length=6
    )
    attributes: list[ReviewedAttribute] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def unique_attribute_keys(self) -> ReviewedMetadata:
        keys = [attribute.key for attribute in self.attributes]
        if len(keys) != len(set(keys)):
            raise ValueError("metadata attribute keys must be unique")
        return self


class MetadataSuggestion(StrictMetadataModel):
    merchant: str = Field(min_length=1, max_length=160)
    platform: str | None = Field(default=None, max_length=100)
    category_id: str | None = Field(default=None, max_length=80)
    category_name: str | None = Field(default=None, max_length=80)
    category_source: EvidenceSource | None = None
    category_confidence: float | None = Field(default=None, ge=0, le=1)
    category_reason: str | None = Field(default=None, max_length=160)
    subcategory: str | None = Field(default=None, max_length=80)
    attributes: list[ReviewedAttribute] = Field(default_factory=list, max_length=8)
    tags: list[SuggestedTag] = Field(default_factory=list, max_length=8)


SAFE_MERCHANT_CATALOG: dict[str, tuple[str, str | None]] = {
    "burger king": ("Food & Dining", "Fast Food"),
    "domino's": ("Food & Dining", "Fast Food"),
    "dominos": ("Food & Dining", "Fast Food"),
    "kfc": ("Food & Dining", "Fast Food"),
    "mcdonald's": ("Food & Dining", "Fast Food"),
    "mcdonalds": ("Food & Dining", "Fast Food"),
    "starbucks": ("Food & Dining", "Cafe"),
    "swiggy": ("Food & Dining", None),
    "zomato": ("Food & Dining", None),
}
SAFE_PLATFORM_CATALOG: dict[str, tuple[str, str]] = {
    "swiggy": ("Food & Dining", "Delivery"),
    "zomato": ("Food & Dining", "Delivery"),
}
SAFE_TAG_PHRASES: dict[str, tuple[str, ...]] = {
    "Date Night": ("date night",),
    "On Vacation": ("on vacation", "on holiday"),
    "Treat": ("treat",),
    "Work Meal": ("work meal", "client meal", "office lunch"),
}


def _category_by_id(
    categories: list[dict[str, Any]], category_id: str
) -> dict[str, Any] | None:
    return next(
        (
            category
            for category in categories
            if str(category.get("id")) == category_id
            and category.get("category_type") in {"expense", "both"}
        ),
        None,
    )


def _category_by_name(
    categories: list[dict[str, Any]], category_name: str
) -> dict[str, Any] | None:
    normalized = normalize_key(category_name)
    return next(
        (
            category
            for category in categories
            if normalize_key(str(category.get("name", ""))) == normalized
            and category.get("category_type") in {"expense", "both"}
        ),
        None,
    )


def _rule_matches(rule: dict[str, Any], merchant_key: str) -> bool:
    if rule.get("is_active") is False:
        return False
    pattern = normalize_key(str(rule.get("merchant_pattern", "")))
    if not pattern:
        return False
    match_type = rule.get("match_type", "contains")
    if match_type == "exact":
        return merchant_key == pattern
    if match_type == "contains":
        return pattern in merchant_key
    if match_type == "regex":
        try:
            return re.search(pattern, merchant_key) is not None
        except re.error:
            return False
    return False


def suggest_transaction_metadata(
    *,
    source_text: str,
    merchant: str,
    platform: str | None,
    model_category_id: str | None,
    model_category_name: str | None,
    model_subcategory: str | None,
    model_attributes: list[ModelAttribute],
    model_tags: list[ModelTag],
    categories: list[dict[str, Any]],
    merchant_rules: list[dict[str, Any]],
) -> MetadataSuggestion:
    reviewed_merchant = normalize_label(merchant)
    reviewed_platform = normalize_label(platform) if platform else None
    merchant_key = normalize_key(reviewed_merchant)
    platform_key = normalize_key(reviewed_platform or "")

    category: dict[str, Any] | None = None
    category_source: EvidenceSource | None = None
    category_confidence: float | None = None
    category_reason: str | None = None
    subcategory: str | None = None

    matching_rules = sorted(
        (rule for rule in merchant_rules if _rule_matches(rule, merchant_key)),
        key=lambda rule: (-int(rule.get("priority", 100)), str(rule.get("id", ""))),
    )
    if matching_rules:
        category = _category_by_id(categories, str(matching_rules[0]["category_id"]))
        if category is not None:
            category_source = "household_rule"
            category_confidence = 1.0
            category_reason = (
                f"Your {reviewed_merchant} rule suggests {category['name']}."
            )

    catalog_entry = SAFE_MERCHANT_CATALOG.get(merchant_key)
    if category is None and catalog_entry is not None:
        category = _category_by_name(categories, catalog_entry[0])
        if category is not None:
            category_source = "safe_catalog"
            category_confidence = 1.0
            category_reason = (
                f"{reviewed_merchant} is in Artha's food merchant catalog."
            )
            subcategory = catalog_entry[1]

    platform_entry = SAFE_PLATFORM_CATALOG.get(platform_key)
    if category is None and platform_entry is not None:
        category = _category_by_name(categories, platform_entry[0])
        if category is not None:
            category_source = "safe_catalog"
            category_confidence = 0.95
            category_reason = (
                f"{reviewed_platform} is a known food delivery platform."
            )

    if (
        category is None
        and model_category_id is not None
        and model_category_name is not None
    ):
        model_category = _category_by_id(categories, model_category_id)
        if (
            model_category is not None
            and normalize_key(str(model_category["name"]))
            == normalize_key(model_category_name)
        ):
            category = model_category
            category_source = "model_suggested"
            category_confidence = 0.75
            category_reason = "The description suggests this household category."

    if subcategory is None and model_subcategory:
        allowed_subcategories = {"cafe", "fast food", "groceries", "restaurant"}
        if normalize_key(model_subcategory) in allowed_subcategories:
            subcategory = normalize_label(model_subcategory)

    attributes_by_key: dict[str, ReviewedAttribute] = {}
    for model_attribute in model_attributes:
        attributes_by_key[model_attribute.key] = ReviewedAttribute(
            key=model_attribute.key,
            value=model_attribute.value,
            source=model_attribute.source,
            confidence=model_attribute.confidence,
        )
    if platform_entry is not None and "order_channel" not in attributes_by_key:
        attributes_by_key["order_channel"] = ReviewedAttribute(
            key="order_channel",
            value=platform_entry[1],
            source="safe_catalog",
            confidence=1.0,
        )

    reserved = {
        normalize_key(value)
        for value in (
            reviewed_merchant,
            reviewed_platform or "",
            str(category.get("name", "")) if category else "",
            subcategory or "",
        )
        if value
    }
    source_key = normalize_key(source_text)
    tags: list[SuggestedTag] = []
    seen_tags: set[str] = set()
    for model_tag in model_tags:
        normalized_name = normalize_key(model_tag.name)
        canonical = next(
            (
                name
                for name, phrases in SAFE_TAG_PHRASES.items()
                if normalized_name == normalize_key(name)
                and any(phrase in source_key for phrase in phrases)
            ),
            None,
        )
        if (
            canonical is None
            or normalized_name in reserved
            or normalized_name in seen_tags
        ):
            continue
        seen_tags.add(normalized_name)
        tags.append(
            SuggestedTag(
                name=canonical,
                normalized_name=normalized_name,
                source=model_tag.source,
                confidence=model_tag.confidence,
            )
        )

    return MetadataSuggestion(
        merchant=reviewed_merchant,
        platform=reviewed_platform,
        category_id=str(category["id"]) if category is not None else None,
        category_name=str(category["name"]) if category is not None else None,
        category_source=category_source,
        category_confidence=category_confidence,
        category_reason=category_reason,
        subcategory=subcategory,
        attributes=list(attributes_by_key.values()),
        tags=tags,
    )
