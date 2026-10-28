---
adr: '0016'
title: 'Milestone dates: where they live, how they resolve, and the derived site phase'
date: 2026-10-28
status: Accepted
scope: project
tags: [transformation, rollout, model, exchange-format]
---

# ADR 0016 — Milestone dates: where they live, how they resolve, and the derived site phase

Extends ADR 0013 points 5, 6 and 9, and ADR 0015 point 3. Nothing either ADR says is reversed. The sponsor accepted it on 2026-10-28.

## Context

ADR 0013 point 5 says a site milestone "resolves from the site, else its wave, else its rollout". #209 (PR #217) gave site plans their own dates, but gave neither the rollout nor a wave anywhere to keep one, so nothing could be inherited. Point 6 fixes the phase set and the rule "the last milestone reached, actual dates taking precedence", but not what "reached" means for a date that is a quarter long. Point 9 names the token for every phase except Unplanned, which it calls "neutral ink". #213 builds all three and needs these left-open points decided. Each one is a file-format or a behaviour commitment that would need a migration, or would change what a user sees, to undo.

## Decision

1. **Where the dates live.**
   - A rollout's date for a milestone is `Milestone.date`, on the milestone in its set.
   - A wave's dates are `WavePlan.milestones`, keyed by milestone id.
   - A site's own dates stay `SitePlan.milestones` (#209).

   All three are optional `PlanDate`s (ADR 0015 point 1), checked by `isPlanDate` on read and on write.

2. **How a site's date resolves (`resolveSiteMilestones`).** For each milestone of the set, in order:
   1. the site's own date, which is **set**;
   2. else its wave's, **inherited**;
   3. else the rollout's, **inherited**.

   A milestone none of the three dates is then **spaced** by the site's archetype's `durations`, which give the days from the previous milestone to each one:

   4. forward from the milestone before it, when that one resolved and the archetype has a duration for this one, walking the set in order, so a chain of spaced dates follows one anchor;
   5. else backward from the milestone after it, minus that one's duration, walking the set in reverse.

   A spaced date **keeps the precision of the date it is spaced from**: a wave anchored at 2027-Q3 spaces its sites' later milestones in quarters, never in days it does not know. The chain carries the exact day and snaps each date to its period only at the end, so three spacings of 42 days from a quarter are 126 days from its first day, not three roundings. A spaced date is inherited, and says which milestone it is spaced from and by how many days.

   A site in no wave inherits nothing from a wave, and still inherits the rollout's dates.

3. **Clearing an override makes the site inherit again.** No state means "explicitly no date". Choosing *Inherit* in the site's dates dialog, a blank `milestone.<id>` cell in the workbook, and `null` passed to `setSiteMilestones` all delete the site's own date. A precision that is not one of the four (a `<select>`'s empty option) is never stored. The form reads it as *Inherit*, and the store refuses a change that carries it (CLAUDE.md, type guards on the write path).

4. **The derived site phase (`deriveSitePhase`).**
   - A milestone is **reached** on its actual day, which takes precedence early or late. With no actual day, it is reached on the **first day** of its planned period.
   - The phase is the phase started by the last milestone, walking the set in order, that has been reached by the time point.
   - A site in **no wave is Unplanned**, whatever its dates say (proposal §4.5).
   - A site in a wave that has reached no milestone is **Planned**.
   - Nothing about the phase is stored.

5. **Overdue is a flag, not a phase.** A milestone is overdue when it has a planned date, no actual day, and its **whole period has ended**. A date planned for 2027-Q2 is overdue from 1 July 2027, not from 1 April. A site is overdue when any of its milestones is.

6. **Unplanned is drawn in `--ink2`.** This is the "neutral ink" of ADR 0013 point 9. `--ink3` would be the obvious neutral, but in the light theme it is the same colour as `--lc-plan` (#8c939b), so Unplanned and Planned would look alike.

7. **Presets are data in `src/model/presets.ts`:** *generic* and *data migration*.
   - The generic set follows the proposal's §4.5 table, where cutover starts **Hypercare**. So the register's cutover column shows the first milestone that starts Cutover, else the first that starts Hypercare (`switchMilestone`).
   - Each preset also seeds one archetype, `standard`, holding its default durations. These durations are **our own placeholders**, not taken from a source; a programme replaces them.

8. **Deleting a milestone** removes, as one command that one undo restores:
   - every date and actual date of it on site plans;
   - every wave date for it;
   - every archetype duration for it.

   The editor says what will go before it deletes. The delete is **refused while a template change is anchored on the milestone**. Validating template references is #214's work, and until then the refusal keeps the anchor from dangling.

9. **Exchange format (extends ADR 0015 point 3).**
   - A wave's dates travel as `archipelago.plan.milestone.<id>` properties on the wave's Work Package. This is the key family a site plan already uses, in the same text forms.
   - A rollout's dates travel inside the milestone set's canonical JSON (`archipelago.plan.milestones`), as the rest of the set already does.
   - A wave date the reader cannot parse is kept as an ordinary property and reported, as for site plans.

10. **Workbook.**
    - The Waves sheet gains a `milestone.<id>` column per milestone, read and written. A blank cell deletes the wave's date.
    - A read-only **Milestones** sheet lists the set: id, label, phase started, rollout date. An edited copy of it is reported (`rollout-workbook.milestones-read-only`) and not applied, as the Template sheet is.
    - Every date cell carries its precision by its text form (ADR 0015 point 1).

## Consequences

- **A rolling plan needs no special case.** A rollout that dates its next wave to the day and later waves to the quarter shows each at its own precision: on the timeline, where a quarter is a block and a day a sliver, and in the workbook as `2027-05-17` beside `2027-Q3`.
- **Spacing is a default, never a value.** A spaced date is not written to any file. Changing an archetype's durations moves every spaced date at once, and nothing a user set.
- **Reached at the start, overdue at the end.** A quarter-precision cutover puts a site in Cutover from the first day of the quarter, and marks it overdue only once the quarter has passed without an actual date. The phase is optimistic and the flag is patient. A programme that wants earlier warnings plans to a finer precision.
- **Adding or removing a field is additive.** `Milestone.date` and `WavePlan.milestones` are optional. A file without them reads as before, and a file written before #213 writes the same bytes.
- **#214 inherits a constraint.** Until template references are validated, a milestone with a template change anchored on it cannot be deleted from the set.
