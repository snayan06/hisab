# Architecture artifacts

This directory holds the maintained architecture pack and focused technical
contracts. Start with the product overview, then open only the component view
needed for the decision or review at hand.

## Architecture diagram pack

Every board has an editable Excalidraw source and a checked-in SVG exported from
the same scene.

| View | Use it to understand | Editable source | Rendered view |
|---|---|---|---|
| Product architecture | The complete capture, review, ledger and read-only assistant story | [Excalidraw](../../assets/artha-architecture.excalidraw) | [SVG](../../assets/artha-architecture.svg) |
| Capture and metadata | Grounded interpretation, clarification, structured suggestions and confirmation | [Excalidraw](diagrams/artha-capture-metadata.excalidraw) | [SVG](diagrams/artha-capture-metadata.svg) |
| Ledger and shared money | Transaction semantics, atomic writes, splits and derived balances | [Excalidraw](diagrams/artha-ledger-shared-money.excalidraw) | [SVG](diagrams/artha-ledger-shared-money.svg) |
| Identity and household isolation | Login, verified request context, membership, RLS and tenant isolation | [Excalidraw](diagrams/artha-identity-household-isolation.excalidraw) | [SVG](diagrams/artha-identity-household-isolation.svg) |
| Ask Artha | Canonical facts, Gemini intent selection, exact validation and safe generative UI | [Excalidraw](diagrams/artha-ask-artha.excalidraw) | [SVG](diagrams/artha-ask-artha.svg) |
| Deployment and recovery | Vercel/Supabase/Gemini topology, CI, telemetry and encrypted recovery | [Excalidraw](diagrams/artha-deployment-recovery.excalidraw) | [SVG](diagrams/artha-deployment-recovery.svg) |

## Supporting architecture documents

- [System architecture](../../system-architecture.md)
- [Database structure](../../database-schema.md)
- [Supabase migrations](../../../supabase/migrations/)
- [Auto-tagging design](../../auto-tagging.md)

## Feature contracts

- [Atomic account-transfer contract](v1-atomic-transfer.md)
- [LLM usage map and safety boundary](v1-llm-usage-map.md)
- [Encrypted ledger recovery](v1-encrypted-ledger-recovery.md)
- [Gemini provider evaluation and safety decision](2026-08-06-gemini-provider-evaluation.md)
- [Private AI learning and evaluation ledger](private-ai-learning-eval-ledger.md)
- [Sprint 2 Accounts & family product contract](sprint-2-accounts-family-contract.md)
- [Accounts & family implementation architecture](v2-accounts-family-management.md)

Future generated OpenAPI snapshots and exported ER diagrams should be stored
here with the source commit recorded in the artifact.
