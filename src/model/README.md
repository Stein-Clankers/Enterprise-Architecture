# The model layer

The typed ArchiMate 3.2 core. Pure TypeScript — no React, no storage, no I/O.
Everything above it (store, import/export, screens, reports) imports model
semantics from here and nowhere else.

Concept reference: `design/specs/open-ea-repository-concept.md` §4.
UI reference: `design/specs/open-ea-repository-ui-spec.md` §3.1, §2.2.

| File | What it owns |
|---|---|
| `layers.ts` | layers, aspects, the six colour groups |
| `element-types.ts` | the 61-element catalogue, two-letter codes |
| `relationship-types.ts` | the 11 relationship types, notation, abbreviations |
| `validity.ts` | the relationship validity matrix: Archi's `archi/relationships.xml`, and its junction rules |
| `profile.ts` | portfolio profile types, scales, TIME, tags |
| `plan.ts` | rollouts, waves and site plans; `PlanDate`; change entries; their guards (#209) |
| `lifecycle.ts` | phase derivation from dates |
| `site-phase.ts` | a site's milestone dates resolved (set, inherited or spaced) and its derived phase and overdue flag (#213, ADR 0016) |
| `presets.ts` | the rollout presets, as data: milestone sets, default durations and the checks each adds (#213, #214) |
| `plan-checks.ts` | a rollout's plan checks at a time point: capacity, blackouts, dependency order, expiry, precision, the template's reach, and the preset's checks (#214, ADR 0017) |
| `completeness.ts` | completeness scoring and model health |
| `workspace.ts` | `Element`, `Relationship`, `View`, `Folder`, `ReportDefinition`, `Workspace` |
| `views.ts` | pure view operations: node removal with lifting, absolute bounds |
| `legend.ts` | what a legend lists, worked out from its view as Archi does (#134) |
| `migrate.ts` | bringing a stored workspace from an earlier schema forward |
| `validate.ts` | whole-model validation: Archipelago's integrity findings, and the validator's run |
| `validate-views.ts` | referential integrity of views and folders |
| `validate-plans.ts` | referential integrity of rollouts, waves, site plans and the template's references |
| `checks.ts` | Archi 5.10's eight validator checks (#193) |
| `nesting.ts` | what nesting one shape in another can mean: the prompt's and the validator's one rule |
| `folders.ts` | where things may be filed: each kind's group, no folder inside itself |

## Element types

All 61 element types of ArchiMate 3.2: Strategy (4), Business (13), Application
(9), Technology (13), Physical (4), Motivation (10), Implementation & Migration
(5), plus Location, Grouping and Junction. Each carries a layer, an aspect, a
colour group, and a unique two-letter monospace code — the code replaces the
notation shape set in list, card, graph, breadcrumb and palette contexts (ADR
UI-2). Junction is a relationship connector rather than an element, but the
exchange format serialises it in the element list, so it is carried here.

The catalogue has one `Junction`, as the specification does. The exchange format
has two concrete types instead, so the and/or flavour travels beside the type as
`Element.junctionKind` — absent means `and`, which is what an unqualified
junction is — and `io/exchange-format.ts` maps between the two shapes.

Three relationship attributes belong to one type each (`TYPE_SPECIFIC_ATTRIBUTES`):
`accessType` on Access (in the profile), `isDirected` on Association and
`modifier` on Influence (on `Relationship`). `misplacedAttributes` is the one
definition of "on the wrong type"; the readers, the exchange writer and
`validate` all use it (#84).

Colour groups are not layers: Strategy renders with Business, Physical with
Technology, and every passive-structure element renders in the slate ramp
regardless of which layer it belongs to.

## Relationship validity

The matrix is Archi's own `relationships.xml` (ADR 0009, #129), vendored
unmodified in `archi/` under its MIT licence: the specification's Appendix B as
Archi 5.10 enforces it. `validity.ts` parses it at load, and a test pins the
file's SHA-256, so it cannot be edited by hand without the test failing.

- `validateRelationship(source, type, target)` is the matrix alone, by element
  type. A refusal names what is allowed instead, and the other direction when
  that one is allowed.
- `validateRelationshipBetween(model, source, type, target)` adds Archi's
  junction rules, which need the model: every relationship on a junction is of
  one type (a Grouping or Location containing it does not count), and each
  element on the junction's far side must be a legal end for the type. The
  connect menu, the fact sheet's relation picker and `validate()` all use it,
  as Archi's connection tool and validator do.

Until #129 this module derived the matrix from structural rules over the
`(layer, aspect)` metadata. They disagreed with Archi on 5,437 cells.

## Lifecycle derivation

There is no stored lifecycle phase (ADR UI-3). Each date is the date its phase
*starts*, and the phase at a time point is the last phase whose start has been
reached:

```
t < phaseIn   → Plan          t < active   → Phase In      t < phaseOut → Active
t < endOfLife → Phase Out                                  otherwise    → End of Life
```

Phases without a date are skipped, so partial lifecycles behave sensibly; a time
point before every known start resolves to the phase preceding the earliest one.
Elements with no dates at all are Active and render `—` for every date. With all
four boundary dates present this is exactly the UI spec's rule — `lifecycle.test.ts`
checks the two agree on every year in the slider range.

Deriving rather than storing is what makes the time dimension free: the inventory
evaluates at today, the graph at its slider year, the roadmap will read the same
dates, and nothing can drift.

## Completeness scoring

*(UI spec open question 4 — resolved here.)*

Completeness is the **weighted fraction of the fields expected of an element**,
as a percentage. Which fields are expected depends on the element type.

| Criterion | Weight | Applies to |
|---|---|---|
| Documentation | 2 | every element |
| Owner (`owner` property) | 1 | every element |
| At least one relation | 2 | every element |
| Tags | 1 | every element |
| Lifecycle dates | 3 | profiled types — scored as the fraction of the five dates set |
| Functional fit | 1 | profiled types |
| Technical fit | 1 | profiled types |
| Business criticality | 1 | profiled types |
| TIME classification | 1 | profiled types |

"Profiled types" are the element types that carry a portfolio profile —
`PROFILED_TYPES` in `profile.ts`, Application Component and the IT-component-like
technology types by default (concept §4.2: applied to Application Component by
default, configurable per type later).

Two decisions worth stating:

- **Non-profiled types are not scored on profile fields.** A Capability with no
  technical fit is not an incomplete capability. Scoring it against fields it
  cannot have would make every non-application element look neglected and make
  model health meaningless.
- **Lifecycle scores partially.** Three of five phase dates earns three fifths of
  the weight, because half-filled lifecycles are the normal state of a real
  inventory rather than an error.

So a Capability is complete at 6 points (documentation, owner, a relation, a
tag); an Application Component at 13.

Weights live in `COMPLETENESS_CONFIG` and nowhere else. The colour ramp is ≥75
green, ≥50 amber, else red (handoff, "Derived values"); model health is the
rounded mean of element completeness.

## Views and folders (#75)

A `View` is a hand-drawn diagram: `nodes` (an element drawing, a note, a group,
or a reference to another view) and `connections` (a relationship drawing, or a
plain line). Node bounds are **relative to the parent node**, so moving a
container is one edit; bend-points are absolute view coordinates. Ids of nodes
and connections are unique within their view.

A `Folder` is organisation, not semantics. Each sits either in another folder
(`parent`) or directly in one of the fixed top-level groups (`root`) — never
both. Membership is on the member (`folder` on elements, relationships and
views); absent means the default group for its kind, which `defaultFolderRoot`
gives for an element's layer.

The model tree (#80) moves things with the store's `moveToFolder`, which keeps
each kind in its own group — an element under its layer's group, a relationship
under Relations, a view under Views, a folder in the group it was made in — and
refuses a folder moved into itself. `folders.ts` holds those rules, so the tree
can refuse a drop before the store would.

Saved report definitions were called `ViewDefinition` and stored under `views`
in schema 1; schema 2 renamed them `ReportDefinition`, stored under `reports`.

## Validation (#193)

Two kinds of finding, each a `Finding` with a severity (`error`, `warning`
or `advice`, Archi's three issue types), a stable `code`, and the subject it
concerns: an element, relationship, view, folder, or a view's shape (`node`)
or line (`connection`), which also names its `viewId`.

- **Archipelago's own** (`integrityFindings` in `validate.ts`, with
  `validate-views.ts`): what a file can get wrong that Archi's model cannot
  hold, such as a dangling reference, a duplicate id or an unparseable date.
  They always run and carry no `check`.
- **Archi's eight checks** (`checks.ts`), ported from the bytecode of each
  `*Checker` in `com.archimatetool.hammer` 5.10 and tagged with their
  `CheckId`. Each can be switched off, as on Archi's Validator preference
  page; all are on by default. Their severities are Archi's: invalid
  relations and junctions are errors; duplicates, unused elements, unused
  relations and viewpoint concepts are warnings; empty views and nesting are
  advice.

`validate()` is what the importers and tests ask: Archipelago's findings plus
Archi's invalid-relations check, as before #193. `runValidator(workspace,
enabled)` is the validator screen's run: Archipelago's findings plus each
enabled check. Archi's command line has no validator, so nothing here is
diffed against Archi's output; `checks.test.ts` has a fixture per check that
trips it alone, and a near miss for each that trips nothing.

Where the port follows Archi rather than the obvious reading:

- **Duplicates** compare the name exactly (no trimming, case counts) and the
  type exactly; two unnamed elements of one type are duplicates, and two
  junctions never are.
- **Junctions** count every relationship's type, a Grouping's containment
  included, which `validateRelationshipBetween` lets through. So a junction
  inside a Grouping can trip the junction check and no other.
- **Viewpoints** report element shapes only. Archi 5.10 has a message for a
  relationship but never reaches it.
- **Empty views** are views with no node at all: one holding only a note is
  not empty.
- **Nesting** asks `meansNesting`, the rule the canvas's nesting prompt asks
  (#131). A line drawn between the two shapes that does not mean the nesting
  reports it; otherwise a nesting-type relationship either way round in the
  model means it is not reported.

## Rollouts, waves and site plans (#209)

ADR 0013 and ADR 0014 decide the model; `plan.ts` holds the shapes and their
guards, and nothing that evaluates them. Date inheritance, the derived site
phase and presets are `site-phase.ts` and `presets.ts` (#213, ADR 0016); a
site's exceptions, dependencies and own blackouts are fields of its site plan,
and the plan checks are `plan-checks.ts` (#214, ADR 0017).

- **A milestone date resolves from the site, else its wave, else its
  rollout** (`SitePlan.milestones`, `WavePlan.milestones`, `Milestone.date`).
  Only the site's own date is *set*; a milestone none of them dates is spaced
  from a neighbour by the site's archetype's durations, at that neighbour's
  precision. Nothing resolved is stored: the screens resolve each time.
- **The site phase is derived, never stored**, as a lifecycle phase is: the
  phase started by the last milestone reached, an actual day taking
  precedence, a planned one reached on the first day of its period, and a
  spaced one on the exact day its chain reaches. A site in no wave is
  Unplanned until its first actual day, and then follows its actual days.
  Overdue is a flag: a planned period that has ended with no actual day, for
  a site in a wave (ADR 0016, amended 2026-10-28).
- **Every record kept by milestone id is read with `getKey`**
  (`io/records.ts`): a user names the milestone, and "Constructor" is the id
  `constructor`, which a plain object finds on `Object.prototype` (#229
  review). The rollout test fixture has such a milestone.

- **A rollout is a Work Package with `plan.kind === 'rollout'`.** Its plan
  holds the template version, the ordered milestone set, the ordered scope
  template, the constraints, the archetypes and one **site plan** per
  Location. Site plans are records keyed by Location id, not elements (ADR
  0013 point 3).
- **A wave is a Work Package with `plan.kind === 'wave'`.** Its plan names
  its rollout, which is the one source of which rollout a wave belongs to.
  `createWave` also adds the Aggregation from the rollout, so the model says
  it in ArchiMate terms too. A wave's `label` (Pilot, W1) is beside the
  element's name, which stays the full name.
- **A `PlanDate` is held by the first day of its period**: the first of the
  quarter or month, the Monday of the ISO week, or the day itself. So a
  period has one spelling and one file (ADR 0004), and `isPlanDate` refuses a
  day that does not start its period rather than guessing which period was
  meant (ADR 0015 point 1). `formatPlanDate` and `parsePlanDate` read and
  write the forms people type: `2027-Q2`, `2027-05`, `2027-W19`, `2027-05-12`.
- **A template change is ADR 0014's change entry** with an applicability rule.
  Its date is a `PlanDate` or an anchor milestone plus whole days. Which
  template changes apply to an archetype is said by each change's
  applicability, so an archetype holds only its label and its default
  durations.
- **Every guard is strict**: it accepts exactly the shape, with no key it does
  not know, so what it passes is what canonical JSON writes back and the
  published schema accepts. The store calls them on the write path:
  `waveIdOf` and `archetypeIdOf` turn a form's value into an id of the
  rollout's own, or `undefined`, so a `<select>`'s empty option stores
  nothing.

Deleting a Location leaves its site plans where they are: a plan holds the
dates, actuals and notes someone entered. `validate()` reports each reference
a site plan or a wave holds that no longer holds (`plan.site-location-missing`,
and the same for a wave, an archetype, a milestone, or a wave's rollout), and
each reference of the template (#214): a change's subject and successor, its
applicability's element and archetypes, its date's anchor, and the keys of an
archetype's durations. A site's exceptions and dependencies are checked the
same way (`plan.exception-*`, `plan.site-dependency-*`).

**Plan checks are not integrity findings** (#214, ADR 0017). `planChecks`
judges a plan at a time point, `validate()` says it points at nothing; a check
leaves a reference that does not hold to `validate()`. The checks of every
rollout are a site in no wave, a wave over capacity, a cutover in a blackout,
a dependency order violated, an expired exception (of any class), a site
still at quarter precision in the next wave or a wave under way, a template
change made at no site, and a site that lacks what a change retires; a rollout made from a preset (`RolloutPlan.preset`)
runs that preset's checks too, which `presets.ts` holds as data. An order
compares the days the phase is derived from (`reachedAt`); an overlap with a
blackout compares the whole period a date is shown at. A coarse date in an
order counts from its period's first day, so an order check does not flag a
coarse order; the next-wave check keeps the near waves precise. No check is silent on
input it lacks: it says, as an `advice`, what it could not judge and why.
Checks are independent: one site may be reported by several, and none yields
to another. A `preference` exception with no expiry is advice; a `legal` or
`operational` one may be open-ended. A site that purges or retains a
template `replace`'s data (a `modify` exception) moves none of it, so
residency does not read that change at it.
