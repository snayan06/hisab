# Auto-tagging design

Auto-tagging is a suggestion pipeline. It never posts or rewrites a transaction
without confirmation.

## Current production behavior

Supabase production Quick Add sends the authenticated capture context directly
to Gemini, including the household's existing category allow-list. FastAPI then
resolves suggestions in this order: an active household merchant rule, the small
server-owned safe catalog, a grounded model suggestion, or no suggestion. The
source and reason are surfaced inside the unsaved Quick Add review. If
interpretation is unavailable or invalid, category selection remains manual.

The standalone `POST /api/v1/assistant/tag-suggestion` endpoint is a bounded
Gemini API contract. The caller sends only description, amount and direction;
it cannot supply a category allow-list. FastAPI loads up to 200 active categories
from the authenticated household, keeps only categories eligible for the
transaction direction, and accepts only an exact ID/name pair from that set.
The endpoint returns no suggestion when the model is missing, unavailable or
invalid. The V1 web application does not call this endpoint, so its result must
not be described as part of the web review flow. Neither path creates a fallback
category.

Only explicit transaction confirmation can save the reviewed draft.

## Merchant-rule behavior

Both production capture and the SQLAlchemy local/demo path implement
merchant-rule-first behavior. They
normalizes merchant text, matches household rules by `exact`, `contains`, then
validated `regex`, and asks the configured model only when no rule matches. A
confirmed correction can prospectively create or update a rule for later local
entries.

Production reads only active rules belonging to the authenticated household.
Learning remains prospective: a new rule affects later drafts and never rewrites
history.

## Production API contract

Request body:

```json
{"description":"weekly groceries at reliance fresh","amount_paise":184000,"direction":"expense"}
```

Successful response envelope:

```json
{
  "provider": "gemini",
  "model": "gemini-3.5-flash-lite",
  "mode": "model",
  "result": {
    "category_id": "<existing-household-category-id>",
    "category_name": "Groceries",
    "confidence": 0.96,
    "reason": "The description indicates a grocery purchase."
  }
}
```

The API rejects caller-supplied extra fields, unknown/mismatched categories,
malformed model output and out-of-range confidence. It does not receive account
numbers, card numbers, database credentials or raw household history.

The internal local/demo assistant contract may accept an explicit category
allow-list for isolated tests. That is not the public production request schema.

## Learning contract

Where learning is enabled on the local/demo path, it is household-specific and
prospective. Existing confirmed transactions are never silently retagged. The
planned production integration must preserve the same rule: corrections affect
future suggestions only, and any bulk historical retagging requires an explicit
preview and confirmation workflow.

## Provider behavior

Production uses `gemini-3.5-flash-lite` through Google's
official SDK. For the standalone endpoint, server code supplies the authenticated
household category allow-list to Gemini. When Gemini is missing, rate-limited,
unavailable or invalid, no category is selected. Explicit Ollama selection may
be used in local development, but it is not a production provider or recovery
path.

Gemini requests use `store=false`; provider storage does not replace Artha's
household-scoped, consent-controlled audit design.
