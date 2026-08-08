from __future__ import annotations

import pytest

from artha_api.transaction_metadata import (
    ModelAttribute,
    ModelTag,
    ReviewedAttribute,
    ReviewedMetadata,
    SuggestedTag,
    suggest_transaction_metadata,
)

FOOD_CATEGORY = {
    "id": "food-id",
    "name": "Food & Dining",
    "category_type": "expense",
}
TRAVEL_CATEGORY = {
    "id": "travel-id",
    "name": "Travel",
    "category_type": "expense",
}


def test_burger_king_via_zomato_keeps_merchant_and_platform_distinct() -> None:
    result = suggest_transaction_metadata(
        source_text=(
            "Paid 680 for dinner at Burger King via Zomato from HDFC, "
            "date night"
        ),
        merchant="Burger King",
        platform="Zomato",
        model_category_id=None,
        model_category_name=None,
        model_subcategory=None,
        model_attributes=[
            ModelAttribute(
                key="meal_occasion",
                value="Dinner",
                source="user_explicit",
                confidence=0.99,
            )
        ],
        model_tags=[
            ModelTag(name="Date Night", source="user_explicit", confidence=0.98)
        ],
        categories=[FOOD_CATEGORY, TRAVEL_CATEGORY],
        merchant_rules=[],
    )

    assert result.merchant == "Burger King"
    assert result.platform == "Zomato"
    assert result.category_name == "Food & Dining"
    assert result.category_source == "safe_catalog"
    assert result.category_reason == "Burger King is in Artha's food merchant catalog."
    assert result.subcategory == "Fast Food"
    assert [item.model_dump() for item in result.attributes] == [
        {
            "key": "meal_occasion",
            "value": "Dinner",
            "source": "user_explicit",
            "confidence": 0.99,
            "review_status": "needs_review",
        },
        {
            "key": "order_channel",
            "value": "Delivery",
            "source": "safe_catalog",
            "confidence": 1.0,
            "review_status": "needs_review",
        },
    ]
    assert [tag.name for tag in result.tags] == ["Date Night"]


def test_personal_merchant_rule_wins_over_catalog_and_model() -> None:
    result = suggest_transaction_metadata(
        source_text="Paid 680 at Burger King via Zomato",
        merchant="Burger King",
        platform="Zomato",
        model_category_id="travel-id",
        model_category_name="Travel",
        model_subcategory="Restaurant",
        model_attributes=[],
        model_tags=[],
        categories=[FOOD_CATEGORY, TRAVEL_CATEGORY],
        merchant_rules=[
            {
                "id": "rule-id",
                "match_type": "exact",
                "merchant_pattern": "burger king",
                "category_id": "travel-id",
                "priority": 10,
                "is_active": True,
            }
        ],
    )

    assert result.category_id == "travel-id"
    assert result.category_name == "Travel"
    assert result.category_source == "household_rule"
    assert result.category_reason == "Your Burger King rule suggests Travel."


def test_highest_priority_personal_merchant_rule_wins() -> None:
    result = suggest_transaction_metadata(
        source_text="Paid 680 at Burger King",
        merchant="Burger King",
        platform=None,
        model_category_id=None,
        model_category_name=None,
        model_subcategory=None,
        model_attributes=[],
        model_tags=[],
        categories=[FOOD_CATEGORY, TRAVEL_CATEGORY],
        merchant_rules=[
            {
                "id": "lower-priority",
                "match_type": "exact",
                "merchant_pattern": "burger king",
                "category_id": "food-id",
                "priority": 10,
                "is_active": True,
            },
            {
                "id": "higher-priority",
                "match_type": "exact",
                "merchant_pattern": "burger king",
                "category_id": "travel-id",
                "priority": 100,
                "is_active": True,
            },
        ],
    )

    assert result.category_id == "travel-id"
    assert result.category_name == "Travel"


def test_metadata_rejects_inferred_or_redundant_tags_and_arbitrary_attributes() -> None:
    result = suggest_transaction_metadata(
        source_text="Paid 680 for dinner at Burger King via Zomato",
        merchant="Burger King",
        platform="Zomato",
        model_category_id=None,
        model_category_name=None,
        model_subcategory=None,
        model_attributes=[],
        model_tags=[
            ModelTag(name="Food & Dining", source="model_suggested", confidence=0.8),
            ModelTag(name="Zomato", source="model_suggested", confidence=0.8),
            ModelTag(name="Italian", source="model_suggested", confidence=0.8),
        ],
        categories=[FOOD_CATEGORY],
        merchant_rules=[],
    )

    assert result.tags == []
    serialized = result.model_dump(mode="json")
    assert "location" not in str(serialized).casefold()
    assert "cuisine" not in str(serialized).casefold()
    assert "companion" not in str(serialized).casefold()


def test_model_metadata_sources_are_limited() -> None:
    with pytest.raises(ValueError, match="Input should be 'user_explicit' or 'model_suggested'"):
        ModelAttribute(
            key="meal_occasion",
            value="Dinner",
            source="safe_catalog",  # type: ignore[arg-type]
            confidence=1,
        )


def test_reviewed_metadata_rejects_duplicate_attribute_keys() -> None:
    with pytest.raises(ValueError, match="attribute keys must be unique"):
        ReviewedMetadata(
            attributes=[
                ReviewedAttribute(
                    key="meal_occasion",
                    value="Lunch",
                    source="user_explicit",
                    confidence=1,
                    review_status="reviewed",
                ),
                ReviewedAttribute(
                    key="meal_occasion",
                    value="Dinner",
                    source="user_corrected",
                    confidence=1,
                    review_status="reviewed",
                ),
            ]
        )


def test_reviewed_attribute_rejects_whitespace_only_values() -> None:
    with pytest.raises(ValueError, match="attribute value cannot be blank"):
        ReviewedAttribute(
            key="order_channel",
            value="   ",
            source="user_corrected",
            confidence=1,
            review_status="reviewed",
        )


def test_reviewed_tag_requires_the_server_normalized_name() -> None:
    with pytest.raises(ValueError, match="normalized tag name must match"):
        SuggestedTag(
            name="  Work   Meal  ",
            normalized_name="work lunch",
            source="user_explicit",
            confidence=1,
            review_status="reviewed",
        )
