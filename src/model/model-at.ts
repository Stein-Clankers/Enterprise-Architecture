import {
  PLAN_OF_RECORD_STATUSES,
  byCodeUnit,
  initiativePlanOf,
  isoDayOf,
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
import type { Element, Workspace } from './workspace'

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
 *   makes it retired from its date, and its stored end of life is set aside.
 *   A retirement never makes live an element nothing introduces and its own
 *   dates never make live (ADR 0020 point 8). Where several included entries
 *   date the same thing, the earliest wins, and `planConflicts` lists the
 *   disagreement.
 * - **An element dated only by entries is absent from a state without them**
 *   (ADR 0014 §2): one that some initiative introduces, and that has no
 *   lifecycle date of its own, exists only in the states that include such an
 *   entry. The same holds for a relationship some initiative `add`s that has
 *   no `validFrom`.
 * - A relationship's window runs from `validFrom` (or its included `add`) up
 *   to, but not including, `validTo` (or its included `remove`): every date in
 *   the model is the first day of what it names, as a lifecycle date is the
 *   first day of its phase. An absent bound is open, and so is one that is no
 *   date: `validate()` reports it (`relationship.unparseable-date`), as it
 *   reports an element's.
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
 * (ADR 0017, 2026-10-30).
 *
 * **Which entries count is decided once,** by `readPlan`, and every pass reads
 * its list: an entry whose subject is missing or is not the kind of object its
 * kind dates, a `replace` without its successor, and a `replace` of an element
 * by itself date nothing, in the state and in the conflicts alike, and
 * `validate()` reports each of them.
 *
 * **Two steps.** `preparePlan` does what does not depend on the time point:
 * the ids, the parsed dates, the included entries and their effects. `stateAt`
 * evaluates a prepared plan at a time point, in one pass over the elements and
 * one over the relationships. A screen that moves its time point prepares once
 * per model version and scenario (ADR 0014's remedy for the budget), and
 * `modelAt` does both. The budget is 10 ms at 5,000 elements and 15,000
 * relationships on the CI runner (ADR 0014, Consequences; ADR 0020 point 9),
 * asserted in `model-at.test.ts`.
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

/** An element's state as `stateAt` writes it, by code; 0 is absent. */
const STATE_CODES: readonly (ElementState | undefined)[] = [undefined, 'planned', 'live', 'retired']
const PLANNED = 1
const LIVE = 2
const RETIRED = 3

/**
 * A workspace and a scenario, read for evaluation at any time point. Build
 * one with `preparePlan`, and evaluate it with `stateAt`; its fields are
 * `stateAt`'s to read. It holds no copy of the workspace, only what was read
 * from it, in flat arrays indexed by an element's or a relationship's place:
 * moving a time point is then two passes over numbers (ADR 0020 point 9).
 * Ids are unique, as the store and both readers keep them: an element id
 * given twice anyway is read at its first place, and `validate()` reports
 * the second (`element.duplicate-id`, `relationship.duplicate-id`).
 */
export interface PreparedPlan {
  readonly elementIds: readonly string[]
  readonly elementIndex: ReadonlyMap<string, number>
  /** Phase start dates, in phase order, NaN where unset; `undefined` with none. */
  readonly starts: readonly (readonly number[] | undefined)[]
  /** The earliest included introduction and retirement; NaN where none. */
  readonly entryStart: Float64Array
  readonly entryEnd: Float64Array
  /** 1 where the element is dated only by entries, none of them included (ADR 0014 §2). */
  readonly elementAbsent: Uint8Array
  readonly relationshipIds: readonly string[]
  /** The endpoints' element places; -1 for an endpoint that is no element. */
  readonly sources: Int32Array
  readonly targets: Int32Array
  /** The window `[start, end)`, entries applied, open as ±Infinity. */
  readonly windowStart: Float64Array
  readonly windowEnd: Float64Array
  readonly relationshipAbsent: Uint8Array
  /** Included `modify` entries by element, ordered by date, then as included. */
  readonly modifies: ReadonlyMap<string, readonly Included[]>
  /** Included `replace` entries, as included. */
  readonly replaces: readonly Included[]
}

/** The included entries, and the ids some initiative of any status introduces. */
interface Plan {
  /** Included entries whose references hold, in a fixed order: initiative id, then list order. */
  included: Included[]
  /** Elements an entry of any initiative introduces, or makes a successor. */
  introducedElements: Set<string>
  /** Relationships an entry of any initiative adds. */
  addedRelationships: Set<string>
}

/**
 * Does `change` date something that is there, of the kind its kind dates?
 * The one decision of which entries count: every pass reads `readPlan`'s list.
 * An `add` or `remove` is kept whatever it names, because what it dates is
 * looked up only from a relationship that is there: an id that names an
 * element, or nothing, is never looked up, so it dates nothing.
 */
function holds(change: InitiativeChange, elements: ReadonlyMap<string, number>): boolean {
  switch (change.kind) {
    case 'add':
    case 'remove':
      return true
    case 'replace':
      return (
        change.subject !== change.successor &&
        elements.has(change.subject) &&
        elements.has(change.successor)
      )
    default:
      return elements.has(change.subject)
  }
}

function readPlan(
  workspace: Workspace,
  scenario: Scenario | undefined,
  elements: ReadonlyMap<string, number>,
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

  const plan: Plan = {
    included: [],
    introducedElements: new Set(),
    addedRelationships: new Set(),
  }
  for (const initiative of initiatives) {
    for (const change of initiative.changes) {
      if (!holds(change, elements)) continue
      if (change.kind === 'introduce') plan.introducedElements.add(change.subject)
      if (change.kind === 'replace') plan.introducedElements.add(change.successor)
      if (change.kind === 'add') plan.addedRelationships.add(change.subject)
      if (initiative.included) {
        plan.included.push({ initiative: initiative.id, change, at: dayMs(change.date.date) })
      }
    }
  }
  return plan
}

/**
 * An ISO day as UTC midnight in ms. Entry dates are guarded ISO days, so this
 * cannot fail. `setUTCFullYear`, because `Date.UTC` reads years 0–99 as
 * 1900–1999.
 */
function dayMs(day: string): number {
  const date = new Date(0)
  date.setUTCFullYear(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  )
  return date.getTime()
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

/** `included` holds only entries whose references hold, so nothing is checked again here. */
function effectsOf(included: readonly Included[]): Effects {
  const effects: Effects = {
    elements: new Map(),
    relationships: new Map(),
    modifies: new Map(),
    replaces: [],
  }
  for (const entry of included) {
    const { change, at } = entry
    switch (change.kind) {
      case 'introduce': {
        const dating = datingOf(effects.elements, change.subject)
        dating.start = earlier(dating.start, at)
        break
      }
      case 'retire': {
        const dating = datingOf(effects.elements, change.subject)
        dating.end = earlier(dating.end, at)
        break
      }
      case 'replace': {
        const predecessor = datingOf(effects.elements, change.subject)
        predecessor.end = earlier(predecessor.end, at)
        const successor = datingOf(effects.elements, change.successor)
        successor.start = earlier(successor.start, at)
        effects.replaces.push(entry)
        break
      }
      case 'add': {
        const dating = datingOf(effects.relationships, change.subject)
        dating.start = earlier(dating.start, at)
        break
      }
      case 'remove': {
        const dating = datingOf(effects.relationships, change.subject)
        dating.end = earlier(dating.end, at)
        break
      }
      case 'modify':
        push(effects.modifies, change.subject, entry)
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
    const value = lifecycle[phase]
    const ms = value === undefined ? Number.NaN : parseLifecycleDate(value)
    if (!Number.isNaN(ms)) any = true
    return ms
  })
  return any ? starts : undefined
}

const END_OF_LIFE = LIFECYCLE_PHASES.indexOf('endOfLife')

/**
 * The baseline state at `at` from parsed phase starts. This is
 * `deriveLifecyclePhase` (UI spec §3.1) over numbers it has already parsed,
 * mapped to ADR 0014 §1's three states; `model-at.test.ts` pins the two
 * together on every combination of dates. With `withoutEnd`, the end of life
 * is read as unset: an included retirement has taken its place.
 */
function storedState(
  starts: readonly number[] | undefined,
  at: number,
  withoutEnd: boolean,
): ElementState {
  if (!starts) return 'live'
  let started = -1
  let earliestKnown = -1
  for (let index = 0; index < starts.length; index++) {
    const ms = starts[index]!
    if (Number.isNaN(ms) || (withoutEnd && index === END_OF_LIFE)) continue
    if (earliestKnown < 0) earliestKnown = index
    if (ms <= at) started = index
  }
  if (earliestKnown < 0) return 'live'
  const phase = started >= 0 ? started : Math.max(0, earliestKnown - 1)
  return stateOfPhase(LIFECYCLE_PHASES[phase]!)
}

/** ADR 0014 §1: planned before phase-in, retired from end of life, live in between. */
export function stateOfPhase(phase: LifecyclePhase): ElementState {
  return phase === 'plan' ? 'planned' : phase === 'endOfLife' ? 'retired' : 'live'
}

/** An element's state code at `at`; `start` and `end` are its included entries' dates, NaN where none. */
function elementState(
  starts: readonly number[] | undefined,
  start: number,
  end: number,
  at: number,
): number {
  if (at >= end) return RETIRED
  if (at < start) return PLANNED
  // An included retirement sets the stored end of life aside, and an included
  // introduction the stored planned phase: the entry wins (ADR 0014 §4).
  const stored = storedState(starts, at, !Number.isNaN(end))
  if (stored === 'planned') return Number.isNaN(start) ? PLANNED : LIVE
  return stored === 'live' ? LIVE : RETIRED
}

/** A stored bound in ms; NaN when it is absent or is no date. */
function bound(value: string | undefined): number {
  return value === undefined ? Number.NaN : parseLifecycleDate(value)
}

/**
 * Read a workspace under a scenario for evaluation at any time point: the
 * part of `modelAt` that does not depend on the date.
 */
export function preparePlan(workspace: Workspace, scenario?: Scenario): PreparedPlan {
  return prepare(workspace, scenario).prepared
}

/** `preparePlan`, with the plan and effects it read, for `planConflicts` to read too. */
function prepare(
  workspace: Workspace,
  scenario: Scenario | undefined,
): { prepared: PreparedPlan; plan: Plan; effects: Effects } {
  const elementIndex = new Map<string, number>()
  const elementIds: string[] = []
  const firstElements: Element[] = []
  for (const element of workspace.elements) {
    if (elementIndex.has(element.id)) continue
    elementIndex.set(element.id, elementIds.length)
    elementIds.push(element.id)
    firstElements.push(element)
  }
  const plan = readPlan(workspace, scenario, elementIndex)
  const effects = effectsOf(plan.included)

  const count = elementIds.length
  const starts: (number[] | undefined)[] = new Array(count)
  const entryStart = new Float64Array(count).fill(Number.NaN)
  const entryEnd = new Float64Array(count).fill(Number.NaN)
  const elementAbsent = new Uint8Array(count)
  for (let index = 0; index < count; index++) {
    const element = firstElements[index]!
    const own = phaseStarts(element)
    starts[index] = own
    const dating = effects.elements.get(element.id)
    if (dating?.start !== undefined) entryStart[index] = dating.start
    if (dating?.end !== undefined) entryEnd[index] = dating.end
    // No lifecycle date of its own: its only introduction is an entry.
    if (dating?.start === undefined && own === undefined && plan.introducedElements.has(element.id))
      elementAbsent[index] = 1
  }

  const relationships = workspace.relationships
  const total = relationships.length
  const relationshipIds: string[] = new Array(total)
  const sources = new Int32Array(total)
  const targets = new Int32Array(total)
  const windowStart = new Float64Array(total)
  const windowEnd = new Float64Array(total)
  const relationshipAbsent = new Uint8Array(total)
  for (let index = 0; index < total; index++) {
    const relationship = relationships[index]!
    relationshipIds[index] = relationship.id
    sources[index] = elementIndex.get(relationship.source) ?? -1
    targets[index] = elementIndex.get(relationship.target) ?? -1
    const dating = effects.relationships.get(relationship.id)
    const validFrom = bound(relationship.profile?.validFrom)
    const validTo = bound(relationship.profile?.validTo)
    windowStart[index] =
      dating?.start ?? (Number.isNaN(validFrom) ? Number.NEGATIVE_INFINITY : validFrom)
    windowEnd[index] = dating?.end ?? (Number.isNaN(validTo) ? Number.POSITIVE_INFINITY : validTo)
    if (
      dating?.start === undefined &&
      Number.isNaN(validFrom) &&
      plan.addedRelationships.has(relationship.id)
    )
      relationshipAbsent[index] = 1
  }

  // Latest date wins; on the same date, the later-included entry (a stable sort).
  const modifies = new Map<string, Included[]>()
  for (const [subject, entries] of effects.modifies) {
    modifies.set(
      subject,
      [...entries].sort((a, b) => a.at - b.at),
    )
  }

  return {
    prepared: {
      elementIds,
      elementIndex,
      starts,
      entryStart,
      entryEnd,
      elementAbsent,
      relationshipIds,
      sources,
      targets,
      windowStart,
      windowEnd,
      relationshipAbsent,
      modifies,
      replaces: effects.replaces,
    },
    plan,
    effects,
  }
}

/** A prepared plan evaluated at `at` (epoch ms). */
export function stateAt(plan: PreparedPlan, at: number): ModelState {
  const codes = new Uint8Array(plan.elementIds.length)
  let present = 0
  for (let index = 0; index < codes.length; index++) {
    if (plan.elementAbsent[index]) continue
    codes[index] = elementState(
      plan.starts[index],
      plan.entryStart[index]!,
      plan.entryEnd[index]!,
      at,
    )
    present++
  }

  const valid = new Uint8Array(plan.relationshipIds.length)
  let validCount = 0
  for (let index = 0; index < valid.length; index++) {
    if (plan.relationshipAbsent[index]) continue
    if (plan.windowStart[index]! > at || at >= plan.windowEnd[index]!) continue
    const source = plan.sources[index]!
    const target = plan.targets[index]!
    if (source < 0 || target < 0 || codes[source] !== LIVE || codes[target] !== LIVE) continue
    valid[index] = 1
    validCount++
  }

  const values = new Map<string, PlannedValues>()
  for (const [subject, entries] of plan.modifies) {
    const planned: PlannedValues = {}
    for (const { change, at: date } of entries) {
      if (date > at) break
      if (change.kind === 'modify') setPlanned(planned, change.field, change.value)
    }
    if (Object.keys(planned).length) values.set(subject, planned)
  }

  const successors: SuccessorLink[] = []
  for (const { initiative, change, at: date } of plan.replaces) {
    if (date > at || change.kind !== 'replace') continue
    successors.push({
      predecessor: change.subject,
      successor: change.successor,
      date: change.date.date,
      initiative,
      entry: change.id,
    })
  }

  return {
    at,
    elements: new ElementStates(plan, codes, present),
    relationships: new ValidRelationships(plan, valid, validCount),
    values,
    successors,
  }
}

/** The element states of one evaluation, read through the prepared plan's index. */
class ElementStates implements ReadonlyMap<string, ElementState> {
  readonly #plan: PreparedPlan
  readonly #codes: Uint8Array
  readonly size: number

  constructor(plan: PreparedPlan, codes: Uint8Array, size: number) {
    this.#plan = plan
    this.#codes = codes
    this.size = size
  }

  get(id: string): ElementState | undefined {
    const index = this.#plan.elementIndex.get(id)
    return index === undefined ? undefined : STATE_CODES[this.#codes[index]!]
  }

  has(id: string): boolean {
    return this.get(id) !== undefined
  }

  *entries(): MapIterator<[string, ElementState]> {
    const ids = this.#plan.elementIds
    for (let index = 0; index < ids.length; index++) {
      const state = STATE_CODES[this.#codes[index]!]
      if (state) yield [ids[index]!, state]
    }
  }

  *keys(): MapIterator<string> {
    for (const [id] of this.entries()) yield id
  }

  *values(): MapIterator<ElementState> {
    for (const [, state] of this.entries()) yield state
  }

  forEach(
    callback: (value: ElementState, key: string, map: ReadonlyMap<string, ElementState>) => void,
  ): void {
    for (const [id, state] of this.entries()) callback(state, id, this)
  }

  [Symbol.iterator](): MapIterator<[string, ElementState]> {
    return this.entries()
  }
}

/** The valid relationships of one evaluation; the id index is built on the first `has`. */
class ValidRelationships implements ReadonlySet<string> {
  readonly #plan: PreparedPlan
  readonly #valid: Uint8Array
  #index: Map<string, number> | undefined
  readonly size: number

  constructor(plan: PreparedPlan, valid: Uint8Array, size: number) {
    this.#plan = plan
    this.#valid = valid
    this.size = size
  }

  has(id: string): boolean {
    if (!this.#index) {
      // First place wins, as for elements.
      this.#index = new Map()
      const ids = this.#plan.relationshipIds
      for (let place = ids.length - 1; place >= 0; place--) this.#index.set(ids[place]!, place)
    }
    const index = this.#index.get(id)
    return index !== undefined && this.#valid[index] === 1
  }

  *values(): SetIterator<string> {
    const ids = this.#plan.relationshipIds
    for (let index = 0; index < ids.length; index++) if (this.#valid[index]) yield ids[index]!
  }

  *keys(): SetIterator<string> {
    yield* this.values()
  }

  *entries(): SetIterator<[string, string]> {
    for (const id of this.values()) yield [id, id]
  }

  forEach(callback: (value: string, key: string, set: ReadonlySet<string>) => void): void {
    for (const id of this.values()) callback(id, id, this)
  }

  [Symbol.iterator](): SetIterator<string> {
    return this.values()
  }
}

/**
 * The architecture at `at` (epoch ms) under `scenario`, or under the plan of
 * record when no scenario is given (ADR 0014 §4). A caller that evaluates one
 * model at many time points prepares once (`preparePlan`) and calls `stateAt`.
 */
export function modelAt(workspace: Workspace, at: number, scenario?: Scenario): ModelState {
  return stateAt(preparePlan(workspace, scenario), at)
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
 * §6). They do not depend on a time point, only on what is included, and they
 * read the same included entries as `modelAt`.
 *
 * This lists four of §6's six. "A live element depends on an element retired
 * before it" needs impact's notion of dependency (#65), and "an initiative
 * starts before an initiative it depends on finishes" needs initiative
 * dependencies (#60); each lands with its issue.
 */
export function planConflicts(workspace: Workspace, scenario?: Scenario): Conflict[] {
  const elementsById = new Map(workspace.elements.map((element) => [element.id, element]))
  const { prepared, plan, effects } = prepare(workspace, scenario)
  const { included } = plan
  const conflicts: Conflict[] = []
  const ref = (entry: Included) => ({ initiative: entry.initiative, entry: entry.change.id })
  const name = (id: string) => elementsById.get(id)?.name || id

  // The included entries by what they date, read once.
  const retiring = new Map<string, Included[]>()
  const introducing = new Map<string, Included[]>()
  const dating = new Map<string, Included[]>()
  for (const entry of included) {
    const { change } = entry
    if (change.kind === 'retire' || change.kind === 'replace') push(retiring, change.subject, entry)
    if (change.kind === 'introduce') push(introducing, change.subject, entry)
    if (change.kind === 'replace') push(introducing, change.successor, entry)
    if (change.kind === 'add' || change.kind === 'remove') push(dating, change.subject, entry)
  }

  // Two included entries retire or replace the same element.
  for (const [subject, entries] of retiring) {
    if (entries.length < 2) continue
    conflicts.push({
      code: 'change.retired-twice',
      message: `“${name(subject)}” is retired by ${entries.length} entries (${entries.map(describe).join(', ')}). The earliest, ${isoDayOf(Math.min(...entries.map((e) => e.at)))}, is the one that counts.`,
      subject,
      entries: entries.map(ref),
    })
  }

  // A successor that goes live after its predecessor retires leaves a gap in coverage.
  for (const entry of effects.replaces) {
    if (entry.change.kind !== 'replace') continue
    const { subject, successor } = entry.change
    const retires = effects.elements.get(subject)?.end
    const goesLive = effects.elements.get(successor)?.start
    if (retires === undefined || goesLive === undefined || goesLive <= retires) continue
    // The replace, and whichever entries retire the predecessor earlier than it.
    const causes = (retiring.get(subject) ?? []).filter((other) => other.at < goesLive)
    conflicts.push({
      code: 'change.successor-gap',
      message: `“${name(successor)}” replaces “${name(subject)}”, but goes live on ${isoDayOf(goesLive)}, after “${name(subject)}” retires on ${isoDayOf(retires)}.`,
      subject,
      entries: [entry, ...causes.filter((other) => other !== entry)].map(ref),
    })
  }

  // A stored date disagrees with an included entry; the entry wins (ADR 0014 §4).
  // Compared as days: a lifecycle may hold a timestamp, and an entry is a day.
  for (const element of workspace.elements) {
    const starts = phaseStarts(element)
    if (!starts) continue
    const dates = effects.elements.get(element.id)
    if (!dates) continue
    const storedLive = storedLiveFrom(starts)
    const storedEnd = starts[END_OF_LIFE]!
    const disagreements: string[] = []
    const involved: Included[] = []
    if (dates.start !== undefined && !sameDay(storedLive, dates.start)) {
      disagreements.push(
        `goes live on ${isoDayOf(dates.start)} by its entries, and ${storedLive === Number.NEGATIVE_INFINITY ? 'is live from the start' : Number.isNaN(storedLive) ? 'never goes live' : `on ${isoDayOf(storedLive)}`} by its lifecycle`,
      )
      involved.push(...(introducing.get(element.id) ?? []))
    }
    if (dates.end !== undefined && !Number.isNaN(storedEnd) && !sameDay(storedEnd, dates.end)) {
      disagreements.push(
        `retires on ${isoDayOf(dates.end)} by its entries, and on ${isoDayOf(storedEnd)} by its lifecycle`,
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
    const dates = effects.relationships.get(relationship.id)
    if (!dates) continue
    const from = bound(relationship.profile?.validFrom)
    const to = bound(relationship.profile?.validTo)
    const disagreements: string[] = []
    if (dates.start !== undefined && !Number.isNaN(from) && !sameDay(from, dates.start))
      disagreements.push(
        `its entries add it on ${isoDayOf(dates.start)} and validFrom is ${isoDayOf(from)}`,
      )
    if (dates.end !== undefined && !Number.isNaN(to) && !sameDay(to, dates.end))
      disagreements.push(
        `its entries remove it on ${isoDayOf(dates.end)} and validTo is ${isoDayOf(to)}`,
      )
    if (!disagreements.length) continue
    conflicts.push({
      code: 'change.stored-date-disagrees',
      message: `Relationship "${relationship.id}": ${disagreements.join(', and ')}. The entries win.`,
      subject: relationship.id,
      entries: (dating.get(relationship.id) ?? []).map(ref),
    })
  }

  // A relationship dated to stay valid after an endpoint retires. An open end
  // is not a conflict: it says nothing about the endpoint, and the relationship
  // stops being valid when the endpoint retires. Nor is one this scenario
  // leaves absent, or one to an absent element: neither is in any state.
  for (let index = 0; index < prepared.relationshipIds.length; index++) {
    const end = prepared.windowEnd[index]!
    if (prepared.relationshipAbsent[index] || end === Number.POSITIVE_INFINITY) continue
    const ends = [prepared.sources[index]!, prepared.targets[index]!]
    if (ends.some((place) => place >= 0 && prepared.elementAbsent[place])) continue
    const id = prepared.relationshipIds[index]!
    for (const place of ends) {
      if (place < 0) continue
      const endpoint = prepared.elementIds[place]!
      const retires = retirementOf(elementsById.get(endpoint)!, effects.elements.get(endpoint))
      if (retires === undefined || end <= retires) continue
      conflicts.push({
        code: 'change.relationship-outlives-endpoint',
        message: `Relationship "${id}" is valid until ${isoDayOf(end)}, but “${name(endpoint)}” retires on ${isoDayOf(retires)}.`,
        subject: id,
        entries: [
          ...(dating.get(id) ?? []).filter((entry) => entry.change.kind === 'remove'),
          ...(retiring.get(endpoint) ?? []),
        ].map(ref),
      })
      // One conflict per relationship, naming the first endpoint it outlives.
      break
    }
  }
  return conflicts
}

/** Do two instants fall on one UTC day? `-Infinity` and NaN are days of their own. */
function sameDay(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b
  return isoDayOf(a) === isoDayOf(b)
}

/** When an element retires under its entries, or by its lifecycle; `undefined` if it never does. */
function retirementOf(element: Element, dates: Dating | undefined): number | undefined {
  if (dates?.end !== undefined) return dates.end
  const end = bound(element.profile?.lifecycle?.endOfLife)
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
