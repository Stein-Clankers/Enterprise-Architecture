import {
  PLAN_ELEMENT_TYPE,
  byLocation,
  isArchetype,
  isBlackout,
  isIsoDay,
  isMilestone,
  isPlanDate,
  isPositiveInteger,
  isSiteRag,
  isTemplateChange,
  type Archetype,
  type Blackout,
  type Milestone,
  type PlanProfile,
  type RolloutConstraints,
  type RolloutPlan,
  type SitePlan,
  type TemplateChange,
  type WavePlan,
  type WaveWindow,
} from '@/model'
import { problem, type ImportProblem } from './problems'
import { setKey } from './records'
import { byId, isRecord, prune } from './json-helpers'
import { listed } from './exchange-xml'

/**
 * Rollout and wave plan profiles in the native format (#209), and the lenient
 * readers both formats share.
 *
 * Writing: the milestone set and the template keep the order their author
 * gave them, because the order means something (phases are derived walking the
 * milestones in order). Everything else is sorted by a stable key: archetypes
 * and blackouts by id, site plans by location id (proposal §8), and every
 * record's keys by `sortKeys` at every depth. An empty record or list is left
 * out, as everywhere else in the file.
 *
 * Reading: a plan is read part by part, not accepted or refused whole. One
 * malformed milestone must not cost a rollout its 160 site plans, so each part
 * that fails its guard is dropped and named, and the caller reports what was
 * dropped (`json.invalid-plan`). A part this build does not know is named too.
 * Only a field the plan cannot exist without (a rollout's template version, a
 * wave's rollout) drops the whole plan, and that is reported as well.
 */

/** The plan profile in canonical shape. */
export function canonicalPlan(plan: PlanProfile): Record<string, unknown> {
  if (plan.kind === 'wave') {
    return prune({ ...plan, window: plan.window && prune({ ...plan.window }) })
  }
  return prune({
    kind: plan.kind,
    templateVersion: plan.templateVersion,
    milestones: plan.milestones.map((milestone) => ({ ...milestone })),
    template: plan.template.map((change) => ({ ...change })),
    constraints: plan.constraints && canonicalConstraints(plan.constraints),
    archetypes: [...plan.archetypes].sort(byId).map((archetype) => prune({ ...archetype })),
    sites: [...plan.sites].sort(byLocation).map(canonicalSitePlan),
  })
}

function canonicalConstraints(constraints: RolloutConstraints): Record<string, unknown> {
  return prune({
    ...constraints,
    blackouts:
      constraints.blackouts && [...constraints.blackouts].sort(byId).map(canonicalBlackout),
  })
}

function canonicalBlackout(blackout: Blackout): Record<string, unknown> {
  return prune({ ...blackout })
}

export function canonicalSitePlan(site: SitePlan): Record<string, unknown> {
  // Empty notes and no notes are one model, so they write one file (ADR 0004).
  return prune({ ...site, notes: site.notes || undefined })
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** What a lenient read produced, and the parts it had to leave out. */
export interface PlanRead<T> {
  /** `undefined` when a part the plan cannot exist without was unreadable. */
  value: T | undefined
  /** Each part left out, named for a message: `milestones[2]`, `site "loc-9".rag`. */
  dropped: string[]
}

/** A plan profile, read part by part. */
export function readPlanProfile(raw: unknown): PlanRead<PlanProfile> {
  if (!isRecord(raw)) return { value: undefined, dropped: ['the plan, which is not an object'] }
  if (raw.kind === 'rollout') return readRolloutPlan(raw)
  if (raw.kind === 'wave') return readWavePlan(raw)
  return { value: undefined, dropped: [`kind ${JSON.stringify(raw.kind)}`] }
}

function readRolloutPlan(raw: Record<string, unknown>): PlanRead<RolloutPlan> {
  const dropped: string[] = []
  const templateVersion = raw.templateVersion
  if (!isPositiveInteger(templateVersion)) {
    return { value: undefined, dropped: [`templateVersion ${JSON.stringify(templateVersion)}`] }
  }
  const plan: RolloutPlan = {
    kind: 'rollout',
    templateVersion,
    milestones: readPlanList<Milestone>(raw.milestones, isMilestone, 'milestones', dropped),
    template: readPlanList<TemplateChange>(raw.template, isTemplateChange, 'template', dropped),
    archetypes: readPlanList<Archetype>(raw.archetypes, isArchetype, 'archetypes', dropped),
    sites: readSitePlans(raw.sites, dropped),
  }
  if (raw.constraints !== undefined) {
    const constraints = readConstraints(raw.constraints, dropped)
    if (constraints) plan.constraints = constraints
  }
  unknownKeys(
    raw,
    ['kind', 'templateVersion', 'milestones', 'template', 'constraints', 'archetypes', 'sites'],
    '',
    dropped,
  )
  return { value: plan, dropped }
}

function readWavePlan(raw: Record<string, unknown>): PlanRead<WavePlan> {
  const { rollout, label, order, templateVersion } = raw
  const missing = [
    typeof rollout === 'string' && rollout !== ''
      ? undefined
      : `rollout ${JSON.stringify(rollout)}`,
    typeof label === 'string' ? undefined : `label ${JSON.stringify(label)}`,
    Number.isSafeInteger(order) ? undefined : `order ${JSON.stringify(order)}`,
    isPositiveInteger(templateVersion)
      ? undefined
      : `templateVersion ${JSON.stringify(templateVersion)}`,
  ].filter((part): part is string => part !== undefined)
  if (missing.length) return { value: undefined, dropped: missing }

  const dropped: string[] = []
  const plan: WavePlan = {
    kind: 'wave',
    rollout: rollout as string,
    label: label as string,
    order: order as number,
    templateVersion: templateVersion as number,
  }
  if (raw.window !== undefined) {
    const window = readWindow(raw.window, dropped)
    if (window) plan.window = window
  }
  if (raw.capacity !== undefined) {
    if (isPositiveInteger(raw.capacity)) plan.capacity = raw.capacity
    else dropped.push(`capacity ${JSON.stringify(raw.capacity)}`)
  }
  unknownKeys(
    raw,
    ['kind', 'rollout', 'label', 'order', 'window', 'capacity', 'templateVersion'],
    '',
    dropped,
  )
  return { value: plan, dropped }
}

function readWindow(raw: unknown, dropped: string[]): WaveWindow | undefined {
  if (!isRecord(raw)) {
    dropped.push('window')
    return undefined
  }
  const window: WaveWindow = {}
  for (const end of ['start', 'end'] as const) {
    const value = raw[end]
    if (value === undefined) continue
    if (isPlanDate(value)) window[end] = value
    else dropped.push(`window.${end}`)
  }
  unknownKeys(raw, ['start', 'end'], 'window.', dropped)
  return Object.keys(window).length ? window : undefined
}

function readConstraints(raw: unknown, dropped: string[]): RolloutConstraints | undefined {
  if (!isRecord(raw)) {
    dropped.push('constraints')
    return undefined
  }
  const constraints: RolloutConstraints = {}
  const blackouts = readPlanList<Blackout>(
    raw.blackouts,
    isBlackout,
    'constraints.blackouts',
    dropped,
  )
  if (blackouts.length) constraints.blackouts = blackouts
  if (raw.defaultCapacity !== undefined) {
    if (isPositiveInteger(raw.defaultCapacity)) constraints.defaultCapacity = raw.defaultCapacity
    else dropped.push('constraints.defaultCapacity')
  }
  unknownKeys(raw, ['blackouts', 'defaultCapacity'], 'constraints.', dropped)
  return Object.keys(constraints).length ? constraints : undefined
}

/**
 * The items of a list that pass `guard`, each id once. An item is counted as
 * kept only once it is kept, so a repeat of an id already read is dropped and
 * named rather than replacing it (#106, #114).
 */
export function readPlanList<T extends { id: string }>(
  raw: unknown,
  guard: (value: unknown) => value is T,
  path: string,
  dropped: string[],
): T[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    dropped.push(path)
    return []
  }
  const out: T[] = []
  const seen = new Set<string>()
  for (const [index, item] of raw.entries()) {
    if (!guard(item)) dropped.push(`${path}[${index}]`)
    else if (seen.has(item.id)) dropped.push(`${path}[${index}], a second "${item.id}"`)
    else {
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

function readSitePlans(raw: unknown, dropped: string[]): SitePlan[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    dropped.push('sites')
    return []
  }
  const out: SitePlan[] = []
  const seen = new Set<string>()
  for (const [index, item] of raw.entries()) {
    // A repeat is dropped whole before it is read, so none of its fields is
    // named as if the plan that is kept had lost it.
    const location = isRecord(item) ? item.location : undefined
    if (typeof location === 'string' && seen.has(location)) {
      dropped.push(`sites[${index}], a second plan for "${location}"`)
      continue
    }
    const site = readSitePlan(item, `sites[${index}]`, dropped)
    if (!site) continue
    seen.add(site.location)
    out.push(site)
  }
  return out.sort(byLocation)
}

/** One site plan, field by field. Without a location it is not a plan of anything. */
export function readSitePlan(raw: unknown, path: string, dropped: string[]): SitePlan | undefined {
  if (!isRecord(raw) || typeof raw.location !== 'string' || raw.location === '') {
    dropped.push(path)
    return undefined
  }
  const site: SitePlan = { location: raw.location }
  const at = `site "${raw.location}"`
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'location':
        break
      case 'wave':
      case 'archetype':
        if (typeof value === 'string' && value !== '') site[key] = value
        else dropped.push(`${at}.${key}`)
        break
      case 'milestones': {
        const milestones = readRecord(value, isPlanDate, `${at}.milestones`, dropped)
        if (milestones) site.milestones = milestones
        break
      }
      case 'actuals': {
        const actuals = readRecord(value, isIsoDay, `${at}.actuals`, dropped)
        if (actuals) site.actuals = actuals
        break
      }
      case 'rag':
        if (isSiteRag(value)) site.rag = value
        else dropped.push(`${at}.rag`)
        break
      case 'notes':
        // Empty notes are no notes: one model, one spelling.
        if (typeof value === 'string') {
          if (value !== '') site.notes = value
        } else dropped.push(`${at}.notes`)
        break
      default:
        dropped.push(`${at}.${key}`)
    }
  }
  return site
}

function readRecord<T>(
  raw: unknown,
  guard: (value: unknown) => value is T,
  path: string,
  dropped: string[],
): Record<string, T> | undefined {
  if (!isRecord(raw)) {
    dropped.push(path)
    return undefined
  }
  const out: Record<string, T> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key !== '' && guard(value)) setKey(out, key, value)
    else dropped.push(`${path}.${key}`)
  }
  return Object.keys(out).length ? out : undefined
}

function unknownKeys(
  raw: Record<string, unknown>,
  known: readonly string[],
  prefix: string,
  dropped: string[],
): void {
  for (const key of Object.keys(raw)) if (!known.includes(key)) dropped.push(`${prefix}${key}`)
}

/**
 * A plan on an element in a canonical JSON file. A plan on anything but a Work
 * Package is reported and left out: ADR 0013 points 1 and 2 put plans on Work
 * Packages only.
 */
export function readElementPlan(
  raw: unknown,
  element: { id: string; type: string },
  problems: ImportProblem[],
  where: { file?: string },
): PlanProfile | undefined {
  const at = { ...where, subject: element.id }
  if (element.type !== PLAN_ELEMENT_TYPE) {
    problems.push(
      problem(
        'warning',
        'json.invalid-plan',
        `Element "${element.id}" is a ${element.type}, and only a Work Package carries a plan, so its plan was dropped.`,
        at,
      ),
    )
    return undefined
  }
  const { value, dropped } = readPlanProfile(raw)
  if (!value) {
    problems.push(
      problem(
        'warning',
        'json.invalid-plan',
        `Element "${element.id}" has a plan that could not be read (${listed(dropped)}), so it was dropped.`,
        at,
      ),
    )
    return undefined
  }
  if (dropped.length) problems.push(planPartsDropped(element.id, dropped, 'json.invalid-plan', at))
  return value
}

/** The problem for a plan read with parts left out; both readers word it the same way. */
export function planPartsDropped(
  subject: string,
  dropped: readonly string[],
  code: string,
  where: { file?: string; subject?: string },
): ImportProblem {
  return problem(
    'warning',
    code,
    `The plan of "${subject}" has ${dropped.length} part${dropped.length === 1 ? '' : 's'} that could not be read and ${dropped.length === 1 ? 'was' : 'were'} dropped: ${listed(dropped)}.`,
    where,
  )
}
