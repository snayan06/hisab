# Excalidraw architecture board design

**Date:** 2026-08-08
**Status:** superseded on 9 August 2026 by the
[manager-ready architecture set](2026-08-09-manager-ready-architecture-set-design.md)

This document records the earlier exploratory whiteboard direction. Its raw,
scattered-note treatment was replaced after review with a cleaner product
overview and five focused component boards. It remains as design history only.

## Objective

Replace the current polished dark architecture infographic with a genuine Excalidraw board that feels like a product and engineering team mapped Artha together on a whiteboard. It must remain technically accurate, but should be understandable before it is detailed.

## Chosen approach

Create an editable `.excalidraw` source file and export its light-canvas SVG for the README.

This is preferred over:

- restyling the existing SVG, which would still be an imitation rather than an editable board;
- Mermaid, which is maintainable but looks like generated documentation rather than collaborative thinking;
- a bitmap screenshot, which would not be editable and would lose sharpness when zoomed.

## Board composition

The board must look like an architecture discussion captured by a developer,
not a designed infographic. There is no enclosing panel, formal grid, or set of
equal-sized stages.

The main flow runs loosely across the upper half:

`write naturally` → `Gemini + household context` → `unsaved draft` → `you review + confirm` → `ledger truth`

The nodes vary in size and alignment. The review checkpoint is circled twice
with a handwritten note: **AI understands. You decide.**

Supporting thoughts are scattered around the main flow like working notes:

- a yellow sticky beneath Gemini: `unsure? keep the exact text → manual form`;
- a small red note beside the write boundary: `NO CONFIRM = NO WRITE`;
- a blue side trail for Ask Artha: `DB facts → Gemini chooses intent → safe React card`, ending in `read only`;
- a developer stack sketch near the bottom: `React PWA` → `FastAPI` → `Supabase + RLS`, with Gemini connected only to FastAPI;
- a crossed-out attempted Gemini-to-ledger arrow labelled `never direct`;
- tiny margin notes such as `integer paise`, `allow-listed IDs`, `RLS`, and `idempotent` positioned beside the component that owns each rule.

## Visual direction

- warm off-white infinite-canvas crop with visible breathing room around the notes;
- Excalidraw's handwritten typography;
- rough, imperfect strokes and curved arrows;
- pale green, blue, yellow, and coral sticky notes with deliberately uneven sizing and placement;
- dark ink instead of a dark background;
- no swim lanes, section panels, formal three-zone layout, or decorative container around the board;
- a few underlines, circles, question marks and crossed-out arrows so it feels actively reasoned through;
- short phrases only, with deeper implementation detail left in the architecture docs.

## Deliverables

- `docs/assets/artha-architecture.excalidraw` — editable source;
- `docs/assets/artha-architecture.svg` — README export;
- README architecture caption/alt text updated only if needed for clarity;
- architecture artifact guide updated to point to both source and export.

## Acceptance checks

- the `.excalidraw` file opens as valid editable Excalidraw JSON;
- the SVG is a real export of the editable board, not a separately drawn approximation;
- the whole story is readable at normal README width without looking like a polished product card;
- the primary flow remains understandable at 390 px without horizontal overflow;
- the board remains legible on both light and dark GitHub themes because it carries its own light canvas;
- no labels are clipped and arrows do not cover text;
- the diagram preserves the review-before-save, read-only assistant, RLS, and no-direct-AI-ledger boundaries.
