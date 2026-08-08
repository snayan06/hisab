# Production Demo Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Artha a real authenticated production product while treating one allow-listed Supabase user as the isolated sample-data demo account and removing current `fictional pilot` product language.

**Architecture:** Every deployed user follows Supabase Auth, FastAPI, Supabase Postgres and RLS. The API derives demo identity from the verified JWT subject and `ARTHA_DEMO_ACCOUNT_USER_ID`, returns that fact in the profile/status contracts and allows sample-only Gemini calls only for that UUID; the browser never grants demo or AI authority. The existing `VITE_DEMO_MODE=true` path remains local-test-only.

**Tech Stack:** React 19, TypeScript, Vite, Supabase Auth, FastAPI, Pydantic, pytest, Vitest, Vercel, Supabase Postgres/RLS.

---

### Task 1: Server-owned demo identity and AI data policy

**Files:**
- Create: `apps/api/src/artha_api/ai_policy.py`
- Create: `apps/api/tests/test_ai_policy.py`
- Modify: `apps/api/src/artha_api/production_routes.py:1-52,268-292,727-950`
- Modify: `apps/api/src/artha_api/assistant.py:410-418`
- Test: `apps/api/tests/test_production_routes.py`

- [ ] **Step 1: Write failing policy tests**

```python
def test_sample_only_allows_only_configured_demo_uuid(monkeypatch):
    monkeypatch.setenv("ARTHA_AI_DATA_POLICY", "sample_only")
    monkeypatch.setenv("ARTHA_DEMO_ACCOUNT_USER_ID", DEMO_USER_ID)
    policy = AiAccessPolicy.from_env()
    assert policy.is_demo(DEMO_USER_ID) is True
    assert policy.can_send_financial_text(DEMO_USER_ID) is True
    assert policy.can_send_financial_text(PERSONAL_USER_ID) is False

def test_private_approved_allows_authenticated_users(monkeypatch):
    monkeypatch.setenv("ARTHA_AI_DATA_POLICY", "private_approved")
    monkeypatch.delenv("ARTHA_DEMO_ACCOUNT_USER_ID", raising=False)
    assert AiAccessPolicy.from_env().can_send_financial_text(PERSONAL_USER_ID) is True

def test_invalid_policy_fails_closed(monkeypatch):
    monkeypatch.setenv("ARTHA_AI_DATA_POLICY", "unknown")
    assert AiAccessPolicy.from_env().data_policy is AiDataPolicy.SAMPLE_ONLY
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `cd apps/api && uv run pytest tests/test_ai_policy.py -q`

Expected: collection fails because `artha_api.ai_policy` does not exist.

- [ ] **Step 3: Implement the pure policy object**

```python
class AiDataPolicy(StrEnum):
    SAMPLE_ONLY = "sample_only"
    PRIVATE_APPROVED = "private_approved"

@dataclass(frozen=True, slots=True)
class AiAccessPolicy:
    data_policy: AiDataPolicy
    demo_user_id: str | None

    @classmethod
    def from_env(cls) -> "AiAccessPolicy":
        raw = getenv("ARTHA_AI_DATA_POLICY", "sample_only").strip().casefold()
        try:
            policy = AiDataPolicy(raw)
        except ValueError:
            policy = AiDataPolicy.SAMPLE_ONLY
        demo_user_id = getenv("ARTHA_DEMO_ACCOUNT_USER_ID", "").strip() or None
        return cls(policy, demo_user_id)

    def is_demo(self, user_id: str) -> bool:
        return self.demo_user_id is not None and compare_digest(self.demo_user_id, user_id)

    def can_send_financial_text(self, user_id: str) -> bool:
        return self.data_policy is AiDataPolicy.PRIVATE_APPROVED or self.is_demo(user_id)
```

- [ ] **Step 4: Run the policy tests and verify GREEN**

Run: `cd apps/api && uv run pytest tests/test_ai_policy.py -q`

Expected: all policy tests pass.

- [ ] **Step 5: Write failing production-route tests**

Add tests proving `/api/v1/profile` returns `is_demo=true` only for the configured JWT subject, and that parse/chat/tag routes return `403` before constructing/calling `LocalFinancialAssistant` for a personal UUID under `sample_only`. Add a private-approved case proving the existing provider call remains reachable.

- [ ] **Step 6: Run focused route tests and verify RED**

Run: `cd apps/api && uv run pytest tests/test_production_routes.py -k 'demo_profile or ai_data_policy' -q`

Expected: profile lacks `is_demo` and AI routes still call the model.

- [ ] **Step 7: Enforce policy in production routes**

Add a focused helper:

```python
def require_ai_access(auth: AuthContext) -> AiAccessPolicy:
    policy = AiAccessPolicy.from_env()
    if not policy.can_send_financial_text(auth.user_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "AI features are not enabled for personal financial data in this deployment; use manual entry.",
        )
    return policy
```

Call it before model construction in parse, chat and tag-suggestion routes. Return
`is_demo` from the profile and expose `data_policy` plus
`personal_data_enabled` in authenticated assistant status without exposing the
configured UUID.

- [ ] **Step 8: Run focused API tests and commit**

Run: `cd apps/api && uv run pytest tests/test_ai_policy.py tests/test_production_routes.py -q`

Expected: focused suites pass.

```bash
git add apps/api/src/artha_api/ai_policy.py apps/api/src/artha_api/assistant.py apps/api/src/artha_api/production_routes.py apps/api/tests/test_ai_policy.py apps/api/tests/test_production_routes.py
git commit -m "feat: enforce production AI data policy"
```

### Task 2: Password login for the production test account

**Files:**
- Modify: `apps/web/src/lib/auth.tsx:12-31,218-260`
- Modify: `apps/web/src/pages/LoginPage.tsx:1-95`
- Modify: `apps/web/src/App.tsx:136-145`
- Test: `apps/web/src/lib/auth.test.tsx`
- Test: `apps/web/src/pages/LoginPage.test.tsx`

- [ ] **Step 1: Write failing auth and login tests**

Test that `signInWithPassword(email, password)` calls Supabase
`auth.signInWithPassword`, normalizes the email, never persists the password and
returns the same generic failure message for invalid credentials. Test that the
login UI offers `Use password` as a secondary option, submits on Enter and keeps
magic link as the default flow.

- [ ] **Step 2: Run focused web tests and verify RED**

Run: `cd apps/web && npm test -- --run src/lib/auth.test.tsx src/pages/LoginPage.test.tsx`

Expected: the context and UI do not expose password sign-in.

- [ ] **Step 3: Add the password auth method**

```typescript
signInWithPassword: async (email: string, password: string) => {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase authentication is not configured.')
  const { error: signInError } = await client.auth.signInWithPassword({
    email: email.trim(),
    password
  })
  if (signInError) throw new Error('Email or password did not match. Please try again.')
  setRecovery(null)
}
```

Add a small secondary password form to `LoginPage`; do not hardcode
`test@artha.com`, a password or a test-account shortcut. Wire it through `App`.

- [ ] **Step 4: Run focused web tests and commit**

Run: `cd apps/web && npm test -- --run src/lib/auth.test.tsx src/pages/LoginPage.test.tsx`

Expected: focused suites pass with no console warnings.

```bash
git add apps/web/src/lib/auth.tsx apps/web/src/pages/LoginPage.tsx apps/web/src/App.tsx apps/web/src/lib/auth.test.tsx apps/web/src/pages/LoginPage.test.tsx
git commit -m "feat: support secure password sign in"
```

### Task 3: Demo badge from the authenticated profile

**Files:**
- Modify: `apps/web/src/types.ts:38-42`
- Modify: `apps/web/src/lib/api.ts:396-404`
- Modify: `apps/web/src/App.tsx:20-25,145-250`
- Test: `apps/web/src/lib/api.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing profile/demo tests**

Add an API-mapping test for `is_demo`. Add an App test proving an authenticated
profile with `isDemo=true` shows `Demo data` while a personal profile and any
ledger-load failure never show it.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd apps/web && npm test -- --run src/lib/api.test.ts src/App.test.tsx`

Expected: `UserProfile` has no `isDemo` and the production profile cannot drive
the badge.

- [ ] **Step 3: Map and derive demo presentation**

```typescript
export interface UserProfile {
  displayName: string
  householdName: string
  members: HouseholdMember[]
  isDemo: boolean
}
```

Map `raw.is_demo === true`, default cached/legacy profiles to `false`, and derive
the badge from `localDemo || profile.isDemo`. Do not let dashboard response
errors or local storage turn a personal profile into demo mode.

- [ ] **Step 4: Run focused tests and commit**

Run: `cd apps/web && npm test -- --run src/lib/api.test.ts src/App.test.tsx src/pages/HomePage.test.tsx src/pages/TransactionsPage.test.tsx`

Expected: all focused tests pass.

```bash
git add apps/web/src/types.ts apps/web/src/lib/api.ts apps/web/src/App.tsx apps/web/src/lib/api.test.ts apps/web/src/App.test.tsx
git commit -m "feat: label the authenticated demo account"
```

### Task 4: Replace pilot warnings with accurate product disclosures

**Files:**
- Modify: `apps/web/src/pages/QuickAddPage.tsx:210-220`
- Modify: `apps/web/src/pages/AssistantPage.tsx:48-58`
- Modify: `apps/web/src/pages/SettingsPage.tsx:1-35`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/src/pages/QuickAddPage.test.tsx`
- Test: `apps/web/src/pages/AssistantPage.test.tsx`
- Test: `apps/web/src/pages/SettingsPage.test.tsx`

- [ ] **Step 1: Rewrite tests first**

Require an accessible `AI-assisted` disclosure, no `fictional pilot` text and
the statements “review before saving” for capture and “read-only” for Ask
Artha. Settings must render server status and clearly distinguish
`sample_only` from `private_approved` without claiming zero retention.

- [ ] **Step 2: Run disclosure tests and verify RED**

Run: `cd apps/web && npm test -- --run src/pages/QuickAddPage.test.tsx src/pages/AssistantPage.test.tsx src/pages/SettingsPage.test.tsx`

Expected: current fictional-pilot assertions/copy fail the new contract.

- [ ] **Step 3: Implement calm, truthful copy**

Use the shared wording:

```text
AI-assisted. Artha sends this text to the configured AI provider to prepare a
reviewable result. Nothing is written to your ledger until you confirm.
```

For Ask Artha, end with `Ask Artha is read-only and cannot change your ledger.`
Settings loads authenticated assistant status, shows the configured provider,
model and data policy and retains the analytics exclusion statement.

- [ ] **Step 4: Run disclosure tests and commit**

Run: `cd apps/web && npm test -- --run src/pages/QuickAddPage.test.tsx src/pages/AssistantPage.test.tsx src/pages/SettingsPage.test.tsx`

Expected: all disclosure tests pass.

```bash
git add apps/web/src/pages/QuickAddPage.tsx apps/web/src/pages/AssistantPage.tsx apps/web/src/pages/SettingsPage.tsx apps/web/src/lib/api.ts apps/web/src/pages/QuickAddPage.test.tsx apps/web/src/pages/AssistantPage.test.tsx apps/web/src/pages/SettingsPage.test.tsx
git commit -m "fix: present Artha as the production product"
```

### Task 5: Current docs, configuration and release evidence

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/PROJECT-CHECKPOINT.md`
- Modify: `docs/SPRINT-BOARD.md`
- Modify: `docs/TASKS.md`
- Modify: `docs/product-requirements.md`
- Modify: `docs/system-architecture.md`
- Modify: `docs/DECISIONS.md`
- Create: `docs/artifacts/qa/2026-08-09-production-demo-account-acceptance.md`

- [ ] **Step 1: Update configuration examples**

Production API configuration includes:

```dotenv
ARTHA_AI_DATA_POLICY=sample_only
ARTHA_DEMO_ACCOUNT_USER_ID=<verified-supabase-user-uuid>
```

Document that switching to `private_approved` requires an active billed Gemini
Cloud project and a review of current provider terms. Never store the demo
password, API key or real UUID in the repository.

- [ ] **Step 2: Update current product language**

Replace current release badges/headings such as `private pilot` and `Live pilot`
with `V1` and `Live app`. Keep dated QA artifacts unchanged when `fictional`
accurately describes their inputs. Update the checkpoint to distinguish
implemented/local, deployed and manually accepted state.

- [ ] **Step 3: Run documentation and terminology checks**

Run:

```bash
python3 scripts/check_docs_links.py
rg -n -i "fictional[- ]pilot|private[- ]pilot|live pilot" README.md docs/DEPLOYMENT.md docs/PROJECT-CHECKPOINT.md docs/SPRINT-BOARD.md docs/TASKS.md docs/product-requirements.md docs/system-architecture.md apps/web/src
```

Expected: link checker passes; terminology search returns only explicit
historical-policy explanations or no current product UI/status references.

- [ ] **Step 4: Run the full local gate**

Run: `make check`

Expected: ESLint, TypeScript, Ruff, mypy, all web/API tests, production build,
SQL contracts and AI dataset validators pass.

- [ ] **Step 5: Commit docs and evidence**

```bash
git add .env.example README.md docs
git commit -m "docs: document production demo account"
```

- [ ] **Step 6: Release without inventing evidence**

Push only after review. Create the confirmed `test@artha.com` Supabase password
user outside source control, set its UUID in the API environment, onboard it
with sample data through normal production endpoints and leave
`VITE_DEMO_MODE=false`. After CI/CodeQL and both Vercel deployments pass,
manually verify personal magic-link login, demo password login, RLS isolation,
capture/manual entry/assistant behavior, mobile/desktop layouts and sign-out.
Record exact non-secret evidence in the QA artifact.

### Task 6: Senior engineering review and production release

**Files:**
- Review: `apps/web/src/**`
- Review: `apps/api/src/artha_api/**`
- Review: `supabase/migrations/**`
- Review: `.github/workflows/**`
- Modify only files implicated by verified findings
- Modify: `docs/PROJECT-CHECKPOINT.md`
- Modify: `docs/artifacts/qa/2026-08-09-production-demo-account-acceptance.md`

- [ ] **Step 1: Review architecture and product invariants**

Trace login → onboarding/profile → dashboard → capture draft → explicit
confirmation → ledger RPC → refreshed dashboard. Confirm integer paise,
transaction/share separation, transfer invariants, idempotency, RLS ownership,
fail-closed AI policy and no sample-data fallback in production.

- [ ] **Step 2: Review frontend quality**

Apply the Web Interface Guidelines and React performance guidance to auth,
onboarding, Home, Transactions, Quick Add, Shared, Ask Artha and Settings.
Check keyboard behavior, focus, semantic labels, error recovery, 320/390/1440
layouts, light/dark themes, scroll/overflow, stale requests and unnecessary
render/network work.

- [ ] **Step 3: Run a standard security audit**

Review JWT validation, Supabase token forwarding, RLS reliance, CORS, secret
boundaries, demo-account identification, password handling, prompt injection,
model output validation, recovery encryption and logging/analytics redaction.
Only validated findings are fixed; every behavior fix starts with a failing
test.

- [ ] **Step 4: Re-run all local release gates**

Run:

```bash
make check
python3 scripts/check_docs_links.py
git diff --check origin/main...HEAD
```

Expected: all gates pass, documentation links resolve and the committed diff
has no whitespace errors.

- [ ] **Step 5: Publish through review**

Push `codex/message-ux`, open a PR against `main`, inspect the complete diff and
GitHub review/check results, address validated feedback and merge only after CI
and CodeQL are green.

- [ ] **Step 6: Verify deployment and live behavior**

Confirm the web and API Vercel deployments are built from the merged `main`
SHA. Probe web routes, API health and security headers, then manually exercise
login/session persistence, demo badge and isolation, onboarding/profile,
manual and AI capture safety, confirmation/idempotency, transactions/filters,
shared balances, Ask Artha, Settings/export, sign-out and responsive layouts.

- [ ] **Step 7: Close the checkpoint honestly**

Record commit, PR, CI, CodeQL, deployment and live-smoke evidence. If creation
of the Supabase `test@artha.com` user or private-approved Gemini billing cannot
be performed without user credentials, record that exact external gate and do
not describe those paths as accepted.
