---
adr: '0017'
title: 'Site exceptions, dependencies and blackouts, and the plan checks'
date: 2026-10-29
status: Proposed
scope: project
tags: [transformation, rollout, model, exchange-format, validation]
---

# ADR 0017 — Site exceptions, dependencies and blackouts, and the plan checks

Extends ADR 0013 points 4 and 10, ADR 0015 point 3 and ADR 0016 point 8. Nothing they say is reversed. Proposed with #214; it waits for the sponsor's acceptance.

## Context

ADR 0013 point 4 says a site deviates from the template through exceptions, each with a class, and point 10 says the exceptions travel as canonical JSON in the exchange format. Neither says what an exception holds, how a site says it must wait for another, or where a blackout of one site lives. The proposal's §6 item 8 lists the plan checks, and §4.8 the four the data-migration preset adds; neither says what "before" means between a date planned to the quarter and one planned to the day, or what a check says when its input is missing. ADR 0016 point 8 refused to delete a milestone a template change is anchored on "until #214" validates template references. #214 builds all of this. Each point below is a file-format commitment, or changes what a user is told about their plan, so it needs a decision of record.

## Decision

1. **A site's exceptions are `SitePlan.exceptions`**, a list of three kinds:
   - `skip` names a template change the site does not make;
   - `modify` names a template change the site makes at another offset from its anchor (`offsetDays`, which replaces the change's), with another disposition (`migrate`, `archive`, `purge`, `retain`), or both, and at least one;
   - `add` holds a change entry (ADR 0014 §2) only the site makes.

   Each has a class (`legal`, `operational`, `preference`) and may have an owner, a rationale and an expiry. **`expires` is the last day the exception holds**, an ISO day: from the start of the next day it has expired. **An exception's id is unique across its rollout's sites**, because the workbook's Exceptions sheet is keyed by it and an exception may move from one site to another. A reader that meets a repeat keeps the first, by location id, and reports the rest.

2. **A site's dependencies are `SitePlan.dependsOn`**: the Location ids of other sites of the same rollout that must cut over before it, a hub before its spokes. A dependency is a record of the site plan, not a relationship: a site plan is not an element (ADR 0013 point 3), so there is nothing for a relationship to join.

3. **A site's own blackouts are `SitePlan.blackouts`**, the same shape as the rollout's (`RolloutConstraints.blackouts`). Both hold for the site.

4. **A rollout records the preset it was made from**, `RolloutPlan.preset`. The milestone set stays the rollout's to change. The preset is kept for the checks it adds, which `presets.ts` holds as data (`PresetChecks`): each names the milestones it reads by id.

5. **Plan checks are not integrity findings.** `planChecks(model, rollout, at)` judges a plan at a time point and returns `Finding`s coded `rollout.*`, against the site's Location, the wave, the rollout or a store. It is not part of `validate()`. `validate()` says a plan points at something that is not there (`plan.*`), and a check leaves such a reference to it. A plan check never refuses a plan (ADR 0014 §6: conflicts are computed, never prevented). The checks of every rollout:
   - a site in no wave of the rollout;
   - a wave with more sites than its capacity, its own or else the rollout's default;
   - a cutover in a blackout of the rollout or the site;
   - a site that cuts over on or before a site it depends on;
   - an expired exception;
   - a site of the next wave whose cutover is still planned only to the quarter;
   - a template change no site makes: none matches its applicability, or every one that does skips it;
   - a site whose Location does not aggregate what a `retire` or `replace` made there retires.

   The **data-migration preset** adds four:
   - each mock load reached before cutover;
   - the freeze, from cutover to reconciliation signed off, clear of every blackout;
   - reconciliation signed off before hypercare ends;
   - **residency**: a site whose class (`archipelago.site.residency`: `none`, `region` or `country`) keeps its data in its country or region does not migrate it to a store located outside. A site's country is the Location that aggregates it, its region the one that aggregates that (proposal §4.1). A store is located by the Locations that aggregate it, and every one must lie within the area. Its data moves to the successor of each `replace` made at the site, the template's and its own. One finding per site names every move out of the area.

6. **What a check compares.**
   - **An order** ("before", "after") compares the days the phase is derived from (`reachedAt`, ADR 0016 point 4): an actual day, which takes precedence; else a spaced date's exact day; else the first day of the planned period. A check never says one milestone comes first where the phase says the other does. **"Before" is strict**: the same day is not before.
   - **An overlap** with a blackout compares the whole period a date is shown at, or its actual day. Both ends of a blackout count. A cutover planned for `2027-W13` is in a blackout that touches any day of that week: a coarse date that may fall in a blackout is reported, so the planner details it.
   - **The next wave** is the first wave, in order, with sites, all of which are still Planned at the time point (proposal §5: detail only the next wave).

7. **No check is silent on input it lacks.** Where a check needs input it does not have, it says, as an `advice`, what it could not judge and why. For example: a site in a wave with no cutover date, a wave with no capacity and no default, a dependency on a site in no wave, an exception with no expiry, a residency class it cannot read, a site no Location places, or a store no Location aggregates. A milestone a preset's check reads that the set no longer has is said once, for the rollout. A violation is a `warning`.

8. **`validate()` checks the template's references** (#214, #222):
   - a change's subject, which is a relationship for `add` and `remove` and an element otherwise;
   - a `replace`'s successor;
   - an applicability's element and archetypes;
   - a date's anchor;
   - the milestone ids an archetype's durations are keyed by.

   It checks an exception's references the same way. A `skip` or `modify` names a change of the template, and an `add`'s change is checked as a template change is. It also reports a `modify` that gives another offset to a change dated on its own, with no anchor, and a dependency on the site itself or on a site that is not in the rollout.

9. **Exchange format (extends ADR 0013 point 10 and ADR 0015 point 3).** A site's exceptions, dependencies and own blackouts each travel as canonical JSON in one property of the site plan's Work Package: `archipelago.plan.exceptions`, `archipelago.plan.dependsOn` and `archipelago.plan.blackouts`. They name model ids in the file's spelling, as the template does. The preset travels as `archipelago.plan.preset` on the rollout. A value the reader cannot parse, or an entry of one it cannot keep, is reported, never dropped quietly.

10. **No schema version bump.** Every new field is optional. A file without them reads as before, and a file written before #214 writes the same bytes. A build before #214 reads a file that has them and reports each site's unknown keys as `json.invalid-plan`, dropping only those, as #213's additions did.

11. **The rollout workbook** gains an `Exceptions` sheet, keyed by exception id, and a `Dependencies` sheet, one row per pair. An `add`'s change is canonical JSON in one cell, never fields joined by a separator. An Exceptions row is applied whole or not at all, because a half-changed exception may be none. A site removed in the Sites sheet takes its exceptions and dependencies with it, and the other sites' dependencies on it, and each one dropped is said. **A site's own blackouts are not carried by the workbook yet**: its export says so, and its import leaves them as they are.

12. **Deleting a milestone (amends ADR 0016 point 8).** The refusal stays and is not turned into a check finding. A milestone some anchor names is refused deletion, whether the anchor is a template change's or an `add` exception's. A template change of the rollout is never left anchored on nothing by the app. `validate()` now reports an anchor that does not hold (`plan.template-anchor-unknown`, `plan.exception-anchor-unknown`), so a file edited by hand, or written by another tool, is caught. See ADR 0016's [amendment of 2026-10-29](0016-milestone-dates-and-site-phase.md#amendment-of-2026-10-29).

## Consequences

- **A check and the phase never disagree.** A site the register shows in Cutover is not reported as not yet cut over, because both read `reachedAt`.
- **A coarse plan is reported where it might be wrong.** A quarter that touches a blackout is reported until the planner details the date. A quarter-precision cutover in the next wave is reported too. Both say where to plan finer, which is what rolling-wave planning asks.
- **A check that cannot judge says so.** A plan with gaps produces advice, not silence, so a clean list means the plan was judged, not skipped.
- **The preset is history, the milestone set is not.** A rollout made from the data-migration preset keeps its checks after its set is edited. A check whose milestone is gone says so once, rather than passing every site.
- **`preference` exceptions are not flagged.** The proposal says a preference is rejected by default, but that is a review policy, not a fault in the plan. No check reports one. A later issue may add a review queue.
- **Site blackouts need an editor.** The model, the canonical file and the exchange format carry them, and a plan check reads them. Only a hand-edited file or the demo sets one today.
