---
adr: '0020'
title: 'modelAt: what ADR 0014 left open about reading a state'
date: 2026-10-30
status: Accepted
scope: project
tags: [transformation, time, model]
---

# ADR 0020 — modelAt: what ADR 0014 left open about reading a state

Extends ADR 0014 §1, §4 and §6. It reverses nothing ADR 0014 says. The sponsor accepted it as proposed on 2026-10-30, with #246.

## Context

#61 implements `modelAt(workspace, at, scenario?)` (`src/model/model-at.ts`) and `planConflicts`. ADR 0014 fixes the entry kinds, the plan of record, the precedence of entries over stored dates, and the invariant. Writing the function needed more answers, and its review (#246) found three more. Each one changes what a user sees, so each is written down here.

## Decision

1. **`validTo` is the first day a relationship is no longer valid.** A relationship's window is `[validFrom, validTo)`.
   - This matches every other date in the model: a lifecycle date is the first day of its phase, and a `remove` entry's date is the first day without the relationship.
   - The alternative is to read "valid to 31 Dec" as including 31 Dec. Then a `remove` on 1 Jan and a `validTo` of 1 Jan would mean different days.
2. **A relationship is valid only while both endpoints are live,** not merely while neither is absent or retired.
   - ADR 0014 §4's invariant names absent and retired endpoints. A relationship to a planned element is held back as well, so a view never draws a working dependency on something that does not exist yet.
   - The relationship's own window is unchanged. It becomes valid when its later endpoint goes live.
3. **Of several included entries that date the same thing, the earliest wins.** `planConflicts` lists two retirements as `change.retired-twice` (ADR 0014 §6). Two introductions are not a conflict ADR 0014 lists, and are not reported.
4. **"Dated only by entries" means having no date of its own.**
   - An element is absent from a state that leaves its introduction out when some initiative, of any status, introduces it (or is the successor of its `replace`), and it has no lifecycle date at all.
   - A relationship is absent in the same way when some initiative `add`s it and it has no `validFrom`.
   - An element with any lifecycle date keeps its stored state in every scenario.
   - Only an entry whose references hold counts, and this is decided once, for `modelAt` and `planConflicts` alike:
     - an `add` naming an element introduces nothing;
     - a `replace` whose subject or successor is missing dates nothing, so its successor is not made absent;
     - a `replace` of an element by itself dates nothing either.

     `validate()` reports each of them (`plan.initiative-subject-unknown`, `-successor-unknown`, `-replace-self`).
5. **A relationship outlives an endpoint only when its end is dated.**
   - `change.relationship-outlives-endpoint` is listed when a `validTo` or an included `remove` falls after an endpoint's retirement.
   - An open end is not listed. It says nothing about the endpoint, and the relationship stops being valid when the endpoint retires (point 2).
   - Listing open ends would report nearly every baseline relationship to a retiring application, which is the two-sources-of-truth burden the research found in LeanIX (ADR 0014, Context).
6. **On one date, the later-included `modify` wins.** Initiatives are read in id order (code units, ADR 0004), and each one's entries in its author's order.
7. **Two of ADR 0014 §6's six conflicts wait for their issues:**
   - "A live element depends on an element retired before it" needs impact's notion of dependency (#65).
   - "An initiative starts before an initiative it depends on finishes" needs initiative dependencies (#60).
8. **A retirement never makes an element live.**
   - An included `retire` sets the stored end of life aside, and the element keeps whatever its other dates say until the entry's date.
   - So an element planned and then retired by its lifecycle, with no phase-in, stays planned until the entry retires it.
   - Before the review, the entry revived it as live in between, with no introduction anywhere.
9. **The budget is the evaluation at a time point.** Following ADR 0014's own remedy, `modelAt` is two steps:
   - `preparePlan` reads the ids, the dates and the included entries once per model version and scenario;
   - `stateAt` evaluates at a time point.

   The two budgets, on the CI runner, which runs the suite under coverage:
   - **`stateAt`:** at most 10 ms, held to half that in the test as the margin;
   - **a cold `modelAt`:** at most 30 ms. An edit pays it once.

   Under coverage the runner measured about 4× this machine's time. The first version took 21 ms cold there, before preparation was split out.
10. **A relationship bound that is no date is read as unset,** the way an unparseable lifecycle date is. `validate()` reports it (`relationship.unparseable-date`). It also counts as no `validFrom` for point 4, so a relationship whose only real introduction is an excluded `add` stays absent.

## Consequences

- `model-at.test.ts` pins each point, and in each precedence test the stored date falls on both sides of the entry's.
- If the sponsor changes point 1, only the window `preparePlan` reads and its tests change. Stored files keep their bytes either way.
