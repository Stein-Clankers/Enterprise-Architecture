# Architecture Decision Records

Product ADRs for Archipelago. Fresh sequence started 2026-08 (the knowledge-base era ADRs live at the `knowledge-base-final` tag; superseded by wiki ADR 0007). Format per `~/Code/HQ/wiki/conventions/decisions.md`.

| ADR | Decision | Date | Status |
|---|---|---|---|
| [0001](0001-archimate-core-portfolio-overlay.md) | ArchiMate 3.2 as base metamodel with a portfolio-profile overlay | 2026-08-06 | Accepted |
| [0002](0002-inmemory-model-indexeddb-files.md) | In-memory model + IndexedDB snapshots; files are the source of truth | 2026-08-06 | Accepted |
| [0003](0003-reactflow-elkjs-views.md) | React Flow + ELKjs for generated views | 2026-08-06 | Accepted |
| [0004](0004-canonical-json-exchange-boundary.md) | Canonical JSON as native format; exchange XML as interop boundary | 2026-08-06 | Accepted |
| [0005](0005-product-name-archipelago.md) | Product name: Archipelago | 2026-08-07 | Accepted |
| [0006](0006-diagram-engine.md) | A custom SVG editor over our own model for hand-drawn views | 2026-10-02 | Accepted |
| [0007](0007-one-language-per-model.md) | A model holds one language, chosen by the texts it keeps | 2026-10-05 | Accepted |
| [0008](0008-diagram-editor-before-transformation.md) | The diagram editor comes before transition planning | 2026-10-06 | Accepted |
| [0009](0009-relationship-validity-from-archi.md) | Relationship validity is Archi's matrix, with Archi's junction rules | 2026-10-06 | Accepted |
| [0010](0010-shared-folder-collaboration.md) | A shared synced folder is the first collaboration mode; one editor per model, enforced by a lock file | 2026-10-07 | Accepted |
| [0011](0011-stay-on-archimate-3-2.md) | Stay on ArchiMate 3.2 until Archi supports ArchiMate 4 | 2026-10-07 | Accepted |
| [0012](0012-rollout-planning-alongside-the-editor.md) | Multi-site rollout planning starts now, alongside the editor | 2026-10-26 | Accepted |
| [0013](0013-rollout-model.md) | Rollout model: one template, waves, and site plans keyed by location | 2026-10-26 | Accepted |
| [0014](0014-time-and-change-model.md) | Time and change: dated validity, change entries owned by initiatives, scenarios as overlays | 2026-10-26 | Accepted |
| [0015](0015-plan-dates-and-rollout-exchange-mapping.md) | Plan dates and the exchange mapping of rollouts | 2026-10-26 | Accepted |
| [0016](0016-milestone-dates-and-site-phase.md) | Milestone dates: where they live, how they resolve, and the derived site phase | 2026-10-28 | Accepted; amended 2026-10-29 (accepted 2026-10-30, with 0017) |
| [0017](0017-site-exceptions-dependencies-and-plan-checks.md) | Site exceptions, dependencies and blackouts, and the plan checks | 2026-10-29 | Accepted |
| [0018](0018-rollout-progress-and-actuals.md) | Rollout progress: the burn-up, its checkpoints, and actuals from the PMO | 2026-10-29 | Accepted |
