---
adr: '0015'
title: 'Plan dates and the exchange mapping of rollouts'
date: 2026-10-26
status: Accepted
scope: project
tags: [transformation, rollout, exchange-format, archimate]
---

# ADR 0015 — Plan dates and the exchange mapping of rollouts

Amends ADR 0013 points 5 and 10.

Point 3 is extended by [ADR 0016](0016-milestone-dates-and-site-phase.md): a wave's milestone dates travel under the same `archipelago.plan.milestone.<id>` key family.

Point 3 is extended by [ADR 0017](0017-site-exceptions-dependencies-and-plan-checks.md) (proposed): a site's exceptions, dependencies and own blackouts travel as canonical JSON on the site plan's Work Package, and a rollout's preset as a property of its own.

## Context

#209 put ADR 0013's rollouts, waves and site plans into the model and both file formats (PR #217). The PR made two file-format commitments that ADR 0013 leaves open. Each would need a migration to change later:

- how a `PlanDate` is stored (ADR 0013 point 5 gives it a date and a precision, and nothing more);
- how a site plan, which is a record and not an element, is written to the exchange format and recognised again on import.

It also departed from ADR 0013 point 10, which says "a wave's end travels as a Plateau". The PR writes the window as two properties and no Plateau. The review of #217 found the departure unrecorded, with the PR's own docs citing point 10 for a mapping that contradicts it. The sponsor accepted the decisions below on 2026-10-26.

## Decision

1. **A `PlanDate.date` is the first day of its period:**
   - the first day of the quarter, for `quarter`;
   - the first day of the month, for `month`;
   - the Monday of the ISO 8601 week, for `week`;
   - the day itself, for `day`.

   A date that does not start its period fails the guard (`isPlanDate`) and is never stored. A period therefore has one spelling, and two plans that say the same thing write the same bytes (ADR 0004). The textual forms `YYYY-Qn`, `YYYY-MM`, `YYYY-Www` and `YYYY-MM-DD` are the spelling used in exchange files, Excel and the UI. `formatPlanDate` and `parsePlanDate` are the one pair that converts between the two.
2. **A wave's rollout is `plan.rollout`.** `createWave` also adds an Aggregation from the rollout to the wave, so the model says it in ArchiMate terms. That relationship is for ArchiMate readers: it is an ordinary relationship, and no reader derives a wave's rollout from it. A wave's `label` (Pilot, W1) is kept beside the element's name, which stays the full name.
3. **Site plans in the exchange format:**
   - **One Work Package per site plan,** with the id `<rollout>.site.<location>`.
   - **Two relationships with it:**
     - `<id>.in`, an Aggregation from the site's wave, or from the rollout when the site is in no wave;
     - `<id>.at`, an Association to the Location.
   - **These ids are claimed as `xs:ID`s and never parsed.** They are claimed like every other id the writer writes, so a collision is resolved deterministically and the same model writes the same file. On import a site plan is recognised by `archipelago.plan.kind = site` alone. Nobody may add a parser for these ids: the composition is not escaped, because nothing reads it.
   - **One property per field.** Each milestone's planned date is under `archipelago.plan.milestone.<id>`, and each actual date under `archipelago.plan.actual.<id>`.
   - **The notes are the Work Package's documentation.**
   - **The name is derived** as `<rollout name>: <location name>`. A different name on import is reported, since the model has no field to keep it in.
   - **Site plans are not filed in organizations.** A site plan's Work Package or relationship that a file files in a folder is folded back, and the filing is reported.
4. **Plan properties are declared `string`.** Three of the four precision forms (`2027-Q2`, `2027-05`, `2027-W19`) are not `xs:date` lexical forms, so a `date` declaration would be false for them. A declared type would also enter the workspace's `propertyTypes` on import. Where a carried `propertyTypes` entry makes the writer declare a plan key `number` or `boolean`, the readers read the value's text, which is exactly what the writer wrote, so the plan still comes back.
5. **Amends ADR 0013 point 10:** a wave's window travels as the properties `archipelago.plan.windowStart` and `archipelago.plan.windowEnd`. No Plateau is written per wave. Plateaus are reserved for the named states of ADR 0014 §3 (#62), where "after wave N" belongs.
6. **Empty notes are no notes,** so a site plan with empty notes and one with none are one model and write one file. **`deleteWave` unassigns its sites and keeps their dates:** a wave going is no reason to lose what was entered for its sites.

## Consequences

- **A form must snap or refuse visibly.** `toPlanDate('2027-05-12', 'week')` is `undefined`; it does not snap to the Monday. The editing UI (#211) therefore either snaps the day to the start of its period before calling it, or shows that the value was refused. A later change from "refuse" to "snap" in the guard is a schema change.
- **ADR 0013 point 10 now reads with this ADR.** Its other parts stand: plan fields travel as `archipelago.plan.*` properties, the template and exceptions as canonical JSON in a property, Implementation Event and Gap are not used, and what the exchange cannot carry is reported.
- **A site plan's Work Package only exists in the file.** An export of a 160-site rollout holds 160 more Work Packages and 320 more relationships than the model; an import folds them back, and the model gains no element for any of them.
- **No reader depends on the id composition.** Changing it would change the bytes an export writes, and nothing else: the `archipelago.plan.kind` key and the property keys are the contract.
