import {
  formatPlanDate,
  rolloutPlanOf,
  siteStatus,
  switchMilestone,
  wavePlanOf,
  wavesOf,
  type Element,
  type GoNoGo,
  type Milestone,
  type ResolvedMilestone,
  type RolloutPlan,
  type SitePhase,
  type SitePlan,
  type SiteRag,
  type WavePlan,
} from '@/model'
import type { MilestoneUsage, ModelStore } from '@/store'

/**
 * What the rollout screens show, derived from the model in one pass (#211).
 *
 * Nothing here is stored: counts, capacity and over-capacity, each site's
 * resolved milestone dates and its phase (#213) are worked out from the
 * rollout's site plans and its waves each time the model changes, at the time
 * point the caller gives.
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
  /** Every milestone of the set, with the date the site resolves and where it came from (#213). */
  milestones: ResolvedMilestone[]
  /** The milestone the site switches over at (`switchMilestone`), resolved. */
  cutover: ResolvedMilestone | undefined
  /** The derived phase at the time point; never stored. */
  phase: SitePhase
  /** A planned date whose period has passed with no actual date. */
  overdue: boolean
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
  /** The milestone a site switches over at, if the rollout has one (`switchMilestone`). */
  cutoverMilestone: Milestone | undefined
  /** The time point phases are derived at, in UTC ms. */
  at: number
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

/**
 * A site's phase on the lifecycle ramp (ADR 0013 point 9, under D7). Unplanned
 * is neutral ink: `--ink2`, because `--ink3` is the colour of `--lc-plan` in
 * the light theme, and the two must differ.
 */
export const SITE_PHASE_TOKENS: Record<SitePhase, string> = {
  unplanned: 'var(--ink2)',
  planned: 'var(--lc-plan)',
  preparing: 'var(--lc-in)',
  cutover: 'var(--lc-in)',
  hypercare: 'var(--lc-in)',
  migrated: 'var(--lc-act)',
  done: 'var(--lc-act)',
}

export function rolloutData(
  store: ModelStore,
  rolloutId: string,
  at: number,
): RolloutData | undefined {
  const rollout = store.element(rolloutId)
  const plan = rolloutPlanOf(rollout)
  if (!rollout || !plan) return undefined

  const cutoverMilestone = switchMilestone(plan.milestones)
  const archetypes = new Map(plan.archetypes.map((archetype) => [archetype.id, archetype.label]))
  const waveElements = wavesOf(store.elements(), rolloutId)
  const waveIds = new Set(waveElements.map((wave) => wave.id))

  const sites: SiteRow[] = plan.sites.map((site) => {
    const element = store.element(site.location)
    const code = element?.properties[SITE_CODE_KEY]
    const wave = assignedWave(site, waveIds)
    const status = siteStatus(
      plan,
      site,
      wave === undefined ? undefined : wavePlanOf(store.element(wave)),
      at,
    )
    return {
      location: site.location,
      element,
      code: typeof code === 'string' && code !== '' ? code : undefined,
      name: element?.name ?? 'Deleted Location',
      wave: assignedWave(site, waveIds),
      danglingWave: assignedWave(site, waveIds) === undefined ? site.wave : undefined,
      archetype: site.archetype === undefined ? undefined : archetypes.get(site.archetype),
      milestones: status.milestones,
      cutover: status.milestones.find((resolved) => resolved.milestone === cutoverMilestone),
      phase: status.phase,
      overdue: status.overdue,
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
    at,
  }
}

/**
 * Where a resolved date came from, in words: the long form a date's title
 * gives, beside the short `set` or `inherited` every date shows (#213).
 */
export function sourceText(
  resolved: ResolvedMilestone,
  waveLabel: string | undefined,
  milestones: readonly Milestone[],
): string {
  switch (resolved.source) {
    case 'site':
      return 'set at the site'
    case 'wave':
      return `inherited from wave ${waveLabel ?? ''}`.trimEnd()
    case 'rollout':
      return 'inherited from the rollout'
    case 'spaced': {
      const from = resolved.spacedFrom!
      const label =
        milestones.find((milestone) => milestone.id === from.milestone)?.label ?? from.milestone
      const days = Math.abs(from.days)
      return `inherited: ${days} day${days === 1 ? '' : 's'} ${from.days < 0 ? 'before' : 'after'} ${label}`
    }
    default:
      return 'not planned'
  }
}

/** A resolved date as it is shown: its period, and `set` or `inherited`. */
export function dateText(resolved: ResolvedMilestone | undefined): string {
  if (!resolved?.planned) return '—'
  return `${formatPlanDate(resolved.planned)} · ${resolved.source === 'site' ? 'set' : 'inherited'}`
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

/** A go/no-go decision in words (#215). */
export const GO_NO_GO_LABELS: Record<GoNoGo, string> = { go: 'Go', 'no-go': 'No-go' }

/**
 * The rollouts `locationId` is a site of, by name, each as its screens' data
 * at `at`: the site fact sheet's Migration tab shows one block per rollout (#215).
 */
export function siteRollouts(store: ModelStore, locationId: string, at: number): RolloutData[] {
  return rolloutsOf(store)
    .filter((rollout) => rolloutPlanOf(rollout)!.sites.some((site) => site.location === locationId))
    .map((rollout) => rolloutData(store, rollout.id, at)!)
}

/** Every rollout in the model, by name. */
export function rolloutsOf(store: ModelStore): Element[] {
  const rollouts: Element[] = []
  for (const element of store.elements()) if (rolloutPlanOf(element)) rollouts.push(element)
  return rollouts.sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** What deleting a milestone takes with it, in words, from `milestoneUsage`. */
export function usageText(usage: MilestoneUsage): string {
  const parts = [
    usage.sites && `${usage.sites} site${usage.sites === 1 ? '' : 's'}`,
    usage.waves && `${usage.waves} wave${usage.waves === 1 ? '' : 's'}`,
    usage.archetypes && `${usage.archetypes} archetype${usage.archetypes === 1 ? '' : 's'}`,
  ].filter((part): part is string => Boolean(part))
  if (!parts.length) return 'Nothing has a date or a duration for it.'
  const list =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  const verb = parts.length === 1 && list.startsWith('1 ') ? 'has' : 'have'
  return `${list} ${verb} dates or durations for it, which are deleted with it. Undo brings them back.`
}

/**
 * Why a milestone cannot be deleted, and what to do instead. The app has no
 * template editor yet (#214 validates template references, #60 brings change
 * sets), so the only place to re-anchor a template change is the model's
 * file: the sentence says so, rather than asking for something the app
 * cannot do (#229 review, finding 9; ADR 0016 point 8).
 */
export function blockedText(label: string, anchoredChanges: readonly string[]): string {
  const one = anchoredChanges.length === 1
  return `“${label}” cannot be deleted: the template ${one ? 'change' : 'changes'} ${anchoredChanges.join(', ')} ${one ? 'is' : 'are'} dated from it. The template can only be edited in the model’s file for now: date ${one ? 'it' : 'them'} from another milestone there, then delete this one.`
}
