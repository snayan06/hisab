# Manager-ready architecture set implementation plan

> Execute the complete plan in this task and keep the in-progress message and
> metadata feature files out of architecture-only commits.

**Goal:** Produce one clean overall product architecture board and five focused
component boards as native Excalidraw sources plus official SVG exports.

**Architecture:** Generate a shared visual language with Excalidraw's native
skeleton conversion API, then export every scene through Excalidraw's official
SVG exporter. The checked-in source remains editable and the exported SVG is
the reviewed documentation surface.

**Tooling:** Temporary Vite page, React, `@excalidraw/excalidraw@0.18.1`, local
browser visual verification, repository link checker and the normal quality
gate. No runtime dependency is added to Artha.

## Task 1: Validate content against the implementation

- Read the system architecture, database schema, deployment runbook, ADRs and
  relevant route/database contracts.
- Separate current behavior from planned merchant learning, invitations,
  investments and agentic assistant work.

## Task 2: Generate the six native scenes and exports

- Replace `docs/assets/artha-architecture.excalidraw` and its SVG with the clean
  product overview.
- Add the five component source/export pairs under
  `docs/artifacts/architecture/diagrams/`.
- Use one shared palette, typography scale, spacing grid and legend.

## Task 3: Wire the documentation

- Update the architecture artifact index with a short purpose and audience for
  every board.
- Keep the README focused on the single overview and link the complete pack.
- Update architecture narrative only where the diagram work exposes stale
  terminology.

## Task 4: Verify and review

- Parse every source and SVG; assert required labels and accessibility metadata.
- Round-trip the official embedded Excalidraw scene where supported.
- Inspect the overview and component boards at desktop and mobile widths.
- Run the local Markdown link checker, focused documentation assertions and the
  repository quality gate before committing only the architecture scope.
