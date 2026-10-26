import {
  PLAN_ELEMENT_TYPE,
  archetypeIdOf,
  byLocation,
  formatPlanDate,
  isIsoDay,
  isPlanDatePrecision,
  isRolloutPlan,
  parsePlanDate,
  isWavePlan,
  rolloutPlanOf,
  waveIdOf,
  wavePlanOf,
  wavesOf,
  type Archetype,
  type Element,
  type Milestone,
  type PlanDate,
  type RolloutConstraints,
  type RolloutPlan,
  type SitePlan,
  type TemplateChange,
  type WavePlan,
  type WaveWindow,
} from '@/model'
import type { Command } from './commands'
import { newId } from './ids'
import { ReadOnlyModelError, type ModelStore } from './model-store'

/**
 * The store commands for rollouts, waves and site plans (#209).
 *
 * Every one of them is one command on the stack, so one undo step, whatever it
 * touches: assigning forty sites to a wave is one update of the rollout, whose
 * site plans are records inside it, and deleting a wave is that wave's removal
 * plus its sites' unassignment in one batch.
 *
 * Each checks the role first and throws `ReadOnlyModelError` for a reader,
 * before it looks at its arguments. The store refuses a reader's dispatch
 * anyway (#198), but a command that found nothing to do would otherwise return
 * quietly for a reader and hide the missed guard in the screen that called it.
 *
 * Every value that comes from a form goes through a guard from `model/plan.ts`:
 * an empty `<select>` value, an unknown wave id or a wave of another rollout is
 * refused with `false` and nothing is dispatched, so no value the published
 * schema rejects can be stored (CLAUDE.md, type guards on the write path).
 *
 * `false` means refused and nothing changed. `true` means done, including when
 * there was nothing to change, which records no command.
 */

/** What a new rollout starts with. Presets (#213) will fill these. */
export interface RolloutInput {
  name: string
  milestones?: Milestone[]
  template?: TemplateChange[]
  constraints?: RolloutConstraints
  archetypes?: Archetype[]
}

/** A new rollout Work Package, at template version 1 with no sites. */
export function createRollout(store: ModelStore, input: RolloutInput): Element | undefined {
  assertWriter(store, 'create-rollout')
  const plan: RolloutPlan = {
    kind: 'rollout',
    templateVersion: 1,
    milestones: input.milestones ?? [],
    template: input.template ?? [],
    archetypes: input.archetypes ?? [],
    sites: [],
  }
  if (input.constraints !== undefined) plan.constraints = input.constraints
  if (typeof input.name !== 'string' || !isRolloutPlan(plan)) return undefined
  const rollout: Element = {
    id: newId('el'),
    type: PLAN_ELEMENT_TYPE,
    name: input.name,
    properties: {},
    plan: structuredClone(plan),
  }
  store.dispatch({ kind: 'add-element', element: rollout })
  return rollout
}

export function renameRollout(store: ModelStore, rolloutId: string, name: string): boolean {
  assertWriter(store, 'rename-rollout')
  return rename(store, rolloutPlanOf(store.element(rolloutId)) ? rolloutId : undefined, name)
}

/**
 * Delete a rollout, its site plans and every wave of it, as one step. The
 * cascade is `removalCommands`' own (#222), so Delete on the rollout's fact
 * sheet does the same.
 */
export function deleteRollout(store: ModelStore, rolloutId: string): boolean {
  assertWriter(store, 'delete-rollout')
  if (!rolloutPlanOf(store.element(rolloutId))) return false
  dispatchAll(store, store.removalCommands([rolloutId]))
  return true
}

/** What a new wave starts with. */
export interface WaveInput {
  name: string
  label: string
  /** Defaults to after the rollout's last wave. */
  order?: number
  window?: WaveWindow
  capacity?: number
}

/**
 * A new wave Work Package of `rolloutId`, locked to the rollout's current
 * template version, and the Aggregation from the rollout that makes it one of
 * the rollout's waves in ArchiMate terms (ADR 0013 point 2), as one step.
 */
export function createWave(
  store: ModelStore,
  rolloutId: string,
  input: WaveInput,
): Element | undefined {
  assertWriter(store, 'create-wave')
  const rollout = rolloutPlanOf(store.element(rolloutId))
  if (!rollout || typeof input.name !== 'string') return undefined
  const last = wavesOf(store.elements(), rolloutId).at(-1)
  const plan: WavePlan = {
    kind: 'wave',
    rollout: rolloutId,
    label: input.label,
    order: input.order ?? (wavePlanOf(last)?.order ?? 0) + 1,
    templateVersion: rollout.templateVersion,
  }
  if (input.window !== undefined) plan.window = input.window
  if (input.capacity !== undefined) plan.capacity = input.capacity
  if (!isWavePlan(plan)) return undefined
  const wave: Element = {
    id: newId('el'),
    type: PLAN_ELEMENT_TYPE,
    name: input.name,
    properties: {},
    plan: structuredClone(plan),
  }
  store.dispatch({
    kind: 'batch',
    commands: [
      { kind: 'add-element', element: wave },
      {
        kind: 'add-relationship',
        relationship: {
          id: newId('rel'),
          type: 'Aggregation',
          source: rolloutId,
          target: wave.id,
          properties: {},
        },
      },
    ],
  })
  return wave
}

export function renameWave(store: ModelStore, waveId: string, name: string): boolean {
  assertWriter(store, 'rename-wave')
  return rename(store, wavePlanOf(store.element(waveId)) ? waveId : undefined, name)
}

/**
 * Delete a wave, and unassign its sites in the same step. The sites stay in
 * the rollout, unplanned: a wave going is no reason to lose their dates. The
 * unassignment is `removalCommands`' own (#222), so Delete on the wave's fact
 * sheet does the same.
 */
export function deleteWave(store: ModelStore, waveId: string): boolean {
  assertWriter(store, 'delete-wave')
  if (!wavePlanOf(store.element(waveId))) return false
  dispatchAll(store, store.removalCommands([waveId]))
  return true
}

/**
 * What the wave controls change: any of them, in one command. A key left out
 * is left alone; `window: {}` and `capacity: null` clear.
 */
export interface WaveChanges {
  name?: string
  label?: string
  window?: WaveWindow
  capacity?: number | null
}

/**
 * Edit a wave's name, label, window and capacity as one command. Every value
 * goes through the wave's guard: a capacity of nought, or a window date that
 * does not start its period, is refused with `false` and stores nothing. A
 * form gets its window dates from `snapPlanDate`, which never yields such a
 * date silently.
 */
export function updateWave(store: ModelStore, waveId: string, changes: WaveChanges): boolean {
  assertWriter(store, 'update-wave')
  const wave = store.element(waveId)
  const plan = wavePlanOf(wave)
  if (!wave || !plan) return false
  if (changes.name !== undefined && typeof changes.name !== 'string') return false
  const next: WavePlan = { ...plan }
  if (changes.label !== undefined) next.label = changes.label
  if (changes.window !== undefined) {
    const window: WaveWindow = {}
    if (changes.window.start !== undefined) window.start = changes.window.start
    if (changes.window.end !== undefined) window.end = changes.window.end
    if (window.start === undefined && window.end === undefined) delete next.window
    else next.window = window
  }
  if (changes.capacity === null) delete next.capacity
  else if (changes.capacity !== undefined) next.capacity = changes.capacity
  if (!isWavePlan(next)) return false
  if (next.window?.start && next.window.end && next.window.end.date < next.window.start.date) {
    return false
  }
  const after: Element = { ...wave, name: changes.name ?? wave.name, plan: next }
  if (JSON.stringify(after) !== JSON.stringify(wave)) {
    store.dispatch({ kind: 'update-element', before: wave, after })
  }
  return true
}

/**
 * A form's day and precision as a `PlanDate`, **snapped** to the first day of
 * the period the day falls in (ADR 0015 point 1): 2027-05-12 at week precision
 * is the week of Monday 2027-05-10, written 2027-W19. `toPlanDate` refuses a
 * day that does not start its period, so a form that handed it the day the
 * user picked stored nothing and said nothing (#222). This is the door forms
 * use instead: the user sees the period it snapped to before saving.
 *
 * `undefined` only for what names no period: an empty field, a day that is
 * not a calendar day, or a precision the select does not offer.
 */
export function snapPlanDate(day: unknown, precision: unknown): PlanDate | undefined {
  if (!isIsoDay(day) || !isPlanDatePrecision(precision)) return undefined
  // `formatPlanDate` names the period any day falls in, and `parsePlanDate`
  // spells that period by its first day: the one pair ADR 0015 allows.
  return parsePlanDate(formatPlanDate({ date: day, precision }))
}

/**
 * Put Locations in the rollout. A Location already in it keeps its plan. Every
 * id must be a Location, or nothing is added.
 */
export function addSites(
  store: ModelStore,
  rolloutId: string,
  locationIds: readonly string[],
): boolean {
  assertWriter(store, 'add-sites')
  return updateSites(store, rolloutId, locationIds, true, (site) => site)
}

/** Take Locations out of the rollout, with their plans: a deliberate removal. */
export function removeSites(
  store: ModelStore,
  rolloutId: string,
  locationIds: readonly string[],
): boolean {
  assertWriter(store, 'remove-sites')
  const rollout = store.element(rolloutId)
  const plan = rolloutPlanOf(rollout)
  if (!rollout || !plan || !locationIds.length) return false
  const removing = new Set(locationIds)
  const sites = plan.sites.filter((site) => !removing.has(site.location))
  if (sites.length === plan.sites.length) return true
  store.dispatch({
    kind: 'update-element',
    before: rollout,
    after: { ...rollout, plan: { ...plan, sites } },
  })
  return true
}

/**
 * Assign one or many sites to a wave of the same rollout, as **one** command:
 * one undo step puts every one of them back where it was (#209). A site not
 * yet in the rollout is added. `wave` comes from a form, so it is guarded: an
 * empty value, an unknown id or another rollout's wave stores nothing.
 */
export function assignSites(
  store: ModelStore,
  rolloutId: string,
  locationIds: readonly string[],
  wave: unknown,
): boolean {
  assertWriter(store, 'assign-sites')
  const waveId = waveIdOf(wave, rolloutId, (id) => store.element(id))
  if (waveId === undefined) return false
  return updateSites(store, rolloutId, locationIds, true, (site) => ({ ...site, wave: waveId }))
}

/** Take sites out of their wave, as one command. They stay in the rollout. */
export function unassignSites(
  store: ModelStore,
  rolloutId: string,
  locationIds: readonly string[],
): boolean {
  assertWriter(store, 'unassign-sites')
  return updateSites(store, rolloutId, locationIds, false, (site) => without(site, 'wave'))
}

/**
 * Set the archetype of one or many of the rollout's sites, as one command;
 * `null` clears it. Any other value must be an archetype of the rollout.
 */
export function setArchetype(
  store: ModelStore,
  rolloutId: string,
  locationIds: readonly string[],
  archetype: unknown,
): boolean {
  assertWriter(store, 'set-archetype')
  const plan = rolloutPlanOf(store.element(rolloutId))
  if (!plan) return false
  if (archetype === null) {
    return updateSites(store, rolloutId, locationIds, false, (site) => without(site, 'archetype'))
  }
  const archetypeId = archetypeIdOf(archetype, plan)
  if (archetypeId === undefined) return false
  return updateSites(store, rolloutId, locationIds, false, (site) => ({
    ...site,
    archetype: archetypeId,
  }))
}

// ── Internals ────────────────────────────────────────────────────────────────

function assertWriter(store: ModelStore, what: string): void {
  if (!store.writable) throw new ReadOnlyModelError(what)
}

function rename(store: ModelStore, id: string | undefined, name: string): boolean {
  const element = id === undefined ? undefined : store.element(id)
  if (!element || typeof name !== 'string') return false
  if (element.name !== name) {
    store.dispatch({ kind: 'update-element', before: element, after: { ...element, name } })
  }
  return true
}

/**
 * Change the plans of `locationIds` in one update of the rollout. With
 * `create`, a Location not yet in the rollout gets a plan, and every id not yet
 * in it must be a Location; without, such an id is passed over.
 *
 * A site already in the plan is never refused for its Location: one whose
 * Location was deleted is kept, and reported, until it is reassigned or
 * removed (`validate()`), so reassigning it has to work (#222).
 */
function updateSites(
  store: ModelStore,
  rolloutId: string,
  locationIds: readonly string[],
  create: boolean,
  change: (site: SitePlan) => SitePlan,
): boolean {
  const rollout = store.element(rolloutId)
  const plan = rolloutPlanOf(rollout)
  if (!rollout || !plan || !locationIds.length) return false
  const sites = new Map(plan.sites.map((site) => [site.location, site]))
  const isNewNonLocation = (id: string) => !sites.has(id) && store.element(id)?.type !== 'Location'
  if (create && locationIds.some(isNewNonLocation)) return false

  let changed = false
  for (const location of new Set(locationIds)) {
    const before = sites.get(location)
    if (!before && !create) continue
    const after = change(before ?? { location })
    if (before && JSON.stringify(after) === JSON.stringify(before)) continue
    sites.set(location, after)
    changed = true
  }
  if (!changed) return true
  store.dispatch({
    kind: 'update-element',
    before: rollout,
    after: { ...rollout, plan: { ...plan, sites: [...sites.values()].sort(byLocation) } },
  })
  return true
}

function dispatchAll(store: ModelStore, commands: Command[]): void {
  const [only] = commands
  if (commands.length === 1 && only) store.dispatch(only)
  else if (commands.length) store.dispatch({ kind: 'batch', commands })
}

function without(site: SitePlan, key: 'wave' | 'archetype'): SitePlan {
  const copy = { ...site }
  delete copy[key]
  return copy
}
