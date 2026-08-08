# Documentation artifacts

This directory is the single home for generated or captured project evidence.
The maintained source documentation remains in `docs/`; exports, screenshots,
reports and snapshots belong here.

## Structure

| Directory | Store here |
| --- | --- |
| [`ui/`](ui/) | Sanitized mobile/desktop screenshots, mockups and interaction recordings |
| [`architecture/`](architecture/) | Rendered diagrams, schema exports and API snapshots |
| [`qa/`](qa/) | Test summaries, responsive checks and release-verification reports |

## Naming

Use lowercase kebab-case and include the milestone or date when useful:

- `v1-mobile-home-dark.png`
- `v1-database-erd.svg`
- `2026-08-04-release-verification.md`

## Safety rules

- Use fictional names, accounts, merchants and balances only.
- Never commit credentials, tokens, production exports or real financial data.
- Prefer text or SVG for diagrams so changes remain reviewable.
- Keep source-of-truth decisions and requirements in the parent `docs/` folder.
- Link every material artifact from this index or its directory index.

## Current artifacts

- [Natural-language transfer review](ui/v1-natural-language-transfer.md)
- [Magic-link recovery states](ui/v1-auth-recovery.md)
- [Encrypted export and restore UI](ui/v1-encrypted-recovery.md)
- [Encrypted recovery architecture](architecture/v1-encrypted-ledger-recovery.md)
- [Recovery and isolation acceptance](qa/2026-08-06-encrypted-recovery.md)
- [Consolidated Gemini, recovery and telemetry release](qa/2026-08-07-consolidated-gemini-recovery-release.md)
- [Authenticated production acceptance](qa/2026-08-07-authenticated-production-acceptance.md)
- [Capture-hardening production acceptance](qa/2026-08-08-capture-hardening-production-acceptance.md)
- [Message UX and structured metadata release evidence](qa/2026-08-09-message-metadata-release.md)
- [Account activity filter](ui/v1-account-activity-filter.md)
- [Atomic transfer contract](architecture/v1-atomic-transfer.md)
- [LLM usage and safety map](architecture/v1-llm-usage-map.md)
- [Sprint 2 Accounts & family product contract](architecture/sprint-2-accounts-family-contract.md)
- [Accounts & family implementation architecture](architecture/v2-accounts-family-management.md)
- [Transfer and parser test gate](qa/2026-08-04-transfer-parser-gate.md)
- [First-request reliability diagnosis](qa/2026-08-04-first-request-reliability.md)
- [Sprint 1 manual QA pass](qa/2026-08-05-sprint-1-manual-pass.md)
- [Sprint 1 deployment verification](qa/2026-08-05-sprint-1-deployment.md)
- [Security headers and offline state](qa/2026-08-05-security-network.md)
- [Sprint 1 reliability batch](qa/2026-08-05-reliability-batch.md)
- [Production release acceptance](qa/2026-08-06-production-release-acceptance.md)
- [Web Interface Guidelines audit](qa/2026-08-06-web-interface-guidelines-audit.md)
- [V1 QA scenario matrix](qa/v1-scenario-matrix.md)
- [V1 public-release verification](qa/v1-public-release.md)
- [Production staging verification](qa/production-staging-verification.md)
- [Personal Supabase launch verification](qa/2026-08-04-personal-supabase.md)
- [Personal Vercel launch verification](qa/2026-08-04-personal-vercel.md)
- [UI artifact guide](ui/README.md)
- [Architecture artifact guide](architecture/README.md)
