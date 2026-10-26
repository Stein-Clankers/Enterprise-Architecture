# Standards name the states; tools supply the clock

ArchiMate 3.2 and TOGAF give migration planning a shared vocabulary but not its time dimension. Transition states are Plateaus and Gaps, change is Work Packages, Deliverables and Implementation Events, and TOGAF supplies the Phase E/F method and five planning tables. Yet a Plateau in ArchiMate 3.2 has **no date attribute at all**, a work package's start and end only "may be modeled as attributes", and neither standard says anything about rolling a change out across many sites. Every serious tool fills that gap in one of three ways:

- **Planned deltas applied to one live model.** SAP LeanIX's Transformations and Impacts, Essential's typed plan-to-element links and Waltz's Change Units work this way.
- **Branches of the model.** Ardoq's Scenarios work this way.
- **Validity dates on elements and relationships, with the state at a date derived from them.** Bizzdesign, Alfabet, HOPEX and the academic literature work this way.

No commercial or open-source tool has a first-class "site rollout wave" object. The closest are LeanIX's "Rollout Application" template, whose rollout impact is an added Organization relation, and Alfabet's "business supports" used for roll-out plans. In practice, a 160-site migration follows a convergent pattern from AWS, Microsoft, Google and SAP rollout guidance:

- atomic move groups are aggregated into time-boxed waves
- a small pilot runs first, and complexity and criticality rise wave by wave
- only the next few waves are planned in detail
- tasks, runbooks and status live in a PPM tool, and the structure lives in the EA tool

For Archipelago, the evidence favours a specific design. Store valid time on elements and on relationships, and model a planned change as a typed, dated relationship from a work package whose date can reference a wave milestone. Derive plateau membership, site phase and gaps rather than storing them. That design fits the project's "lifecycle is derived" and "relationship properties are first-class" rules almost exactly.

A note on sources. As of 2026-10-26 every `pubs.opengroup.org` page redirects to an Open Group login. The ArchiMate and TOGAF text below was read through Internet Archive snapshots of the same URLs, and the citations give the canonical address. LeanIX's documentation has moved to a JavaScript-only `help.sap.com` and was read from 2025–2026 snapshots of `docs-eam.leanix.net`. A few claims rest only on search-result summaries and are marked as such.

## ArchiMate 3.2 defines five migration elements but gives a plateau no dates

ArchiMate's Implementation and Migration chapter says its elements "support the implementation and migration of architectures", including "modeling implementation programs and projects" and "migration planning" ([ArchiMate 3.2 §12](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Implementation-and-Migration-Layer.html)). It defines five elements:

- **Work Package**: "a series of actions identified and designed to achieve specific results within specified time and resource constraints". It can model a task, a project, a program or a portfolio, and in 3.2 also an Agile sprint or increment.
- **Deliverable**: "a precisely defined result of a work package".
- **Implementation Event**: "a state change related to implementation or migration". It is instantaneous.
- **Plateau**: "a relatively stable state of the architecture that exists during a limited period of time".
- **Gap**: "a statement of difference between two plateaus".

All five come from the same chapter ([ArchiMate 3.2 §12.2](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Implementation-and-Migration-Layer.html)). The standard ties the plateau explicitly to TOGAF. Transition Architectures "allow for individual work packages and projects to be grouped into managed portfolios and programs," and "in order to support this, the plateau element is defined."

**Time support is weaker than most practitioners assume, and it got weaker in 3.2.** ArchiMate 3.1 said a work package "has a clearly defined start and end date." 3.2 softened this to "has a start and an end. These may be modeled as attributes." Compare [ArchiMate 3.1 §13.2.1](https://pubs.opengroup.org/architecture/archimate31-doc/chap13.html) with [3.2 §12.2.1](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Implementation-and-Migration-Layer.html). An implementation event "may have a time attribute" for milestones. **The plateau section defines no date or validity attribute at all**: time appears only in the phrase "a limited period of time." Dates otherwise come only through the profile mechanism, whose allowed attribute types include Date ([ArchiMate 3.2 §14.1](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Language-Customization-Mechanisms.html)).

The relationships carry the real planning semantics. The metamodel figure shows:

- **Plateau triggers Plateau**, which expresses the succession of states.
- A Gap is associated with exactly **two** plateaus.
- A Deliverable realizes a Plateau.
- Work packages trigger other work packages and implementation events.
- Events trigger plateaus, and plateaus trigger events.

This is Figure 106, read from the identical-numbered 3.1 figure because the 3.2 image is not archived ([ArchiMate 3.1 Figure 106](https://pubs.opengroup.org/architecture/archimate31-doc/chap13.html)). 3.2 **deprecates the realization relationship from Work Package to Deliverable** and recommends access instead ([§12.1 note](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Implementation-and-Migration-Layer.html)). An importer of older models must handle both forms.

Two rules matter most for a multi-site rollout. First, "a plateau may aggregate or compose any of the concepts of the ArchiMate core language", and realization from a plateau is allowed: "a capability may be realized by a plateau, signifying that a certain capability increment is valid only during the time span of that plateau" ([§12.5](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Implementation-and-Migration-Layer.html)). The normative relationship table confirms that **a Plateau or a Location may compose or aggregate a relationship**, not only an element ([App. B.6, Table 21](https://pubs.opengroup.org/architecture/archimate32-doc/ch-relationships-Normative.html)). A plateau can therefore state that application A serves process P at a given site, rather than only that A exists. An older Twente thesis complained that plateaus could not do this ([essay.utwente.nl/65664](https://essay.utwente.nl/65664)); that complaint no longer holds.

Second, Location "represents a conceptual or physical place or position where concepts are located … or performed". It aggregates structure and behaviour elements, it can nest because composite elements can aggregate other composite elements, and it can aggregate any concept, including relationships ([§4.5.2](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Generic-Metamodel.html); [App. B.6](https://pubs.opengroup.org/architecture/archimate32-doc/ch-relationships-Normative.html)). "A composite element may aggregate a work package or deliverable" ([§12.5](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Implementation-and-Migration-Layer.html)), so a Location can also hold the work packages for its own site.

The standard defines three relevant viewpoints ([App. C.4](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Example-Viewpoints.html)):

- **Project**: goal, outcome, work package, implementation event, deliverable, business actor, business role.
- **Migration**: *only* Plateau and Gap.
- **Implementation and Migration**: everything above plus Requirement, Constraint, **Location** and any core element. It "allows modeling of the scope of programs, projects, and project activities in terms of the plateaus that are realized or the individual architecture elements that are affected," and adds that "the way the elements are affected may be indicated by annotating the relationships."

That last sentence is as close as the standard gets to a create/modify/retire marker.

The Open Group's own ArchiSurance case-study model shows the canonical pattern in practice ([ArchiSurance HTML model](https://pubs.opengroup.org/architecture/case-study-models/archisurance-html/)):

- Plateaus run Baseline → a junction → *Transition A* (one CRM first) or *Transition B* (back office first) → *Transition C* → *Target*. Alternative futures are alternative paths through triggering junctions.
- Plateaus *aggregate* application components and *realize* capabilities.
- Project work packages *realize plateaus directly*, skipping the deliverable.
- A "Phasing Out Legacy" work package *realizes* the legacy apps it removes. That loose use of realization means "affects", which shows why a typed action qualifier is needed.
- No Gap elements appear in the relationship list. The difference is left implicit in the plateau contents.

Lankhorst, writing for Bizzdesign, confirms the practical consequences ([Bizzdesign, 25 Sep 2025](https://bizzdesign.com/blog/planning-and-roadmapping-modeling-in-archimate)):

- A plateau "will typically have a start and end date". That is a tool convention, not the standard.
- Sub-plateaus should keep "time periods … consistent with their parent plateau".
- Because "many elements appear in several plateaus," he keeps plateau membership "in a cross-reference table" rather than in views.

**The duplication problem is real.** Every unchanged element must be re-aggregated into every plateau unless membership is derived.

## TOGAF supplies the method and five tables, but no multi-site guidance

TOGAF 10 places migration logic in four concepts: **Architecture Roadmap, Work Packages, Transition Architectures, and the Implementation and Migration Plan** ([TOGAF 10 ADM §9.5](https://pubs.opengroup.org/togaf-standard/adm/chap09.html)). The roadmap "lists individual work packages in a timeline". A Transition Architecture "describes the enterprise at an architecturally significant state between the Baseline and Target". The plan "provides a schedule of the projects."

Phase E consolidates the gap analyses from Phases B–D and groups the gaps into work packages. Dependencies "serve as the basis for most migration planning" ([§9.3.6](https://pubs.opengroup.org/togaf-standard/adm/chap09.html)). Phase E then chooses one of three strategies:

- **Greenfield**
- **Revolutionary** ("switch on, switch off")
- **Evolutionary** ("parallel running or a phased approach")

It classifies every current system as Mainstream, Contain or Replace, and decomposes top-level work packages "into increments to deliver the capability increments" ([§9.3.8–9.3.9](https://pubs.opengroup.org/togaf-standard/adm/chap09.html)).

Phase E also states three rules a tool can enforce or display ([§9.3.10](https://pubs.opengroup.org/togaf-standard/adm/chap09.html)):

- Transition architectures "should provide measurable business value".
- "**The time-span between successive Transition Architectures does not have to be of uniform duration**".
- Transitions must reflect "the enterprise's capacity for creating and absorbing change", and the difficult activities go after the ones that "most easily deliver missing capability".

Phase F then does three things ([TOGAF 10 ADM §10.3](https://pubs.opengroup.org/togaf-standard/adm/chap10.html)):

- It assigns business value to each work package, splitting costs into **capital** and **operations and maintenance**.
- It prioritises by value against cost and risk. A project can rank high "if it provides a critical deliverable on the path to some large benefit."
- It integrates everything into a plan where "**any Transition Architectures will act as portfolio milestones**."

TOGAF explicitly allows that the Implementation and Migration Plan "could be part of a different plan produced by another one of the frameworks". In practice that means the PPM tool ([§10.3.1](https://pubs.opengroup.org/togaf-standard/adm/chap10.html)).

The most useful material for a tool designer is the five tables in the Migration Planning Techniques chapter, whose exact columns are recoverable from the figure images ([TOGAF 10 ADM Techniques ch. 6](https://pubs.opengroup.org/togaf-standard/adm-techniques/chap06.html)):

| TOGAF technique | Columns / axes | What it becomes for a site rollout (inference) |
|---|---|---|
| Implementation Factor Catalog | Factor · Description · Deduction ("Impact on Migration Plan") | Constraint register: blackout periods, long-lead circuits, legal deadlines |
| Consolidated Gaps, Solutions & Dependencies Matrix | No. · Architecture · Gap · Potential Solutions · Dependencies (Phase E adds Solution and risks) | Per-gap work-package seeding |
| Architecture Definition Increments Table | Project · one column per *dated* Transition Architecture · Comments | The wave plan (rows = waves/projects, columns = dated plateaus) |
| Transition Architecture State Evolution Table | Sub-Domain · Service · TA1 · TA2 · TA3, cells = solution + state (new / retain / transition / replace), optional green/yellow/red | **Site × transition status matrix** |
| Business Value Assessment | Value index (y) vs risk index (x), bubble = size, colour = status | Wave-assignment scatter |

Two details stand out. **TOGAF puts date ranges on the Transition Architecture column headers** ("April 2018/2019 — Transition Architecture 1: Preparation"). TOGAF therefore treats a transition architecture as a time window, which ArchiMate's Plateau cannot record natively. And TOGAF's lifecycle-disposition vocabularies have no ArchiMate equivalent:

- Mainstream / Contain / Replace for systems
- new / retain / transition / replace in the State Evolution Table
- Included / New / Eliminated in the gap-analysis matrix, where "anything under 'Eliminated' or 'New' is a gap" ([TOGAF 10 ADM Techniques ch. 5](https://pubs.opengroup.org/togaf-standard/adm-techniques/chap05.html))

Each of these can be *derived* from membership in two dated states.

On high-level-first planning, TOGAF is structural rather than procedural. It defines Strategic, Segment and Capability architecture levels, and says "broad, summary architectures set the direction for narrow and detailed architectures" ([Applying the ADM §3](https://pubs.opengroup.org/togaf-standard/applying-the-adm/chap03.html)). It uses "Phase F (Migration Planning) to initiate new more detailed architecture development projects" ([Applying the ADM §2.5.1](https://pubs.opengroup.org/togaf-standard/applying-the-adm/chap02.html)). And it warns that "where significant additional detail is required … the architecture is likely transitioning to a different level" ([§10.3.7](https://pubs.opengroup.org/togaf-standard/adm/chap10.html)). TOGAF's Location entity gives a ready-made site hierarchy: Region, Country, Building and Specific Location, plus industry types such as Ship, Port or Mine ([TOGAF 10 Architecture Content §2.4–2.5](https://pubs.opengroup.org/togaf-standard/architecture-content/chap02.html)).

**In none of the Phase E/F, techniques, levels or content-framework chapters read did TOGAF address rollout across many sites or business units**: pilot site, waves, template rollout, site readiness. The TOGAF Series Guides were not read and may say more.

## Commercial tools split into deltas, branches and dated models

Each major vendor has a dated, hierarchical "initiative" object and a finer change record, but they differ sharply on how the future state exists.

**SAP LeanIX: planned deltas on one live model.** The module, launched as "BTM" in 2020, is now "SAP LeanIX Architecture and Road Map Planning" ([LeanIX docs](https://docs-eam.leanix.net/docs/initiative-modeling-guidelines)). Its Initiative fact sheet has subtypes Idea, Program, Project and Epic. Ideas double as alternative scenarios, and the documented ERP example models **waves as child Projects of a Program**. The guidance is blunt: LeanIX "is not a project management tool," and users should "add Initiatives only up to level 2 or 3" ([same](https://docs-eam.leanix.net/docs/initiative-modeling-guidelines)).

Change lives in **Transformations**, "groups of pre-defined & customized impacts", whose completion date is "either an exact date or use a milestone" ([LeanIX: Transformations](https://docs-eam.leanix.net/docs/transformations)). Ten templates include "**Rollout Application**" ("roll out an existing Application to several Organization and/or Business Capabilities") and "Withdraw Application". A table mode creates "numerous transformations in one go" with drag-fill and milestone-bound dates ([LeanIX: Working with transformations](https://docs-eam.leanix.net/docs/working-with-transformations)).

Impacts execute in a fixed order:

1. set field
2. set lifecycle phase
3. copy field
4. tags
5. remove relations
6. remove all relations
7. create relations
8. copy all relations
9. move all relations
10. set relation field
11. set relation validity
12. remove/create relation constraints

Each impact is classified with a derived Impact Type such as Introduction, Decommissioning, **Rollout ("Organization relation added to Application")** or Withdrawal ([LeanIX: Impacts](https://docs-eam.leanix.net/docs/working-with-impacts)).

Planned fact sheets sit in the inventory in a hidden "planned" state. "Execute" writes impacts into the as-is, for a single transformation, a child project or the whole roadmap. An admin choice decides whether execution deletes relations or instead writes "Active from/until" onto them, which "lets you document past relations" ([LeanIX: Working with transformations](https://docs-eam.leanix.net/docs/working-with-transformations)). A search-result summary says workspaces created from December 2025 drop the separate "set relation validity" impact and derive validity from the completion date ([help.sap.com](https://help.sap.com/docs/leanix/ea/standardization-of-relation-validity-handling-in-transformations)); this was not verified on the rendered page.

The weak spots are documented by LeanIX itself:

- Milestones are shareable only "along the parent-child hierarchy" ([LeanIX: Milestones](https://docs-eam.leanix.net/docs/working-with-milestones)).
- Relation validity "will never 'overwrite' the global lifecycle. Make sure that both are aligned." That gives two sources of truth for one date ([LeanIX: Target Architecture](https://docs-eam.leanix.net/docs/target-architecture)).
- "All the to-be architecture data needs to be added manually." A plan-vs-completed KPI was listed as "view to be added" ([LeanIX: Phase 3](https://docs-eam.leanix.net/docs/phase-3-explore-define-the-future-states-of-your-architecture-and-the-transformations-needed)).

A May 2026 release added a "target architecture diagram" that switches between current state, changes and target state ([LeanIX update 2026-05-07](https://updates.leanix.net/announcements/ann_pavS6lKLIDNVN)).

**Ardoq: branches of the model.** Scenarios let users "select any part of their architecture and branch it," tracking mainline changes and offering differential analysis ([Ardoq: Introducing Scenarios](https://help.ardoq.com/en/articles/44014-introducing-scenarios-model-alternative-futures-and-analyze-the-impact-of-change)). Merging runs in either direction, field by field, with an "Original Value" column and a red-dot conflict marker. The metamodel must be merged first, and "components can be created only from scenario to mainline" ([Ardoq: Merge](https://help.ardoq.com/en/articles/44026-how-to-merge-your-scenarios-and-mainline-data)).

Branching has costs. Scenarios support only Block Diagram and Pages views, and Ardoq's own roadmap recipe uses **one cumulative scenario per phase** ([Ardoq: Build application roadmaps using scenarios](https://help.ardoq.com/en/articles/43997-build-application-roadmaps-using-ardoq-scenarios)). Ardoq's 2026 guidance adds Future State components with three features ([Ardoq: Modeling Future States and Transition Architectures](https://help.ardoq.com/en/articles/532231-modeling-future-states-and-transition-architectures-in-ardoq)):

- an "Active Period" and an approval lifecycle
- "Is Delivered By" links to Initiatives, with transitions chained by "Is Dependency For"
- impacts typed Direct or Indirect

Ardoq says these states are detailed "as uncertainty over scope and content reduces." The S2E Initiative fields (Active Period, Stage, Status) and the derived Capability Delta end date are known only from search snippets ([Ardoq S2E metamodel](https://help.ardoq.com/en/articles/43895-strategy-to-execution-metamodel)).

**Bizzdesign Horizzon, Alfabet and HOPEX: time stamped on a single model.** Bizzdesign acquired MEGA (HOPEX) in 2024 and announced the Alfabet acquisition on 10 January 2025, keeping all three products ([Dutch IT Channel](https://www.dutchitchannel.nl/news/587944/bizzdesign-koopt-ea-en-spm-specialist-alfabet)). In April 2026 it launched "Unify" as a separate AI/collaboration layer ([IT Brief](https://itbrief.co.uk/story/bizzdesign-launches-unify-to-link-collaboration-data)).

Horizzon stays ArchiMate-native. Only plateau, program and work package carry lifetime dates directly. Other objects need a lifecycle profile, and a "Default life cycle management" profile applies to "any object **and relation**" ([Bizzdesign help: profiles](https://help.bizzdesign.com/articles/#!horizzon-help/available-life-cycle-profiles-and-stages); [Setting the lifetime](https://help.bizzdesign.com/articles/#!horizzon-help/setting-the-lifetime-of-an-object)). Its Roadmap view is "comparable to working with a Gantt chart," and its Life cycle view shows segmented cylinders ([Roadmap view](https://help.bizzdesign.com/articles/#!horizzon-help/modeling-a-roadmap-view)). One gotcha is instructive: an unpinned timeline start resets to today, so objects "may disappear from the view" ([Timeline display settings](https://help.bizzdesign.com/articles/#!horizzon-help/timeline-display-settings)).

Alfabet frames migration as "the process in which applications are substituted by other applications," each step with "an incremental description and target date." It uses **master plans of "business supports"** (application × organization × process, each with lifecycles) "to define and communicate the rollout plans of application assets … along organizational or business structures" ([Alfabet 11.13 Product Overview](https://documentation.alfabet.com/de/pdf/ProductOverview_Alfabet_11-13.pdf)).

HOPEX runs idea → project demand → candidate project, gives each object a "life" of dated states editable in a Gantt, and has a Decommissioning Plan report showing retirements "quarter by quarter" ([HOPEX V6.2](https://doc.mega.com/hopex-v6-2-en/APM/MEGA_APM_Inventaire.Defining_Application_Life.html)).

| Tool | Future state exists as | Change object | Site/rollout support | Plan vs actual |
|---|---|---|---|---|
| SAP LeanIX | As-is + projected impacts at date *t* | Initiative → Transformation → Impact | "Rollout Application" template; Rollout impact type on Organization relations; Matrix report | Execute step; status field |
| Ardoq | Scenario branch + Future State components | Initiative, Future State, Capability Delta | None specific; locations are ordinary components | Merge to mainline |
| Bizzdesign Horizzon | Lifecycles on objects and relations; plateaus | ArchiMate Program/Work package/Plateau | ArchiMate Location | Lifecycle stage |
| Alfabet | Lifecycle-bearing business supports in master plans | Demand → proposal → project | Business supports for roll-out plans; blueprints | Plan-fulfilment tracking |
| HOPEX | Object "life" periods | Idea → demand → candidate project | Enterprise sites, application installations (TOC only) | Assessment / validation |

Secondary tools add little to the data-model question. BOC ADOIT 17.3 introduced application-, capability- and goal-based roadmap workspaces ([ADOIT 17.3](https://www.boc-group.com/en/adoit/whats-new/adoit-17-3/)). No primary documentation of the planning mechanics was found for Avolution ABACUS or Orbus iServer365. **No public customer case study describes how a 100+-site rollout was modelled in any of these tools**, and none documents per-site work items with their own dependencies. All of them push that detail to Jira or PPM tools.

## Open-source tools and the research literature favour reified, dated change

**FINOS Waltz**, still active (release 1.84.0, July 2026, per [GitHub releases](https://github.com/finos/waltz/releases)), splits time across four narrow structures.

The first is **Roadmaps and Scenarios**. These are dated grids typed CURRENT, INTERIM or TARGET, which rate applications against two taxonomy axes. Each scenario stores its full contents and can be cloned, and scenarios "can be contradictory to allow for alternative views." Comparisons stay meaningful only because "axes domains" are fixed per roadmap ([Waltz: Roadmaps and Scenarios](https://github.com/finos/waltz/blob/master/docs/features/roadmaps/README.md)).

The second is **Change Initiatives**. These form an Initiative > Programme > Project hierarchy with start and end dates, linked to entities by an untyped `RELATES_TO` ([Change Initiatives](https://github.com/finos/waltz/blob/master/docs/features/change_initiative/README.md)).

The third is **Change Sets and Change Units**, designed because "Waltz presently captures current state architecture only". A Change Set is "a collection of changes that are intended to be carried out as an 'atomic' set" with a planned date. Each Change Unit carries:

- an action: ACTIVATE, RETIRE or MODIFY
- old and new attribute values
- an **execution status: PENDING, COMPLETE or DISCARDED**

([Waltz future flows design](https://github.com/finos/waltz/blob/master/docs/design/draft/future_flows/README.md); partly implemented per [ChangeSet.java](https://github.com/finos/waltz/blob/master/waltz-model/src/main/java/org/finos/waltz/model/change_set/ChangeSet.java)).

The fourth is **planned decommission and replacement records dated on the app-to-taxonomy mapping, not on the app**. They come with a derived `isValid()` check that flags a mapping decommission dated after the app's own ([MeasurableRatingPlannedDecommission.java](https://github.com/finos/waltz/blob/master/waltz-model/src/main/java/org/finos/waltz/model/measurable_rating_planned_decommission/MeasurableRatingPlannedDecommission.java)).

Waltz also keeps soft delete (`is_removed`) separate from lifecycle status ([Entity Lifecycle design](https://github.com/finos/waltz/blob/master/docs/design/completed/entity_lifecycle/README.md)). Being removed from the repository is a different fact from being decommissioned in reality.

**Essential** has the most directly reusable shape: a reified `PLAN_TO_ELEMENT_RELATION` joining four things ([core_roadmap_functions.xsl](https://github.com/essentialproject/essential_viewer/blob/master/common/core_roadmap_functions.xsl); [core_api_el_planned_elements.xsl](https://github.com/essentialproject/essential_viewer/blob/master/enterprise/api/core_api_el_planned_elements.xsl)):

- a Strategic Plan, with valid-from and valid-to dates
- a Project, with proposed start, actual start and target end
- a Planning Action, classified **Creation, Enhancement, Reduction, Removal or No Change**
- any EA element

"No Change" lets a plan assert that an element is deliberately kept, which a pure set-difference gap cannot express. Separating plan from project lets an element be planned before any project exists.

**Archi** offers only the ArchiMate elements plus untyped properties. Its exchange exporter hard-codes `type="string"` for every property definition ([XMLModelExporter.java](https://github.com/archimatetool/archi/blob/master/org.opengroup.archimate.xmlexchange/src/org/opengroup/archimate/xmlexchange/XMLModelExporter.java)). The Open Group XSD itself allows `date` ([archimate3_Model.xsd](http://www.opengroup.org/xsd/archimate/3.1/archimate3_Model.xsd)).

Practitioners fill the gaps with jArchi scripts. One scaffold generator creates plateaus, gaps and work packages but does not compute differences ([Roadmap Gap Scaffold Generator](https://github.com/ThomasRohde/jarchi-scripting-system/blob/master/scripts/Roadmap%20Gap%20Scaffold%20Generator.ajs)). A task-list exporter treats **triggering as dependency and the plateau as an epic** ([generate-task-list.ajs](https://github.com/nivogt/scriptsarchi/blob/main/customs/exports/generate-task-list.ajs)). No published script computing a plateau-to-plateau set difference was found, and coArchi branches are change branches rather than comparable scenarios ([Archi plug-ins](https://www.archimatetool.com/plugins/)).

Structurizr and LikeC4 model deployment environments but not time ([Structurizr DSL](https://docs.structurizr.com/dsl/language)). Sparx EA's Time Aware Modeling clones a package "as a new version" with unchanged elements kept as linked references: snapshots with structural sharing ([Sparx Time Aware Models](https://sparxsystems.com/resources/user-guides/model-domains/time-aware-models.pdf)).

The academic literature anticipated most of this. Buckl et al. (TU München, 2008) distinguish:

- **current** landscapes
- **planned** landscapes, at a specific future date and derived from projects
- **target** landscapes, long-term, with "no need to have projects defined"

They avoid "to-be" as ambiguous. They name **three time dimensions: planned for, modelled at, and variant**. Their requirements include "deduction of future landscapes from the project tasks" ([Buckl et al. 2008](https://www.cs.cit.tum.de/fileadmin/w00cfj/sebis/publications/2008/Bu08h.pdf)). Their proposed solution dates the *relationship*: the support relationship "becomes valid, once the endDate of the project is reached". They also warned that such a model is "likely to be usable only via an appropriate tool."

Aier and Gleichauf (EMISA 2010) note that enterprise models are largely "dateless." They derive project outlines from an as-is/to-be graph comparison, classifying element pairs as 1:1, 1:n, n:m, n:1, 1:0 (termination) and 0:1 (new). They then separate valid time from modelling time and "abstain from labelling the models as as-is or to-be … because this information is more formally expressed by the validity" ([EMISA article](https://emisa-journal.org/emisa/article/view/67/42)).

Xavier et al. (ICEIS 2017) add two things ([SciTePress](https://scitepress.org/Papers/2017/61875/pdf/index.html)):

- **Synchronic relationships**, valid only where their endpoints' intervals overlap.
- Consistency rules. On a real 3,742-element model these **found 126 temporal inconsistencies and auto-corrected 92**.

## A 160-site migration runs as waves of move groups, planned only a few waves ahead

No primary source addresses exactly "160 locations." The cloud-migration frameworks and SAP rollout practice, however, agree on the mechanics closely enough to state a practitioner consensus.

**The structure is move group → wave → cluster.** AWS defines a move group as "a block of servers or applications that should be moved together," the "building block of a migration wave." Dependencies are recorded as Type, Dependency and Description, then turned into prioritised rules such as "applications with a shared database must migrate together." Ubiquitous dependencies like Active Directory are excluded and built first ([AWS Portfolio playbook](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-portfolio-playbook/wave-planning.html)). Microsoft's Cloud Adoption Framework adds: "when uncertainty exists about dependency criticality, group the components together" ([Microsoft CAF](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/migrate/migration-wave-planning)). In SAP rollouts, "waves combine several rollouts and clusters consist of several waves." Sites that roll out in parallel are chosen on similar size, geography and complexity ([valantic](https://www.valantic.com/en/blog/successfully-standardize-in-sap-rollouts/)). A wave is "a managed deployment group with a defined scope and template baseline" ([LeverX](https://leverx.com/blog/sap-global-template-rollout-strategy)).

**Sequencing starts small and simple, and raises complexity and criticality as the programme learns.** AWS keeps early waves under 10 servers. It caps waves by team capacity, for example "a migration team of four architects can migrate up to 50 servers in a week". It moves dev/test before production, fewer dependencies and non-critical units first, and "10 users before 10,000" ([AWS Portfolio playbook](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-portfolio-playbook/wave-planning.html)).

CAF and Google both use a **business value × effort 2×2**. High value and low effort are "quick wins - migrate first", and low value with high effort is "avoid or defer". CAF also advises adding "one or two complex workloads to each early wave" as representative tests ([Microsoft CAF](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/migrate/migration-wave-planning); [Google Cloud](https://docs.cloud.google.com/migration-center/docs/plan-migration-waves)).

SAP sequencing adds criteria a site programme will recognise ([LeverX](https://leverx.com/blog/sap-global-template-rollout-strategy)):

- intercompany and shared-service relationships
- shared warehouses and distribution networks
- local readiness and expert availability
- "**financial close periods, seasonal peaks, and disruption windows**"

LeverX also notes that geographic sequencing (country by country) and functional sequencing (finance first) can be combined. For network rollouts, a vendor reports that "the first 10 sites … are the most difficult," after which large customers "deployed 50 to 60 sites in a single day," and that circuits are the long-lead item ([Network World / Aruba](https://www.networkworld.com/article/3640521/mastering-sd-wan-deployments.html)). That figure is vendor self-reported.

**No primary source gives a site-complexity scoring formula or a standard wave size measured in sites.** AWS says only to use a discovery tool's complexity score if one exists. Google "doesn't define a scoring method."

**High level first, detail later, is explicit policy.** CAF says: "define only the immediate next wave in detail, leaving later waves at a high level until you understand their specific requirements" ([Microsoft CAF](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/migrate/migration-wave-planning)). AWS plans "at least 4–5 waves in advance" and warns "do not try to plan all waves at once." In AWS's factory model the portfolio workstream runs "five waves ahead of the migration workstream," spending 1–2 weeks per wave against 3–4 weeks of migration ([AWS Governance playbook](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-governance-playbook/managing-large-migration.html)). AWS also ramps velocity, for example from 5 to 50–100 servers per week, and treats runbooks as "living documents" revised after each cutover ([AWS Stage 2](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-guide/stage2.html)).

This is rolling-wave planning in the PMBOK sense: near-term work is planned in detail, and far-term work stays in "planning packages" with only scope, dates and budget. The PMBOK definition was reached only through a secondary source ([Rework](https://resources.rework.com/libraries/project-management/rolling-wave-planning)). CAF adds checkpoints at 25/50/75% of each wave and a review of "actual vs. planned durations after each wave" to adjust later waves.

**Template rollouts separate a governed core from classified local deltas.** In SAP practice, local requests are triaged into three classes ([LeverX](https://leverx.com/blog/sap-global-template-rollout-strategy); [valantic](https://www.valantic.com/en/blog/successfully-standardize-in-sap-rollouts/)):

- "Mandatory local requirement"
- "Justified operational variant"
- "User preference", where the standard remains the default

Each exception records the affected entities, the basis, the effort and an expiry date. The template is locked per wave, and teams "track template version per entity". A board of decision-makers not involved operationally governs extensions. The pilot needs "representative processes," because "one successful go-live cannot prove processes that were outside its scope." LeverX also stresses that wave rollout "is therefore a deployment strategy, not a migration method." The data-migration approach is a separate decision.

Site archetypes appear in network tooling. Riverbed recommends configuring "against site types rather than individual sites to keep the configuration simple and scalable" ([Riverbed SCC](https://support.riverbed.com/bin/support/static/3gs1kglhu73a40gkqpnr58tob9/html/ntmgt0cuqjbohifg0kotvm5vv6/scc-ug-html/scc_10.2.0_ug/scc-ug-configuring-networks-sites.11.09.html)). **No source formally defines an "archetype plus migration recipe" method**, although the convention is visible across sources.

**Each site then passes through a consistent per-unit lifecycle.** The stages are synthesised across sources rather than taken from a single standard:

1. survey
2. fit-gap or design
3. build
4. readiness evidence
5. go/no-go
6. cutover with a rehearsed runbook and rollback
7. hypercare
8. handover
9. source decommission

LeverX lists readiness evidence by dimension: process, data control totals, integrations, security and segregation-of-duties conflicts, user acceptance testing, and cutover rehearsal. Its key line is: "Readiness is better demonstrated by completing a critical task than by attending a training session" ([LeverX](https://leverx.com/blog/sap-global-template-rollout-strategy)). AWS hypercare "is 1–4 days," after which "the wave is considered complete" ([AWS Governance playbook](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-governance-playbook/managing-large-migration.html)). CAF requires "rollback procedures and success criteria for each cutover" scheduled inside maintenance windows.

Tracking lives in "a dashboard on a Confluence site, a list in Microsoft Excel, or a combination of tools," and the sprint backlog lives in Jira or Azure Boards (AWS, CAF). EA vendors draw the same line: LeanIX recommends showing initiatives "on an aggregated level (synchronized with a project portfolio management tool)" ([LeanIX docs](https://docs-eam.leanix.net/docs/initiative-modeling-guidelines)).

Putting this together gives a practical two-stage plan for 160 sites. **This is a synthesis of the sources above, not a sourced recipe.**

**At the high level**, the EA team holds:

- a site inventory with attributes: region, legal entity, archetype, size, criticality and constraint windows
- a small set of archetypes with reference target architectures
- a disposition per site asset, in the style of the AWS 7Rs or TOGAF's Mainstream/Contain/Replace
- dependency-driven move groups
- a pilot of 1–3 representative sites
- waves with target windows and capacity-based sizes
- a blackout calendar

**In detail**, a few waves ahead, planners add:

- per-site work packages and milestone dates
- local deltas against the template version
- readiness status by dimension and go/no-go records
- reconciled per-site inventory

Tasks, owners and runbook steps live in the PPM tool. Actual cutover dates and status flow back to the EA tool.

## Transferable design patterns for Archipelago (inference, not source fact)

**Everything in this section is the author's inference from the evidence above.** It is design reasoning, not a finding of any cited source. Citations here point to the evidence each pattern draws on.

**Pattern 1: store valid time; derive plateau membership, phase and gaps.** ArchiMate gives plateaus no dates, and Lankhorst's cross-reference table exists because plateau membership duplicates the model. Buckl and Aier & Gleichauf both argue that the future should be *deduced* from dated change. That points to validity intervals on elements **and on relationships**, with plateau contents computed as "everything valid during the plateau's window." A plateau's window can itself be derived from the implementation events that trigger it and that it triggers, the standard's own route to milestones ([ArchiMate 3.2 §12.2.3](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Implementation-and-Migration-Layer.html)).

This is Archipelago's "lifecycle is derived, never stored" rule extended to plateaus. Dating the edge rather than the node is what Buckl's temporal association, Waltz's decommission-on-mapping and LeanIX's relation validity all converge on, and it fits ADR 0001. Explicit plateau aggregation should still import and export, because ArchiSurance and Archi users author it. The tool should then report where hand-authored membership disagrees with the dates, rather than silently preferring one.

**Pattern 2: make the planned change a typed, dated relationship from a work package.** Essential's plan-to-element link (Creation / Enhancement / Reduction / Removal / No Change), Waltz's Change Unit (ACTIVATE / RETIRE / MODIFY with old and new values) and LeanIX's Impact Types all reify "this initiative does *this* to *that* element by *then*." ArchiMate already sanctions the carrier: "the way the elements are affected may be indicated by annotating the relationships" ([App. C.4.3](https://pubs.opengroup.org/architecture/archimate32-doc/ch-Example-Viewpoints.html)).

In ArchiMate terms, that means Work Package → element through realization (create, modify) or association (retire, keep), with an action property and an effective date on the relationship. That avoids ArchiSurance's ambiguous "Phasing Out Legacy *realizes* legacy app." **Keep "No Change" as an explicit action**, because "deliberately retained" is a planning decision that set difference cannot see.

**Pattern 3: give every date a single source, either a milestone reference or an override.** LeanIX's "date or milestone" choice per transformation is what lets one wave move shift every site in it. Its documented flaws are the anti-patterns: milestones reachable only along one hierarchy, and relation validity and lifecycle as "two sources of truth" ([LeanIX: Milestones](https://docs-eam.leanix.net/docs/working-with-milestones); [LeanIX: Target Architecture](https://docs-eam.leanix.net/docs/target-architecture)).

An implementation event carrying a date is the natural milestone. A change relationship's effective date then holds either that event's id or a literal ISO date, never both. Resolution is a derivation step, so canonical JSON stays byte-stable under ADR 0004.

**Pattern 4: two planning levels on one structure, refined in place.** Three sources describe the same shape: TOGAF's levels and "Phase F initiates more detailed cycles", rolling-wave planning packages, and CAF's "only the next wave in detail". All suggest one wave work package that starts as a planning package (window, site list, archetype, dispositions) and is later *composed of* per-site work packages. A `planningLevel` property (outline → planned → committed → executing → done) would support it.

Several checks become mechanical:

- Lankhorst's rule that sub-periods stay inside the parent's period.
- Xavier's synchronic-relationship rule.
- A wave that splits a must-move-together dependency group.
- A cutover date inside a blackout window.
- AWS's "fewer than N waves at detailed readiness" buffer.

The four-level structure (site → move group → wave → program) maps onto Location plus nested Work Packages. Archetypes map onto Location specializations whose reference content seeds each site's target state, with per-site deviations recorded as typed local deltas (legal / variant / preference).

**Pattern 5: compute gaps, generate Gap elements on request.** With stable ids, a gap between two derived states is a typed set difference over elements and relationships: added, removed, kept, and property-changed within kept. Replacements come from explicit links rather than heuristics (Aier & Gleichauf's 1:n and n:1 successor classes; Waltz's replacement record).

ArchiSurance shows real models omit Gap elements, so the tool should compute them. It can optionally materialise a Gap associated with both plateaus for export. Output sorts by id with a locale-free comparison. The 160-site gap is the same diff filtered by Location, and rolling it up by wave is a cheap, high-value report.

**Pattern 6: views follow TOGAF's own tables.**

- **Site × transition matrix**, the State Evolution Table with sites as rows and dated plateaus as columns. Cells hold a derived new / retain / transition / replace state, coloured green, yellow and red as TOGAF already suggests.
- **Wave plan**, the Increments Table.
- **Roadmap Gantt** with grey or red dependency lines for satisfied or violated triggering (LeanIX).
- **Time slider with a two-point diff** over any existing view (LeanIX's shift-click compare).
- **Site × application matrix** at a chosen date.
- **Burn-up of sites cut over against plan**, computed from milestone dates.
- **Value × risk scatter** for wave assignment.

Waltz's lesson applies to all of them: compare states only over a fixed frame.

**Pattern 7: bulk creation from templates is not optional at 160 sites.** LeanIX had to add a table mode and custom templates because hand-creating per-site changes did not scale ([LeanIX update 2024-03-27](https://updates.leanix.net/announcements/expedite-transformation-setup-with-customized-templates)). "Apply this archetype's change set to these 40 sites in wave 3" should be a single command on the command stack: one undo step, many relationships.

**Pattern 8: record execution, never rewrite history, and let git be modelling time.** LeanIX's Execute and Ardoq's merge both mutate the baseline. Waltz's PENDING / COMPLETE / DISCARDED status and Essential's forecast-versus-actual dates do not. A per-change execution status and actual date, imported from a PPM CSV, keeps plan and actual side by side.

Buckl's "what did the plan of January say about 2010?" is bitemporal. In a tool whose canonical JSON is committed to git, each commit already is a "modelled at" edition. Storing valid time only and diffing commits for modelling time avoids bitemporal tables.

**Pattern 9: alternatives as alternative plateau paths, not branches.** Ardoq's branches bring restricted views, merge friction and metamodel-first merges. ArchiSurance expresses alternatives natively as plateau paths through a junction, and LeanIX uses competing "Idea" initiatives. A scenario is then a set of work packages whose changes apply together, and state(t, scenario) = baseline plus the in-scenario changes effective by t. That needs no model copy and fits a single-file model.

**Pattern 10: treat interchange as lossy on purpose and say so.** Write dates as `type="date"` in the Exchange Format, which the XSD permits, and accept Archi's `string`-typed dates on import. Report every unparsable date-like value as an `ImportProblem`. Convert or flag the deprecated Work Package → Deliverable realization. Export plans as CSV with escaped multi-value fields, or as MS Project XML, whose `PredecessorLink` carries FS, SS, FF and SF links with lag ([Microsoft PredecessorLink](https://msdn2.microsoft.com/en-us/library/bb968712(v=office.12))).

**Stop at the PPM boundary.** Every vendor keeps the EA tool to two or three levels and leaves tasks, owners and runbooks to Jira or PPM. ArchiMate offers no scheduling semantics beyond triggering, so a browser tool that tries to be a scheduler will lose to the tools teams already run.

## Conclusion

The evidence reframes the design question. The hard problem in migration planning is not drawing plateaus. ArchiMate's vocabulary and TOGAF's tables already cover the concepts, and the tables even supply the column layouts. The hard problem is keeping **one date per fact** consistent across 160 sites while the plan changes weekly.

Every tool that stores future states as separate snapshots, from Waltz's cloned scenarios to Ardoq's branches to hand-maintained plateau aggregation, pays for it in duplication, merge friction or drift. Every tool that bolted dates on later now has two date sources: LeanIX's lifecycle against relation validity. Archipelago has an advantage none of the commercial tools started with. Its existing invariants (derived lifecycle, first-class relationship properties, deterministic JSON in git) are the very model the 2008–2017 literature recommended and then said no tool could make usable.

The open risks are empirical rather than conceptual:

- No source documents how anyone actually modelled a 100+-site rollout inside an EA tool.
- No source gives a site-complexity formula or a typical wave size in sites.
- TOGAF's Series Guides and Wierda's critique of plateaus remain unread.

Archipelago would be designing the first public reference for site-wave modelling. It should validate that design against one real rollout plan before freezing the schema in an ADR.
