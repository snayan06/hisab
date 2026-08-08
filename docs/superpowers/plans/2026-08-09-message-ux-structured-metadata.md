# Message UX and Structured Transaction Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make natural-language capture conversational when information is missing and preserve reviewed merchant, platform, subcategory, attributes, and optional tags as safe ledger facts.

**Architecture:** FastAPI owns the typed draft-or-clarification contract, grounded choices, safe catalog, evidence normalization, and confirmation validation. React renders one-question continuation and an inspectable review without gaining write authority. Supabase persists only reviewed bounded metadata and normalized household tags in the existing atomic confirmation boundary; recovery and analytics read the same contract.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, FastAPI, Pydantic v2, Gemini structured output, Supabase Postgres/RLS, Vitest/Testing Library, Pytest, pgTAP-style SQL contracts.

## Implementation status update — 9 August 2026

- Complete: composer keyboard safety, grounded one-question continuation,
  structured merchant/platform/category/context/tag review, honest Quick Add and
  Ask Artha progress messages, server revalidation, atomic persistence in
  versioned transaction metadata, and a 60-case capture evaluation dataset.
- Persistence decision: use the existing RLS-protected transaction metadata and
  version-1 recovery boundary for this release; no database migration is needed.
- Deferred to the next data sprint: relational household tags/aliases, recovery
  version 2, metadata indexes/aggregates, and new Ask Artha analytics bundles.
- Still required here: current documentation, responsive rendered QA, complete
  local gate, PR review/CI, merge, deployment, and final-domain acceptance.

This status update supersedes Tasks 5–7 below where they describe the larger
relational-tag and metadata-analytics scope; those sections are retained as the
follow-up implementation blueprint.

---

## File structure

- Create `apps/api/src/artha_api/transaction_metadata.py`: bounded evidence, safe merchant/platform hints, tag normalization, and redundant-tag rejection.
- Modify `apps/api/src/artha_api/assistant.py`: model capture schema and prompt fields for merchant, platform, subcategory, attributes, tags, and one missing field.
- Modify `apps/api/src/artha_api/schemas.py`: public draft/clarification union and confirmed metadata contract.
- Modify `apps/api/src/artha_api/production_routes.py`: grounded clarification choices, metadata precedence, confirmation validation, dashboard dimensions, and recovery mapping.
- Modify `apps/api/src/artha_api/recovery.py`: recovery schema v2 and explicit v1 compatibility adapter.
- Modify `apps/web/src/types.ts` and `apps/web/src/lib/api.ts`: strict capture-result union and metadata mapping.
- Create `apps/web/src/components/CaptureClarificationCard.tsx`: accessible one-question continuation with grounded choice chips.
- Create `apps/web/src/components/TransactionMetadataReview.tsx`: distinct category/details/context/tags review surfaces.
- Modify `apps/web/src/pages/QuickAddPage.tsx` and `apps/web/src/pages/AssistantPage.tsx`: keyboard contract, continuation, review editing, and warm factual copy.
- Create `supabase/migrations/20260809010000_transaction_metadata.sql`: bounded columns, tag tables, RLS, atomic confirmation, logical activity, export, and restore v2.
- Modify SQL/API/web tests and eval datasets listed below.

### Task 1: Composer keyboard safety

**Files:**
- Modify: `apps/web/src/pages/QuickAddPage.tsx`
- Modify: `apps/web/src/pages/AssistantPage.tsx`
- Test: `apps/web/src/pages/QuickAddPage.test.tsx`
- Test: `apps/web/src/pages/AssistantPage.test.tsx`

- [ ] **Step 1: Write failing keyboard tests**

Add tests that dispatch Enter, Shift+Enter, blank Enter, busy Enter, and IME-composition Enter. Assert Quick Add calls `parseDraft` only for safe Enter and never calls `onConfirm`; assert Ask Artha submits once and preserves newline behavior.

- [ ] **Step 2: Verify RED**

Run: `npm --prefix apps/web test -- --run src/pages/QuickAddPage.test.tsx src/pages/AssistantPage.test.tsx`

Expected: failures for missing Quick Add Enter handling, IME handling, and helper text.

- [ ] **Step 3: Implement the shared contract**

Use this predicate in each composer handler:

```ts
if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
event.preventDefault()
if (!value.trim() || busy) return
void submit()
```

Render `Enter to continue · Shift+Enter for a new line.` below each composer. Do not attach this handler to review inputs.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused tests, then commit `feat: add safe composer keyboard controls`.

### Task 2: Typed capture clarification and grounded choices

**Files:**
- Modify: `apps/api/src/artha_api/assistant.py`
- Modify: `apps/api/src/artha_api/schemas.py`
- Modify: `apps/api/src/artha_api/production_routes.py`
- Test: `apps/api/tests/test_assistant.py`
- Test: `apps/api/tests/test_production_routes.py`

- [ ] **Step 1: Write failing API tests**

Cover `Paid 540 at Zomato` with missing account. Require HTTP 200 and:

```json
{
  "outcome": "clarification",
  "source_text": "Paid 540 at Zomato",
  "understood": {"amount_paise": 54000, "merchant": "Zomato"},
  "missing_field": "source_account_id",
  "question": "How did you pay for Zomato?",
  "explanation": "Choose one so Artha updates the correct balance. Nothing has been saved.",
  "choices": [{"id": "<account-id>", "label": "HDFC UPI", "answer": "paid from HDFC UPI"}]
}
```

Also test one missing field only, active-account allow-listing, source-text preservation, no invented choice IDs, and transfer destination wording.

- [ ] **Step 2: Verify RED**

Run the focused assistant/production route tests; expect the current 422 clarification behavior to fail.

- [ ] **Step 3: Implement minimal union**

Add `CaptureClarificationResponse`, `CaptureChoice`, and `CaptureUnderstood` Pydantic models. Convert model `clarify` into a server-owned question/explanation and choices from authenticated context. Return `{"outcome":"draft", ...}` for drafts and never expose model-authored clarification prose directly.

- [ ] **Step 4: Verify GREEN and commit**

Run focused API tests, Ruff, and mypy; commit `feat: return grounded capture clarifications`.

### Task 3: Clarification card and continuation

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/components/CaptureClarificationCard.tsx`
- Modify: `apps/web/src/pages/QuickAddPage.tsx`
- Test: `apps/web/src/lib/api.test.ts`
- Test: `apps/web/src/pages/QuickAddPage.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Require a polite status card with understood merchant/amount, exactly one question, explanation, active account choice buttons, and “Nothing has been saved.” Selecting `HDFC UPI` must call `parseDraft('Paid 540 at Zomato; paid from HDFC UPI')`, preserve the source text, and not call confirmation.

- [ ] **Step 2: Verify RED**

Run the API adapter and Quick Add tests; expect the current draft-only adapter to fail.

- [ ] **Step 3: Implement strict parsing and card**

Define `CaptureResult = CaptureDraftResult | CaptureClarification`. Reject malformed choices in the adapter. Keep `sourceText` in browser state only. The card uses `role="status"`, `aria-live="polite"`, 44 px choice targets, and a manual-entry escape hatch.

- [ ] **Step 4: Verify GREEN and commit**

Run focused tests and TypeScript; commit `feat: add guided capture continuation`.

### Task 4: Structured metadata, catalog precedence, and review

**Files:**
- Create: `apps/api/src/artha_api/transaction_metadata.py`
- Modify: `apps/api/src/artha_api/assistant.py`
- Modify: `apps/api/src/artha_api/production_routes.py`
- Modify: `apps/web/src/types.ts`
- Create: `apps/web/src/components/TransactionMetadataReview.tsx`
- Modify: `apps/web/src/pages/QuickAddPage.tsx`
- Test: `apps/api/tests/test_transaction_metadata.py`
- Test: `apps/api/tests/test_production_routes.py`
- Test: `apps/web/src/pages/QuickAddPage.test.tsx`

- [ ] **Step 1: Write failing taxonomy tests**

Use `Paid 680 for dinner at Burger King via Zomato from HDFC`. Require merchant `Burger King`, platform `Zomato`, category `Food & Dining`, safe-catalog subcategory `Fast Food`, attributes `meal_occasion=Dinner` and `order_channel=Delivery`, with no inferred location/cuisine/companion. Test precedence `merchant rule > safe catalog > grounded model > no suggestion` and evidence-source restrictions.

- [ ] **Step 2: Verify RED**

Run new metadata and focused route/UI tests; expect missing fields/modules.

- [ ] **Step 3: Implement bounded metadata**

Add strict enums for evidence source/review status, max lengths/counts, allowed attribute keys (`meal_occasion`, `order_channel`), safe catalogs, and server-owned suggestion reasons. Model output may supply only `user_explicit` or `model_suggested`; server code owns catalog/rule evidence.

- [ ] **Step 4: Implement inspectable review**

Render separate **Suggested category**, **Transaction details**, **Context**, and **Optional tags** sections. Field edits become `user_corrected`; optional fields never block confirmation. Merchant and platform remain distinct.

- [ ] **Step 5: Verify GREEN and commit**

Run focused Python/React tests, Ruff, mypy, ESLint, and TypeScript; commit `feat: review structured transaction metadata`.

### Task 5: Normalized tags and atomic persistence

**Files:**
- Create: `supabase/migrations/20260809010000_transaction_metadata.sql`
- Modify: `apps/api/src/artha_api/schemas.py`
- Modify: `apps/api/src/artha_api/production_routes.py`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `supabase/tests/001_schema_assertions.sql`
- Modify: `supabase/tests/003_two_household_isolation.sql`
- Create: `supabase/tests/005_transaction_metadata.sql`
- Test: `apps/api/tests/test_production_routes.py`

- [ ] **Step 1: Write failing confirmation/SQL contracts**

Assert columns `subcategory` and `platform`, bounded metadata validation, tag/alias/link tables, composite household foreign keys, indexes, grants, RLS, cross-household denial, reserved-tag rejection, and idempotent atomic confirmation.

- [ ] **Step 2: Verify RED**

Run SQL parse/contracts and focused confirmation tests; expect absent schema/RPC arguments.

- [ ] **Step 3: Add schema and RPC**

Store reviewed metadata version 1 only, normalize tags with case-folded whitespace, reject structured-fact duplicates, and write transaction plus selected tag links inside `confirm_transaction`. Transfers reject expense metadata/tags.

- [ ] **Step 4: Wire confirmed payload**

`toApiDraft` sends reviewed metadata and tag IDs but never `sourceText`. FastAPI revalidates household ownership and all review statuses before calling the RPC.

- [ ] **Step 5: Verify GREEN and commit**

Run API + SQL tests and static checks; commit `feat: persist reviewed transaction metadata`.

### Task 6: Recovery v2 and compatibility

**Files:**
- Modify: `apps/api/src/artha_api/recovery.py`
- Modify: `apps/api/tests/test_recovery.py`
- Modify: `supabase/migrations/20260809010000_transaction_metadata.sql`
- Modify: `supabase/tests/004_recovery_round_trip.sql`

- [ ] **Step 1: Write failing recovery tests**

Require v2 export/restore to preserve subcategory, platform, bounded evidence, tag definitions, aliases, and links; require v1 input to adapt to empty structured fields; reject unknown v2 fields, dangling links, duplicate normalized aliases, and raw source text.

- [ ] **Step 2: Verify RED**

Run recovery Python and SQL tests; expect schema version 1 behavior.

- [ ] **Step 3: Implement v2 plus v1 adapter**

Normalize v1 to v2 before validation. Keep restore empty-household-only and atomic. Include all metadata collections in checksum/preview counts.

- [ ] **Step 4: Verify GREEN and commit**

Run focused recovery tests; commit `feat: recover structured transaction metadata`.

### Task 7: Metadata analytics and safe Ask Artha bundles

**Files:**
- Modify: `apps/api/src/artha_api/assistant.py`
- Modify: `apps/api/src/artha_api/production_routes.py`
- Modify: `apps/api/tests/test_assistant.py`
- Modify: `apps/api/tests/test_production_routes.py`
- Modify: `apps/web/src/lib/api.test.ts`

- [ ] **Step 1: Write failing analytics tests**

Require posted personal-share expense aggregates for merchant/platform and a Food & Dining breakdown. Exclude transfers/card payments. Require exact canonical widget equality and reject model-calculated or reordered values.

- [ ] **Step 2: Verify RED**

Run focused assistant/route tests; expect missing context/bundle.

- [ ] **Step 3: Add bounded aggregates and widgets**

FastAPI computes integer-paise aggregates, caps rows, sanitizes labels, and passes only canonical bundles to Gemini. The model selects an intent; it never receives write tools or calculates totals.

- [ ] **Step 4: Verify GREEN and commit**

Run focused tests; commit `feat: analyze reviewed transaction dimensions`.

### Task 8: Evals, documentation, responsive QA, and release

**Files:**
- Modify: `apps/api/evals/capture-v1.jsonl`
- Modify: `apps/api/evals/tag-suggestions-v1.jsonl`
- Modify: `docs/PROJECT-CHECKPOINT.md`
- Modify: `docs/SPRINT-BOARD.md`
- Modify: `docs/TASKS.md`
- Create: `docs/artifacts/qa/2026-08-09-message-metadata-release.md`

- [ ] **Step 1: Extend fictional datasets**

Add platform-vs-merchant, explicit meal/context, ambiguous account, transfer destination, optional tag, prohibited inference, typo, Hinglish, and long-label cases. Validate no personal data or raw private prompts.

- [ ] **Step 2: Run complete local gate**

Run `make check`, `python3 scripts/check_docs_links.py`, `git diff --check`, and inspect the complete branch diff. Expected: all web/API/SQL/eval/build gates pass with no warnings attributable to the app.

- [ ] **Step 3: Rendered manual QA**

Use the in-app browser at 320, 390, and 1440 px in light/dark. Verify Enter/Shift+Enter/IME behavior, continuation choices, manual escape, review metadata/tags, explicit confirmation, transaction history, assistant breakdown, keyboard focus, live regions, 44 px targets, no overflow, and clean app console.

- [ ] **Step 4: Update current docs**

Record the implementation, exact test counts, remaining external gates, and the next sprint plan. Remove obsolete fictional-pilot language while retaining a quiet server-verified Demo badge for the designated test account.

- [ ] **Step 5: Publish only after verification**

Push the feature branch, open a PR, wait for CI and CodeQL, review the PR diff, merge to `main`, verify both Vercel deployments use the merge SHA, apply/probe the exact Supabase migration before dependent app code, then run authenticated final-domain smoke tests. Do not claim deployed or green from local evidence alone.

## Plan self-review

- Spec coverage: keyboard safety, one-field continuation, grounded choices, evidence/taxonomy, normalized tags, RLS, recovery, analytics, evals, responsive QA, and release evidence each map to a task.
- Placeholder scan: no TBD/TODO/“similar to” instructions remain.
- Type consistency: API uses `outcome: draft|clarification`; browser uses the same discriminant; confirmation persists reviewed metadata and selected tag IDs only; `sourceText` remains browser-only.
- Scope boundary: the future agent runtime, raw prompt history, automatic rule creation, and Investments remain backlog work.
