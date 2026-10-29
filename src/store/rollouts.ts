import {
  PLAN_ELEMENT_TYPE,
  archetypeIdOf,
  byLocation,
  isGoNoGo,
  isIsoDay,
  isMilestonePhase,
  isPlanDate,
  isPlanDatePrecision,
  isRolloutPlan,
  isSiteRag,
  periodOf,
  isWindowInOrder,
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
import { setKey } from '@/io/records'
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

/** What a new rollout starts with: `presetPlan` fills the milestones and an archetype (#213). */
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
  store.removeElement(rolloutId)
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
  /** The dates its sites inherit, by milestone id of the rollout. */
  milestones?: Record<string, PlanDate>
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
  if (input.milestones !== undefined && Object.keys(input.milestones).length) {
    if (!knowsMilestones(rollout, input.milestones)) return undefined
    plan.milestones = { ...input.milestones }
  }
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
  store.removeElement(waveId)
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
  /** The dates its sites inherit, replacing the wave's; `{}` clears them. */
  milestones?: Record<string, PlanDate>
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
  if (changes.milestones !== undefined) {
    const rollout = rolloutPlanOf(store.element(plan.rollout))
    if (!rollout || !knowsMilestones(rollout, changes.milestones, plan.milestones)) return false
    if (Object.keys(changes.milestones).length) next.milestones = { ...changes.milestones }
    else delete next.milestones
  }
  if (!isWavePlan(next)) return false
  if (
    next.window?.start &&
    next.window.end &&
    !isWindowInOrder(next.window.start, next.window.end)
  ) {
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
  return periodOf(day, precision)
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

// ── Milestone sets (#213) ────────────────────────────────────────────────────

/** What the milestone dialog changes. `date: null` clears the rollout's own date. */
export interface MilestoneChanges {
  label?: string
  startsPhase?: unknown
  date?: PlanDate | null
}

/**
 * Add a milestone at the end of the rollout's set, as one command. Its id is
 * made from its label (`Go/no-go` is `goNoGo`) and is never changed after:
 * the workbook's columns and the exchange format's keys are named by it. The
 * phase comes from a form, so it goes through its guard: an empty `<select>`
 * value adds nothing. Returns the new id, or `undefined` when refused.
 */
export function addMilestone(
  store: ModelStore,
  rolloutId: string,
  input: { label: string; startsPhase: unknown; date?: PlanDate },
): string | undefined {
  assertWriter(store, 'add-milestone')
  const rollout = store.element(rolloutId)
  const plan = rolloutPlanOf(rollout)
  if (!rollout || !plan || typeof input.label !== 'string' || !input.label.trim()) return undefined
  if (!isMilestonePhase(input.startsPhase)) return undefined
  const milestone: Milestone = {
    id: milestoneIdFor(input.label, plan.milestones),
    label: input.label.trim(),
    startsPhase: input.startsPhase,
  }
  if (input.date !== undefined) milestone.date = input.date
  const next: RolloutPlan = { ...plan, milestones: [...plan.milestones, milestone] }
  if (!isRolloutPlan(next)) return undefined
  store.dispatch({ kind: 'update-element', before: rollout, after: { ...rollout, plan: next } })
  return milestone.id
}

/** Edit a milestone's label, phase and rollout date as one command. */
export function updateMilestone(
  store: ModelStore,
  rolloutId: string,
  milestoneId: string,
  changes: MilestoneChanges,
): boolean {
  assertWriter(store, 'update-milestone')
  const rollout = store.element(rolloutId)
  const plan = rolloutPlanOf(rollout)
  const index = plan?.milestones.findIndex((milestone) => milestone.id === milestoneId) ?? -1
  if (!rollout || !plan || index < 0) return false
  const before = plan.milestones[index]!
  const milestone: Milestone = { ...before }
  if (changes.label !== undefined) {
    if (typeof changes.label !== 'string' || !changes.label.trim()) return false
    milestone.label = changes.label.trim()
  }
  if (changes.startsPhase !== undefined) {
    if (!isMilestonePhase(changes.startsPhase)) return false
    milestone.startsPhase = changes.startsPhase
  }
  if (changes.date === null) delete milestone.date
  else if (changes.date !== undefined) {
    if (!isPlanDate(changes.date)) return false
    milestone.date = changes.date
  }
  const milestones = [...plan.milestones]
  milestones[index] = milestone
  const next: RolloutPlan = { ...plan, milestones }
  if (!isRolloutPlan(next)) return false
  const same =
    milestone.label === before.label &&
    milestone.startsPhase === before.startsPhase &&
    milestone.date?.date === before.date?.date &&
    milestone.date?.precision === before.date?.precision
  if (!same) {
    store.dispatch({ kind: 'update-element', before: rollout, after: { ...rollout, plan: next } })
  }
  return true
}

/**
 * Move a milestone one place earlier (`-1`) or later (`1`) in the set, as one
 * command. The order is what the phase is derived walking, so it is the
 * author's to choose. At either end there is nowhere to go: `true`, nothing done.
 */
export function moveMilestone(
  store: ModelStore,
  rolloutId: string,
  milestoneId: string,
  by: -1 | 1,
): boolean {
  assertWriter(store, 'move-milestone')
  const rollout = store.element(rolloutId)
  const plan = rolloutPlanOf(rollout)
  const index = plan?.milestones.findIndex((milestone) => milestone.id === milestoneId) ?? -1
  if (!rollout || !plan || index < 0 || (by !== -1 && by !== 1)) return false
  const target = index + by
  if (target < 0 || target >= plan.milestones.length) return true
  const milestones = [...plan.milestones]
  milestones[index] = plan.milestones[target]!
  milestones[target] = plan.milestones[index]!
  store.dispatch({
    kind: 'update-element',
    before: rollout,
    after: { ...rollout, plan: { ...plan, milestones } },
  })
  return true
}

/** What still uses a milestone: what deleting it would take with it, or refuse over. */
export interface MilestoneUsage {
  /** Sites with a planned or an actual date for it. */
  sites: number
  /** Waves of the rollout with a date for it. */
  waves: number
  /** Archetypes with a duration for it. */
  archetypes: number
  /** Template changes anchored on it, by id: these block the delete. */
  anchoredChanges: string[]
}

export function milestoneUsage(
  store: ModelStore,
  rolloutId: string,
  milestoneId: string,
): MilestoneUsage {
  const plan = rolloutPlanOf(store.element(rolloutId))
  const uses = (record: Record<string, unknown> | undefined) =>
    record !== undefined && Object.hasOwn(record, milestoneId)
  return {
    sites: plan?.sites.filter((site) => uses(site.milestones) || uses(site.actuals)).length ?? 0,
    waves: wavesOf(store.elements(), rolloutId).filter((wave) => uses(wavePlanOf(wave)?.milestones))
      .length,
    archetypes: plan?.archetypes.filter((archetype) => uses(archetype.durations)).length ?? 0,
    anchoredChanges:
      plan?.template
        .filter((change) => 'anchor' in change.date && change.date.anchor === milestoneId)
        .map((change) => change.id) ?? [],
  }
}

/**
 * Delete a milestone, with every date and duration given for it, as one
 * command that one undo puts back: the sites' planned and actual dates, the
 * waves' dates and the archetypes' durations. The dialog asks first when
 * anything uses it (`milestoneUsage`).
 *
 * **Refused while a template change is anchored on it** (`false`, nothing
 * done): the change's date would name a milestone that is gone, and the
 * template is re-anchored on purpose, not by a side effect of this.
 */
export function removeMilestone(
  store: ModelStore,
  rolloutId: string,
  milestoneId: string,
): boolean {
  assertWriter(store, 'remove-milestone')
  const rollout = store.element(rolloutId)
  const plan = rolloutPlanOf(rollout)
  if (!rollout || !plan || !plan.milestones.some((milestone) => milestone.id === milestoneId)) {
    return false
  }
  if (milestoneUsage(store, rolloutId, milestoneId).anchoredChanges.length) return false
  const next: RolloutPlan = {
    ...plan,
    milestones: plan.milestones.filter((milestone) => milestone.id !== milestoneId),
    archetypes: plan.archetypes.map((archetype) =>
      withRecord(archetype, 'durations', withoutKey(archetype.durations, milestoneId)),
    ),
    sites: plan.sites.map((site) =>
      withRecord(
        withRecord(site, 'milestones', withoutKey(site.milestones, milestoneId)),
        'actuals',
        withoutKey(site.actuals, milestoneId),
      ),
    ),
  }
  const commands: Command[] = [
    { kind: 'update-element', before: rollout, after: { ...rollout, plan: next } },
  ]
  for (const wave of wavesOf(store.elements(), rolloutId)) {
    const wavePlan = wavePlanOf(wave)!
    if (!wavePlan.milestones || !Object.hasOwn(wavePlan.milestones, milestoneId)) continue
    const after = withRecord(wavePlan, 'milestones', withoutKey(wavePlan.milestones, milestoneId))
    commands.push({ kind: 'update-element', before: wave, after: { ...wave, plan: after } })
  }
  store.dispatch(commands.length === 1 ? commands[0]! : { kind: 'batch', commands })
  return true
}

/**
 * Set or clear one site's own milestone dates, as one command. `null` clears
 * an override, so the site inherits that milestone again (ADR 0016); any
 * other value must be a plan date (`isPlanDate`), for a milestone of the
 * rollout. One value that fails refuses the whole change with `false`: a form
 * that turned an empty precision into `{ precision: '' }` stores nothing, and
 * the value the schema rejects is never written (CLAUDE.md, type guards).
 */
export function setSiteMilestones(
  store: ModelStore,
  rolloutId: string,
  locationId: string,
  dates: Record<string, unknown>,
): boolean {
  assertWriter(store, 'set-site-milestones')
  const plan = rolloutPlanOf(store.element(rolloutId))
  if (!plan || !plan.sites.some((site) => site.location === locationId)) return false
  const known = new Set(plan.milestones.map((milestone) => milestone.id))
  const changes: [string, PlanDate | null][] = []
  for (const [id, value] of Object.entries(dates)) {
    if (!known.has(id)) return false
    if (value === null) changes.push([id, null])
    else if (isPlanDate(value)) changes.push([id, value])
    else return false
  }
  return updateSites(store, rolloutId, [locationId], false, (site) => {
    const milestones: Record<string, PlanDate> = { ...site.milestones }
    for (const [id, value] of changes) {
      if (value === null) delete milestones[id]
      else setKey(milestones, id, value)
    }
    return withRecord(site, 'milestones', Object.keys(milestones).length ? milestones : undefined)
  })
}

/**
 * What a site's progress dialog changes (#215): actual days by milestone id,
 * the RAG and the go/no-go decision. `null` clears a value; a key left out
 * leaves it as it is.
 */
export interface SiteProgressChanges {
  actuals?: Record<string, unknown>
  rag?: unknown
  goNoGo?: unknown
}

/**
 * Set or clear one site's actual days, RAG and go/no-go, as one command, and
 * nothing else of its plan. An actual is an ISO day (`isIsoDay`) for a
 * milestone of the rollout, the RAG one of `SITE_RAGS` and the decision one of
 * `GO_NO_GO_DECISIONS`; `null` clears each. One value that fails its guard
 * refuses the whole change with `false`, so a `<select>`'s empty option or a
 * half-typed day is never stored (CLAUDE.md, type guards on the write path).
 */
export function setSiteProgress(
  store: ModelStore,
  rolloutId: string,
  locationId: string,
  changes: SiteProgressChanges,
): boolean {
  assertWriter(store, 'set-site-progress')
  const plan = rolloutPlanOf(store.element(rolloutId))
  if (!plan || !plan.sites.some((site) => site.location === locationId)) return false
  const known = new Set(plan.milestones.map((milestone) => milestone.id))
  const actuals: [string, string | null][] = []
  for (const [id, value] of Object.entries(changes.actuals ?? {})) {
    if (!known.has(id)) return false
    if (value === null || isIsoDay(value)) actuals.push([id, value])
    else return false
  }
  const { rag, goNoGo } = changes
  if (rag !== undefined && rag !== null && !isSiteRag(rag)) return false
  if (goNoGo !== undefined && goNoGo !== null && !isGoNoGo(goNoGo)) return false
  return updateSites(store, rolloutId, [locationId], false, (site) => {
    const record: Record<string, string> = { ...site.actuals }
    for (const [id, value] of actuals) {
      if (value === null) delete record[id]
      else setKey(record, id, value)
    }
    let next = withRecord(site, 'actuals', Object.keys(record).length ? record : undefined)
    if (rag !== undefined) next = withRecord(next, 'rag', rag ?? undefined)
    if (goNoGo !== undefined) next = withRecord(next, 'goNoGo', goNoGo ?? undefined)
    return next
  })
}

/**
 * A milestone id from its label: its words in camel case, `goNoGo` for
 * "Go/no-go", made unique in the set with a number. A word is letters, marks
 * and digits of any script, so "Übergabe" is `übergabe`, not `bergabe`. A label
 * with no letter or digit gives `milestone`.
 *
 * The id may be any word, `constructor` among them: every record keyed by it
 * is read with `getKey` (#229 review).
 */
export function milestoneIdFor(label: string, milestones: readonly Milestone[]): string {
  // Composed first, so "Übergabe" typed as U + a combining diaeresis is the
  // id that "Übergabe" is; marks (\p{M}) belong to their word, so a script
  // whose vowels are combining signs keeps its words whole.
  const words = label.normalize('NFC').match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  const base =
    words
      .map((word, index) =>
        index === 0 ? word.toLowerCase() : word[0]!.toUpperCase() + word.slice(1).toLowerCase(),
      )
      .join('') || 'milestone'
  const taken = new Set(milestones.map((milestone) => milestone.id))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}

// ── Internals ────────────────────────────────────────────────────────────────

/**
 * Is every key of `dates` a milestone of `plan`? A new date for no milestone
 * is refused. One the wave already holds, unchanged, is kept: validate()
 * reports it, and an edit of the wave's other dates must not drop it unseen.
 */
function knowsMilestones(
  plan: RolloutPlan,
  dates: Record<string, PlanDate>,
  held: Record<string, PlanDate> = {},
): boolean {
  const known = new Set(plan.milestones.map((milestone) => milestone.id))
  return Object.entries(dates).every(
    ([id, date]) =>
      known.has(id) ||
      (Object.hasOwn(held, id) &&
        held[id]!.date === date.date &&
        held[id]!.precision === date.precision),
  )
}

/** `record` without `key`, or `undefined` when nothing is left. */
function withoutKey<T>(
  record: Record<string, T> | undefined,
  key: string,
): Record<string, T> | undefined {
  if (!record) return undefined
  const out = { ...record }
  delete out[key]
  return Object.keys(out).length ? out : undefined
}

/** `object` with `key` set to `value`, or without `key` when `value` is undefined. */
function withRecord<T extends object, K extends keyof T>(
  object: T,
  key: K,
  value: T[K] | undefined,
): T {
  const out = { ...object }
  if (value === undefined) delete out[key]
  else out[key] = value
  return out
}

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

function without(site: SitePlan, key: 'wave' | 'archetype'): SitePlan {
  const copy = { ...site }
  delete copy[key]
  return copy
}
