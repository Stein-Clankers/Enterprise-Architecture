---
adr: '0012'
title: Multi-site rollout planning starts now, alongside the editor
date: 2026-10-26
status: Accepted
scope: project
tags: [roadmap, transformation, rollout, excel]
---

# ADR 0012 — Multi-site rollout planning starts now, alongside the editor

## Context

The sponsor's organisation has to migrate about 160 locations. It needs to plan them roughly first, with sites in waves and coarse dates, and in detail later, with milestones, exceptions and actuals per site. `design/specs/migration-planning-proposal.md` proposes a rollout layer on top of the plan pillar (#72). It describes one rollout with a scope template, waves, and one plan per site, in four slices:

- **R1:** site register and wave plan
- **R2:** detailed site plans
- **R3:** architecture change per site, which needs #58, #60, #61 and #64
- **R4:** scenarios and a sequencing assistant

ADR 0008 put the diagram editor before transition planning. R1 and R2 are planning data and planning screens. They need neither the editor nor the overlay engine.

## Decision

Sponsor, 2026-10-26:

1. **R0–R2 start now, alongside the editor.** ADR 0008 still orders the editor ahead of the rest of the transformation core. R3 waits for #58, #60, #61 and #64 as planned.
2. **Build for any rollout; data migration is the first case.** Milestone sets, site fields and template change kinds are configurable. Data migration is the first preset, not a special case in code.
3. **Excel is the first file format for the plan.** One `.xlsx` workbook per rollout carries sites, waves, site plans, exceptions and actuals. It is both the export and the import template, and follows #94's conventions. CSV follows.

## Consequences

- **The #58 ADR (time and change model) becomes a prerequisite of R1,** so that the rollout's template changes are #60's change entries from the start and nothing is rebuilt in R3. A rollout-model ADR (D2, D5–D7 in the proposal's §11) is written alongside it.
- **An XLSX reader and writer in `src/io/` is pulled forward from #94** and shared with it. There is no XLSX dependency today, and the npm `xlsx` package is no longer maintained there, so the choice of library, or of our own writer on `src/io/zip.ts` and `fast-xml-parser`, is made in that issue.
- **The generated demo (#68) gains a 160-site data-migration rollout,** so e2e journeys and performance budgets run at the real scale.
- **Two tracks now compete for review time:** the editor (#74) and the rollout. The order within each track is unchanged.
