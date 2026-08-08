# Real product and demo separation design

Status: approved for implementation
Date: 9 August 2026

## Product decision

Artha is the real personal and family money product. The authenticated
production application must not describe itself as a fictional pilot. The demo
is one allow-listed authenticated production account containing sample data;
it uses the same application, API, database policies and AI path as a personal
account. It is not a product status and it cannot silently replace another
user's ledger.

## Production identities

### Personal account

- Supabase authentication is required and every ledger request is scoped by the
  authenticated user's household and database RLS.
- Sample bootstrap, local parser fallback and sample balances are unavailable.
- Provider or ledger failure is shown honestly and never replaced with demo
  content.
- The UI uses normal product language. It may identify an AI-assisted action
  and link to data-use details, but it does not call the product a pilot.

### Demo account

- `test@artha.com` signs in through normal Supabase authentication. Because the
  address does not need to receive a magic link, the account is created as a
  confirmed password user and the login screen supports email/password in
  addition to the existing magic-link flow.
- The API identifies the account by its verified Supabase user UUID in
  `ARTHA_DEMO_ACCOUNT_USER_ID`. The typed email is never an authorization
  signal.
- The account is onboarded once through the ordinary production APIs with
  sample accounts, people and transactions. Its rows remain isolated by the
  same RLS policies as any other household.
- The profile response includes server-owned `is_demo=true`; the web app uses
  that value only to show a quiet `Demo` label. It does not use the phrase
  `fictional pilot`.
- The account persists changes so every production feature can be tested
  realistically. Resetting it is an explicit, separately authorized operation,
  not an automatic login side effect.

`VITE_DEMO_MODE=true` remains only for local development and automated web
tests. It must stay `false` on the deployed web project. The deployed demo
account never uses the local parser, local SQLite or browser sample fallbacks.

## AI data-use boundary

Google's published Gemini API terms distinguish unpaid from paid services.
Unpaid-service content may be used to improve Google products and may be
reviewed by people; Google says not to submit sensitive, confidential or
personal information to unpaid services. Paid-service prompts and responses
are not used to improve Google's products, although limited safety and abuse
processing can still apply.

Artha therefore uses an explicit server setting:

- `ARTHA_AI_DATA_POLICY=sample_only` is the safe default. Production capture,
  tagging and Ask Artha may call Gemini only for the allow-listed demo account.
  Other accounts reject provider calls that could contain personal ledger
  content. Manual transaction entry, dashboards and ledger management remain
  available.
- `ARTHA_AI_DATA_POLICY=private_approved` enables production Gemini calls only
  after the Gemini Cloud project has active billing and the deployment owner
  has reviewed the current provider terms.
- Development-only Ollama remains local and is not a hosted production
  fallback.

The API owns and enforces both the data policy and demo UUID. Browser state
cannot grant AI authority. Invalid or missing production policy values fail
closed to `sample_only`, and a missing demo UUID matches no account.

## Product copy

Quick Add and Ask Artha replace the amber pilot warning with a calm disclosure:

> AI-assisted. Artha sends this text to the configured AI provider to prepare a
> reviewable result. Nothing is written to your ledger until you confirm.

Ask Artha remains read-only, so its final sentence says that it cannot change
the ledger. Settings is the detailed source of truth and shows:

- configured provider and model;
- whether AI is available for personal data in this deployment;
- exactly what is sent and why;
- that capture creates only an unsaved draft;
- that the model cannot directly access or write the database;
- that analytics excludes financial text, amounts, account/member names,
  emails and assistant questions.

The demo account uses only a small `Demo` label. Marketing copy and the README
call the deployed application `V1` or `personal release`, not `pilot`.

## Documentation policy

Current product documents, deployment instructions, architecture and backlog
use real-product terminology. Historical QA and evaluation artifacts retain
`fictional data` where it accurately describes the test evidence; they are not
rewritten to imply tests used real financial data. Historical uses of `pilot`
inside dated decision records can remain when required for provenance, but
current status headings and links must not present Artha as a pilot.

## Verification

Automated tests must prove:

1. only literal `VITE_DEMO_MODE=true` enables the local development demo;
2. production never bootstraps or substitutes browser/local sample data;
3. only the configured, authenticated demo UUID receives `is_demo=true`;
4. the sample-only API policy allows the demo UUID but blocks capture, tagging
   and Ask Artha for every other UUID before a provider request;
5. private-approved policy preserves the existing Gemini contracts;
6. email/password and magic-link authentication both preserve session and RLS
   isolation;
7. Quick Add, Ask Artha and Settings contain accurate non-pilot disclosures;
8. the production build contains no current `fictional pilot` product copy;
9. documentation links, lint, types, API/web tests, SQL contracts and AI eval
   schema checks pass.

Manual acceptance covers personal magic-link login, `test@artha.com` password
login, demo-account isolation, mobile and desktop disclosure layouts,
provider-unavailable recovery and proof that no sample ledger appears for the
personal account.
