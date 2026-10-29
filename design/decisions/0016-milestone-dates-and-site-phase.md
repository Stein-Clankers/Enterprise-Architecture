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

**Amended 2026-10-28**, after the #229 review, by the sponsor's decisions on two of its points: a spaced date is reached on its chain's exact day (point 4), and a site in no wave follows its actual dates (points 4 and 5). Points 7 and 8 now also say what the interface shows. See [Amendment of 2026-10-28](#amendment-of-2026-10-28) for what changed and why.

**Amended 2026-10-29** by ADR 0017 point 12, with #214: the refusal to delete an anchored milestone (point 8) stays, and now also covers a site's own change anchored on it. See [Amendment of 2026-10-29](#amendment-of-2026-10-29). Pending the sponsor's acceptance with ADR 0017.

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

   *Amended 2026-10-28:* the exact day the chain reaches is kept beside the date, for the phase (point 4). It is derived each time, like the date, and never stored. The date is still **shown** at its anchor's precision.

   A site in no wave inherits nothing from a wave, and still inherits the rollout's dates.

3. **Clearing an override makes the site inherit again.** No state means "explicitly no date". Choosing *Inherit* in the site's dates dialog, a blank `milestone.<id>` cell in the workbook, and `null` passed to `setSiteMilestones` all delete the site's own date. A precision that is not one of the four (a `<select>`'s empty option) is never stored. The form reads it as *Inherit*, and the store refuses a change that carries it (CLAUDE.md, type guards on the write path).

4. **The derived site phase (`deriveSitePhase`).**
   - A milestone is **reached** on its actual day, which takes precedence early or late.
   - With no actual day, a **spaced** date (point 2) is reached on the **exact day its chain reaches**, though it is shown at its anchor's precision. *(Amended 2026-10-28.)*
   - With no actual day, a date that is set or inherited, and not spaced, is reached on the **first day** of its planned period.
   - The phase is the phase started by the last milestone, walking the set in order, that has been reached by the time point.
   - A site in **no wave is Unplanned while none of its milestones has reached an actual day**. From its first actual day, its phase follows its actual days, which take precedence (ADR 0013 point 6). Its planned dates do not count: a site in no wave has no plan that commits it to them. This covers a site whose wave was deleted after its cutover (ADR 0015 point 6 keeps its dates). *(Amended 2026-10-28; was "Unplanned, whatever its dates say".)*
   - A site in a wave that has reached no milestone is **Planned**.
   - Nothing about the phase is stored.

5. **Overdue is a flag, not a phase.** A milestone is overdue when it has a planned date, no actual day, and its **whole period has ended**. A date planned for 2027-Q2 is overdue from 1 July 2027, not from 1 April. This is the period the date is **shown** at, for a spaced date too, never its exact day. A site is overdue when any of its milestones is. **A site in no wave is never overdue.** *(Amended 2026-10-28.)*

6. **Unplanned is drawn in `--ink2`.** This is the "neutral ink" of ADR 0013 point 9. `--ink3` would be the obvious neutral, but in the light theme it is the same colour as `--lc-plan` (#8c939b), so Unplanned and Planned would look alike.

7. **Presets are data in `src/model/presets.ts`:** *generic* and *data migration*.
   - The generic set follows the proposal's §4.5 table, where cutover starts **Hypercare**. So the register's cutover column shows the first milestone that starts Cutover, else the first that starts Hypercare (`switchMilestone`). **A site of a generic rollout therefore never shows the Cutover phase:** it goes from Preparing straight to Hypercare on its cutover day. That is the proposal's table, not a fault. *(Made explicit 2026-10-28.)*
   - Each preset also seeds one archetype, `standard`, holding its default durations. These durations are **placeholders of our own**, not taken from a source; a programme replaces them. Until an archetype editor exists, the archetype's label says so, **"Standard (placeholder)"**, and every screen that shows a site's archetype shows all of that label, never cut short. A site made Standard shows dates as "inherited" that nobody planned, so the label is how a reader knows. *(Made explicit 2026-10-28; the label shortened on 2026-10-29, because the register cut "Standard (placeholder durations)" to "Standard (pla…".)*

8. **Deleting a milestone** removes, as one command that one undo restores:
   - every date and actual date of it on site plans;
   - every wave date for it;
   - every archetype duration for it.

   The editor says what will go before it deletes. The delete is **refused while a template change is anchored on the milestone**. Validating template references is #214's work, and until then the refusal keeps the anchor from dangling. The app has no template editor yet, so the refusal says the template is edited in the model's file for now; it does not ask for a re-anchoring the app cannot do. This holds until #214 or #60 brings template editing. *(Wording made explicit 2026-10-28.)*

   *Amended 2026-10-29 (ADR 0017 point 12):* the refusal stays after #214, and also holds while a site's `add` exception is anchored on the milestone. The refusal names the exceptions and says they are re-dated in the rollout workbook's Exceptions sheet. `validate()` now reports an anchor that does not hold.

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
- **Reached at the start, overdue at the end.** A quarter-precision cutover that is set or inherited puts a site in Cutover from the first day of the quarter, and marks it overdue only once the quarter has passed without an actual date. The phase is optimistic and the flag is patient. A programme that wants earlier warnings plans to a finer precision.
- **A spaced chain does not run ahead of itself.** A wave that says only `readiness: 2027-Q3`, under the generic preset and the Standard archetype, shows its sites' readiness, go/no-go, cutover and hypercare end all as 2027-Q3 (and legacy retired as 2027-Q4). Each spaced one is reached on its exact day: go/no-go on 29 July, cutover on 5 August, hypercare end on 2 September, legacy retired on 1 December. Before the amendment all four were reached on 1 July, so the site read Migrated on 1 July and Done on 1 October, before any cutover. Overdue still waits for the end of the shown quarter, so the phase is never ahead of the plan and overdue is never premature.
- **A site in no wave keeps what happened to it.** Unassigning a site, or deleting its wave, takes away the plan it was late against, so it is never overdue; it does not take away an actual cutover, so it does not go back to Unplanned.
- **Adding or removing a field is additive.** `Milestone.date` and `WavePlan.milestones` are optional. A file without them reads as before, and a file written before #213 writes the same bytes.
- **#214 inherits a constraint.** Until template references are validated, a milestone with a template change anchored on it cannot be deleted from the set. *(#214 keeps it: see the amendment of 2026-10-29.)*

## Amendment of 2026-10-28

The #229 review found two places where the accepted text gave a phase that contradicted the plan it was derived from. The sponsor decided both on 2026-10-28. Nothing in the file format changed: the exact day of a spaced date is derived, like the date, and is never written.

1. **Spaced dates (points 2 and 4).** Reaching every date on the first day of its period was right for a date someone set or inherited, but a spaced date is a day the chain computes and then snaps to the anchor's period for display. Snapping it for the phase too put a quarter-anchored chain's every milestone on the quarter's first day (the example under Consequences). So a spaced date is now reached on its exact day, which the chain computes already. A date that is set or inherited, and not spaced, keeps the first-day rule. Overdue keeps the shown period's rule.
2. **No wave (points 4 and 5).** "A site in no wave is Unplanned, whatever its dates say" ignored actual dates, which ADR 0013 point 6 says take precedence. ADR 0015 point 6 keeps a site's dates when its wave is deleted because they matter, so a site with an actual cutover read Unplanned once its wave went. It also let an unassigned site be flagged overdue against rollout dates it was never planned to. Now a site in no wave is Unplanned only until its first actual day, its phase then follows its actual days, and it is never overdue.
3. **Made explicit.** Point 7: the Standard archetype's durations are placeholders, and its label says so wherever it is shown; a generic rollout never shows the Cutover phase. Point 8: the refusal to delete an anchored milestone says where the template is edited today.

## Amendment of 2026-10-29

#214 validates the template's references (ADR 0017 point 8), which point 8 named as the condition for revisiting the refusal. The refusal is not turned into a plan-check finding:

- **A dangling anchor is not a plan to be judged.** A change anchored on nothing has no date. The site's timeline and phase would silently lose it, and a finding afterwards would report a loss the app itself caused. The refusal prevents it; `validate()` catches the same fault in a file edited by hand or written by another tool.
- **There is still no template editor in the app.** The refusal still says where the template is edited today, and does not ask for a re-anchoring the app cannot do.
- **A site's own change anchors too.** An `add` exception (ADR 0017 point 1) holds a change entry whose date may be anchored on a milestone. Deleting that milestone is refused as well, and the refusal names the exceptions and says they are re-dated in the rollout workbook's Exceptions sheet, which can edit them.

What deleting a milestone removes is unchanged: its site dates, actual dates, wave dates and archetype durations, as one command.
