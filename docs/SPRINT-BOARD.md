# Artha sprint board

Start with [`PROJECT-CHECKPOINT.md`](PROJECT-CHECKPOINT.md) for the current
handoff, release guard and exact resume sequence.

Updated: 9 August 2026
Goal: make personal production use trustworthy before entering real financial data

Current scope: a private personal ledger with expense splitting for friends and
family. Separate logins for invited people are optional future work, not a
Sprint 1 dependency.

## How to read this board

- **Done** means implemented, tested and documented.
- **In progress** means code or verification is actively underway.
- **Blocked** means a named user or provider action is required.
- **Next** is ordered; the first unchecked item is the next engineering task.

## Current snapshot

| Area | Status | What this means |
| --- | --- | --- |
| AI-primary release | Deployed | PR #20 merged as `69e44a8`; production capture and assistant are model-only, and both web/API Vercel deployments are ready |
| V1 capture hardening | Deployed and accepted | PR #21 merged as `c4ae0dc`; manual Expense/Income/Transfer recovery, grounded category/account context and the AI notice passed final-domain fictional QA plus 170 web + 223 API + 50/30/24 AI contracts |
| Message UX and metadata | Local release candidate | Safe composer behavior, grounded continuation, reviewed merchant/platform/category/context/tags, progress messages, editable architecture pack and 60 capture cases are implemented; PR/CI/deployment/final-domain QA remain |
| Public repository and CI | Done for current release | Main CI `31271421128` and CodeQL `31271421107` passed for `c4ae0dc` |
| Vercel and Supabase infrastructure | Done | Web, API and database are live on personal accounts |
| Persistent production login | Done for one fictional identity | New-user link, returning-user link, persisted session and sign-out/re-login passed on the final domain |
| Server-owned onboarding/profile | Done for one fictional identity | Profile, household and participants returned from the server without repeating onboarding |
| ₹25k self-transfer flow | Production verified | `25k` mapped to ₹25,000 with ordered ICICI → HDFC accounts; totals remained unchanged |
| First-request reliability | Deployed | API now runs Mumbai → Mumbai; authenticated cold/warm measurement remains |
| Structured Gemini features | Production verified | Grounded capture and read-only metric/chart responses passed; hosted fictional gates remain 50/50, 30/30 and 24/24 |
| Parser evaluation dataset | Done | 60 fictional cases, including merchant/platform/context/tag scenarios, plus an automated contract checker are in the repository |
| Private AI learning/eval ledger | Priority next | Audited private interactions, user corrections, token budgets and eval runs need RLS-backed storage, export/delete controls and sanitized dataset promotion |
| Accounts & family | Next implementation track | Product contract and secure architecture are complete; owner maintenance ships before invitations |
| Family email invitations | Sprint 2B | Permission model is defined; owner-only RLS hardening must land before any invited viewer |
| Account-specific history | Done locally | The ledger filters banks/cards and includes both sides of a transfer |
| Accounts/cards management after onboarding | Backlog | Detailed V2 settings task is recorded |
| Production acceptance | In progress | Current V1 fictional happy path and responsive sweep passed; two-owner isolation, fresh-household encrypted restore and real provider-unavailable recovery remain |

## Senior product audit — net-new additions

The full journey review is in
[`artifacts/product/2026-08-08-senior-product-usability-audit.md`](artifacts/product/2026-08-08-senior-product-usability-audit.md).
Existing isolation, recovery, Accounts & family, correction, settlement,
invitation and assistant-evidence tasks remain unchanged; this table contains
only additions that were missing from the board.

| ID | Status | Placement | Net-new task | Acceptance gate |
| --- | --- | --- | --- | --- |
| PA-01 | Done — implementation/automated | Current hardening; real-data gate | Manual Expense/Income/Transfer recovery and safe type correction | Exact text survives AI failure; all three types reach valid review; no write before confirm |
| PA-02 | Done — implementation/automated | Current hardening; real-data gate | Server-owned category correction control | Only direction-valid household categories can be submitted; unavailable state retries without losing the draft |
| PA-03 | Planned | First Sprint 2 slice; real-data gate | Post-confirm **View transaction** recovery entry point | Reuses audited edit/soft-delete; balances recalculate atomically; retries are idempotent |
| PA-04 | Done — implementation/automated | Fictional-pilot hardening; real-data privacy gate | In-product AI provider/data-use disclosure | Fictional-only restriction is visible; real data waits for an approved privacy configuration; telemetry stores no content |
| PA-05 | Done — implementation/automated | Current hardening | Quick Add account-context error and retry state | Failure explains disabled confirmation; retry preserves text/draft; no unhandled error |
| PA-06 | Planned | Before candidate publication | Remove stale active-QA deterministic fallback claims | QA matches Gemini-only interpretation, exact-text manual recovery and honest assistant unavailability |
| PA-07 | Planned | Sprint 2 product quality | Resumable onboarding, field errors and first-transaction guidance | Refresh preserves safe setup fields; each error identifies its field; empty states offer a next action |
| PA-08 | Planned | Sprint 2 shared-money slice | Member-paid expense capture in the web | Owner account does not move; owner's payable and member balance update; settlement later clears without income/spend |
| PA-09 | Planned | Sprint 2 measurement | Privacy-safe activation/capture/reliability events | No text, amounts, balances, emails, account/member names or assistant questions are emitted |
| PA-10 | Later | After daily capture is proven | Optional missing-transaction reminder and weekly review | User-controlled cadence; no financial content in notifications; dismissal/snooze supported |

PA-01, PA-02, PA-04 and PA-05 are complete only at the implementation and
automated-test level on the unpublished hardening branch. After deployment,
Expense, Income, Transfer and provider-unavailable recovery still require
manual final-domain acceptance. Real family-finance data also remains blocked
on privacy approval, isolation, restore and log-redaction evidence.

## Sprint 1 — trust and capture foundation

### Authentication and onboarding

- [x] Verify magic-link callback on the final domain in the same browser.
- [x] Verify session survives navigation and a fresh app load.
- [ ] Verify session survives a full browser process close and reopen.
- [x] Replace local-only profile hydration with a server profile/household endpoint.
- [x] Hydrate an existing user's display name, household and participants from the server after setup lookup.
- [x] Clarify login copy: the same email action creates a first account or signs in a returning user.
- [x] Prove on the final domain that a returning user does not repeat onboarding in the same browser.
- [ ] Repeat returning-user hydration on a second device/browser profile.
- [x] Add explicit callback, expired-link and wrong-browser recovery states.
- [x] Verify sign-out clears the local session and returning sign-in restores the same ledger.

### Natural-language capture and transfers

- [x] Parse `25k` as ₹25,000 and Indian lakh shorthand as rupees, then store integer paise.
- [x] Resolve ordered source and destination accounts from `ICICI -> HDFC`.
- [x] Render separate **Transfer from** and **Transfer to** review controls.
- [x] Prevent family splits and same-account confirmation for transfers.
- [x] Confirm transfers through the atomic, idempotent Supabase `create_transfer` RPC.
- [x] Keep total balance, income and spending unchanged for internal transfers.
- [x] Collapse paired transfer rows into one production history movement with zero cashflow.
- [x] Replace raw-row prefix pagination with a logical ledger activity projection so a transfer pair cannot be split at a page boundary.
- [x] Add an account activity filter that includes both the source and destination side of transfers.
- [x] Run the full local web/API test and production-build gate.
- [x] Run the authenticated production transfer, income, expense, card, split and filter smoke tests.

### Runtime reliability

- [x] Identify Vercel Washington-to-Supabase Mumbai region mismatch.
- [x] Configure the Python API for Vercel Mumbai (`bom1`) with Fluid compute.
- [x] Increase the browser API timeout from 3.5 seconds to 10 seconds.
- [x] Retry transient reads and explicitly idempotent writes once.
- [x] Never retry an unsafe onboarding write automatically.
- [ ] Deploy and measure cold plus warm authenticated requests.
- [x] Verify the deployed API executes in Mumbai (`bom1`) beside Supabase.
- [x] Add a truthful offline/network-state banner without claiming that V1 queues writes.
- [ ] Add sanitized authenticated cold/warm latency evidence.

### Structured LLM parsing and evaluation

- [x] Define a strict provider-neutral capture schema for kind, paise, accounts, category, members and date.
- [x] Ground every model-selected ID against server-provided allow-lists.
- [x] Reject invented account, category or member IDs.
- [x] Represent `draft`, `clarify` and `reject` as separate model outcomes.
- [x] Surface model warnings and never label a warned draft “Looks good”.
- [x] Reuse one idempotency key when the user retries the same reviewed draft.
- [x] Keep model output advisory and review-before-write.
- [x] Finish the production parsing endpoint regression tests.
- [x] Add 50 fictional evaluation cases across English, Hinglish, typos and ambiguity.
- [x] Validate dataset IDs, allow-listed entities, outcomes and integer-paise values in CI.
- [x] Gate 22 common/safety-critical deterministic drafts plus negative, ambiguous and unknown-member input.
- [x] Add a hosted-model evaluation runner with field/outcome/tag slices and sanitized reports.
- [x] Archive the superseded Qwen/Groq baseline as historical provider evidence;
  neither provider is part of the current production runtime or fallback path.
- [x] Add Gemini through the official server-side SDK with `store=false`, strict
  validation and exact-text manual recovery when interpretation is unavailable.
- [x] Separate HTTP/rate-limit/timeout/schema/grounding failures from model correctness without persisting private text.
- [x] Respect `Retry-After`, back off safely, checkpoint progress and resume unfinished cases.
- [x] Pass the hosted fictional gates: capture 50/50, auto-tag 30/30 and assistant 24/24.
- [x] Verify production Gemini capture plus read-only metric/chart assistant responses; retain the 30/30 hosted auto-tag gate as the current tagging evidence.
- [x] Remove deterministic production language interpretation; preserve exact text and open manual review when model capture is unavailable.
- [x] Constrain assistant output to an approved intent narrative and the exact server-owned widget bundle.
- [x] Publish AI-primary PR #20 as `69e44a8`; pass main CI `31268322011`, CodeQL
  `31268322023` and both web/API Vercel deployments.
- [x] Pass the current hardening branch gate: 170 web tests, 223 API tests, 8
  migrations, 4 SQL contracts and 50 capture + 30 auto-tag + 24 assistant cases.
- [x] Manually verify fictional capture success, zero/incomplete-transfer guards, assistant success/failure and no 320/390/1440 Quick Add/Assistant overflow in light/dark.
- [ ] Re-run hosted fictional Gemini gates with the ignored server-side key for
  the current hardening follow-up.
- [ ] Publish the hardening follow-up, then manually verify Expense, Income,
  Transfer and provider-unavailable recovery on the final domain.

## Sprint 2 — Accounts & family

**Entry gate:** Sprint 1 login/session, two-household isolation and transfer
smoke tests pass on the final domain.

Detailed acceptance criteria and security decisions live in
[`artifacts/architecture/sprint-2-accounts-family-contract.md`](artifacts/architecture/sprint-2-accounts-family-contract.md)
and [`artifacts/architecture/v2-accounts-family-management.md`](artifacts/architecture/v2-accounts-family-management.md).

### Sprint 2A — owner maintenance

| ID | Status | Task | Depends on | Acceptance gate |
| --- | --- | --- | --- | --- |
| S2-01 | Next | Owner-only **Accounts & family** settings snapshot and responsive route | Sprint 1 production acceptance | Returning owner sees active/archived server data; non-owner gets `403` |
| S2-02 | Planned | Add, rename, archive and restore banks, cash, wallets and cards | S2-01 | Immutable type/currency, duplicate-name and non-zero/archive rules pass |
| S2-03 | Planned | Update card limit, statement day and due day | S2-02 | Card-only validation and over-limit warning pass |
| S2-04 | Planned | Audited balance correction using append-only adjustment movements | S2-02 | Balance changes exactly; income/spend/splits remain unchanged |
| S2-05 | Planned | Add, rename, deactivate and restore non-login participants | S2-01 | Historical splits survive; unsettled people cannot be deactivated |

### Sprint 2B — family access

| ID | Status | Task | Depends on | Acceptance gate |
| --- | --- | --- | --- | --- |
| S2-06 | Planned | Harden base-table RLS/RPCs to owner-only before adding viewers | S2-01 | Direct viewer reads of accounts, ledger, roster and audit are denied |
| S2-07 | Planned | Invitation create/resend/expire/accept/revoke lifecycle | S2-05, S2-06 | Token hash, email match, single-use acceptance and immediate revocation pass |
| S2-08 | Planned | **Shared with me** minimal read model and mobile UI | S2-07 | Viewer sees only their shared expenses/settlements, never private balances |
| S2-09 | Planned | Two-owner/two-viewer production isolation and revocation matrix | S2-08 | Cross-household and unrelated-row probes return no data |

### Sprint 2C — private capture learning loop

| ID | Status | Task | Depends on | Acceptance gate |
| --- | --- | --- | --- | --- |
| S2-10 | Planned | Store private capture feedback: original text, parser/model/version, proposed JSON and user-confirmed JSON | Privacy/schema review | Enabled by default with clear onboarding disclosure; never written before review |
| S2-11 | Planned | Add Settings toggle plus export and delete-all controls | S2-10 | Household can disable, export and permanently remove learning history |
| S2-12 | Planned | Promote reviewed, sanitized examples into versioned eval cases | S2-10 | No automatic external training or public dataset use without separate consent |
| S2-13 | Priority next | Add token-budget scheduler and per-case checkpoints for capture, auto-tagging and assistant evals | Hosted benchmark evidence | RPM/RPD/TPM/TPD headers are respected; unfinished cases resume without repeated completed calls |
| S2-14 | Priority next | Add RLS-backed `ai_interactions` and append-only `ai_interaction_reviews` audit tables | Privacy contract | Only the owning household can read/export/delete; no keys, provider prose or account numbers are stored |
| S2-15 | Planned | Add `model_eval_runs` and `model_eval_cases` with versioned model/prompt/schema metadata | S2-13 | Every benchmark and failure is queryable without storing private input text |

Detailed schema and privacy rules: [`artifacts/architecture/private-ai-learning-eval-ledger.md`](artifacts/architecture/private-ai-learning-eval-ledger.md).

## Sprint 3 — recovery, production quality and measured AI

### Recovery and corrections

- [x] Define a versioned export bundle with schema version and checksums.
- [x] Add client-side encrypted export; the passphrase never reaches Artha.
- [x] Restore first into a new or empty household with a full preview and atomic validation.
- [ ] Add correction, soft-delete, settlement and dedicated per-account activity UI.
- [x] Prove restored balances, transfers, splits and audit facts match in local SQL round-trip acceptance.
- [ ] Repeat the encrypted export/restore drill with fictional data on the final domain.

### Production quality

- [x] Add Vercel Web Analytics and Speed Insights with query/fragment redaction tests.
- [ ] Record cold/warm authenticated latency after the Mumbai deployment.
- [ ] Add privacy-first Sentry error monitoring after explicit approval: error events only, no Session Replay, financial payloads, emails or IP collection, with client/server redaction tests.
- [ ] Add a deliberate per-user rate-limit policy.
- [x] Add no-store API caching policy and web/API security headers locally.
- [x] Verify deployed HSTS, nosniff, frame, referrer and permissions headers.
- [ ] Record sanitized browser/API log-redaction evidence.
- [ ] Test PWA install/reopen, offline unsaved drafts, expired auth and accessibility.
- [x] Confirm all six primary pages have no horizontal overflow at 320 px, 390 px and 1440 px; verify light/dark switching and mobile/desktop dark UI.

Current production evidence: Home, Transactions, Quick Add, Shared, Assistant
and Settings fit at 320 px, 390 px and 1440 px without horizontal overflow.
System/light/dark switching works; Home passed mobile and desktop dark visual
review. Onboarding and auth recovery remain covered by their earlier focused
responsive artifact rather than this authenticated primary-page sweep.
See [`artifacts/qa/2026-08-06-web-interface-guidelines-audit.md`](artifacts/qa/2026-08-06-web-interface-guidelines-audit.md).

### Measured AI

- [x] Add deterministic and hosted-model scoring runners for the 60-case dataset.
- [ ] Publish separate amount/date/account/transfer/split/Hinglish error slices.
- [x] Select hosted Gemini for sample-data traffic after all critical-field gates pass.
- [ ] Show assistant evidence range, source count and matching transactions.
- [ ] Prove assistant totals equal deterministic database calculations.

## Sprint 4 — optional channels and net-worth foundation

### Messaging capture (independent release gate)

- [ ] Define a provider-neutral message → authenticated unsaved draft → PWA review link flow.
- [ ] Pilot Telegram first; reassess current WhatsApp pricing and account requirements before committing.
- [ ] Verify webhook signatures, sender mapping, replay protection, rate limits and consent.
- [ ] Never confirm a ledger write from a message alone.

### Investments and liabilities (independent release gate)

- [ ] Add a top-level **Investments** tab; detailed product, valuation and data-source scope must be approved during sprint planning before implementation.
- [ ] Start the first tracking slice with mutual funds and stocks only.
- [ ] Show invested amount, current value, absolute gain/loss, allocation and the timestamp/source of every valuation.
- [ ] Model investment accounts, instruments, holdings/lots, liabilities and dated prices.
- [ ] Start with manual entry and CSV import; defer bank/broker aggregation.
- [ ] Keep portfolio transfers separate from spending and show valuation timestamps.
- [ ] Reconcile holdings from transactions and prevent net-worth double counting.
- [ ] Defer trading, advice, tax calculations and automatic corporate actions.

## Next data sprint — metadata analytics and reusable tags

- [ ] Add household-managed tags, aliases, lifecycle controls and relational
  transaction links with RLS and recovery versioning.
- [ ] Add merchant/platform/category personal-share aggregates that exclude
  transfers and card payments.
- [ ] Add canonical, database-calculated Ask Artha breakdown bundles; Gemini may
  select a bundle but never calculate its values.
- [ ] Add edit/correction behavior for reviewed metadata without rewriting
  unrelated history.

## Future sprint candidate — agentic Ask Artha

This is intentionally parked. Its exact scope, sequencing, model/tool choice,
cost budget and acceptance gates must be decided in a dedicated sprint-planning
session before implementation.

- [ ] Evolve Ask Artha beyond its current fixed-intent assistant into a bounded
  multi-step financial-analysis agent.
- [ ] Define server-owned read-only tools for transaction search, period and
  category comparison, account analysis, recurring-spend detection, anomaly
  review and evidence retrieval.
- [ ] Require every number and conclusion to link back to deterministic ledger
  calculations and matching transactions; model reasoning is never ledger truth.
- [ ] Show a user-friendly activity/evidence trail and generative UI without
  exposing raw private chain-of-thought or rendering model-authored HTML.
- [ ] Keep read-only analysis automatic; any create/edit/delete capability may
  only prepare a reviewable draft and requires explicit user confirmation.
- [ ] Define tool-step, latency, token/cost, privacy, audit, failure and evaluation
  budgets before enabling an agent loop in production.
- [ ] Keep payments, transfers of real money, trading and autonomous financial
  actions outside Artha's authority.

## Release blockers before real financial data

- [x] Final-domain new/returning login, fresh app load and sign-out/re-login pass.
- [ ] Session survives a full browser process close and reopen.
- [ ] Two independent owners cannot read or write each other's households.
- [x] Multi-account/card onboarding, a transfer, a backdated expense and family splits pass end to end with fictional data.
- [ ] Repeat setup with the owner's complete four-bank/multiple-card configuration.
- [x] All six primary pages fit at 320 px, 390 px and 1440 px; explicit theme switching passes.
- [ ] Browser/API logs contain no tokens or financial payloads.
- [x] Security headers are enabled and verified.
- [ ] Encrypted export/restore reconstructs the ledger successfully.
- [ ] Real family-finance text is approved only after a reviewed privacy configuration.
- [ ] The capture-hardening follow-up passes final-domain Expense, Income,
  Transfer and provider-unavailable acceptance after deployment.

## Actions needed from the user

1. Use a second fictional identity for isolation testing; never share passwords or email tokens.
2. Use that fresh/empty household for the encrypted restore acceptance drill.
3. Production Gemini variables are configured. Save the key in the ignored local
   `.env` only if local hosted evaluation is required; never commit it.

## Completion update format

Every finished item is reported as:

1. **Done:** the user-visible outcome.
2. **How it works:** the important product and technical behavior.
3. **Where:** links to code, tests and artifacts.
4. **Verified:** exact tests and production checks.
5. **Next:** the first remaining board item.
