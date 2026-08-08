# Message UX and structured metadata release evidence

Date: 9 August 2026
Branch: `codex/message-ux`
Status: PR #23 open; merge held for companion feature and final-domain acceptance

## Product scope

- Enter submits a non-empty Quick Add or Ask Artha message; Shift+Enter keeps a
  newline and IME composition Enter is ignored.
- Quick Add never confirms from the keyboard. Every financial write still needs
  the explicit confirmation action.
- Incomplete safe capture returns one server-owned question, grounded account
  choices where available, and safe full-form recovery while preserving the
  original text.
- Review separates the primary category from merchant, platform, subcategory,
  bounded context and optional explicit tags.
- Household merchant rules take precedence over the safe catalog, which takes
  precedence over an allow-listed model suggestion.
- Quick Add and Ask Artha show truthful progress messages. They do not expose
  Gemini private chain-of-thought.
- Confirmation strips raw source text, marks the remaining evidence reviewed,
  revalidates it in FastAPI and stores versioned metadata through the existing
  atomic transaction RPC.

## Automated evidence

Fresh `make check` before the documentation pass:

- Web: 19 files, 184 tests passed.
- API: 254 tests passed.
- ESLint, TypeScript, Ruff and strict mypy passed.
- Production PWA build passed.
- Eight migrations, seed and four SQL contract files parsed.
- AI contracts: 60 capture, 30 category-suggestion and 24 assistant cases valid
  without calling a model.

Focused feature evidence:

- Web message/metadata adapter and pages: 95 checks passed.
- API assistant, production routes and metadata: 122 checks passed.
- Metadata capture evaluation: 10 evaluation-runner tests passed and 60 cases
  validated.
- Independent branch review findings were corrected before publication:
  descending merchant-rule priority, category-correction provenance, strict
  confirmation metadata/tag validation, accurate clarification actions, and
  optional platform/subcategory clearing now have regression coverage.

The replacement Gemini key is stored locally in the ignored root `.env` and as
Sensitive Vercel Production and Preview variables; it is never written to this
repository. A hosted run reached the configured Gemini Interactions model and
then hit its 15-request free-tier quota. That run exposed and fixed the newer
Interactions SDK error boundary: rate limits, timeouts and connection failures
now become sanitized retryable capture diagnostics or the normal unavailable
state, never a raw provider exception. The complete hosted benchmark and
deployed acceptance remain release gates after the companion feature is ready.

## Persistence and privacy

The release uses the existing RLS-protected `transactions.metadata` object, so
no database migration is required. The existing recovery export/restore already
preserves that object. Relational household tags, aliases, indexes and metadata
analytics remain a separate data sprint.

No raw capture sentence is included in confirmation metadata, evaluation
checkpoints or reports. The designated demo account remains server-verified;
ordinary authenticated users use their own ledger.

## Rendered QA

Completed locally before publication:

- All six primary pages fit at 320 px and 1440 px; the 390 px Quick Add review
  also fits. Explicit light and dark switching passed with zero horizontal
  overflow.
- Quick Add produced an editable unsaved review on the local demo ledger. A
  prior manual pass also confirmed a reviewed ₹680 expense and verified the
  resulting dashboard movement.
- Ask Artha rendered its truthful progress state, recovered from a deliberately
  unavailable provider, restored the exact question and returned to `scrollY=0`
  at 390 px.
- The final clean-browser sweep reported no app-owned console warnings or
  errors. Keyboard behavior, metadata review, safe tag selection and live-region
  semantics are covered by the 184 web checks.

The production Gemini metadata result still requires final-domain authenticated
acceptance after this branch is merged and deployed.

## Remote release gates

Pending:

1. Reconcile the companion feature into the open PR #23 release line.
2. Review the combined diff; pass CI and CodeQL.
3. Merge the combined candidate to `main`.
4. Verify both Vercel deployments correspond to the merge SHA.
5. Run authenticated final-domain demo-account and personal-account smoke tests.

## Next sprint plan

1. Relational household tags, aliases, lifecycle controls and query indexes.
2. Merchant/platform/category personal-share aggregates and new canonical Ask
   Artha breakdown widgets.
3. Immediate **View transaction** and audited edit/soft-delete recovery.
4. Accounts & family maintenance, followed by invitation authorization.
5. Investments planning for mutual funds and stocks.
6. Dedicated planning for a bounded, read-only multi-step Ask Artha agent; no
   agent runtime is part of this release.
