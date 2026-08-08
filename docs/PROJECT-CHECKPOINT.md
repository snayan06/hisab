# Artha project checkpoint

Updated: 9 August 2026, 01:10 IST

This is the first document to read when starting or resuming Artha work. It is
the concise handoff between the user and Codex. Use the
[sprint board](SPRINT-BOARD.md) for ordered sprint execution and
[task list](TASKS.md) for the complete backlog.

## How to maintain this checkpoint

After every meaningful work batch:

1. Update the timestamp and current release state.
2. Record what changed, how it was verified and the next exact action.
3. Keep the morning/run-resume checklist current.
4. Link detailed evidence instead of copying large reports here.
5. Never include passwords, tokens, email links, real balances or private
   financial data.

## Current release state

**Status: the deployed production baseline remains `c4ae0dc`. The message UX,
structured metadata, architecture pack, production/demo separation and password
sign-in release candidate is locally green on `codex/message-ux`, but is not yet
merged or deployed.**

Do not enter real financial data yet. New and returning login, onboarding,
financial flows, Gemini capture/assistant behavior, encrypted export, manual
Expense/Income/Transfer recovery and the responsive page sweep passed on the
final domain. Two-owner isolation, a final-domain restore into a fresh
household, a real provider-unavailable exercise and privacy approval remain
release guards.

| Surface | Current state |
| --- | --- |
| Message/metadata release candidate | Local branch `codex/message-ux`; safe Enter behavior, grounded continuation, reviewed merchant/platform/category/context/tags, progress messages and 60-case capture evaluation are implemented; remote release gates remain |
| AI-primary production release | PR [#20](https://github.com/snayan06/artha/pull/20) merged as `69e44a8`; model-only production capture/assistant behavior and honest failure boundaries are published |
| V1 capture hardening | PR [#21](https://github.com/snayan06/artha/pull/21) merged as `c4ae0dc`; server-owned capture context, complete manual Expense/Income/Transfer recovery and the fictional-pilot AI data-use notice are deployed and final-domain accepted |
| Production `main` | Merge `c4ae0dc`; release PRs [#16](https://github.com/snayan06/artha/pull/16), [#17](https://github.com/snayan06/artha/pull/17), [#18](https://github.com/snayan06/artha/pull/18), [#20](https://github.com/snayan06/artha/pull/20) and [#21](https://github.com/snayan06/artha/pull/21) are merged |
| GitHub checks | Main CI run [31271421128](https://github.com/snayan06/artha/actions/runs/31271421128) passed Web/API/SQL; CodeQL run [31271421107](https://github.com/snayan06/artha/actions/runs/31271421107) passed JavaScript/TypeScript and Python analysis for `c4ae0dc` |
| Vercel | Web deployment `5811366329` and API deployment `5811363817` completed successfully for `c4ae0dc`; the final web and health URLs return `200` |
| Supabase RPC catalog | The exact `artha-production` project now resolves balances, logical activity, encrypted export and atomic restore RPCs |
| Public checks | API health and web return `200`; anonymous catalog probes resolve both required ledger RPCs without exposing ledger data |
| Authenticated journey | New-user magic link, returning-user link, session persistence, sign-out and restored server-owned onboarding passed with fictional data |
| Financial journey | Backdated split expense, `25k` income, `25k` transfer, card expense, filters and live dashboard/member updates passed |
| Gemini production | Final-domain expense, `25k` income, `25k` transfer and read-only balance assistant were manually verified with fictional data after `c4ae0dc`; hosted fictional gates remain 50/50, 30/30 and 24/24 |
| Responsive/theme | Home, Transactions, Quick Add, Shared, Assistant and Settings have no horizontal overflow at 320, 390 or 1440 CSS px; light/dark switching and mobile/desktop dark UI passed |
| Remaining gate | Two-owner isolation; full browser-process reopen; final-domain encrypted restore; real provider-unavailable recovery; sanitized log/latency evidence; real-data privacy approval; fresh hosted eval rerun; all Sprint 2+ features |

## Resume checklist

- [x] Apply and verify `20260805010000_logical_ledger_activity.sql` remotely.
- [x] Merge PR #11 and pass fresh main CI, CodeQL and Vercel deployments.
- [x] Verify public API health, web routing and baseline security headers.
- [x] Verify the deployed `list_ledger_activity` and `get_account_balances`
  endpoints resolve through PostgREST instead of returning `PGRST202`.
- [x] Complete authenticated login, reopen, sign-out, transfer and account-filter
  smoke tests using fictional data.
- [ ] Complete two-owner hosted isolation.
- [x] Complete the final-domain 320 px, 390 px and 1440 px primary-page sweep.
- [x] Implement client-side encrypted export/restore with an empty-household
  restore guard and local SQL round-trip contract.
- [x] Consolidate Gemini PR #15 and dependency PRs #8-#10 into one tested release.
- [x] Apply `20260806030000_encrypted_recovery.sql` to the exact Artha production
  project before deploying the application code that exposes recovery.
- [x] Merge and deploy the consolidated release; verify Gemini capture and
  assistant requests plus the hosted auto-tag gate.
- [x] Merge AI-primary PR #20 as `69e44a8`; pass main CI, CodeQL and both Vercel
  production deployments.
- [x] Publish the capture-hardening follow-up and manually accept Expense,
  Income, Transfer and exact-text manual recovery on the final domain.
- [ ] Exercise real provider-unavailable recovery on the final domain.
- [ ] Re-run the 60 capture, 30 auto-tag and 24 assistant hosted sample-data gates
  for the hardening follow-up.
- [ ] Verify session persistence across a full browser process close and reopen.
- [x] Download a client-side encrypted final-domain backup with fictional data.
- [ ] Restore that backup into a fresh/empty production household and compare totals.
- [ ] Approve a real-data privacy configuration before entering real family-finance text.
- [ ] Begin S2-01 owner-only **Accounts & family** settings after the acceptance gate.

## Completed in the deployed release and local hardening follow-up

- Explicit expired/reused magic-link, wrong-browser PKCE, invalid-callback and
  stale-session recovery.
- Server-owned onboarding/profile hydration for returning users.
- Correct `25k` → ₹25,000 transfer capture with source and destination accounts.
- Atomic idempotent transfers and pair-safe logical activity pagination.
- Transaction history filtering for banks/cards, including both transfer sides.
- Truthful offline state and baseline web/API security headers.
- A 60-case sample capture dataset plus a provider-neutral hosted evaluation
  runner. The pre-Gemini Qwen baseline is archived as historical evidence only;
  it is not a current provider or fallback.
- A Gemini provider adapter shared by capture, allow-listed auto-tagging and the
  validated read-only assistant, with fictional hosted gates of 50/50, 30/30
  and 24/24 respectively.
- Client-side encrypted export and preview-before-restore with an atomic,
  empty-household-only database restore boundary.
- Web bundle split: the main JavaScript chunk fell from 520 KB to 304 KB.
- Updated product, architecture, UI, backend, database and QA artifacts.
- Authenticated server-owned capture context for active accounts and
  direction-valid household categories.
- Exact-text manual Expense/Income/Transfer recovery, account-context retry and
  direction-valid category correction with no write before confirmation.
- A visible Gemini data-use notice that keeps the pilot fictional-only and
  documents the no-financial-content telemetry boundary.

## Verification checkpoint

```text
Current release candidate web: 19 files, 184 tests passed
Current release candidate API: 254 tests passed
Quality: ESLint, TypeScript, Ruff and strict mypy passed
Build: production PWA passed without the previous bundle-size warning
SQL: 8 migrations, seed and 4 SQL contract tests parsed
AI contracts: 60 capture, 30 auto-tag and 24 assistant cases valid
Fresh hosted Gemini gate: not run for this hardening follow-up; prior fictional production evidence remains 50/50, 30/30 and 24/24
Hardening recovery: focused automated Expense/Income/Transfer, category allow-list, context-retry and provider-unavailable tests pass; final-domain manual Expense/Income/Transfer recovery passed; real provider unavailability remains
Architecture artwork: no overflow and readable in a 736 px README-sized light/dark rendering; the full diagram fits at 390 px but dense labels require opening/zooming
Production baseline: capture-hardening PR #21 merged as c4ae0dc; main CI 31271421128, CodeQL 31271421107 and both web/API Vercel deployments are green
Candidate publication: not pushed, reviewed, merged or deployed yet
Public smoke: web root, transactions and assistant routes return 200; API health returns 200 from Mumbai
Recovery: exact production project resolves all four required RPCs without a PGRST202 catalog miss
Telemetry: Vercel Web Analytics and Speed Insights are mounted with tested query/fragment redaction
Authenticated production: new/returning magic link, persisted session, sign-out/re-login and server-owned onboarding passed
Financial production: expense, income, transfer, card, backdate, split, filters and live chart/member updates passed
Gemini production: grounded ₹123 expense, 25k income, 25k transfer and exact-balance assistant responses passed with fictional data on c4ae0dc
```

Detailed evidence: [capture-hardening production acceptance](artifacts/qa/2026-08-08-capture-hardening-production-acceptance.md)
and [Sprint 1 reliability batch](artifacts/qa/2026-08-05-reliability-batch.md).

## Product and engineering decisions to preserve

- Current scope is personal use with friends/family participating in expense
  splits. Separate invited-user access is Sprint 2, not a Sprint 1 dependency.
- Money is integer paise. Transfers and card payments are not spending or income.
- Natural-language and LLM parsing only create unsaved review drafts. A user must
  explicitly confirm every ledger write.
- Production natural-language capture requires Gemini and opens the manual form
  with exact text when interpretation is unavailable; it never substitutes a
  language-parser guess. The local parser remains demo/evaluation-only. Gemini
  is selected for the fictional private-pilot evaluation after full capture,
  auto-tag and assistant gates; free-tier Gemini must not receive real family-
  finance text.
- Private capture learning history is planned as default-on with clear notice,
  Settings disable/delete/export controls and no external training/public use
  without separate consent.
- Multiple banks/cards are first-class accounts. Post-onboarding account editing
  belongs in **Accounts & family** settings.
- Production order is always database migration → application deployment →
  authenticated acceptance. Never deploy code that depends on an absent RPC.
- Never claim production is green until final-domain authentication, two-owner
  isolation, responsive QA, recovery and export/restore gates pass.

## Remaining user actions

Only ask for these when the engineering work reaches the corresponding gate:

1. Use a second fictional test identity for household-isolation acceptance.
2. Restore the encrypted backup into that identity's fresh/empty household.
3. The production Gemini key is configured server-side. Add the same variable
   to the ignored local `.env` only when local hosted evaluation is needed.

## Next engineering priorities

1. Finish two-owner isolation and final-domain restore acceptance.
2. Exercise real provider-unavailable recovery without losing the submitted text.
3. Record sanitized browser/API log redaction and authenticated cold/warm latency.
4. Obtain real-data privacy approval and re-run the fresh hosted fictional gates.
5. Verify full browser-process reopen, then build S2-01 through S2-05 only after
   the V1 acceptance gate passes.

## Source-of-truth map

| Need | Document |
| --- | --- |
| Current handoff and resume point | This file |
| Ordered sprint execution | [SPRINT-BOARD.md](SPRINT-BOARD.md) |
| Full backlog | [TASKS.md](TASKS.md) |
| Product requirements | [product-requirements.md](product-requirements.md) |
| System architecture | [system-architecture.md](system-architecture.md) |
| Database structure | [database-schema.md](database-schema.md) |
| Deployment procedure | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Decisions | [DECISIONS.md](DECISIONS.md) |
| Detailed evidence | [artifacts/](artifacts/) |

## Checkpoint log

| Date | Checkpoint |
| --- | --- |
| 9 Aug 2026 | Implemented the message/metadata release candidate on `codex/message-ux`: safe Enter/Shift+Enter/IME behavior, grounded one-question capture continuation, merchant/platform/category precedence, bounded reviewed context and optional tags, truthful Quick Add/Ask Artha progress messages, versioned JSON persistence, 60 capture evals and a clean manager-ready editable architecture pack. Fresh local gate: 184 web, 254 API, build, SQL and 60/30/24 keyless AI contracts. The candidate is published as PR #23 but is intentionally not merged or deployed while the companion feature is completed. |
| 9 Aug 2026 | Prepared the approved message-UX and structured-transaction-metadata design on isolated branch `codex/message-ux` from current `origin/main`. The design covers composer keyboard safety, contextual capture continuation, warm accessible messaging, visible category reasoning, distinct merchant/platform/subcategory/tag taxonomy, bounded field evidence, normalized household tags/aliases, RLS/recovery/analytics/eval coverage and fictional final-domain acceptance. This is design-only and unpublished; no product code, migration, remote branch, PR or deployment was created before the work was handed back to the parent task. |
| 8 Aug 2026 | Merged V1 capture-hardening PR #21 as `c4ae0dc`; main CI `31271421128`, CodeQL `31271421107` and both production Vercel deployments passed. Final-domain fictional QA then passed persisted login, six core routes, manual Expense/Income/Transfer recovery, a saved ₹123 Gemini expense with exact dashboard movement, unsaved `25k` income/transfer drafts, read-only assistant balance, filters, shared reconciliation, encrypted export and 390 px light/dark layout |
| 8 Aug 2026 | Merged AI-primary PR #20 as `69e44a8`; main CI `31268322011`, CodeQL `31268322023` and web/API Vercel deployments passed. Separately added the editable architecture board and V1 capture hardening; after the latest boundary-quality fixes, that follow-up branch is locally green at 170 web, 223 API, 50+30+24 AI contracts and 8 migrations/4 SQL contracts, but is not published or deployed |
| 8 Aug 2026 | AI-primary feature candidate passed the final local gate (154 web, 209 API and 104 AI contracts), independent technical review, and fictional responsive QA at 320/390/1440 in light/dark; production capture is Gemini-only and fails into exact-text manual review; the candidate is not deployed yet |
| 7 Aug 2026 | Merged and deployed PRs #16-#18; completed real magic-link new/returning login, server-owned onboarding, fictional expense/income/transfer/card/split flows, transaction filters, Gemini capture/assistant, encrypted export and 320/390/1440 responsive acceptance; fixed live chart/member refresh and mobile chart overflow found during QA |
| 7 Aug 2026 | Consolidated Gemini and dependency PRs onto encrypted recovery; full local gate passed with 98 web and 122 API tests plus 104 AI dataset contracts; applied and catalog-probed the exact production recovery migration; production Gemini variables configured pending deployment |
| 7 Aug 2026 | Implemented encrypted export/restore, Settings recovery UI, recovery RPCs and two-household/round-trip SQL contracts; full local gate passed with 98 web and 112 API tests; production migration and consolidated Gemini release remain |
| 6 Aug 2026 | Deployed and merged PR #13; full local gate, CodeQL, Vercel, public routing, API health and both live RPC probes passed; GitHub Web/API/SQL runners remained queued during the GitHub Actions outage |
| 6 Aug 2026 | Recovered the production ledger RPC catalog, verified both required functions through the deployed REST endpoint and added exact-project release guards |
| 6 Aug 2026 | Logical-ledger migration applied; PR #11 merged; main CI, CodeQL, Vercel and public health/routing checks green; Sprint 2 contract and superseded pre-Gemini Qwen baseline recorded |
| 5 Aug 2026 | Release candidate implemented, manually checked, published as PR #11 and fully green; production held for Supabase migration authorization |
