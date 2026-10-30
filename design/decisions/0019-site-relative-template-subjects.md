---
adr: '0019'
title: 'Site-relative template subjects: one template change per data object, resolved for each site'
date: 2026-10-30
status: Accepted
scope: project
tags: [transformation, rollout, model, time]
---

# ADR 0019 — Site-relative template subjects: one template change per data object, resolved for each site

Amends ADR 0013 point 4 and ADR 0014 §2. Extends ADR 0017's dispositions. The sponsor accepted it as proposed on 2026-10-30 (#230).

## Context

A rollout's template change names one element as its subject (`ChangeEntryBase.subject`, `src/model/plan.ts`). For a data migration, the subject that changes is different at every site: each site's own store stops realizing its data, then retires. The review of #228 (#212's demo) found what that does to a template, and filed it as #230:

- **The demo shares one store per region.** A single named subject cannot pick out a store per site. So 32 sites' entries act on one element, at 32 different dates.
- **Each store is retired twice.** `replace store → lake` at cutover already retires the store (ADR 0014 §2's table), and a separate `retire store` 90 days later retires it again. Once R3 derives the entries, that is the first conflict ADR 0014 §6 lists.
- **The wrong thing is replaced.** Proposal §4.8 moves a store's *realization* of its data at cutover. The template instead replaces the whole element at that date, and the demo's docblock cites §4.8 for it.

ADR 0014 §2 already lets an entry's *date* be "a reference resolved by its owner": an anchor milestone plus an offset. Its subject has no such form.

## Decision

1. **A template change's subject may be a site-relative slot.** The rollout resolves the slot for each site it applies to, as it already resolves the date.
   - A slot names an element by its place in the site's baseline, for example: "the Artifact that this site's Location aggregates and that realizes Data Object D".
   - A slot may also name a relationship between a slot and a fixed element, for example: "the Realization from that Artifact to D".
   - A fixed element id stays allowed, for things that are the same at every site, such as the central store.
   - A slot that resolves to nothing at a site is reported by ADR 0017's check "a site whose baseline lacks the element a template change retires". It is never silently skipped.
   - A slot that resolves to more than one element at a site is a finding, and is never resolved by picking one.
   - Initiatives (#60) keep fixed subjects. Only a rollout's template, which is written once for many sites, has slots.
2. **A data object's migration is two entries.** No store is retired twice.

   | Date | Entry | Effect |
   |---|---|---|
   | cutover | `remove` the site store's Realization of D | the data is served from the target store from then on |
   | legacy decommissioned | `replace` site store → target store | the site store retires once, and the pair is the successor link gap analysis needs (#64) |

   The target store's own Realization of D belongs to the baseline. If it is new, it is introduced once, rollout-wide, at the pilot's cutover. No site introduces it.
3. **Dispositions live on the template, per data object.** A site's `modify` exception overrides the disposition (ADR 0017 point 1).

   | Disposition | Entries |
   |---|---|
   | `migrate` | as in point 2 |
   | `archive` | as in point 2, with the archive store as the successor |
   | `purge` | `remove` the Realization at cutover, and `retire` the site store at legacy decommissioned; no successor |
   | `retain` | none |

   This agrees with the sponsor's decision for the residency check (ADR 0017, 2026-10-29), where purged and retained data never reaches the target store.
4. **A shared store moves with its last site.** A slot can resolve to the same element for several sites, such as a regional file share. In that case:
   - both its `remove` and its `replace` take the **latest** of those sites' dates;
   - the store gets an advice finding that names how many sites share it.

   A shared store is real in an estate, and treating it as a conflict would report a correct plan as wrong.
5. **The demo gets one store per site.** It keeps one or two shared regional stores, to exercise point 4. That gives about 160 to 320 Artifacts, well inside ADR 0014's budget of 5,000 elements for `modelAt`, and it brings the inventory, the graph and `modelAt` to the real scale ADR 0012 asks for.

## Alternatives rejected

- **A relationship-level `replace`.** It would add an entry kind to ADR 0014 §2. A `remove`, together with the target store's existing Realization, says the same thing.
- **Writing every site's entries out in full.** It gives 160 copies of one template, which can drift, and it defeats having a template.
- **Leaving stores shared per region.** That keeps the double retire and the 32 dates on one element, and it does not match an estate where each site runs its own store.

## Consequences

- **The schema changes:**
  - a template change's subject becomes a union of an id and a slot;
  - the template gains a disposition per data object.

  `migrate.ts` moves an older template forward unchanged, because a fixed id is still a valid subject.
- **The checks change:**
  - `validate()` checks that a slot's type and Data Object exist;
  - plan checks report a slot that resolves to nothing, or to more than one element;
  - point 4's advice is a new plan check.
- **The exchange format carries a slot** inside the template's canonical JSON property (ADR 0013 point 10), so nothing new is mapped to ArchiMate.
- **The code lands with R3's derivation** (#60, #61, #64). Until then, a slot is stored, validated and shown, but no state is derived from it. The demo is regenerated when the derivation lands.
- **#230's acceptance** is this ADR, plus a test that the regenerated demo's template produces no ADR 0014 §6 conflict beyond those it seeds on purpose.
