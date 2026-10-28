import {
  rolloutPlanOf,
  wavePlanOf,
  wavesOf,
  type Element,
  type Milestone,
  type PlanDate,
  type RolloutPlan,
  type SitePlan,
  type SiteRag,
  type WavePlan,
} from '@/model'
import type { ModelStore } from '@/store'

/**
 * What the rollout screens show, derived from the model in one pass (#211).
 *
 * Nothing here is stored: counts, capacity and over-capacity are worked out
 * from the rollout's site plans and its waves each time the model changes.
 * Site phases and inherited dates are #213's, so a cutover here is a site's
 * own override or nothing.
 */

/**
 * The property a Location's site code is kept in, until #70's custom fields
 * replace it (ADR 0013 point 8: interim site fields are `archipelago.site.*`).
 */
export const SITE_CODE_KEY = 'archipelago.site.code'

export interface SiteRow {
  /** The Location id: the site plan's key. */
  location: string
  /** The Location, or `undefined` when it was deleted and the plan kept. */
  element: Element | undefined
  code: string | undefined
  name: string
  /** A wave of this rollout, or `undefined` when unassigned. */
  wave: string | undefined
  /**
   * The wave the site plan names when the rollout has no such wave: shown as
   * unassigned, and a move to Unassigned clears it.
   */
  danglingWave: string | undefined
  archetype: string | undefined
  /** The site's own cutover date, when it sets one (inheritance is #213). */
  cutover: PlanDate | undefined
  rag: SiteRag | undefined
  /** The Location that aggregates this one, by name. */
  region: string | undefined
}

export interface WaveColumn {
  element: Element
  plan: WavePlan
  /** The wave's own capacity, or the rollout's default. */
  capacity: number | undefined
  sites: SiteRow[]
  /** More sites than capacity. */
  over: boolean
}

export interface RolloutData {
  rollout: Element
  plan: RolloutPlan
  waves: WaveColumn[]
  unassigned: SiteRow[]
  /** Every site, in display order. */
  sites: SiteRow[]
  /** Sites per region, most first; sites with no region last. */
  regions: { name: string; count: number }[]
  /** The milestone that starts the cutover phase, if the rollout has one. */
  cutoverMilestone: Milestone | undefined
}

export const NO_REGION = 'No region'

/**
 * A site's RAG on the lifecycle ramp (ADR 0013 point 9, under D7): the
 * register's swatch and the timeline's RAG view both colour through here.
 */
export const RAG_TOKENS: Record<SiteRag, string> = {
  green: 'var(--lc-act)',
  amber: 'var(--lc-out)',
  red: 'var(--lc-eol)',
}

export function rolloutData(store: ModelStore, rolloutId: string): RolloutData | undefined {
  const rollout = store.element(rolloutId)
  const plan = rolloutPlanOf(rollout)
  if (!rollout || !plan) return undefined

  const cutoverMilestone = plan.milestones.find((milestone) => milestone.startsPhase === 'cutover')
  const archetypes = new Map(plan.archetypes.map((archetype) => [archetype.id, archetype.label]))
  const waveElements = wavesOf(store.elements(), rolloutId)
  const waveIds = new Set(waveElements.map((wave) => wave.id))

  const sites: SiteRow[] = plan.sites.map((site) => {
    const element = store.element(site.location)
    const code = element?.properties[SITE_CODE_KEY]
    return {
      location: site.location,
      element,
      code: typeof code === 'string' && code !== '' ? code : undefined,
      name: element?.name ?? 'Deleted Location',
      wave: assignedWave(site, waveIds),
      danglingWave: assignedWave(site, waveIds) === undefined ? site.wave : undefined,
      archetype: site.archetype === undefined ? undefined : archetypes.get(site.archetype),
      cutover: cutoverMilestone ? site.milestones?.[cutoverMilestone.id] : undefined,
      rag: site.rag,
      region: element ? regionOf(store, element.id) : undefined,
    }
  })
  sites.sort(bySite)

  const defaultCapacity = plan.constraints?.defaultCapacity
  const waves: WaveColumn[] = waveElements.map((element) => {
    const wavePlan = wavePlanOf(element)!
    const inWave = sites.filter((site) => site.wave === element.id)
    const capacity = wavePlan.capacity ?? defaultCapacity
    return {
      element,
      plan: wavePlan,
      capacity,
      sites: inWave,
      over: capacity !== undefined && inWave.length > capacity,
    }
  })

  const regionCounts = new Map<string, number>()
  for (const site of sites) {
    const name = site.region ?? NO_REGION
    regionCounts.set(name, (regionCounts.get(name) ?? 0) + 1)
  }
  const regions = [...regionCounts]
    .map(([name, count]) => ({ name, count }))
    .sort(
      (a, b) =>
        Number(a.name === NO_REGION) - Number(b.name === NO_REGION) ||
        b.count - a.count ||
        a.name.localeCompare(b.name, 'en'),
    )

  return {
    rollout,
    plan,
    waves,
    unassigned: sites.filter((site) => site.wave === undefined),
    sites,
    regions,
    cutoverMilestone,
  }
}

/**
 * The wave a site is in, as every rollout screen counts it: a wave the
 * rollout does not have is reported by validate(), and the screens show the
 * site where it can be moved from, which is unassigned. The home and the
 * `/rollouts` list both count through here, so they cannot disagree (#223).
 */
export function assignedWave(site: SitePlan, waveIds: ReadonlySet<string>): string | undefined {
  return site.wave !== undefined && waveIds.has(site.wave) ? site.wave : undefined
}

/** The Location that aggregates or composes `locationId`: its region, country or campus. */
function regionOf(store: ModelStore, locationId: string): string | undefined {
  const names = store
    .incoming(locationId)
    .filter(
      (relationship) => relationship.type === 'Aggregation' || relationship.type === 'Composition',
    )
    .map((relationship) => store.element(relationship.source))
    .filter((source): source is Element => source?.type === 'Location')
    .map((source) => source.name)
    .sort((a, b) => a.localeCompare(b, 'en'))
  return names[0]
}

/** By code, then name, then id: a site without a code sorts after those with one. */
function bySite(a: SiteRow, b: SiteRow): number {
  if (a.code !== undefined && b.code !== undefined) {
    const byCode = a.code.localeCompare(b.code, 'en', { numeric: true })
    if (byCode) return byCode
  } else if (a.code !== b.code) {
    return a.code === undefined ? 1 : -1
  }
  return (
    a.name.localeCompare(b.name, 'en') ||
    (a.location < b.location ? -1 : a.location > b.location ? 1 : 0)
  )
}

/**
 * How a wave is headed: its label, which is a code and set in mono, or its
 * name when the label is empty, which is human-authored and is not (#223).
 */
export function waveHeading(wave: { element: Element; plan: WavePlan }): {
  text: string
  code: boolean
} {
  return wave.plan.label
    ? { text: wave.plan.label, code: true }
    : { text: wave.element.name, code: false }
}

/** Every rollout in the model, by name. */
export function rolloutsOf(store: ModelStore): Element[] {
  const rollouts: Element[] = []
  for (const element of store.elements()) if (rolloutPlanOf(element)) rollouts.push(element)
  return rollouts.sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}
