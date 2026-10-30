import {
  PLAN_OF_RECORD_STATUSES,
  byCodeUnit,
  initiativePlanOf,
  type InitiativeChange,
  type PlannableField,
} from './plan'
import { parseLifecycleDate } from './lifecycle'
import {
  LIFECYCLE_PHASES,
  type FitLevel,
  type LifecyclePhase,
  type TimeClassification,
} from './profile'
import type { Element, Relationship, Workspace } from './workspace'

/**
 * The architecture at a date, under a plan (#61, ADR 0014 §4): the one way to
 * read a state. The inventory, fact sheet, graph, gap (#64) and impact (#65)
 * read through it, and none of them evaluates dates on its own.
 *
 * **What it reads.** An element's lifecycle dates and a relationship's
 * `validFrom` and `validTo` are the baseline. The change entries of every
 * initiative in the scenario are the plan (ADR 0014 §3): the plan of record is
 * every initiative whose status is approved, in progress or done, and a
 * scenario includes or excludes initiatives by id on top of it.
 *
 * **What it decides**, at a time point in epoch ms:
 *
 * - An element is `planned`, `live` or `retired` (ADR 0014 §1), or absent. Its
 *   stored lifecycle gives the baseline: before phase-in it is planned, from
 *   end of life it is retired, and with no dates at all it is live.
 * - **An entry wins over a stored date** (ADR 0014 §4). An included `introduce`
 *   (or the successor of a `replace`) makes the element planned before its date
 *   and live from it; an included `retire` (or the predecessor of a `replace`)
 *   makes it retired from its date. Where several included entries date the
 *   same thing, the earliest wins, and `planConflicts` lists the disagreement.
 * - **An element dated only by entries is absent from a state without them**
 *   (ADR 0014 §2): one that some initiative introduces, and that has no
 *   lifecycle date of its own, exists only in the states that include such an
 *   entry. The same holds for a relationship some initiative `add`s that has
 *   no `validFrom`.
 * - A relationship's window runs from `validFrom` (or its included `add`) up
 *   to, but not including, `validTo` (or its included `remove`): every date in
 *   the model is the first day of what it names, as a lifecycle date is the
 *   first day of its phase. An absent bound is open.
 * - **A relationship is valid only while both its endpoints are live.** That is
 *   the invariant ADR 0014 §4 states, and it is enforced here rather than
 *   trusted to the data: a relationship whose window outlives an endpoint is
 *   simply not valid once that endpoint retires, and `planConflicts` says so
 *   when the window was dated to outlive it.
 * - A `modify` entry's value holds from its date until a later one of the same
 *   field; before the first, the stored profile value holds.
 *
 * Entry dates are plan dates, and a coarse one takes effect on the first day
 * of its period, as a coarse milestone counts from its period's first day
 * (ADR 0017, 2026-10-30). An entry whose subject is missing, or is not the
 * kind of object its kind dates, is left out here; `validate()` reports it.
 *
 * `modelAt` is pure and evaluates in one pass over the entries, one over the
 * elements and one over the relationships. Its budget is 10 ms at 5,000
 * elements and 15,000 relationships (ADR 0014, Consequences), asserted in
 * `model-at.test.ts`.
 */

/** An element's state at a time point (ADR 0014 §1). */
export type ElementState = 'planned' | 'live' | 'retired'

/**
 * The plan of record with initiatives included or excluded by id (ADR 0014
 * §3). Exclusion wins over inclusion. Storing and naming a scenario is #62's;
 * this is the overlay it evaluates as.
 */
export interface Scenario {
  include?: readonly string[]
  exclude?: readonly string[]
}

/** A `replace` that has taken effect: the successor link a gap needs (#64). */
export interface SuccessorLink {
  predecessor: string
  successor: string
  /** The entry's date: an ISO day, the first of its period. */
  date: string
  /** The initiative that owns the entry, and the entry's id. */
  initiative: string
  entry: string
}

/** The values `modify` entries have planned (ADR 0014 §5). */
export type PlannedValues = {
  functionalFit?: FitLevel
  technicalFit?: FitLevel
  timeClassification?: TimeClassification
}

/** The architecture at one time point under one scenario. Read-only. */
export interface ModelState {
  /** The time point, epoch ms. */
  at: number
  /** The state of every element present; an absent element is not a key. */
  elements: ReadonlyMap<string, ElementState>
  /** The relationships valid at `at`: inside their window, and between two live elements. */
  relationships: ReadonlySet<string>
  /** The fields an included `modify` has set by `at`, by element id. */
  values: ReadonlyMap<string, Readonly<PlannedValues>>
  /** Each included `replace` whose date is reached by `at`, in the order they were included. */
  successors: readonly SuccessorLink[]
}

/** An included entry, with the initiative it comes from and its date in ms. */
interface Included {
  initiative: string
  change: InitiativeChange
  at: number
}

/** What the entries say about one element or relationship. */
interface Dating {
  /** Earliest included introduction (element) or `add` (relationship). */
  start?: number
  /** Earliest included retirement (element) or `remove` (relationship). */
  end?: number
}

/**
 * The included initiatives' entries, in a fixed order (initiative id, then the
 * entry's place in its list), and the ids some initiative of any status
 * introduces or adds. Shared with `planConflicts`, so the two agree on what a
 * scenario includes.
 */
interface Plan {
  included: Included[]
  /** Introduced (or added) by an entry of any initiative, included or not. */
  introducedAnywhere: Set<string>
}

function readPlan(
  workspace: Workspace,
  scenario: Scenario | undefined,
  elements: ReadonlyMap<string, Element>,
  relationships: ReadonlyMap<string, Relationship>,
): Plan {
  const include = new Set(scenario?.include ?? [])
  const exclude = new Set(scenario?.exclude ?? [])
  const initiatives: { id: string; changes: readonly InitiativeChange[]; included: boolean }[] = []
  for (const element of workspace.elements) {
    const plan = initiativePlanOf(element)
    if (!plan) continue
    const included =
      !exclude.has(element.id) &&
      (include.has(element.id) || PLAN_OF_RECORD_STATUSES.includes(plan.status))
    initiatives.push({ id: element.id, changes: plan.changes, included })
  }
  initiatives.sort((a, b) => byCodeUnit(a.id, b.id))

  const included: Included[] = []
  const introducedAnywhere = new Set<string>()
  for (const initiative of initiatives) {
    for (const change of initiative.changes) {
      // Only an entry of the right kind introduces anything: an `add` naming
      // an element dates nothing, and must not make that element absent.
      if (change.kind === 'introduce' && elements.has(change.subject))
        introducedAnywhere.add(change.subject)
      if (change.kind === 'add' && relationships.has(change.subject))
        introducedAnywhere.add(change.subject)
      if (change.kind === 'replace' && elements.has(change.successor))
        introducedAnywhere.add(change.successor)
      if (initiative.included) {
        included.push({ initiative: initiative.id, change, at: dayMs(change.date.date) })
      }
    }
  }
  return { included, introducedAnywhere }
}

/** An ISO day as UTC midnight in ms. Entry dates are guarded ISO days, so this cannot fail. */
function dayMs(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
}

function earlier(current: number | undefined, at: number): number {
  return current === undefined || at < current ? at : current
}

function datingOf(map: Map<string, Dating>, id: string): Dating {
  let dating = map.get(id)
  if (!dating) {
    dating = {}
    map.set(id, dating)
  }
  return dating
}

/** What the included entries say, by subject, split by what they date. */
interface Effects {
  elements: Map<string, Dating>
  relationships: Map<string, Dating>
  /** Included `modify` entries by element, in included order. */
  modifies: Map<string, Included[]>
  replaces: Included[]
}

function effectsOf(
  included: readonly Included[],
  elements: ReadonlyMap<string, Element>,
  relationships: ReadonlyMap<string, Relationship>,
): Effects {
  const effects: Effects = {
    elements: new Map(),
    relationships: new Map(),
    modifies: new Map(),
    replaces: [],
  }
  for (const entry of included) {
    const { change, at } = entry
    switch (change.kind) {
      case 'introduce':
        if (elements.has(change.subject)) {
          const dating = datingOf(effects.elements, change.subject)
          dating.start = earlier(dating.start, at)
        }
        break
      case 'retire':
        if (elements.has(change.subject)) {
          const dating = datingOf(effects.elements, change.subject)
          dating.end = earlier(dating.end, at)
        }
        break
      case 'replace':
        if (elements.has(change.subject) && elements.has(change.successor)) {
          const predecessor = datingOf(effects.elements, change.subject)
          predecessor.end = earlier(predecessor.end, at)
          const successor = datingOf(effects.elements, change.successor)
          successor.start = earlier(successor.start, at)
          effects.replaces.push(entry)
        }
        break
      case 'add':
        if (relationships.has(change.subject)) {
          const dating = datingOf(effects.relationships, change.subject)
          dating.start = earlier(dating.start, at)
        }
        break
      case 'remove':
        if (relationships.has(change.subject)) {
          const dating = datingOf(effects.relationships, change.subject)
          dating.end = earlier(dating.end, at)
        }
        break
      case 'modify':
        if (elements.has(change.subject)) {
          const list = effects.modifies.get(change.subject)
          if (list) list.push(entry)
          else effects.modifies.set(change.subject, [entry])
        }
        break
    }
  }
  return effects
}

/** The phase start dates of an element's lifecycle, in phase order, NaN where unset. */
function phaseStarts(element: Element): number[] | undefined {
  const lifecycle = element.profile?.lifecycle
  if (!lifecycle) return undefined
  let any = false
  const starts = LIFECYCLE_PHASES.map((phase) => {
    const ms = parseLifecycleDate(lifecycle[phase])
    if (!Number.isNaN(ms)) any = true
    return ms
  })
  return any ? starts : undefined
}

/**
 * The baseline state at `at` from parsed phase starts. This is
 * `deriveLifecyclePhase` (UI spec §3.1) over numbers it has already parsed,
 * mapped to ADR 0014 §1's three states; `model-at.test.ts` pins the two
 * together on every combination of dates.
 */
function storedState(starts: readonly number[] | undefined, at: number): ElementState {
  if (!starts) return 'live'
  let started = -1
  let earliestKnown = -1
  for (let index = 0; index < starts.length; index++) {
    const ms = starts[index]!
    if (Number.isNaN(ms)) continue
    if (earliestKnown < 0) earliestKnown = index
    if (ms <= at) started = index
  }
  const phase = started >= 0 ? started : Math.max(0, earliestKnown - 1)
  return stateOfPhase(LIFECYCLE_PHASES[phase]!)
}

/** ADR 0014 §1: planned before phase-in, retired from end of life, live in between. */
export function stateOfPhase(phase: LifecyclePhase): ElementState {
  return phase === 'plan' ? 'planned' : phase === 'endOfLife' ? 'retired' : 'live'
}

function elementState(
  starts: readonly number[] | undefined,
  dating: Dating | undefined,
  at: number,
): ElementState {
  if (dating?.end !== undefined && at >= dating.end) return 'retired'
  if (dating?.start !== undefined && at < dating.start) return 'planned'
  const stored = storedState(starts, at)
  // The entry wins where the stored dates say otherwise (ADR 0014 §4).
  if (stored === 'planned' && dating?.start !== undefined) return 'live'
  if (stored === 'retired' && dating?.end !== undefined) return 'live'
  return stored
}

/** A relationship's window under its entries: `[start, end)`, open where unset. */
function windowOf(
  relationship: Relationship,
  dating: Dating | undefined,
): { start: number; end: number } {
  const validFrom = parseLifecycleDate(relationship.profile?.validFrom)
  const validTo = parseLifecycleDate(relationship.profile?.validTo)
  return {
    start: dating?.start ?? (Number.isNaN(validFrom) ? Number.NEGATIVE_INFINITY : validFrom),
    end: dating?.end ?? (Number.isNaN(validTo) ? Number.POSITIVE_INFINITY : validTo),
  }
}

/**
 * The architecture at `at` (epoch ms) under `scenario`, or under the plan of
 * record when no scenario is given (ADR 0014 §4).
 */
export function modelAt(workspace: Workspace, at: number, scenario?: Scenario): ModelState {
  const elementsById = new Map(workspace.elements.map((element) => [element.id, element]))
  const relationshipsById = new Map(workspace.relationships.map((r) => [r.id, r]))
  const plan = readPlan(workspace, scenario, elementsById, relationshipsById)
  const effects = effectsOf(plan.included, elementsById, relationshipsById)

  const elements = new Map<string, ElementState>()
  for (const element of workspace.elements) {
    const starts = phaseStarts(element)
    const dating = effects.elements.get(element.id)
    // No lifecycle date of its own: its only introduction is an entry.
    if (
      dating?.start === undefined &&
      starts === undefined &&
      plan.introducedAnywhere.has(element.id)
    )
      continue
    elements.set(element.id, elementState(starts, dating, at))
  }

  const relationships = new Set<string>()
  for (const relationship of workspace.relationships) {
    const dating = effects.relationships.get(relationship.id)
    if (
      dating?.start === undefined &&
      plan.introducedAnywhere.has(relationship.id) &&
      relationship.profile?.validFrom === undefined
    )
      continue
    if (
      elements.get(relationship.source) !== 'live' ||
      elements.get(relationship.target) !== 'live'
    )
      continue
    const window = windowOf(relationship, dating)
    if (window.start <= at && at < window.end) relationships.add(relationship.id)
  }

  const values = new Map<string, PlannedValues>()
  for (const [subject, entries] of effects.modifies) {
    // Latest date wins; on the same date, the later-included entry.
    const sorted = [...entries].sort((a, b) => a.at - b.at)
    const planned: PlannedValues = {}
    for (const { change, at: date } of sorted) {
      if (date > at || change.kind !== 'modify') continue
      setPlanned(planned, change.field, change.value)
    }
    if (Object.keys(planned).length) values.set(subject, planned)
  }

  const successors: SuccessorLink[] = []
  for (const { initiative, change, at: date } of effects.replaces) {
    if (date > at || change.kind !== 'replace') continue
    successors.push({
      predecessor: change.subject,
      successor: change.successor,
      date: change.date.date,
      initiative,
      entry: change.id,
    })
  }

  return { at, elements, relationships, values, successors }
}

function setPlanned(
  planned: PlannedValues,
  field: PlannableField,
  value: FitLevel | TimeClassification,
): void {
  if (field === 'timeClassification') planned.timeClassification = value as TimeClassification
  else planned[field] = value as FitLevel
}

/** An element's value of `field` in `state`: the planned value where one holds, else the stored one. */
export function valueAt<F extends PlannableField>(
  state: ModelState,
  element: Element,
  field: F,
): PlannedValues[F] | undefined {
  const planned = state.values.get(element.id)
  return planned && planned[field] !== undefined
    ? planned[field]
    : (element.profile?.[field] as PlannedValues[F] | undefined)
}

// ── Conflicts (ADR 0014 §6) ──────────────────────────────────────────────────

export type ConflictCode =
  | 'change.retired-twice'
  | 'change.relationship-outlives-endpoint'
  | 'change.successor-gap'
  | 'change.stored-date-disagrees'

/** A plan the model accepts and evaluates, and lists as contradicting itself. */
export interface Conflict {
  code: ConflictCode
  message: string
  /** The element or relationship it is about. */
  subject: string
  /** The included entries involved, by initiative and entry id. */
  entries: { initiative: string; entry: string }[]
}

/**
 * The conflicts of a scenario's plan, computed and never prevented (ADR 0014
 * §6). They do not depend on a time point, only on what is included.
 *
 * This lists four of §6's six. "A live element depends on an element retired
 * before it" needs impact's notion of dependency (#65), and "an initiative
 * starts before an initiative it depends on finishes" needs initiative
 * dependencies (#60); each lands with its issue.
 */
export function planConflicts(workspace: Workspace, scenario?: Scenario): Conflict[] {
  const elementsById = new Map(workspace.elements.map((element) => [element.id, element]))
  const relationshipsById = new Map(workspace.relationships.map((r) => [r.id, r]))
  const { included } = readPlan(workspace, scenario, elementsById, relationshipsById)
  const effects = effectsOf(included, elementsById, relationshipsById)
  const conflicts: Conflict[] = []
  const ref = (entry: Included) => ({ initiative: entry.initiative, entry: entry.change.id })
  const name = (id: string) => elementsById.get(id)?.name || id

  // Two included entries retire or replace the same element.
  const retiring = new Map<string, Included[]>()
  const introducing = new Map<string, Included[]>()
  for (const entry of included) {
    const { change } = entry
    if (!elementsById.has(change.subject)) continue
    if (change.kind === 'retire' || change.kind === 'replace') push(retiring, change.subject, entry)
    if (change.kind === 'introduce') push(introducing, change.subject, entry)
    if (change.kind === 'replace' && elementsById.has(change.successor))
      push(introducing, change.successor, entry)
  }
  for (const [subject, entries] of retiring) {
    if (entries.length < 2) continue
    conflicts.push({
      code: 'change.retired-twice',
      message: `“${name(subject)}” is retired by ${entries.length} entries (${entries.map(describe).join(', ')}). The earliest, ${isoOf(Math.min(...entries.map((e) => e.at)))}, is the one that counts.`,
      subject,
      entries: entries.map(ref),
    })
  }

  // A successor that goes live after its predecessor retires leaves a gap in coverage.
  for (const entry of effects.replaces) {
    if (entry.change.kind !== 'replace') continue
    const retires = effects.elements.get(entry.change.subject)?.end
    const goesLive = effects.elements.get(entry.change.successor)?.start
    if (retires === undefined || goesLive === undefined || goesLive <= retires) continue
    conflicts.push({
      code: 'change.successor-gap',
      message: `“${name(entry.change.successor)}” replaces “${name(entry.change.subject)}”, but goes live on ${isoOf(goesLive)}, after “${name(entry.change.subject)}” retires on ${isoOf(retires)}.`,
      subject: entry.change.subject,
      entries: [ref(entry)],
    })
  }

  // A stored date disagrees with an included entry; the entry wins (ADR 0014 §4).
  for (const element of workspace.elements) {
    const starts = phaseStarts(element)
    if (!starts) continue
    const dating = effects.elements.get(element.id)
    if (!dating) continue
    const storedLive = storedLiveFrom(starts)
    const storedEnd = starts[LIFECYCLE_PHASES.indexOf('endOfLife')]!
    const disagreements: string[] = []
    const involved: Included[] = []
    if (dating.start !== undefined && storedLive !== dating.start) {
      disagreements.push(
        `goes live on ${isoOf(dating.start)} by its entries, and ${storedLive === Number.NEGATIVE_INFINITY ? 'is live from the start' : Number.isNaN(storedLive) ? 'never goes live' : `on ${isoOf(storedLive)}`} by its lifecycle`,
      )
      involved.push(...(introducing.get(element.id) ?? []))
    }
    if (dating.end !== undefined && !Number.isNaN(storedEnd) && storedEnd !== dating.end) {
      disagreements.push(
        `retires on ${isoOf(dating.end)} by its entries, and on ${isoOf(storedEnd)} by its lifecycle`,
      )
      involved.push(...(retiring.get(element.id) ?? []))
    }
    if (!disagreements.length) continue
    conflicts.push({
      code: 'change.stored-date-disagrees',
      message: `“${name(element.id)}” ${disagreements.join(', and ')}. The entries win.`,
      subject: element.id,
      entries: involved.map(ref),
    })
  }
  for (const relationship of workspace.relationships) {
    const dating = effects.relationships.get(relationship.id)
    if (!dating) continue
    const from = parseLifecycleDate(relationship.profile?.validFrom)
    const to = parseLifecycleDate(relationship.profile?.validTo)
    const disagreements: string[] = []
    if (dating.start !== undefined && !Number.isNaN(from) && from !== dating.start)
      disagreements.push(
        `its entries add it on ${isoOf(dating.start)} and validFrom is ${isoOf(from)}`,
      )
    if (dating.end !== undefined && !Number.isNaN(to) && to !== dating.end)
      disagreements.push(
        `its entries remove it on ${isoOf(dating.end)} and validTo is ${isoOf(to)}`,
      )
    if (!disagreements.length) continue
    conflicts.push({
      code: 'change.stored-date-disagrees',
      message: `Relationship "${relationship.id}": ${disagreements.join(', and ')}. The entries win.`,
      subject: relationship.id,
      entries: included
        .filter((entry) => entry.change.subject === relationship.id)
        .filter((entry) => entry.change.kind === 'add' || entry.change.kind === 'remove')
        .map(ref),
    })
  }

  // A relationship dated to stay valid after an endpoint retires. An open end
  // is not a conflict: it says nothing about the endpoint, and the relationship
  // stops being valid when the endpoint retires.
  for (const relationship of workspace.relationships) {
    const dating = effects.relationships.get(relationship.id)
    const window = windowOf(relationship, dating)
    if (window.end === Number.POSITIVE_INFINITY) continue
    for (const endpoint of [relationship.source, relationship.target]) {
      const element = elementsById.get(endpoint)
      if (!element) continue
      const retires = retirementOf(element, effects.elements.get(endpoint))
      if (retires === undefined || window.end <= retires) continue
      conflicts.push({
        code: 'change.relationship-outlives-endpoint',
        message: `Relationship "${relationship.id}" is valid until ${isoOf(window.end)}, but “${name(endpoint)}” retires on ${isoOf(retires)}.`,
        subject: relationship.id,
        entries: included
          .filter(
            (entry) =>
              (entry.change.kind === 'remove' && entry.change.subject === relationship.id) ||
              ((entry.change.kind === 'retire' || entry.change.kind === 'replace') &&
                entry.change.subject === endpoint),
          )
          .map(ref),
      })
      break
    }
  }
  return conflicts
}

/** When an element retires under its entries, or by its lifecycle; `undefined` if it never does. */
function retirementOf(element: Element, dating: Dating | undefined): number | undefined {
  if (dating?.end !== undefined) return dating.end
  const end = parseLifecycleDate(element.profile?.lifecycle?.endOfLife)
  return Number.isNaN(end) ? undefined : end
}

/**
 * The first day the stored lifecycle makes an element live: `-Infinity` when
 * it is live from the start (its earliest date is active or later), NaN when
 * it never is (it has only a plan date, or a plan date and an end of life).
 */
function storedLiveFrom(starts: readonly number[]): number {
  const earliest = starts.findIndex((ms) => !Number.isNaN(ms))
  if (earliest > 1) return Number.NEGATIVE_INFINITY
  // Planned first: live from the first of phase-in, active and phase-out.
  for (const index of [1, 2, 3]) if (!Number.isNaN(starts[index]!)) return starts[index]!
  return Number.NaN
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function describe(entry: Included): string {
  return `"${entry.change.id}" of "${entry.initiative}" on ${entry.change.date.date}`
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
