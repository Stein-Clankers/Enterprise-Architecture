---
adr: '0013'
title: 'Rollout model: one template, waves, and site plans keyed by location'
date: 2026-10-26
status: Accepted
scope: project
tags: [transformation, rollout, model, archimate]
---

# ADR 0013 — Rollout model: one template, waves, and site plans keyed by location

Points 5 and 10 are amended by [ADR 0015](0015-plan-dates-and-rollout-exchange-mapping.md): how a plan date is stored, and how rollouts travel in the exchange format.

Points 5, 6 and 9 are extended by [ADR 0016](0016-milestone-dates-and-site-phase.md): where the rollout's and a wave's dates live, how a site's date resolves and is spaced, when a milestone counts as reached or overdue, and the colour of Unplanned.

Points 4 and 10 are extended by [ADR 0017](0017-site-exceptions-dependencies-and-plan-checks.md) (proposed): what a site exception holds, a site's dependencies and own blackouts, the plan checks, and how exceptions and dependencies travel in the exchange format.

Points 6 and 9 are extended by [ADR 0018](0018-rollout-progress-and-actuals.md) (Proposed): the burn-up and its checkpoints read the derived phase, a go/no-go decision does not move it, and the burn-up's colours.

## Context

ADR 0012 starts multi-site rollout planning (#206) alongside the editor. The model it needs is laid out in `design/specs/migration-planning-proposal.md` §3–§4 and §8. The proposal's §11 left four points for this ADR: D2, D5, D6 and D7. The sponsor accepted all four as proposed on 2026-10-26 (#207).

The research behind the proposal (`migration-planning-research.md`) found that no EA tool has a first-class site wave. ArchiMate 3.2 gives a plateau no dates. ArchiMate 4 removes Gap and Implementation Event (ADR 0011).

## Decision

1. **A rollout is a Work Package** with a plan profile of `kind: 'rollout'`. It carries:
   - a scope template;
   - a template version;
   - an ordered milestone set;
   - constraints: blackouts and default capacity;
   - archetypes.
2. **A wave is a Work Package aggregated by its rollout.** It carries a label, an order, a window, a capacity and the template version it is locked to.
3. **Site plans are records inside the rollout, keyed by Location id** (D2), not Work Package elements. A Location can have one plan in each rollout it belongs to. On exchange export each site plan becomes a Work Package, aggregated by its wave and associated with its Location.
4. **The template is written once, and per-site changes are derived.** A template change is a change entry relative to a site. It has an anchor milestone plus an offset, and an applicability rule. A site stores only its deviations from the template, as exceptions classed `legal`, `operational` or `preference`.
5. **Dates inherit and carry a precision.** A site milestone resolves from the site, else its wave, else its rollout. A `PlanDate` is `{ date, precision }`, with precision one of quarter, month, week or day. The UI shows whether each date is set or inherited.
6. **The site phase is derived, never stored.** It is the phase started by the last milestone reached, with actual dates taking precedence over planned ones. This is the lifecycle rule of ADR UI-3. The phase set is fixed: Unplanned, Planned, Preparing, Cutover, Hypercare, Migrated and Done. Milestone sets are data. A preset (generic, data migration, later others) is a milestone set plus defaults, never code.
7. **No map view in R1–R3** (D5). Map tiles would be a runtime fetch. Sites are grouped by their region hierarchy instead.
8. **Site fields start as interim properties** (D6) under `archipelago.site.*`, handled as `profile-properties.ts` handles the portfolio profile. A `migrate.ts` step moves them to #70's custom fields when #70 lands.
9. **Site phases reuse the lifecycle ramp** (D7):

   | Site phase, RAG or load | Token |
   |---|---|
   | Unplanned | neutral ink |
   | Planned | `--lc-plan` |
   | Preparing, Cutover, Hypercare | `--lc-in` |
   | Migrated, Done | `--lc-act` |
   | RAG green | `--lc-act` |
   | RAG amber | `--lc-out` |
   | RAG red | `--lc-eol` |
   | RAG none (not rated) | `--lc-plan` |
   | Load within capacity | `--lc-in` |
   | Load over capacity | `--lc-eol` |
   | Load none (no capacity) | `--lc-plan` |
   | Burn-up: planned line | `--lc-plan` |
   | Burn-up: actual line | `--lc-act` |
   | Burn-up: time point | `--accent` |
   | Checkpoint due, or not planned | `--lc-plan` |
   | Checkpoint met | `--lc-act` |
   | Checkpoint late | `--lc-eol` |

   Extended 2026-10-27 (#223): RAG and load rows, under D7.
   Extended 2026-10-29 (#215, ADR 0018): burn-up and checkpoint rows, under D7.

   No new tokens.
10. **What the exchange format carries.** Rollout, waves and site plans travel as Work Packages. A wave's end travels as a Plateau. Milestones and plan fields travel as namespaced `archipelago.plan.*` properties. The template and exceptions travel as canonical JSON in a property. Implementation Event and Gap are not used. Anything the exchange cannot carry is reported, never dropped.

## Consequences

- **The change-entry shape in point 4 is provisional until the #58 ADR is written.** If the two differ, one is amended in the same PR, so the rollout's template changes are #60's change entries from the start.
- **Data migration is not special in code.** It is a preset of milestones plus its own checks (proposal §4.8).
- **Hiding work packages:** 160 site plans add no elements to the inventory, but an exchange export holds one Work Package per site plan. A model re-imported from Archi has to recognise them by their `archipelago.plan.*` properties and fold them back into records. The reader reports any it cannot match.
- **Migrating the site fields:** when #70 lands, its migration has a test that moves `archipelago.site.*` properties to custom fields byte-stably.
