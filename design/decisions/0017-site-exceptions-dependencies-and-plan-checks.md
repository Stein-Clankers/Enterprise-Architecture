---
adr: '0017'
title: 'Site exceptions, dependencies and blackouts, and the plan checks'
date: 2026-10-29
status: Proposed
scope: project
tags: [transformation, rollout, model, exchange-format, validation]
---

# ADR 0017 — Site exceptions, dependencies and blackouts, and the plan checks

Extends ADR 0013 points 4 and 10, ADR 0015 point 3 and ADR 0016 point 8. Nothing they say is reversed. Proposed with #214; it waits for the sponsor's acceptance. Four points were decided by the sponsor on 2026-10-29, after the review of #242, and are marked so: checks are independent (point 5), what "the next wave" covers (point 6), which exceptions need an expiry (points 1 and 7), and what a disposition means for residency (point 5). One more was confirmed on 2026-10-30, after the second review: how an order reads a coarse date (point 6).

## Context

ADR 0013 point 4 says a site deviates from the template through exceptions, each with a class, and point 10 says the exceptions travel as canonical JSON in the exchange format. Neither says what an exception holds, how a site says it must wait for another, or where a blackout of one site lives. The proposal's §6 item 8 lists the plan checks, and §4.8 the four the data-migration preset adds; neither says what "before" means between a date planned to the quarter and one planned to the day, or what a check says when its input is missing. ADR 0016 point 8 refused to delete a milestone a template change is anchored on "until #214" validates template references. #214 builds all of this. Each point below is a file-format commitment, or changes what a user is told about their plan, so it needs a decision of record.

## Decision

1. **A site's exceptions are `SitePlan.exceptions`**, a list of three kinds:
   - `skip` names a template change the site does not make;
   - `modify` names a template change the site makes at another offset from its anchor (`offsetDays`, which replaces the change's), with another disposition (`migrate`, `archive`, `purge`, `retain`), or both, and at least one;
   - `add` holds a change entry (ADR 0014 §2) only the site makes.

   Each has a class (`legal`, `operational`, `preference`) and may have an owner, a rationale and an expiry. **`expires` is the last day the exception holds**, an ISO day: from the start of the next day it has expired. **A `legal` or `operational` exception may be open-ended** (sponsor, 2026-10-29): it holds until the law or the operation changes. A `preference` is rejected by default (proposal §2 item 3), so one with no expiry is said (point 7). This departs from the proposal, which gives every exception an owner and an expiry. **An exception's id is unique across its rollout's sites**, because the workbook's Exceptions sheet is keyed by it and an exception may move from one site to another. A reader that meets a repeat keeps the first, by location id, and reports the rest.

2. **A site's dependencies are `SitePlan.dependsOn`**: the Location ids of other sites of the same rollout that must cut over before it, a hub before its spokes. A dependency is a record of the site plan, not a relationship: a site plan is not an element (ADR 0013 point 3), so there is nothing for a relationship to join.

3. **A site's own blackouts are `SitePlan.blackouts`**, the same shape as the rollout's (`RolloutConstraints.blackouts`). Both hold for the site.

4. **A rollout records the preset it was made from**, `RolloutPlan.preset`. The milestone set stays the rollout's to change. The preset is kept for the checks it adds, which `presets.ts` holds as data (`PresetChecks`): each names the milestones it reads by id.

5. **Plan checks are not integrity findings.** `planChecks(model, rollout, at)` judges a plan at a time point and returns `Finding`s coded `rollout.*`, against the site's Location, the wave, the rollout or a store. It is not part of `validate()`. `validate()` says a plan points at something that is not there (`plan.*`), and a check leaves such a reference to it. A plan check never refuses a plan (ADR 0014 §6: conflicts are computed, never prevented). **`planChecks` is the rollout's contribution to ADR 0014 §6's conflict list**: the conflicts function, when it exists (#63, "plan conflicts"), composes it rather than repeating it.

   **Checks are independent, and none yields to another** (sponsor, 2026-10-29). One site may be reported by several. In the data-migration preset the freeze starts on the cutover day, so a cutover in a blackout is always a freeze in one too: both are said, because each asks for its own fix (move the cutover day, or move or shorten the freeze), and the preset's check never hides one every rollout has. The demo's five seeded problems therefore give six findings.

   The checks of every rollout:
   - a site in no wave of the rollout;
   - a wave with more sites than its capacity, its own or else the rollout's default;
   - a cutover in a blackout of the rollout or the site;
   - a site that cuts over on or before a site it depends on;
   - an expired exception, whatever its class;
   - a site whose cutover is still planned only to the quarter, in the next wave or a wave under way (point 6);
   - a template change no site makes: none matches its applicability, or every one that does skips it;
   - a site whose Location does not aggregate what a `retire` or `replace` made there retires.

   The **data-migration preset** adds four:
   - each mock load reached before cutover;
   - the freeze, from its start (the cutover day) to reconciliation signed off, clear of every blackout;
   - reconciliation signed off before hypercare ends;
   - **residency**: a site whose class (`archipelago.site.residency`: `none`, `region` or `country`) keeps its data in its country or region does not migrate it to a store located outside. A site's country is the Location that aggregates it, its region the one that aggregates that (proposal §4.1). A store is located by the Locations that aggregate it, and every one must lie within the area. Its data moves to the successor of each `replace` made at the site, the template's and its own. **A `modify` exception that purges or retains the data of a template `replace` moves none of it**, so the site is not reported for that change (sponsor, 2026-10-29). `archive` and `migrate` are still read as moves: the archive is the successor's. One finding per site names every move out of the area.

6. **What a check compares.**
   - **An order** ("before", "after") compares the days the phase is derived from (`reachedAt`, ADR 0016 point 4): an actual day, which takes precedence; else a spaced date's exact day; else the first day of the planned period. A check never says one milestone comes first where the phase says the other does. **"Before" is strict**: the same day is not before. **A coarse date counts from its period's first day** (sponsor, 2026-10-30): a hub planned for 2027-Q3 is reached on 1 July, so a spoke dated 15 August is not a dependency violation, and a reconciliation planned for March is reached on 1 March, so a freeze starting 11 March ends before it starts.
   - **An overlap** with a blackout compares the whole period a date is shown at, or its actual day. Both ends of a blackout count. A cutover planned for `2027-W13` is in a blackout that touches any day of that week: a coarse date that may fall in a blackout is reported, so the planner details it. **An overlap does not use the spaced day.** A date spaced from a coarser one has an exact day, which the phase and every order read (ADR 0016's amendment), but the planner has committed only to the period it is shown at: the day may still land anywhere in it, so the whole period is checked.
   - **The waves to detail** are every wave, in order, up to and including the next one (sponsor, 2026-10-29). The next wave is the first with sites, all of which are still Planned at the time point (proposal §5: "detail only the next wave"). A wave under way is detailed too: a site of it still planned to the quarter is reported, not skipped because a sibling has started. With no wave wholly Planned, every wave is under way. Two edges follow from the rule as given. A wave under way that comes *after* the first wholly Planned wave is not detailed: the waves to detail stop at the next one, even when a later wave has started. And a wave whose sites are all undated is wholly Planned, so it is the next wave and masks every wave behind it; its own sites are reported as undated, which says nothing of the waves after it.

7. **No check is silent on input it lacks.** Where a check needs input it does not have, it says, as an `advice`, what it could not judge and why. For example: a site in a wave with no cutover date, a wave with no capacity and no default, a dependency on a site in no wave or with no cutover date, a `preference` exception with no expiry, a freeze or reconciliation milestone with no date, a freeze that ends before it starts, a residency class it cannot read, a site no Location places, or a store no Location aggregates. A milestone a preset's check reads that the set no longer has is said once, for the rollout, as a `warning`: the check cannot run for any site. A violation is a `warning`.

   **A mock load with no date is a violation, not missing input.** The preset's check is "fewer mock loads before cutover than the preset requires" (proposal §4.8), and a mock load that is not planned is one fewer. A site's count is over the mock loads the milestone set still has; one the set has lost is the rollout's warning above.

8. **`validate()` checks the template's references** (#214, #222):
   - a change's subject, which is a relationship for `add` and `remove` and an element otherwise;
   - a `replace`'s successor;
   - an applicability's element and archetypes;
   - a date's anchor;
   - the milestone ids an archetype's durations are keyed by.

   It checks an exception's references the same way. A `skip` or `modify` names a change of the template, and an `add`'s change is checked as a template change is. It also reports a `modify` that gives another offset to a change dated on its own, with no anchor, and a dependency on the site itself or on a site that is not in the rollout.

9. **Exchange format (extends ADR 0013 point 10 and ADR 0015 point 3).** A site's exceptions, dependencies and own blackouts each travel as canonical JSON in one property of the site plan's Work Package: `archipelago.plan.exceptions`, `archipelago.plan.dependsOn` and `archipelago.plan.blackouts`. They name model ids in the file's spelling, as the template does. The preset travels as `archipelago.plan.preset` on the rollout. A value the reader cannot parse, or an entry of one it cannot keep, is reported, never dropped quietly.

10. **No schema version bump.** Every new field is optional. A file without them reads as before, and a file written before #214 writes the same bytes. A build before #214 reads a file that has them and reports each site's unknown keys as `json.invalid-plan`, dropping only those, as #213's additions did.

11. **The rollout workbook** gains an `Exceptions` sheet, keyed by exception id, and a `Dependencies` sheet, one row per pair. An `add`'s change is canonical JSON in one cell, never fields joined by a separator. An Exceptions row is applied whole or not at all, because a half-changed exception may be none. An Exceptions row whose id the rollout does not have is refused (`rollout-workbook.exception-unknown`), as the Sites sheet refuses one: a typo in an id would otherwise add a second exception. A site removed in the Sites sheet takes its exceptions and its own dependencies with it, and the other sites' dependencies on it. Each exception and dependency dropped is said (`rollout-workbook.exception-dropped`, `rollout-workbook.dependency-dropped`) and counted as deleted. An `add` row is checked as `validate()` checks a template change: a change anchored on a milestone the set lacks, or naming an element or relationship the model lacks, is refused (`rollout-workbook.entry-reference-unknown`), so the sheet never makes the dangling anchor point 12 refuses. **A site's own blackouts are not carried by the workbook yet**: its export says so, and its import leaves them as they are.

12. **Deleting a milestone (amends ADR 0016 point 8).** The refusal stays and is not turned into a check finding. A milestone some anchor names is refused deletion, whether the anchor is a template change's or an `add` exception's. A template change of the rollout is never left anchored on nothing by the app. `validate()` now reports an anchor that does not hold (`plan.template-anchor-unknown`, `plan.exception-anchor-unknown`), so a file edited by hand, or written by another tool, is caught. See ADR 0016's [amendment of 2026-10-29](0016-milestone-dates-and-site-phase.md#amendment-of-2026-10-29).

## Consequences

- **A check and the phase never disagree.** A site the register shows in Cutover is not reported as not yet cut over, because both read `reachedAt`.
- **A coarse plan is reported where it might be wrong.** A quarter that touches a blackout is reported until the planner details the date. A quarter-precision cutover in the next wave is reported too. Both say where to plan finer, which is what rolling-wave planning asks.
- **An order check does not flag a coarse order.** A coarse date counts from its period's first day, as the phase does, so a later milestone planned to a period that contains the earlier one's day is read as reached first. It is the next-wave check that keeps the near waves precise, and so their orders judged to the day.
- **A check that cannot judge says so.** A plan with gaps produces advice, not silence, so a clean list means the plan was judged, not skipped.
- **The preset is history, the milestone set is not.** A rollout made from the data-migration preset keeps its checks after its set is edited. A check whose milestone is gone says so once, rather than passing every site.
- **A `preference` exception is said only when it has no expiry.** The proposal says a preference is rejected by default; reviewing one is a policy, not a fault in the plan, so a dated preference is not reported until it expires. A later issue may add a review queue.
- **Open-ended `legal` and `operational` exceptions are silent.** A clean Advice list on a real rollout is not crowded by exceptions that are open-ended on purpose.
- **A wave under way stays in view.** Every wave before the next is detailed too: each of its sites whose cutover has no actual day is reported while that cutover is dated only to the quarter, so the stragglers of the current wave are reported alongside the next wave.
- **Site blackouts need an editor.** The model, the canonical file and the exchange format carry them, and a plan check reads them. Only a hand-edited file or the demo sets one today.
