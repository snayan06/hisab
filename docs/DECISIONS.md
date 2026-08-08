# Architecture decisions

## ADR-001: PWA before messaging integrations

The React PWA is the source of truth. WhatsApp and Telegram may later submit drafts through the same API, but neither owns the ledger.

## ADR-002: Python API boundary

FastAPI owns validation, parsing orchestration and business services. Production data is stored in Supabase Postgres with RLS. Local demo mode uses SQLite so development and tests do not require cloud credentials.

## ADR-003: confirmation before financial writes

Natural language produces a `TransactionDraft`. Only the confirmation endpoint may create ledger entries. The parser and future agent cannot write directly.

## ADR-004: derived balances

Account balances, spending and shared receivables are derived from immutable-style ledger facts. Corrections are audited and deletes are soft.

## ADR-005: constrained read-only assistant

The assistant operates on a bounded, server-built financial snapshot. Gemini
selects one supported intent and must copy its exact approved narrative and
canonical widget bundle. FastAPI rejects changed titles, labels, values, rows,
points, order or cardinality before React renders repository-owned components.
The assistant cannot alter the ledger or render arbitrary model code.

## ADR-006: Gemini is the production model

**Decision date:** 7 August 2026

**Decision:** Use Gemini as the only hosted production LLM. Keep explicit
Ollama selection development-only.

**Rationale:** One hosted path keeps deployment, privacy review and failure
handling explicit. Gemini passed the sanitized sample capture, tagging and assistant
schema gates while preserving Artha's review-before-write boundary.

**Consequences:** Model output remains untrusted and fail-closed. Capture can
create only a validated unsaved draft; category suggestions must match
server-owned authenticated household categories; assistant output must equal an
intent's canonical server-owned bundle. Unavailable or invalid output never
creates a guessed ledger fact or fabricated answer. Production merchant-rule
integration remains planned.

Mutable provider configuration, bounded contexts and failure flows belong in
the [system architecture](system-architecture.md) and
[LLM usage map](artifacts/architecture/v1-llm-usage-map.md), not this decision
record.

## ADR-007: Vercel Hobby and Supabase Free for personal production use

Deploy the public monorepo as two Vercel projects owned by the user's personal
account: `apps/web` for the Vite PWA and `apps/api` for the FastAPI function.
Use a fresh Supabase Free project under the same personal ownership for Auth,
Postgres and RLS.

This replaces Cloudflare Pages plus Render as the default because it removes one
provider and avoids Render Free's approximately one-minute wake-up after idle,
which conflicts with five-second capture. Render remains a documented container
fallback through `render.yaml`.

The trade-offs are explicit: Vercel's Python runtime is beta, Hobby is for
personal non-commercial use and has usage caps; Supabase Free can pause after
low activity and has no managed backups. Artha therefore fails closed at API
errors and requires encrypted export/restore before real financial data.

## ADR-008: versioned transaction metadata before relational tags

**Decision date:** 9 August 2026

**Decision:** Store only explicitly confirmed, bounded metadata version 1 inside
the existing RLS-protected `transactions.metadata` JSON object for the messaging
release. Defer household-managed tags, aliases, relational links and indexed
merchant/platform analytics to a separately migrated release.

**Rationale:** The existing confirmation RPC already writes the transaction and
metadata atomically, and encrypted recovery already preserves the JSON object.
This ships the inspectable merchant/platform/category/context review without a
new database or recovery format. FastAPI still owns the strict schema, review
status, source allow-list, normalized safe tag names and transfer/income
exclusions.

**Consequences:** Raw capture text is never persisted. Current optional tags are
from a small server-owned explicit-phrase catalog. Cross-transaction tag
management and efficient metadata analytics remain backlog work and must not be
claimed as current product behavior.
