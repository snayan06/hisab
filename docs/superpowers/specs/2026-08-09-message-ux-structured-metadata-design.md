# Artha message UX and structured transaction metadata design

**Date:** 9 August 2026

**Status:** Implemented release slice; normalized tag analytics remain planned

**Release boundary:** Quick Add and Ask Artha messaging, reviewed transaction metadata, bounded category/tag suggestions, existing recovery compatibility, and release evidence. Normalized tag management, metadata analytics, and a future multi-step agent runtime are explicitly deferred.

## Outcome

Artha should feel natural to type into without weakening its financial-write boundary. Enter submits a valid Quick Add or Ask Artha message, Shift+Enter inserts a newline, and no keyboard shortcut can confirm a transaction. Incomplete capture becomes a calm continuation card instead of a red error. The card preserves the exact source text, shows only safely understood facts, asks one missing-field question, offers grounded choices, explains why the answer matters, and states that nothing has been saved.

The review step should also make Artha's interpretation inspectable. It separates one primary category from optional tags, shows category suggestion source and reason, keeps merchant and platform distinct, and exposes reviewed transaction metadata without turning uncertain guesses into ledger facts.

## Product invariants

- Natural-language capture creates an unsaved draft or an unsaved clarification. It never writes.
- Only the existing explicit **Confirm and add transaction** action may invoke the confirmation endpoint.
- Enter in a composer never invokes confirmation, including when a valid review draft already exists.
- Exact source text remains browser state for recovery and continuation, but is not included in the confirmed transaction payload or persisted as transaction metadata.
- Amounts remain integer paise.
- One transaction has exactly one reporting category for expense/income, zero or one subcategory, one merchant/counterparty, zero or one platform, bounded optional attributes, and zero-to-many optional tags.
- Optional subcategory, platform, attributes, and tags never block confirmation.
- Tags do not duplicate structured or derived facts such as category, merchant, platform, account, date/weekend, or shared status.
- Model output is advisory. IDs, categories, tag names, sources, and structured values are validated by application and database code.
- Confirmed metadata is prospective only. A suggestion or new merchant rule never rewrites historical transactions.
- Errors, privacy notices, destructive actions, and financial safety messages use no playful emoji and never rely on emoji for meaning.

## Considered approaches

### 1. Versioned transaction JSON only — selected for this release

Keep every reviewed field, tag, and evidence record in `transactions.metadata`. This uses the existing atomic confirmation and encrypted recovery boundaries without adding a database migration during the messaging release. FastAPI still validates the full bounded contract before confirmation. The trade-off is that household tag reuse, aliases, and indexed many-to-many analysis remain a follow-up.

### 2. Relational tags plus bounded transaction metadata JSON — planned follow-up

Keep category, merchant, and account in their existing normalized columns. Add dedicated optional `subcategory` and `platform` transaction columns, plus a versioned, bounded JSON contract for per-field evidence and low-cardinality reviewed attributes such as meal occasion and order channel. Add normalized household tags, aliases, and transaction-tag links with provenance/confidence/review columns.

This keeps reusable taxonomy queryable and RLS-protected while avoiding dozens of nullable columns for every future reviewed attribute. It also lets the existing atomic confirmation RPC persist the ledger row, metadata, and selected tags in one transaction.

### 3. A column or table for every captured field

Normalize subcategory, platform, meal occasion, order channel, every future attribute, and every evidence record into separate tables. This maximizes SQL structure but adds joins and migration churn disproportionate to the private-pilot scope.

## Interaction design

### Composer keyboard contract

Quick Add and Ask Artha use the same keyboard rule:

- Enter submits when trimmed text is non-empty, the composer is not busy, and an IME composition is not active.
- Shift+Enter inserts a newline.
- Blank Enter does nothing.
- The Quick Add handler is attached only to the source-message textarea and calls draft creation only.
- Review fields do not submit or confirm on Enter. Confirmation remains a deliberate button activation.

Helper text below each composer says “Enter to continue · Shift+Enter for a new line.” It is supplementary; the visible button remains the primary accessible action.

### Capture continuation card

`POST /api/v1/drafts/parse` returns a typed union rather than turning a valid clarification into HTTP 422:

- `outcome: "draft"` contains the review draft.
- `outcome: "clarification"` contains the exact submitted source text, a bounded understood summary, one missing field, a server-owned question, a server-owned explanation, and zero-to-many grounded choices.
- Unsafe or invalid capture remains a validation error and is not styled playfully.

For `Paid ₹540 at Zomato` without an account, the UI can render:

> 🍽️ Zomato · ₹540<br>
> How did you pay?<br>
> Choose one so Artha updates the correct balance. Nothing has been saved.

The emoji is decorative and accompanied by text. Account and destination-account
choices come only from authenticated active accounts. For category, date, or
member details, the card explains that the full form must be opened instead of
claiming to offer choices that are not present. Choosing an available option
appends a plain-language answer to the exact source message and re-runs
interpretation; it does not mutate or save a partial transaction.

The card uses `role="status"` with a polite live region. Operational failures remain `role="alert"` and visually distinct from normal clarification.

### Warm messaging system

Touched capture and assistant states share three semantic treatments:

1. **Progress/continuation:** warm neutral or moss surface, concise plain language, optional restrained decorative icon or emoji with text.
2. **Review/suggestion:** amber or moss supporting surface, explicit source/reason, “Nothing has been saved” near draft actions.
3. **Error/privacy/destructive:** direct wording, no playful emoji, accessible alert/note semantics, and no claim that a failed action succeeded.

Loading copy describes the work (“Reading your message…”, “Reviewing your ledger…”). Success copy stays warm but factual. “AI response” is not used as the primary trust signal; source/provider remains secondary metadata.

## Transaction taxonomy and review model

### Structured dimensions

| Dimension | Cardinality | Storage | Example |
|---|---:|---|---|
| Category | exactly one for expense/income | existing `category_id` | Food & Dining |
| Subcategory | zero or one | versioned `transactions.metadata` | Fast Food |
| Merchant/counterparty | one reviewed description | existing `transactions.merchant` | Burger King |
| Platform | zero or one | versioned `transactions.metadata` | Zomato |
| Reviewed attributes | zero-to-many bounded keys | versioned `transactions.metadata` contract | meal occasion = Dinner; order channel = Delivery |
| Tags | zero-to-many | versioned `transactions.metadata` | Date Night, Work Meal |

The example `Paid 680 for dinner at Burger King via Zomato from HDFC, split with Hermi yesterday` therefore reviews as:

- Merchant: Burger King
- Platform: Zomato
- Category: Food & Dining
- Subcategory: Fast Food only when supported by the safe catalog or user correction
- Meal occasion: Dinner (`user_explicit`)
- Order channel: Delivery (`safe_catalog`, derived from the known delivery platform)
- Account/date/split: grounded HDFC, yesterday, Hermi
- Tags: none unless an explicit phrase such as “date night” safely supports one

Artha must not infer location, cuisine, restaurant branch, companions, or a tag from “dinner” alone.

### Evidence contract

Every core or optional reviewed field represented in the capture response has:

- `source`: `user_explicit`, `household_rule`, `safe_catalog`, `model_suggested`, or `user_corrected`;
- `confidence`: decimal from 0 to 1;
- `review_status`: `needs_review` or `reviewed` in the draft; all persisted evidence is `reviewed` because it is written only by explicit confirmation;
- a bounded, server-owned explanation where the UI needs one.

The model may emit only `user_explicit` or `model_suggested`. Server orchestration
is the only source of `household_rule` and `safe_catalog` in the unsaved review.
At confirmation the browser converts every accepted metadata item to
`user_corrected`; FastAPI rejects any reviewed payload that still claims model,
catalog, or rule provenance. It also strips raw source text, validates the
bounded metadata again, and passes it to the atomic RPC.

### Category suggestions and precedence

The review UI shows “Suggested category” with the selected household category and one concise validated reason. Resolution order is:

1. An active personal merchant rule matching the reviewed merchant.
2. A small server-owned common-merchant/platform catalog when the match is unambiguous.
3. A grounded model suggestion that exactly matches a direction-valid household category.
4. No suggestion; the user chooses a household category.

Personal rules always win. A catalog or model result cannot create a category. Changing the category marks it `user_corrected`. No category selection creates a rule or rewrites prior transactions.

### Tags in the current slice

The current release accepts only a small server-owned set of explicit tag phrases and stores the selected reviewed tags in the confirmed transaction's versioned metadata. Household-created tags, aliases, lifecycle management, and indexed relational links remain a separate database release with their own RLS and recovery acceptance.

Safe built-in tag suggestions are limited to explicit, high-signal phrases such
as “date night”, “work meal”, “on vacation”, or “treat”. Suggestions appear
separately from Category and can be accepted, removed, or ignored. Confirmation
remains enabled with zero tags. Household tag names and aliases remain deferred.

The server rejects tags equivalent to the category, subcategory, merchant, platform, account, a weekday/date/weekend marker, or shared/split state. This prevents redundant taxonomy even if the browser is bypassed.

## API and persistence flow

1. FastAPI loads active accounts, direction-valid categories and personal merchant rules.
2. Gemini returns a strict draft or clarification with partial evidence. The prompt explicitly separates merchant from platform and forbids invented location/cuisine/restaurant facts.
3. FastAPI validates all IDs and evidence, applies personal-rule then safe-catalog precedence, creates server-owned suggestion reasons, and emits the unsaved response.
4. React renders distinct Category, Transaction details, Context, and Optional
   tags sections. Editing a field clears stale suggestion copy and changes its
   evidence to `user_corrected`.
5. Explicit confirmation sends core fields, bounded metadata, and reviewed tag selections. It never sends `sourceText`.
6. FastAPI revalidates category direction, account/member ownership, metadata
   size/keys, confirmation provenance, server tag allow-list, reserved-tag rules,
   normalized values and confirmed review status.
7. The existing `confirm_transaction` RPC writes the core transaction and reviewed versioned metadata atomically.

Transfers keep category `Transfer`, have no tags or food metadata, and continue through the dedicated transfer RPC. Income can use the common evidence contract but cannot carry expense-only catalog hints.

## Database and RLS design for this release

No database migration is required for this release. The existing transaction row already has an RLS-protected JSON object and the existing confirmation RPC already accepts it atomically. FastAPI restricts the stored version-1 object to reviewed platform, subcategory, evidence, attributes, and selected tags; raw capture text is never included.

The planned normalized-tag follow-up will add dedicated tables, indexes, RLS, aliases, and analytics only after its migration and recovery design is accepted. No service-role path is introduced by either design.

## Analytics and Ask Artha follow-up

The reviewed metadata is intentionally stored now so a later release can add current-month, personal-share aggregates for merchant, platform, and the Food & Dining category's merchant/platform split. Only posted expense rows will count; transfers and card payments will remain excluded.

Ask Artha remains on its existing read-only, fixed-intent canonical bundles in this release. The metadata analytics follow-up may add bounded server-derived aggregate labels and integer-paise values, but Gemini will still select a bundle rather than calculate or edit values.

## Recovery and privacy

The existing version-1 recovery bundle already exports and restores the transaction metadata JSON without modification, so reviewed structured facts survive encrypted backup and restore without a schema-version change. A future relational-tag release must advance recovery only when it introduces collections that version 1 cannot represent.

Raw prompt retention remains a separate privacy decision. This release stores reviewed structured facts only after confirmation and does not introduce capture-history storage, external training, or telemetry containing messages, merchant names, tags, or financial values.

## Testing and acceptance

### Frontend

- Quick Add and Ask Artha Enter, Shift+Enter, blank, busy, and IME composition behavior.
- Enter never calls confirmation from review fields.
- Clarification card summary, one question, reason, grounded choices, exact source preservation, and live-region semantics.
- Category suggestion reason/source, personal-rule precedence rendering, category correction evidence, tag separation, optionality, correction/removal, and redundant-tag filtering.
- Merchant/platform/subcategory/attribute evidence rendering and the Burger King via Zomato example.
- Calm copy and absence of emoji-only/error/privacy/destructive meaning.

### API and AI contracts

- Draft/clarification union, partial grounding, one missing field, safe choices, evidence source restrictions, and invented-fact rejection.
- Household rule > safe catalog > model precedence with direction-valid categories only.
- Safe merchant/platform and tag catalogs, alias normalization, redundant-tag rejection, and exact confirmed metadata shape.
- Existing assistant canonical bundle equality remains unchanged; metadata analytics are a planned follow-up.
- Sanitized sample eval cases for platform versus merchant, explicit attributes,
  weak evidence, clarification, tag suggestions, and prohibited inferred facts.

### Persistence and recovery

- FastAPI metadata validation, atomic confirmation, idempotent replay, and existing transaction RLS.
- Recovery version 1 preserves the reviewed transaction metadata JSON.
- No raw capture text appears in transaction metadata, exports, logs, screenshots, or fixtures.

### Rendered QA and release

- Quick Add and Ask Artha at 320 px, 390 px, and 1440 px in light and dark themes.
- Keyboard-only operation, focus visibility, polite/assertive live regions, 44 px touch targets, no horizontal overflow, and readable long merchant/tag values.
- Full `make check`, diff review, GitHub CI, CodeQL, and both Vercel deployments before merge.
- After merge, final-domain demo-account QA covers continuation, Burger King via Zomato review, tag optionality, explicit confirmation, transaction history, and Ask Artha progress/error behavior.

## Explicit non-goals

- A multi-step or autonomous agent runtime.
- Automatic transaction confirmation.
- Raw prompt history or training-data retention.
- Automatic category/tag rule creation from one confirmation.
- Historical rewrites when catalogs or household rules change.
- Arbitrary user-defined attribute keys in this release.
- Location, cuisine, restaurant branch, or companion inference without explicit support.
