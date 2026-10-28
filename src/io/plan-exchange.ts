import {
  PLAN_ELEMENT_TYPE,
  byLocation,
  formatPlanDate,
  parsePlanDate,
  rolloutPlanOf,
  wavePlanOf,
  type Element,
  type PlanProfile,
  type PropertyValue,
  type Relationship,
  type RolloutPlan,
  type SitePlan,
  type TemplateChange,
  type Workspace,
} from '@/model'
import { canonicalPlan, planPartsDropped, readPlanProfile, readSitePlan } from './canonical-plans'
import { sortKeys } from './canonical-json'
import { listed } from './exchange-xml'
import { problem, type ImportProblem } from './problems'
import { PROFILE_NAMESPACE } from './profile-properties'
import { setKey } from './records'

/**
 * Rollouts, waves and site plans in the exchange format (#209). ADR 0015
 * decides the mapping, amending ADR 0013 point 10: a wave's window travels as
 * two properties, and no Plateau is written for it.
 *
 * | Plan object | Written as |
 * |---|---|
 * | Rollout | its own Work Package, plan fields as `archipelago.plan.*` properties |
 * | Wave | its own Work Package, aggregated by the rollout (a model relationship) |
 * | Site plan | a Work Package of its own, aggregated by its wave and associated with its Location |
 *
 * A rollout's milestone set, template, constraints and archetypes have no
 * ArchiMate vocabulary, so each travels as canonical JSON in one property, as
 * the saved reports do (#36). Every other plan field is a property of its own,
 * readable in Archi's property sheet: a plan date in the form people write it
 * (`2027-Q2`, `2027-W19`), each milestone of a site under its own key
 * (`archipelago.plan.milestone.<id>`), and a site's notes as the Work
 * Package's documentation.
 *
 * Site plans are records, not elements (ADR 0013 point 3), so the Work Package
 * each one is written as, and its two relationships, exist only in the file.
 * Their identifiers are derived from the rollout's and the Location's, and
 * claimed like every other xs:ID, so the same model writes the same file.
 * They are never parsed (ADR 0015 point 3): do not add a parser for them.
 * The readers recognise them by `archipelago.plan.kind = site` and fold them
 * back into their rollout (`foldPlans`). Whatever a fold cannot put back, such
 * as a property added in Archi, a relationship drawn to one, or a renamed one,
 * is reported, never dropped quietly.
 */

const PLAN = `${PROFILE_NAMESPACE}.plan`

export const PLAN_KEYS = {
  kind: `${PLAN}.kind`,
  templateVersion: `${PLAN}.templateVersion`,
  milestones: `${PLAN}.milestones`,
  template: `${PLAN}.template`,
  constraints: `${PLAN}.constraints`,
  archetypes: `${PLAN}.archetypes`,
  rollout: `${PLAN}.rollout`,
  label: `${PLAN}.label`,
  order: `${PLAN}.order`,
  windowStart: `${PLAN}.windowStart`,
  windowEnd: `${PLAN}.windowEnd`,
  capacity: `${PLAN}.capacity`,
  location: `${PLAN}.location`,
  wave: `${PLAN}.wave`,
  archetype: `${PLAN}.archetype`,
  rag: `${PLAN}.rag`,
} as const

/** A site's planned date of milestone `<id>` is under this prefix, its actual date under the next. */
export const MILESTONE_KEY_PREFIX = `${PLAN}.milestone.`
export const ACTUAL_KEY_PREFIX = `${PLAN}.actual.`

const OWNED_KEYS = new Set<string>(Object.values(PLAN_KEYS))

/**
 * Is `key` one this module reads? Membership, and the two milestone families
 * by prefix: an `archipelago.plan.*` key this build does not know is somebody's
 * data and stays an ordinary property (#36).
 */
export function isPlanKey(key: string): boolean {
  return (
    OWNED_KEYS.has(key) ||
    milestoneOf(key, MILESTONE_KEY_PREFIX) !== undefined ||
    milestoneOf(key, ACTUAL_KEY_PREFIX) !== undefined
  )
}

function milestoneOf(key: string, prefix: string): string | undefined {
  return key.startsWith(prefix) && key.length > prefix.length ? key.slice(prefix.length) : undefined
}

/** The name a site plan's Work Package is written with. Derived, so never read back. */
export function sitePlanName(rolloutName: string, location: string): string {
  return `${rolloutName}: ${location}`
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** How the writer names what it writes: the exchange format's ids, which may be rewritten. */
export interface PlanIds {
  of: (id: string) => string
  knows: (id: string) => boolean
  claim: (base: string) => string
}

/** A rollout's or a wave's plan as properties. */
export function planToProperties(
  plan: PlanProfile | undefined,
  of: (id: string) => string,
): Record<string, string> {
  if (!plan) return {}
  const out: Record<string, string> = { [PLAN_KEYS.kind]: plan.kind }
  if (plan.kind === 'wave') {
    out[PLAN_KEYS.rollout] = of(plan.rollout)
    out[PLAN_KEYS.label] = plan.label
    out[PLAN_KEYS.order] = String(plan.order)
    if (plan.window?.start) out[PLAN_KEYS.windowStart] = formatPlanDate(plan.window.start)
    if (plan.window?.end) out[PLAN_KEYS.windowEnd] = formatPlanDate(plan.window.end)
    if (plan.capacity !== undefined) out[PLAN_KEYS.capacity] = String(plan.capacity)
    out[PLAN_KEYS.templateVersion] = String(plan.templateVersion)
    // The dates its sites inherit, under the site plans' own key family (ADR 0016).
    for (const id of Object.keys(plan.milestones ?? {}).sort()) {
      setKey(out, `${MILESTONE_KEY_PREFIX}${id}`, formatPlanDate(plan.milestones![id]!))
    }
    return out
  }
  out[PLAN_KEYS.templateVersion] = String(plan.templateVersion)
  // The template names elements, and the file may call them something else.
  // The site plans are written as Work Packages of their own, not here.
  const canonical = canonicalPlan({
    ...plan,
    template: plan.template.map((c) => renamed(c, of)),
    sites: [],
  })
  for (const part of ['milestones', 'template', 'constraints', 'archetypes'] as const) {
    if (canonical[part] !== undefined)
      out[PLAN_KEYS[part]] = JSON.stringify(canonical[part], sortKeys)
  }
  return out
}

function renamed(change: TemplateChange, of: (id: string) => string): TemplateChange {
  const out = { ...change, subject: of(change.subject) } as TemplateChange
  if (out.kind === 'replace') out.successor = of(out.successor)
  if (out.applicability.kind === 'aggregating') {
    out.applicability = { ...out.applicability, element: of(out.applicability.element) }
  }
  return out
}

/** A Work Package the writer adds for a site plan. */
export interface PlanElementOut {
  id: string
  name: string
  documentation?: string
  properties: Record<string, string>
}

/** One of the two relationships the writer adds for a site plan. */
export interface PlanRelationshipOut {
  id: string
  type: 'Aggregation' | 'Association'
  source: string
  target: string
}

/**
 * The Work Package and relationships each site plan is written as, in a fixed
 * order: rollouts as the model holds them, sites by location id. Every id is
 * already the file's.
 */
export function sitePlanExports(
  workspace: Workspace,
  ids: PlanIds,
  problems: ImportProblem[],
): { elements: PlanElementOut[]; relationships: PlanRelationshipOut[] } {
  const elementsById = new Map(workspace.elements.map((element) => [element.id, element]))
  const elements: PlanElementOut[] = []
  const relationships: PlanRelationshipOut[] = []

  for (const rollout of workspace.elements) {
    const plan = rolloutPlanOf(rollout)
    if (!plan) continue
    for (const site of [...plan.sites].sort(byLocation)) {
      const location = elementsById.get(site.location)
      const locationId = ids.of(site.location)
      const id = ids.claim(`${ids.of(rollout.id)}.site.${locationId}`)
      const out: PlanElementOut = {
        id,
        name: sitePlanName(rollout.name, location?.name ?? site.location),
        properties: siteProperties(site, rollout.id, ids.of),
      }
      if (site.notes) out.documentation = site.notes
      elements.push(out)

      const wave = site.wave === undefined ? undefined : elementsById.get(site.wave)
      const inWave = wavePlanOf(wave)?.rollout === rollout.id
      if (site.wave !== undefined && !inWave) {
        problems.push(
          problem(
            'warning',
            'exchange.plan-wave-missing',
            `The plan for "${site.location}" in rollout "${rollout.id}" names wave "${site.wave}", which is not a wave of that rollout. Its Work Package is aggregated by the rollout instead; the wave's id still travels in ${PLAN_KEYS.wave}.`,
            { subject: rollout.id },
          ),
        )
      }
      relationships.push({
        id: ids.claim(`${id}.in`),
        type: 'Aggregation',
        source: ids.of(inWave && site.wave !== undefined ? site.wave : rollout.id),
        target: id,
      })
      if (location) {
        relationships.push({
          id: ids.claim(`${id}.at`),
          type: 'Association',
          source: id,
          target: locationId,
        })
      } else {
        problems.push(
          problem(
            'warning',
            'exchange.plan-location-missing',
            `The plan for "${site.location}" in rollout "${rollout.id}" is for a Location that is not in the model, so its Work Package is associated with nothing. The plan, and the Location's id, still travel in its properties.`,
            { subject: rollout.id },
          ),
        )
      }
    }
  }
  return { elements, relationships }
}

/** A site plan's fields; `of` gives a reference in the file's spelling. */
function siteProperties(
  site: SitePlan,
  rolloutId: string,
  of: (id: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {
    [PLAN_KEYS.kind]: 'site',
    [PLAN_KEYS.rollout]: of(rolloutId),
    [PLAN_KEYS.location]: of(site.location),
  }
  if (site.wave !== undefined) out[PLAN_KEYS.wave] = of(site.wave)
  if (site.archetype !== undefined) out[PLAN_KEYS.archetype] = site.archetype
  if (site.rag !== undefined) out[PLAN_KEYS.rag] = site.rag
  for (const id of Object.keys(site.milestones ?? {}).sort()) {
    setKey(out, `${MILESTONE_KEY_PREFIX}${id}`, formatPlanDate(site.milestones![id]!))
  }
  for (const id of Object.keys(site.actuals ?? {}).sort()) {
    setKey(out, `${ACTUAL_KEY_PREFIX}${id}`, site.actuals![id]!)
  }
  return out
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** Where the fold reports to: the problem list and the file being read. */
export interface PlanSink {
  problems: ImportProblem[]
  where: { file?: string }
}

/** The model without its site plans' Work Packages, and what was folded away. */
export interface FoldResult {
  elements: Element[]
  relationships: Relationship[]
  /** Ids of the site plans' Work Packages, now records of their rollouts. */
  foldedElements: ReadonlySet<string>
  /** Ids of the relationships the writer had added for them. */
  foldedRelationships: ReadonlySet<string>
}

/**
 * Read the plan back out of a model a reader has just built from a file: a
 * rollout's and a wave's plan from their properties, and each site plan's Work
 * Package folded into its rollout as a record (ADR 0013, Consequences).
 *
 * Both readers call this before they read views and folders, so a view that
 * draws a folded Work Package reports the drawing it cannot keep.
 *
 * A plan key whose value cannot be read stays an ordinary property, as an
 * unreadable profile key does (#37). A site plan's Work Package that cannot be
 * folded (its rollout is not in the file, or the rollout already has a plan
 * for that Location) stays an ordinary Work Package. Each is reported.
 */
export function foldPlans(
  elements: readonly Element[],
  relationships: readonly Relationship[],
  sink: PlanSink,
): FoldResult {
  const out: Element[] = []
  const sites: Element[] = []
  for (const element of elements) {
    const owned = Object.keys(element.properties).filter(isPlanKey)
    if (!owned.length) {
      out.push(element)
      continue
    }
    const kind = element.properties[PLAN_KEYS.kind]
    if (
      element.type !== PLAN_ELEMENT_TYPE ||
      (kind !== 'rollout' && kind !== 'wave' && kind !== 'site')
    ) {
      warn(
        sink,
        'exchange.plan-unreadable',
        element.id,
        `"${element.id}" carries plan properties (${listed(owned)}), but ${element.type !== PLAN_ELEMENT_TYPE ? `its type is ${element.type}, and only a Work Package carries a plan` : `its ${PLAN_KEYS.kind} is ${kind === undefined ? 'missing' : `"${String(kind)}"`}`}, so they were kept as ordinary properties.`,
      )
      out.push(element)
      continue
    }
    if (kind === 'site') {
      sites.push(element)
      out.push(element)
      continue
    }
    out.push(readPlanElement(element, kind, sink))
  }

  const rollouts = new Map<string, Element & { plan: RolloutPlan }>()
  for (const element of out) {
    const plan = rolloutPlanOf(element)
    if (plan) rollouts.set(element.id, { ...element, plan })
  }
  const byId = new Map(out.map((element) => [element.id, element]))
  const foldedElements = new Map<string, { rollout: string; site: SitePlan }>()
  /** What was folded although the file filed it in a folder: a record has none. */
  const filed: string[] = []
  for (const element of sites) {
    const folded = foldSite(element, rollouts, byId, sink)
    if (!folded) continue
    foldedElements.set(element.id, folded)
    if (element.folder !== undefined) filed.push(element.id)
  }

  const foldedRelationships = new Set<string>()
  const lostRelationships: string[] = []
  const keptRelationships: Relationship[] = []
  for (const relationship of relationships) {
    const from = foldedElements.get(relationship.source)
    const to = foldedElements.get(relationship.target)
    if (!from && !to) {
      keptRelationships.push(relationship)
      continue
    }
    if (isWritersOwn(relationship, from, to)) {
      foldedRelationships.add(relationship.id)
      if (relationship.folder !== undefined) filed.push(relationship.id)
    } else lostRelationships.push(relationship.id)
  }
  if (lostRelationships.length) {
    warn(
      sink,
      'exchange.plan-relationship-dropped',
      undefined,
      `${lostRelationships.length} relationship${lostRelationships.length === 1 ? '' : 's'} (${listed(lostRelationships)}) ${lostRelationships.length === 1 ? 'touches' : 'touch'} the Work Package of a site plan. Site plans are records of their rollout, not elements, so ${lostRelationships.length === 1 ? 'it was' : 'they were'} dropped.`,
    )
  }
  // The native reader knows each folder by now; the exchange reader reports
  // its own once it has read the organizations, through the same function.
  reportFoldedFiling(filed, sink)

  return {
    elements: out
      .filter((element) => !foldedElements.has(element.id))
      .map((element) => {
        const rollout = rollouts.get(element.id)
        if (!rollout) return element
        return {
          ...rollout,
          plan: { ...rollout.plan, sites: [...rollout.plan.sites].sort(byLocation) },
        }
      }),
    relationships: keptRelationships,
    foldedElements: new Set(foldedElements.keys()),
    foldedRelationships,
  }
}

/** A rollout's or a wave's plan, read out of its properties. */
function readPlanElement(element: Element, kind: 'rollout' | 'wave', sink: PlanSink): Element {
  const properties = element.properties
  /** Keys whose value landed in `raw`; the rest stay properties. */
  const used = new Set<string>([PLAN_KEYS.kind])
  const unreadable: string[] = []
  const raw: Record<string, unknown> = { kind }
  /** Read `key` into `into[field]`, or note it unreadable. */
  const read = <T>(
    key: string,
    field: string,
    parse: (text: string) => T | undefined,
    into: Record<string, unknown> = raw,
  ) => {
    const value = textOf(properties[key])
    if (value === undefined) return
    const parsed = parse(value)
    if (parsed === undefined) unreadable.push(key)
    else {
      setKey(into, field, parsed)
      used.add(key)
    }
  }
  read(PLAN_KEYS.templateVersion, 'templateVersion', integer)
  if (kind === 'rollout') {
    read(PLAN_KEYS.milestones, 'milestones', json)
    read(PLAN_KEYS.template, 'template', json)
    read(PLAN_KEYS.constraints, 'constraints', json)
    read(PLAN_KEYS.archetypes, 'archetypes', json)
  } else {
    read(PLAN_KEYS.rollout, 'rollout', text)
    read(PLAN_KEYS.label, 'label', (value) => value)
    read(PLAN_KEYS.order, 'order', integer)
    read(PLAN_KEYS.capacity, 'capacity', integer)
    const window: Record<string, unknown> = {}
    read(PLAN_KEYS.windowStart, 'start', parsePlanDate, window)
    read(PLAN_KEYS.windowEnd, 'end', parsePlanDate, window)
    if (Object.keys(window).length) raw.window = window
    const milestones: Record<string, unknown> = {}
    for (const key of Object.keys(properties)) {
      const id = milestoneOf(key, MILESTONE_KEY_PREFIX)
      if (id !== undefined) read(key, id, parsePlanDate, milestones)
    }
    if (Object.keys(milestones).length) raw.milestones = milestones
  }
  // Keys of the right family on the wrong kind of plan: kept, and said.
  for (const key of Object.keys(properties)) {
    if (isPlanKey(key) && !used.has(key) && !unreadable.includes(key)) unreadable.push(key)
  }

  const { value: plan, dropped } = readPlanProfile(raw)
  if (!plan) {
    warn(
      sink,
      'exchange.plan-unreadable',
      element.id,
      `"${element.id}" is a ${kind}, but its plan could not be read (${listed([...unreadable, ...dropped])}), so its plan properties were kept as ordinary properties.`,
    )
    return element
  }
  if (unreadable.length) {
    warn(
      sink,
      'exchange.plan-unreadable',
      element.id,
      `"${element.id}" carries ${unreadable.length} plan propert${unreadable.length === 1 ? 'y' : 'ies'} (${listed(unreadable)}) whose value this build cannot read, so ${unreadable.length === 1 ? 'it was' : 'they were'} kept as ordinary properties rather than as plan fields.`,
    )
  }
  if (dropped.length) {
    sink.problems.push(
      planPartsDropped(element.id, dropped, 'exchange.plan-unreadable', {
        ...sink.where,
        subject: element.id,
      }),
    )
  }
  const kept: Record<string, PropertyValue> = {}
  for (const [key, value] of Object.entries(properties))
    if (!used.has(key)) setKey(kept, key, value)
  return { ...element, properties: kept, plan }
}

/**
 * Fold one site plan's Work Package into its rollout. `undefined` when it
 * cannot be, and then the Work Package stays, as it came in.
 */
function foldSite(
  element: Element,
  rollouts: Map<string, Element & { plan: RolloutPlan }>,
  byId: ReadonlyMap<string, Element>,
  sink: PlanSink,
): { rollout: string; site: SitePlan } | undefined {
  const properties = element.properties
  const rolloutId = textOf(properties[PLAN_KEYS.rollout])
  const locationId = textOf(properties[PLAN_KEYS.location])
  const rollout = rolloutId === undefined ? undefined : rollouts.get(rolloutId)
  const unfolded = (why: string) => {
    warn(
      sink,
      'exchange.plan-site-unfolded',
      element.id,
      `"${element.id}" is the Work Package of a site plan, but ${why}, so it was kept as an ordinary Work Package with its plan properties.`,
    )
    return undefined
  }
  if (!rollout) {
    return unfolded(
      `its rollout ${rolloutId === undefined ? 'is not named' : `"${rolloutId}" is not a rollout in this file`}`,
    )
  }
  if (locationId === undefined || locationId === '') return unfolded('it names no Location')
  if (rollout.plan.sites.some((site) => site.location === locationId)) {
    return unfolded(`rollout "${rollout.id}" already has a plan for "${locationId}"`)
  }

  const lost: string[] = []
  const raw: Record<string, unknown> = { location: locationId }
  const milestones: Record<string, unknown> = {}
  const actuals: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    const planned = milestoneOf(key, MILESTONE_KEY_PREFIX)
    const actual = milestoneOf(key, ACTUAL_KEY_PREFIX)
    // The text the writer wrote, even where a declared type read it as a number.
    const written = String(value)
    if (planned !== undefined) {
      const date = parsePlanDate(written)
      if (date) setKey(milestones, planned, date)
      else lost.push(`${key} = ${JSON.stringify(value)}`)
    } else if (actual !== undefined) setKey(actuals, actual, written)
    else if (key === PLAN_KEYS.wave || key === PLAN_KEYS.archetype || key === PLAN_KEYS.rag) {
      raw[key.slice(PLAN.length + 1)] = written
    } else if (key !== PLAN_KEYS.kind && key !== PLAN_KEYS.rollout && key !== PLAN_KEYS.location) {
      lost.push(`${key} = ${JSON.stringify(value)}`)
    }
  }
  if (Object.keys(milestones).length) raw.milestones = milestones
  if (Object.keys(actuals).length) raw.actuals = actuals
  if (element.documentation !== undefined) raw.notes = element.documentation

  const dropped: string[] = []
  // Never undefined here: it is only without a location, and the location was checked above.
  const site = readSitePlan(raw, element.id, dropped)!
  lost.push(...dropped)
  if (element.profile) lost.push(`its assessment (${Object.keys(element.profile).join(', ')})`)
  const location = byId.get(locationId)
  const name = sitePlanName(rollout.name, location?.name ?? locationId)
  if (element.name !== name) lost.push(`its name “${element.name}”, which is derived as “${name}”`)
  if (lost.length) {
    warn(
      sink,
      'exchange.plan-site-content-dropped',
      rollout.id,
      `The site plan for "${locationId}" in rollout "${rollout.id}" was read back from Work Package "${element.id}", which also carries what a site plan cannot hold, so it was dropped: ${listed(lost)}${lost.length > 3 ? ` (${lost.length} in all)` : ''}.`,
    )
  }
  rollout.plan.sites.push(site)
  return { rollout: rollout.id, site }
}

/**
 * Is this one of the two relationships the writer adds for a site plan, as it
 * wrote it? Anything else touching the Work Package (drawn in Archi, or with a
 * name or a property added) is reported when it is dropped. A folder is not
 * part of the relationship: one filed somewhere is folded, and the filing is
 * reported (`reportFoldedFiling`), as it is for the Work Package.
 */
function isWritersOwn(
  relationship: Relationship,
  from: { rollout: string; site: SitePlan } | undefined,
  to: { rollout: string; site: SitePlan } | undefined,
): boolean {
  const bare =
    relationship.name === undefined &&
    relationship.documentation === undefined &&
    relationship.profile === undefined &&
    !Object.keys(relationship.properties).length
  if (!bare || (from && to)) return false
  if (to) {
    return (
      relationship.type === 'Aggregation' &&
      (relationship.source === to.rollout || relationship.source === to.site.wave)
    )
  }
  return relationship.type === 'Association' && relationship.target === from!.site.location
}

/**
 * A site plan's Work Package, or one of its relationships, that the file filed
 * in a folder. The plan is a record of its rollout now, and a record has no
 * folder (ADR 0015 point 3), so the filing is said, not dropped quietly. Both
 * readers report it here, with one code and one severity.
 */
export function reportFoldedFiling(ids: readonly string[], sink: PlanSink): void {
  if (!ids.length) return
  warn(
    sink,
    'exchange.plan-folder-ignored',
    undefined,
    `${ids.length} site plan${ids.length === 1 ? '' : 's'}' Work Packages or relationships (${listed(ids)}) ${ids.length === 1 ? 'was' : 'were'} filed in a folder. Site plans are records of their rollout, so the folder was not kept.`,
  )
}

function warn(sink: PlanSink, code: string, subject: string | undefined, message: string): void {
  sink.problems.push(
    problem(
      'warning',
      code,
      message,
      subject === undefined ? sink.where : { ...sink.where, subject },
    ),
  )
}

/** An integer written as `String(n)` writes it, so it reads back to the same text. */
function integer(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && String(parsed) === value ? parsed : undefined
}

function text(value: string): string | undefined {
  return value === '' ? undefined : value
}

/**
 * A property's text. A carried `propertyTypes` entry can make the writer
 * declare a plan key `number` or `boolean`, and the reader then hands back a
 * number or a boolean; it only does so when the text survives, so `String`
 * gives back exactly what was written (ADR 0015 point 4).
 */
function textOf(value: PropertyValue | undefined): string | undefined {
  return value === undefined ? undefined : String(value)
}

function json(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}
