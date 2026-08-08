# Manager-ready architecture set design

Status: accepted for implementation
Date: 9 August 2026

## Goal

Replace the crowded working sketch with a small, consistent architecture pack
that a product manager, engineer or reviewer can understand without a guided
walkthrough. The drawings should retain Excalidraw's developer-authored feel,
but use that style for warmth rather than visual noise.

## Deliverables

The pack contains one product overview and five focused component views:

1. **Product architecture** — the end-to-end production system and its three
   authority boundaries: person, application code and ledger.
2. **Capture and metadata** — grounded natural-language interpretation,
   clarification, review, structured metadata and confirmed write.
3. **Ledger and shared money** — expenses, income, transfers, splits,
   settlements, derived balances and atomic persistence.
4. **Identity and household isolation** — Supabase Auth, verified request
   context, membership, RLS and cross-household protection.
5. **Ask Artha** — bounded database facts, Gemini intent selection, exact
   server validation and repository-owned read-only widgets.
6. **Deployment, quality and recovery** — the Vercel/Supabase/Gemini topology,
   CI gates, privacy-filtered telemetry and client-side encrypted recovery.

Each view ships as an editable `.excalidraw` source and an SVG exported from the
same native scene. The README embeds only the product overview; the architecture
artifact index links the complete pack.

## Visual system

- Warm off-white canvas with charcoal text and connectors.
- Blue for client/application surfaces, amber for AI interpretation, coral for
  the human checkpoint, green for ledger/security and soft grey for supporting
  context.
- One left-to-right primary reading path per board.
- Short direct labels inside boxes; supporting rules live in a single footer or
  boundary strip rather than scattered handwritten notes.
- Consistent title, subtitle, box geometry, arrow treatment and legend.
- Excalidraw font and moderate roughness, with no crossed-out arrows,
  overlapping annotations or decorative scribbles.

## Content rules

- Show implemented production behavior, not aspirational agent capabilities.
- Gemini connects only through FastAPI and never receives database credentials
  or writes to the ledger.
- Natural-language capture creates an unsaved draft. Only reviewed confirmation
  reaches an idempotent atomic write.
- Financial values are integer paise; transfers and settlements are not spend.
- The assistant is read-only and renders only application-owned UI.
- Authenticated household context, allow-lists, composite foreign keys and RLS
  preserve tenant isolation.
- Recovery is explicit: export encryption happens in the browser, preview is
  non-writing and restore is restricted to a fresh or empty household.

## Acceptance criteria

- A first-time reader can explain the product overview in under one minute.
- Every component view has one obvious start, one obvious outcome and named
  trust boundaries.
- Labels agree with the checked-in implementation and architecture documents.
- Source and export are both valid, indexed and free of missing local links.
- SVGs contain accessible title/description metadata.
- Overview remains legible at README width and all boards have no horizontal
  clipping when viewed at 390 px and 736 px.
