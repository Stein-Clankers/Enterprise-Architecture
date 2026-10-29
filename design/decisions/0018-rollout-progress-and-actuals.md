---
adr: '0018'
title: 'Rollout progress: the burn-up, its checkpoints, and actuals from the PMO'
date: 2026-10-29
status: Proposed
scope: project
tags: [transformation, rollout, model, workbook]
---

# ADR 0018 — Rollout progress: the burn-up, its checkpoints, and actuals from the PMO

Extends ADR 0013 points 6 and 9 and ADR 0016 points 4 and 5. Nothing either ADR says is reversed.

## Context

#215 adds three things. The PMO returns actual days, a RAG and a go/no-go decision in the rollout workbook. The rollout home gets a Progress tab: a burn-up of sites reaching Migrated, planned against actual, with the current wave's 25%, 50% and 75% checkpoints (proposal §6 item 6). A site's fact sheet gets a Migration tab.

The phase rules exist already (ADR 0016). What the burn-up counts, which wave it reports on, how a share of sites rounds, when a checkpoint is late, and what a go/no-go decision does are new. Each would change what a user sees to undo. The #241 review found that the first version of the checkpoint flagged a quarter-planned wave late two months early, because it used the phase's day where ADR 0016 point 5 uses the shown period. That rule needs to be written down where the next change will find it.

## Decision

1. **The burn-up stores nothing, and has no baseline.**
   - *Planned* is the phase derived from the planned dates alone (`plannedOnly`).
   - *Actual* is the phase derived from the actual days alone (`actualOnly`).
   - A site has migrated in Migrated or Done (`hasMigrated`).
   - The planned line is today's plan: re-planning moves it. A stored baseline to compare against is not built, and would be a file-format change of its own.
   - The sites in scope are every site of the rollout, in a wave or not, so at any time point migrated and not migrated add up to them.

2. **The current wave is the first wave, in order, with a site not actually migrated at the time point.** Its checkpoints are the ones shown. A programme that never records actual days keeps its first wave current; the register says the same thing about it.

3. **A checkpoint's target is its share of the wave's sites, rounded up:** `ceil(sites × p)`. A quarter of 3 sites is 1 and three quarters is 3, so 75% is never reached with a site still to go.

4. **A checkpoint follows the period the plan shows (ADR 0016 points 2 and 5).**
   - It is *planned by* the planned date of the milestone that migrates the site making up the share, **in the period that date is shown at**: `2027-Q4`, `2027-W19` or a day. When several sites migrate at that instant, it is the period that ends last.
   - It is **late** once that whole period has ended without the share being reached, as a milestone is overdue: a checkpoint planned for 2027-Q4 is late from 1 January 2028, never from a day inside the quarter.
   - It is **met** once the share has actually migrated by the time point. A day after the time point does not count.
   - It is drawn on the chart at the instant the planned line reaches its target, which for a spaced date is its exact day (ADR 0016 point 4).

5. **The go/no-go decision is the PMO's record and does not move the phase.** `SitePlan.goNoGo` is `go` or `no-go`, beside the RAG. The phase follows the milestones only (ADR 0013 point 6), and a programme that wants the decision dated records the actual day of a go/no-go milestone.

6. **Actuals from the workbook change nothing else.** An `actual.<id>` cell is an ISO day or a date cell; a blank cell or empty text clears it; anything else is reported at its cell and left as it was. Actuals, RAG and go/no-go are the only fields such an import changes.

7. **No schema version bump.** `goNoGo` is additive and optional, as `Milestone.date` was in #213. A file without it reads as before. An older build reports the key as content it cannot hold rather than dropping it unseen.

8. **Colours reuse the lifecycle ramp.** The rows are in ADR 0013 point 9's table. There are no new tokens.

## Consequences

- **The flag is patient, the line is not.** The planned line steps on the day the phase is reached (ADR 0016 point 4), so a quarter-anchored wave's line rises inside the quarter. Its checkpoints stay *due* until the quarter ends. This is the same split as a site's phase and its overdue flag.
- **Re-planning rewrites history on the chart.** Without a baseline, moving a wave's dates moves the planned line for the past as well as the future. A baseline is a later decision.
- **A wave of one site** has all three checkpoints at that one site.

## Status

Proposed with #241. The sponsor accepts or amends it before #215 closes.
