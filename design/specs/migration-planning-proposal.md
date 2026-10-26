# Migration planning for multi-site rollouts: proposal

**Status:** Accepted on 2026-10-26: priority in ADR 0012, model in ADR 0013 (§11). · **Date:** 2026-10-26
**Builds on:** #72 (plan pillar), #58 (time and change model), #60–#65, #70 (custom fields), #94 (CSV round-trip), concept `archi-class-modelling-concept.md` §3
**Evidence:** `migration-planning-research.md` (this folder). Every claim below about a standard, vendor or practice is sourced there.

## 0. Summary

We have to plan the migration of **160 locations**, roughly first and in detail later. The plan pillar (#72) already designs the general machinery: dated changes owned by initiatives, `modelAt(date, scenario)`, scenarios, gap and impact analysis. It has no notion of **the same change rolled out to many sites in waves**, and that is what this proposal adds.

The core idea is **one rollout, one template, many sites**:

- A **Rollout** describes *what changes at a site* once, as a template: retire the legacy ERP instance, introduce the global template, replace the local server.
- **Waves** group sites in time windows.
- Each **site plan** stores only what is specific to that site: its wave, any dates it overrides, its local exceptions, its dependencies and its actuals.
- The per-site architecture changes are **derived** from the template and the site's resolved dates, never copied 160 times. This is the same rule that keeps lifecycle phases derived.

Planning starts coarse (sites → waves, quarter-precision dates) and gets sharper wave by wave (milestones, exceptions, dependencies), as both rolling-wave practice and the cloud frameworks recommend. Task-level execution stays in the project tool. Archipelago exports the plan and imports the actuals.

Delivery comes in four slices. **R1** (site register + wave plan) and **R2** (detailed site plans) are planning data only, so they do not wait for the overlay engine. **R3** connects them to #58's time model and makes the architecture at any date visible per site. **R4** adds scenarios and a sequencing assistant.

## 1. The gap in today's plan

| Need for a 160-site migration | Covered by #72 today? |
|---|---|
| Register of sites with attributes (region, size, type, criticality) | Partly: `Location` exists as an element type; site attributes need #70 |
| What runs at each site today (baseline per site) | Partly: Location aggregation is legal ArchiMate; there is no bulk onboarding until #94 |
| Waves: assign sites to time windows, capacity per wave | **No** |
| Same change applied to many sites, with local exceptions | **No**: #60's change sets are per initiative, so 160 sites would mean 160 hand-built change sets |
| Coarse dates first, precise dates later | **No**: dates are day-precise ISO strings |
| Per-site milestones (readiness, go/no-go, cutover, hypercare), planned vs actual | **No** |
| Site dependencies, blackout periods, plan conflicts | Partly: #63 plans initiative dependencies and conflicts, not site-level ones |
| Site × scope matrix, wave timeline, progress burn-up | **No**: #63 is an initiative roadmap |
| Architecture at a date per site, gap per site or wave | Partly: #61 and #64, once they can be filtered by location |

## 2. What the research says

Condensed from `migration-planning-research.md`:

1. **The standards give the vocabulary, not the method.** ArchiMate 3.2 has Work Package, Deliverable, Implementation Event, Plateau and Gap. A Location "aggregates" what is located or performed there, and may aggregate any concept, relationships and work packages included. Time is weak: work-package dates "may be modeled as attributes", and a plateau has no date attribute at all. TOGAF Phases E/F supply the artefacts, notably the **Transition Architecture State Evolution Table** (rows of services, one column per transition architecture, cells marked new / retain / transition / replace). Neither standard says anything about rolling out to many sites.
2. **The vendors split three ways on representing the future:**
   - **LeanIX** applies dated, templated changes to one live model. Its Initiative → Transformation → Impact structure includes a *Rollout* template; completion dates are given directly or bound to a milestone; changes can be bulk-created in a table; applications stay "Planned" until executed.
   - **Ardoq** branches the model into scenarios and merges them back.
   - **Bizzdesign, HOPEX and Alfabet** put time (lifecycles, dated plateaus) on one model.

   None has a first-class *site wave*. LeanIX's ERP example models waves as child projects of a programme, and its docs suggest the Matrix report "as a rollout plan". Alfabet's master plans are explicitly for "roll-out plans … along organizational or business structures".
3. **Practice has one shape everywhere:** *unit that moves together → wave → cluster/release.*
   - **Sequencing:** pilot first; small, non-critical and low-complexity before critical; capped by team capacity; avoid financial close periods and seasonal peaks.
   - **Elaboration:** "Define only the immediate next wave in detail" (Microsoft CAF). AWS keeps portfolio analysis about five waves ahead of execution.
   - **Local deviations from a global template** are classified as legal (mandatory), operational (justified) or user preference (rejected by default). Each has an owner and an expiry, and each wave is locked to a template version.
   - **Per-site gates:** readiness evidence, go/no-go, a rehearsed cutover with rollback, hypercare, planned vs actual reviewed after every wave.
   - **The tool boundary:** tasks live in Jira, Azure Boards or MS Project. The EA tool holds sites, waves, scope and dates. LeanIX itself says it "is not a project management tool".
4. **Open-source tools and the literature** point the same way:
   - **FINOS Waltz** has change units (ACTIVATE / RETIRE / MODIFY) with a planned date and an execution status (pending / complete / discarded).
   - **Essential** links plan → project → element with an action type (create / enhance / reduce / remove / no change).
   - **Buckl et al. and Aier & Gleichauf** derive future landscapes from dated projects, and note that a gap needs explicit *successor* links: a set difference alone misses replacements.
   - **No open-source tool computes plateau gaps.**

**What this means for us.** Archipelago's chosen direction (#58: effective dating + change sets + scenario overlays) is the LeanIX/Bizzdesign family, and it is the right base. The rollout layer is what no tool does well, and it is where the 160-site use case lives.

## 3. Design principles

1. **One model, dated change.** A rollout adds change entries to #58's overlay. It never copies the repository per wave or per site.
2. **Template once, derive per site.** The scope is written once. Per-site changes are computed from template × site × resolved dates. Only *deviations* are stored. This is the "derived, never stored" rule applied to plans.
3. **Dates inherit and sharpen.** A site's milestone resolves from the site's own date, else its wave's, else the rollout's. Each date carries a precision (quarter → month → week → day). The UI always shows whether a date is set or inherited. Rolling-wave planning then needs no special mode.
4. **ArchiMate underneath.** Rollout and wave are Work Packages, sites are Locations, and wave ends are Plateaus. Milestones travel as dated properties, not as Implementation Events, because ArchiMate 4 removes Implementation Event and Gap (ADR 0011) and the plan should not depend on either. Exchange XML carries the plan, and anything it cannot carry is reported, never dropped (§8).
5. **Stop at the site.** Archipelago plans sites, waves, scope, milestones and exceptions. Tasks, resourcing and timesheets belong to the project tool: plan out by file, actuals back by file (Excel first).

## 4. Concepts and data model

### 4.1 Sites

- **A site is a `Location` element.** Regions and countries are Locations too, linked by aggregation (Region ◇— Country ◇— Site). TOGAF's location categories (Region, Country, Building, Specific Location) are a sensible default.
- **Site attributes come from custom fields (#70)**: site code, country, headcount, site type (archetype), business criticality, legal entity, time zone, and blackout periods. Until #70 lands, they are namespaced properties (`archipelago.site.*`), handled exactly as `profile-properties.ts` handles the portfolio profile today.
- **What runs at a site** is modelled the ArchiMate way: the Location aggregates the application components, nodes, devices and actors located there. A shared central application used at a site is an association from the Location, so "at the site" and "used from the site" stay distinct.
- **Baseline onboarding is a CSV import** (#94) of sites and of site → element rows. Doing this through 160 fact sheets by hand is not realistic.

### 4.2 Rollout

A `WorkPackage` element whose plan profile marks it `kind: 'rollout'` (an initiative per #60, specialised). It carries:

- **Scope template:** an ordered list of template changes. Each one is an #60 change entry (`introduce`, `retire`, `replace A→B`, `add` or `remove relationship`, `modify` a planned value) written **relative to a site**:
  - the subject is "the site's aggregation of X";
  - the date is an **anchor** (a site milestone) plus an **offset**, e.g. `retire legacy ERP instance @ cutover + 30d`;
  - an **applicability** rule says which sites it applies to: all sites, sites of archetype *Plant*, or sites that currently aggregate X.
- **Milestone set:** an ordered list of milestones. Each one has an `id`, a label and the **site phase it starts**. A rollout begins from a preset (§4.8) and can rename, add or drop milestones. Nothing about data migration, ERP or network is hard-coded. Phase derivation (§4.5) reads only this list.
- **Template version:** an integer. Each wave records the version it is locked to, as SAP-style rollouts do.
- **Constraints:** blackout periods (rollout-wide; sites add their own) and default wave capacity.
- **Archetypes:** a short list of site types, each choosing which template changes apply and its own default durations between milestones.

### 4.3 Wave

A `WorkPackage` aggregated by the rollout, `kind: 'wave'`. It carries:

- order and label (`Pilot`, `W1`, `W2`, …);
- a **window** (start and end `PlanDate`) and the default anchor dates its sites inherit;
- a capacity (maximum number of sites);
- the template version it is locked to.

Waves are few (typically 5–15) and are real projects with owners and budgets, so they are elements: they appear in the inventory, have fact sheets, and work with #63's roadmap.

### 4.4 Site plan

One record per (rollout, site). A site can be in two rollouts at once, say ERP and network.

```ts
interface SitePlan {
  location: string            // Location element id
  wave?: string               // wave Work Package id; absent = not yet assigned
  archetype?: string
  milestones: Record<string, PlanDate>   // keyed by the rollout's milestone ids; overrides only, the rest inherit
  actuals: Record<string, string>        // ISO day per milestone id; from the Excel actuals sheet
  exceptions: SiteException[]  // local deltas against the template
  dependsOn: string[]          // other sites' location ids (e.g. hub before spokes)
  rag?: 'green' | 'amber' | 'red'                           // human judgement, not derived
  notes?: string
}
interface PlanDate { date: string; precision: 'quarter' | 'month' | 'week' | 'day' }
interface SiteException {
  id: string
  kind: 'skip' | 'add' | 'modify'      // skip a template change, add a site-only change, change its offset
  change: string                       // template change id, or an inline change entry for 'add'
  class: 'legal' | 'operational' | 'preference'
  owner?: string
  expires?: string
  rationale?: string
}
```

**Recommendation: site plans are records inside the rollout, not 160 more elements** (decision D2):

- a site plan has no life outside its rollout;
- a Location in two rollouts needs two plans;
- 160 Work Packages in the inventory would bury the 10 that matter.

On exchange export each site plan *becomes* a Work Package (§8), so ArchiMate tools still see one work package per site.

### 4.5 Derived site phase

As with lifecycle (ADR UI-3), **no stored status**. A site's phase at a time point is the phase started by the **last milestone reached**, walking the rollout's milestone set in order. An actual date takes precedence over the planned one. This is the lifecycle rule exactly, so it can share its tests' shape. The phases themselves are a fixed, small set: Unplanned (no wave), Planned, Preparing, Cutover, Hypercare, Migrated, Done. Milestones map onto that set, so every rollout colours and counts the same way. With the generic preset:

```
no wave                 → Unplanned
t < readinessStart      → Planned
t < cutover             → Preparing
t < hypercareEnd        → Hypercare
t < legacyRetired       → Migrated (dual-run)
otherwise               → Done
```

A planned date that has passed without an actual date makes the site **overdue**: a computed flag, not a phase. RAG stays a human field, because it records judgement, not arithmetic.

**Colour reuses the lifecycle ramp, so `tokens.css` gets no new tokens** (decision D7):

| Site phase | Lifecycle token |
|---|---|
| Unplanned | neutral ink |
| Planned | `--lc-plan` |
| Preparing, Cutover and Hypercare | `--lc-in` (in transition) |
| Migrated and Done | `--lc-act` |

### 4.6 How the rollout changes the architecture (R3)

For each site plan and each applicable template change that no exception skips, the store derives one #58 change entry at `resolve(anchor) + offset`. `modelAt(date, scenario)` evaluates these alongside every other initiative's entries. Several things follow:

- **The architecture at a site, at any date**, is a filter of `modelAt` by Location.
- **A plateau per wave end** ("after W3") is a named `(wave.end, scenario)` pair, per concept §3.1, and exports as an ArchiMate Plateau.
- **Gap per site or per wave** is #64 with a location or wave filter. Replacements come from `replace` entries, which record the successor link that the literature says a set difference misses.
- **Plan conflicts** join #58's computed conflicts (§6.6).

Scale check: 160 sites × ~10 template changes ≈ 1,600 derived entries, well inside #61's budget of 5,000 elements in 10 ms.

### 4.7 Scenarios

**An alternative wave plan is a scenario (#62)** that overrides wave assignments and wave windows, for example "Plants first" against "Region by region". Compare puts the two side by side: sites migrated by date, peak sites per month, conflicts. Scenarios come in R4 because they need #62.

### 4.8 Presets, and data migration first (D3)

The first programme migrates **data**: about 160 sites' local data moves into central target stores. The model stays general. A **preset** is plain data (a milestone set, default durations between milestones, the template change kinds it offers, and the site fields it suggests), so ERP, infrastructure, network and workplace rollouts are more presets, not more code.

What follows is our own design from common data-migration practice. The research report did not cover data-migration specifics, so none of it is sourced there.

**Data migration in ArchiMate terms:**

- The site's local store is an Artifact or a System Software (a database, a file share) aggregated by the site's Location. It realizes the Data Objects it holds.
- The target is a central Artifact or System Software, located wherever it is hosted.
- Moving a data object is a `replace` of its realization: the local store's realization ends at cutover, and the central store's begins.
- Applications' Access relationships are re-pointed the same way.
- Decommissioning the local store is a `retire` with an offset after cutover.

**Disposition per data object** is a planned value on the template change: `migrate`, `archive`, `purge` or `retain`. It is the data equivalent of the cloud 7Rs. A site overrides it through an exception, so "Site 042 keeps its HR files locally for legal reasons" is a `legal` exception with an owner and an expiry.

**The data-migration preset:**

| Milestone | Starts phase |
|---|---|
| `mappingSignedOff` | Preparing |
| `mockLoad1` | Preparing |
| `mockLoad2` | Preparing |
| `dressRehearsal` | Preparing |
| `goNoGo` | Preparing |
| `freezeStart` | Cutover |
| `reconciliationSignedOff` | Hypercare |
| `hypercareEnd` | Migrated |
| `legacyReadOnly` | Migrated |
| `legacyDecommissioned` | Done |

**Suggested site fields:** data volume (GB and records), number of source systems, data-quality score, residency class and freeze-window length.

**Checks only this preset adds:**

- **Data residency:** a site whose data may not leave its country or region is migrated to a target store whose Location lies outside it. This is computed from the model, which only an EA tool can do.
- **Mock loads:** fewer mock loads before cutover than the preset requires.
- **Freeze overlap:** the freeze window overlaps a site's blackout, such as a period-end close.
- **Reconciliation:** reconciliation was not signed off before hypercare ends.

## 5. Planning levels: high level first, detail later

| Level | When | What is decided | Date precision | Surfaces |
|---|---|---|---|---|
| **L0 Frame** | Programme start | Scope template, archetypes, site register, constraints | Rollout: year / quarter | Rollout fact sheet, site register |
| **L1 Wave plan** | Weeks 1–4 | Every site in a wave; wave windows; pilot sites chosen | Quarter / month | Wave board, timeline, matrix |
| **L2 Site plan** | Rolling: the next 1–2 waves | Milestone dates, exceptions, dependencies, readiness | Week / day | Site fact sheet, plan checks |
| **L3 Execution** | During each wave | Tasks, people, runbooks | (outside Archipelago) | The rollout workbook out to the PMO; actuals, RAG and go/no-go back in the same workbook |

Moving from L1 to L2 is not a mode switch. It is just setting site-level dates with a finer precision. A plan check flags sites in the *next* wave that still inherit only quarter-precision dates, which puts CAF's "detail only the next wave" into a rule.

## 6. Surfaces

All new screens use the shared report chrome (time point, and later the scenario switcher), monospace for site codes, counts and dates, and the existing tokens.

1. **Rollout home** (`/rollout/:id`, keyed on `id`): KPIs (sites by phase, next cutovers, overdue, conflicts), then tabs for the five views below.
2. **Site register:** the inventory table scoped to the rollout's Locations, with rollout columns (wave, archetype, cutover with an *inherited* marker, phase, RAG). Multi-select bulk edit (assign a wave, set an archetype) is **one command** per action.
3. **Wave board:** a column per wave with its window and a capacity bar; site cards show code, archetype and complexity. Dragging a card is a command. Over-capacity and blackout violations badge the column.
4. **Site × scope matrix** (TOGAF's State Evolution Table, LeanIX's "matrix as a rollout plan"):
   - rows are sites, grouped by wave or region;
   - columns are template changes, or wave-end plateaus;
   - each cell is the state at the time point: legacy / dual-run / target / not applicable / exception.
5. **Timeline:** waves as bars that expand to sites, with milestone ticks, blackout bands, dependency lines (red when violated) and plateau markers. It extends #63's roadmap rather than duplicating it.
6. **Progress:** a burn-up of sites migrated, planned against actual, with CAF's 25/50/75% checkpoints for the current wave.
7. **Site fact sheet, "Migration" tab:** one block per rollout the site is in, showing wave, milestones (planned · actual · inherited), exceptions and dependencies. From R3 it also shows the site's before → after state.
8. **Plan checks** (the validator's style):
   - a site in no wave;
   - a wave over capacity;
   - a cutover inside a blackout;
   - a dependency order violated;
   - an expired exception;
   - a next-wave site still at coarse precision;
   - a template change that applies to no site;
   - a site whose baseline lacks the element a template change retires.

**No map in v1.** Map tiles are a runtime fetch, which the constraints forbid. The region hierarchy groups sites instead; a self-hosted outline map is a later option (decision D5).

## 7. Sequencing assistant (R4)

These are suggestions, never automatic moves:

- **Complexity per site** is computed from the model: the number of elements aggregated, the interfaces touching them, and headcount. **Readiness** is assessed by hand.
- **The assistant proposes:** pilot candidates (low complexity, representative archetype); a wave assignment that respects capacity, blackouts and dependencies; and the 2×2 of value against effort that CAF and Google use.

The research found **no authoritative scoring formula**, so the weights are configurable and labelled as ours.

## 8. Interoperability

- **Canonical JSON:** rollout, waves and site plans live in the workspace, with site plans sorted by location id and exceptions by id, so export → import → export stays byte-identical (ADR 0004). The schema version bumps, and `migrate.ts` brings older files forward.
- **Exchange XML and `.archimate`:**

  | Plan object | Exported as |
  |---|---|
  | Rollout | Work Package |
  | Wave | Work Package, aggregated by the rollout |
  | Site plan | Work Package, aggregated by its wave and associated with its Location |
  | Milestones | Namespaced properties (`archipelago.plan.*`), typed `date` where the format allows it |
  | Wave end | Plateau |

  The template and the exceptions do not fit ArchiMate's vocabulary. They travel as canonical-JSON properties, as views and tag groups already do. Anything that cannot be carried is an `ImportProblem` or export problem, never dropped (#60's precedent). Archi writes every property as a string, so on import a date that does not parse is reported, not guessed.
- **Excel is the first plan format (D4).** One `.xlsx` workbook per rollout. It is both the export and the import template, following #94's conventions:
  - row 1 holds technical keys and row 2 human labels;
  - a blank cell deletes the value, and a missing column leaves it untouched;
  - a dry-run preview (created, updated and deleted counts plus problems) runs before the commit;
  - the whole import is **one undoable command**.

  | Sheet | One row per | Columns |
  |---|---|---|
  | `Sites` | Location | id, code, name, parent region, site fields |
  | `Waves` | wave | id, label, order, window start and end, capacity, template version |
  | `SitePlan` | site | location id, wave, archetype, RAG, then a planned and an actual column per milestone of the rollout's set |
  | `Exceptions` | exception | id, location id, template change id, kind, class, owner, expiry, rationale |
  | `Dependencies` | pair | site, depends-on site |
  | `Template` | template change (read-only on import in R1) | id, kind, subject, anchor, offset, applicability, disposition |

  **Dates in Excel** are the risky part:
  - A *date cell* reads as day precision. A text cell reads by its form: `2027-Q2` is a quarter, `2027-05` a month, `2027-W19` a week, `2027-05-12` a day. Anything else is an `ImportProblem` naming the cell.
  - Excel's date serials convert without any time-zone arithmetic. A test runs under a non-UTC `TZ` to prove a date never shifts by a day.
  - A value that cannot be applied, such as an unknown wave id or a site not in the model, is reported, never skipped.

  Actuals come back the same way: the PMO fills the actual columns in the same workbook and re-imports it.
- **CSV** follows Excel, from the same sheet definitions. Every field is quoted, with round-trip tests using values that contain the delimiter and values that look escaped (CLAUDE.md).
- **Later:** MS Project XML and iCalendar for wave and site milestones.

## 9. Delivery slices

| Slice | Contents | Depends on | Exit |
|---|---|---|---|
| **R0 Decide** | Priority (done: ADR 0012); ADR for #58 (time and change model); rollout-model ADR from this proposal (D2, D5–D7) | — | Both ADRs accepted |
| **R1 Site register and wave plan** | XLSX reader/writer (shared with #94); rollout, waves and site plans in the model; site fields as interim properties; the rollout workbook (sites, waves, site plan); site register, wave board, wave-level timeline; a generated 160-site data-migration demo | R0 | 160 sites in waves on the board and timeline; workbook export → edit → import changes only the edited cells; byte-identical canonical round-trip; exchange export validates against the XSD |
| **R2 Detailed site plans** | Milestone sets and presets (data migration first), `PlanDate` with precision and inheritance, derived site phase, actuals through the workbook, exceptions, site dependencies, blackouts, plan checks (data-migration checks included), Migration tab, progress burn-up | R1 | A wave detailed to day precision while later waves stay at quarter precision; every plan check fires in a test |
| **R3 Architecture change** | Template changes → derived change entries, matrix at a time point, gap per site and per wave, wave-end plateaus, state-aware views per site | #58, #60, #61, #64 | Moving the time point across a cutover changes the site's matrix row and its gap; checked by an e2e journey |
| **R4 Alternatives and assistance** | Alternative wave plans as scenarios, sequencing assistant, MS Project / iCal export | #62, R3 | Two wave plans compared side by side with different burn-ups |

**R1 and R2 need nothing from the overlay engine.** They are plan data and planning screens, so they can run alongside the diagram editor work. But the #58 ADR should come first, so that R1's change-template shape is already #60's change-entry shape and nothing is rebuilt in R3. Test data: extend #68's generated demo workspace with a 160-site rollout, built from a seed and byte-stable, so performance budgets and e2e journeys run at the real scale.

## 10. Repo invariants this has to respect

- **Every plan edit goes through the command stack,** bulk assignment included (one command per user action), and is refused for a reader. Board drags and inline date fields follow the reader-switch rules.
- **The site phase is derived and never stored;** only dates and actuals are.
- **`PlanDate` and every select pass through a type guard on the write path.** An empty precision or an unknown wave id yields `undefined`, not a stored value the schema rejects.
- **`/rollout/:id` is keyed on `id`.**
- **Each plan check, CSV error branch and import fallback gets a test that fires it,** and an acceptance test must fail when its feature is removed.

## 11. Decisions for the sponsor

**Decided 2026-10-26 (sponsor):**

- **D1, priority.** R0–R2 start now, alongside the editor. Recorded in ADR 0012.
- **D3, what migrates.** Data first. The model must serve any rollout, so data migration is the first preset (§4.8), not a special case.
- **D4, the actuals source.** Excel first: one rollout workbook carries plan and actuals (§8). CSV follows.

**Accepted as recommended, 2026-10-26 (ADR 0013):**

- **D2, site plans as records.** Records inside the rollout, or Work Package elements? *Recommendation: records* (§4.4); they still export as Work Packages.
- **D5, map view.** Leave it out, or add a self-hosted outline map later? *Recommendation: leave it out of R1–R3.*
- **D6, custom fields.** Pull #70 forward into R1, or start with interim `archipelago.site.*` properties and migrate them? *Recommendation: interim properties.* #70 is large, and a migration in `migrate.ts` is cheap.
- **D7, phase colours.** Reuse the lifecycle ramp as mapped in §4.5, or add a migration-state ramp to the design system? *Recommendation: reuse the ramp.*
