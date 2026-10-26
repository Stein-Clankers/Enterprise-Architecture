---
adr: '0014'
title: 'Time and change: dated validity, change entries owned by initiatives, scenarios as overlays'
date: 2026-10-26
status: Accepted
scope: project
tags: [transformation, time, model, scenarios]
---

# ADR 0014 — Time and change: dated validity, change entries owned by initiatives, scenarios as overlays

## Context

Transformation planning (#72) and rollout planning (#206) have to answer three questions:

- What does the architecture look like **at a date**?
- What does it look like **under a plan**?
- What is the **difference** between two such states?

#58 set out three options:

1. a snapshot per state;
2. effective dating plus change sets, with scenario overlays;
3. git-like branches inside the model.

The concept (`archi-class-modelling-concept.md` §3.1) recommends option 2, and ADR 0013's rollout template assumes it.

What the model already has:

- **Elements carry lifecycle dates,** and their phase is derived at a time point (ADR UI-3).
- **Relationships carry `validFrom` and `validTo`** in their profile. These round-trip through canonical JSON and the exchange format, but nothing evaluates them.

The research (`design/specs/migration-planning-research.md`) found three things:

- **This is the approach of LeanIX, Bizzdesign and Alfabet,** and of the literature (Buckl et al., Aier & Gleichauf).
- **LeanIX ends up with two sources of truth,** because lifecycle dates and relation-validity dates must be kept aligned by hand.
- **A gap computed as a set difference misses replacements** unless successor links are recorded.

## Decision

The sponsor accepted option 2 on 2026-10-26.

### 1. Validity is dated, and the state at a date is derived

- **An element's dates are its lifecycle dates.** At a time point an element is in one of three states:
  - **planned**: before its phase-in starts;
  - **live**: phase-in, active or phase-out;
  - **retired**: end of life has started.

  An element with no dates is live, as today.
- **A relationship is valid from `validFrom` until `validTo`.** Each bound is optional: an absent bound is open, so a relationship with neither bound is always valid.
- **States are never stored.** They are worked out at a date, as the lifecycle phase is.

### 2. Change entries are owned by initiatives

An **initiative** is a Work Package with a plan profile (#60). Its status runs `idea → proposed → approved → in progress → done`, or `cancelled`. It owns an ordered list of change entries:

| Entry | Effect at its date |
|---|---|
| `introduce` element | the element becomes live |
| `retire` element | the element becomes retired |
| `replace` A → B | B becomes live and A retires, and the pair is recorded as a successor link |
| `add` relationship | the relationship becomes valid |
| `remove` relationship | the relationship stops being valid |
| `modify` field | a planned value takes effect (§5) |

- **Entries date things that exist in the model; they never hold model objects.** A new application is created as an element, and an `introduce` entry says when it goes live. An element or relationship whose only introduction is an entry exists only in the states that include that entry. In every other state it is absent.
- **Each entry's date is either a `PlanDate` or a reference resolved by its owner.** This is how ADR 0013's rollout template works: an anchor milestone plus an offset, resolved for each site. The template shape in ADR 0013 point 4 is therefore exactly this entry shape, which confirms that ADR's provisional point.
- **Every edit to an entry is a command** on the command stack, as every model edit is.

### 3. The plan of record, scenarios and named states

- **Plan of record:** the entries of every initiative with status `approved`, `in progress` or `done`.
- **Scenario:** the plan of record with named initiatives included or excluded, such as draft initiatives or alternative plans. It is evaluated as an overlay and never copied. A scenario is stored as its name, its inclusions and its exclusions, so it round-trips. Later kinds of override, such as R4's alternative wave plans, extend this record.
- **Named state (plateau):** a stored `(date, scenario)` pair with a name, for example "T1: after ERP consolidation, 2027-06". It is referenced by views, reports and exports. On exchange export it becomes an ArchiMate Plateau carrying its date and scenario as `archipelago.*` properties. The import recognises it by those properties and reads it back as a named state.
- **Target:** the last named state of the chosen scenario. It is not a separate concept.

### 4. `modelAt(date, scenario)` is the one way to read a state

- **What it is:** a pure function in `src/model`. Given a workspace, a date and an optional scenario, it returns a read-only state:
  - every element, with its state (planned, live or retired);
  - the relationships valid at that date;
  - planned values resolved.
- **Its invariant:** it never returns a valid relationship with an endpoint that is absent or retired at that date.
- **Precedence:** where an included entry and an element's stored date disagree, the entry wins, and the disagreement is listed as a conflict (§6). This gives one effective source of truth without forbidding baseline dates.
- **Its consumers:** the inventory, fact sheet, graph, views, gap (#64), impact (#65) and every report all read through it. None evaluates dates on its own.

### 5. Planned values are an allow-list

A `modify` entry may set a future value only for these fields:

- technical fit;
- functional fit;
- TIME;
- custom fields that #70 marks as plannable (hosting is the first).

Any other change to an attribute is a direct edit of the present, not a plan. Full bitemporal history ("what did we believe on date X") is out of scope. It belongs to the change log (#67) and git.

### 6. Conflicts are computed, never prevented

The model accepts any plan and lists its conflicts at evaluation:

- two included entries retire or replace the same element;
- a relationship is valid beyond an endpoint's retirement;
- a live element depends on an element retired before it;
- a successor goes live after its predecessor retires, leaving a gap in coverage;
- an initiative starts before an initiative it depends on finishes;
- a stored date disagrees with an included entry.

Rollout plan checks (#214) are added to the same list.

## Alternatives rejected

- **Snapshots per state (#58 option 1).** Copies drift: a correction has to be made once per copy, and the gap between two states becomes a diff of unrelated documents.
- **Branches inside the model (#58 option 3).** These are hard to present to non-technical stakeholders, and scenarios as overlays cover the need. Branching stays a collaboration concern (concept §4), not a planning one.

## Consequences

- **The spike #58 asks for still has to be done.** `modelAt` on a generated workspace of 5,000 elements and 15,000 relationships must evaluate in at most 10 ms on the CI runner. A test asserts the budget with a margin and fails when it is broken. If the spike misses, memoisation by `(model version, date, scenario)` is the first remedy, before this ADR is revisited.
- **#61 now has its contract:** relationship validity evaluated, `modelAt`, and a time point in the shared chrome. #60 has its entry kinds and statuses. #62 has its scenario record. #64 gets successor links from `replace` entries.
- **The schema version bumps** when initiatives, entries, scenarios and named states enter the workspace. `migrate.ts` brings older files forward unchanged, since an old file has no entries.
- **The exchange format carries entries lossily,** as #60 says: initiatives travel as Work Packages with their entries as canonical JSON in a property, and anything a reader cannot restore is reported.
- **Rollout work (#209) is unblocked:** its template changes are change entries with a resolved date.
