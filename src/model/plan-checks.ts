import {
  addDays,
  dayAfterPeriod,
  dayStart,
  formatPlanDate,
  rolloutPlanOf,
  wavePlanOf,
  wavesOf,
  type Applicability,
  type Blackout,
  type Milestone,
  type RolloutPlan,
  type SitePlan,
  type TemplateChange,
  type WavePlan,
} from './plan'
import { ROLLOUT_PRESETS, isResidencyClass, type PresetChecks } from './presets'
import {
  reachedAt,
  phaseInputs,
  siteStatus,
  switchMilestone,
  type ResolvedMilestone,
} from './site-phase'
import type { Finding, FindingSeverity } from './validate'
import type { Element, Relationship } from './workspace'

/**
 * A rollout's plan checks (#214, proposal §6 item 8 and §4.8), in the
 * validator's style: each is a `Finding` against the site, wave, rollout or
 * store it concerns. They judge a plan at a time point; they never refuse one
 * (ADR 0014 §6: conflicts are computed, never prevented). Integrity findings,
 * a plan pointing at something that is not there, are `validate()`'s
 * (`validate-plans.ts`), and the checks take those references as they are.
 *
 * ## What a check compares
 *
 * - **An order** ("before", "after") compares the days the phase is derived
 *   from (`reachedAt`): an actual day, which takes precedence; else a spaced
 *   date's exact day; else the first day of the planned period. So a check
 *   never says one milestone comes first where the phase says the other does.
 *   "Before" is strict: the same day is not before.
 * - **An overlap** with a blackout compares the period a date is shown at, or
 *   its actual day: a cutover planned for `2027-W13` is in a blackout that
 *   touches any day of that week. A coarse date that may fall in a blackout
 *   is reported, so the planner details it; both ends of a blackout count.
 *
 * ## Missing input
 *
 * No check is silent on input it needs and does not have. It says, as an
 * `advice`, what it could not check and why: a site in a wave with no cutover
 * date (`rollout.site-undated`), a wave with no capacity
 * (`rollout.wave-capacity-unset`), a migration target no Location aggregates
 * (`rollout.residency-unchecked`). A violation is a `warning`.
 *
 * ## The preset's checks
 *
 * A rollout made from a preset (`RolloutPlan.preset`) also runs the checks
 * that preset adds (`PresetChecks`): for data migration, mock loads, the
 * freeze, reconciliation and residency (proposal §4.8). Each reads the
 * milestones it needs by id; one the set no longer has is reported once, for
 * the rollout (`rollout.preset-milestone-missing`), and the check then runs on
 * what is left.
 */

/** What the checks read: a snapshot's elements and relationships. */
export interface PlanCheckModel {
  readonly elements: readonly Element[]
  readonly relationships: readonly Relationship[]
}

/** The plan checks of `rolloutId` at `at` (UTC ms), in a fixed order; `[]` for no such rollout. */
export function planChecks(model: PlanCheckModel, rolloutId: string, at: number): Finding[] {
  const elementsById = new Map(model.elements.map((element) => [element.id, element]))
  const rollout = elementsById.get(rolloutId)
  const plan = rolloutPlanOf(rollout)
  if (!rollout || !plan) return []
  const context = buildContext(model, elementsById, rollout, plan, at)
  const out: Finding[] = []
  unassignedSites(context, out)
  waveCapacity(context, out)
  undatedSites(context, out)
  cutoversInBlackouts(context, out)
  dependencyOrder(context, out)
  expiredExceptions(context, out)
  coarseNextWave(context, out)
  unappliedChanges(context, out)
  baselineLacksRetired(context, out)
  const checks = plan.preset === undefined ? {} : ROLLOUT_PRESETS[plan.preset].checks
  presetMilestonesMissing(context, checks, out)
  if (checks.mockLoads) mockLoads(context, checks.mockLoads, out)
  if (checks.freeze) freezeInBlackouts(context, checks.freeze, out)
  if (checks.reconciliation) reconciliation(context, checks.reconciliation, out)
  if (checks.residency) residency(context, checks.residency.field, out)
  return out
}

// ── What every check reads ───────────────────────────────────────────────────

interface Site {
  plan: SitePlan
  element: Element | undefined
  /** Its name, or its Location id when the Location is gone. */
  name: string
  /** Its wave, when it is in a wave of this rollout. */
  wave: { element: Element; plan: WavePlan } | undefined
  milestones: ResolvedMilestone[]
  /** Its resolved cutover (`switchMilestone`), when the set has one. */
  cutover: ResolvedMilestone | undefined
  phase: ReturnType<typeof siteStatus>['phase']
}

interface Context {
  rollout: Element
  plan: RolloutPlan
  elementsById: ReadonlyMap<string, Element>
  sites: Site[]
  sitesById: ReadonlyMap<string, Site>
  waves: { element: Element; plan: WavePlan }[]
  cutoverMilestone: Milestone | undefined
  /** Is `element` the target of an Aggregation from `location`? */
  aggregates: (location: string, element: string) => boolean
  /** The Locations that aggregate `id`, by id. */
  locationsAggregating: (id: string) => string[]
  at: number
}

function buildContext(
  model: PlanCheckModel,
  elementsById: ReadonlyMap<string, Element>,
  rollout: Element,
  plan: RolloutPlan,
  at: number,
): Context {
  const aggregatedBy = new Map<string, string[]>()
  for (const relationship of model.relationships) {
    if (relationship.type !== 'Aggregation') continue
    const sources = aggregatedBy.get(relationship.target)
    if (sources) sources.push(relationship.source)
    else aggregatedBy.set(relationship.target, [relationship.source])
  }
  const waves = wavesOf(model.elements, rollout.id).map((element) => ({
    element,
    plan: wavePlanOf(element)!,
  }))
  const waveById = new Map(waves.map((wave) => [wave.element.id, wave]))
  const cutoverMilestone = switchMilestone(plan.milestones)
  const sites = plan.sites.map((sitePlan): Site => {
    const element = elementsById.get(sitePlan.location)
    const wave = sitePlan.wave === undefined ? undefined : waveById.get(sitePlan.wave)
    const status = siteStatus(plan, sitePlan, wave?.plan, at)
    return {
      plan: sitePlan,
      element,
      name: element?.name ?? sitePlan.location,
      wave,
      milestones: status.milestones,
      cutover: status.milestones.find((resolved) => resolved.milestone === cutoverMilestone),
      phase: status.phase,
    }
  })
  return {
    rollout,
    plan,
    elementsById,
    sites,
    sitesById: new Map(sites.map((site) => [site.plan.location, site])),
    waves,
    cutoverMilestone,
    aggregates: (location, element) => (aggregatedBy.get(element) ?? []).includes(location),
    locationsAggregating: (id) =>
      (aggregatedBy.get(id) ?? []).filter(
        (source) => elementsById.get(source)?.type === 'Location',
      ),
    at,
  }
}

function finding(
  severity: FindingSeverity,
  code: string,
  message: string,
  subjectId: string,
): Finding {
  return { severity, code, message, subjectId, subjectKind: 'element' }
}

/** A site in a wave, with a cutover that resolves to a date: what the date checks judge. */
function datedSites(context: Context): (Site & { cutover: ResolvedMilestone })[] {
  return context.sites.filter(
    (site): site is Site & { cutover: ResolvedMilestone } =>
      site.wave !== undefined && site.cutover !== undefined && isDated(site.cutover),
  )
}

function isDated(resolved: ResolvedMilestone): boolean {
  return resolved.actual !== undefined || resolved.planned !== undefined
}

/** The day a milestone counts as reached, as the phase counts it (`reachedAt`); dated input only. */
function reachedDay(resolved: ResolvedMilestone): number {
  return reachedAt(phaseInputs([resolved])[0]!)!
}

/** The days a dated milestone may fall on, both ends inclusive: its actual day, else its shown period. */
function spanOf(resolved: ResolvedMilestone): { first: string; last: string } {
  if (resolved.actual !== undefined) return { first: resolved.actual, last: resolved.actual }
  const planned = resolved.planned!
  return { first: planned.date, last: addDays(dayAfterPeriod(planned), -1) }
}

/** A dated milestone as it is shown: its actual day, or its planned period. */
function shown(resolved: ResolvedMilestone): string {
  return resolved.actual !== undefined
    ? `${resolved.actual} (actual)`
    : formatPlanDate(resolved.planned!)
}

/** The blackouts that hold for a site: the rollout's and its own. */
function blackoutsOf(context: Context, site: Site): Blackout[] {
  return [...(context.plan.constraints?.blackouts ?? []), ...(site.plan.blackouts ?? [])]
}

/** Both ends inclusive, as a blackout's are. */
function overlaps(span: { first: string; last: string }, blackout: Blackout): boolean {
  return span.first <= blackout.end && span.last >= blackout.start
}

function blackoutNames(blackouts: readonly Blackout[]): string {
  return blackouts
    .map((blackout) => `${blackout.label ?? blackout.id} (${blackout.start} to ${blackout.end})`)
    .join(', ')
}

function waveName(wave: { element: Element; plan: WavePlan }): string {
  return wave.plan.label || wave.element.name
}

// ── The checks of every rollout (proposal §6 item 8) ─────────────────────────

/** A site in no wave: none, or one the rollout does not have. */
function unassignedSites(context: Context, out: Finding[]): void {
  for (const site of context.sites) {
    if (site.wave !== undefined) continue
    out.push(
      finding(
        'warning',
        'rollout.site-unassigned',
        `Site “${site.name}” is in no wave.`,
        site.plan.location,
      ),
    )
  }
}

/** A wave with more sites than its capacity, its own or else the rollout's default. */
function waveCapacity(context: Context, out: Finding[]): void {
  const defaultCapacity = context.plan.constraints?.defaultCapacity
  for (const wave of context.waves) {
    const capacity = wave.plan.capacity ?? defaultCapacity
    const count = context.sites.filter((site) => site.wave === wave).length
    if (capacity === undefined) {
      out.push(
        finding(
          'advice',
          'rollout.wave-capacity-unset',
          `Wave “${waveName(wave)}” has no capacity, and the rollout no default capacity, so it is not checked for being over capacity.`,
          wave.element.id,
        ),
      )
    } else if (count > capacity) {
      out.push(
        finding(
          'warning',
          'rollout.wave-over-capacity',
          `Wave “${waveName(wave)}” has ${count} sites, ${count - capacity} over its capacity of ${capacity}.`,
          wave.element.id,
        ),
      )
    }
  }
}

/** A site in a wave whose cutover resolves to no date: the date checks cannot judge it. */
function undatedSites(context: Context, out: Finding[]): void {
  const milestone = context.cutoverMilestone
  if (!milestone) {
    if (context.sites.some((site) => site.wave !== undefined)) {
      out.push(
        finding(
          'advice',
          'rollout.site-undated',
          `The milestone set has no milestone that starts Cutover or Hypercare, so no site has a cutover, and none is checked for blackouts, dependency order or the precision of the next wave.`,
          context.rollout.id,
        ),
      )
    }
    return
  }
  for (const site of context.sites) {
    if (site.wave === undefined || isDated(site.cutover!)) continue
    out.push(
      finding(
        'advice',
        'rollout.site-undated',
        `Site “${site.name}” has no ${milestone.label} date, set or inherited, so it is not checked for blackouts, dependency order or the precision of the next wave${context.plan.preset === undefined ? '' : ', nor by its preset’s checks'}.`,
        site.plan.location,
      ),
    )
  }
}

/** A cutover whose day, or shown period, touches a blackout of the rollout or the site. */
function cutoversInBlackouts(context: Context, out: Finding[]): void {
  for (const site of datedSites(context)) {
    const span = spanOf(site.cutover)
    const hit = blackoutsOf(context, site).filter((blackout) => overlaps(span, blackout))
    if (!hit.length) continue
    out.push(
      finding(
        'warning',
        'rollout.cutover-in-blackout',
        `Site “${site.name}” cuts over ${shown(site.cutover)}, in ${hit.length === 1 ? 'a blackout' : 'blackouts'}: ${blackoutNames(hit)}.`,
        site.plan.location,
      ),
    )
  }
}

/** A site that cuts over on or before the day a site it depends on does. */
function dependencyOrder(context: Context, out: Finding[]): void {
  for (const site of datedSites(context)) {
    for (const id of site.plan.dependsOn ?? []) {
      const other = context.sitesById.get(id)
      // Not a site of the rollout, or the site itself: validate() reports both.
      if (!other || other === site) continue
      if (other.wave === undefined || other.cutover === undefined || !isDated(other.cutover)) {
        out.push(
          finding(
            'advice',
            'rollout.dependency-unchecked',
            `Site “${site.name}” depends on “${other.name}”, which ${other.wave === undefined ? 'is in no wave' : 'has no cutover date'}, so the order of the two is not checked.`,
            site.plan.location,
          ),
        )
        continue
      }
      if (reachedDay(site.cutover) > reachedDay(other.cutover)) continue
      out.push(
        finding(
          'warning',
          'rollout.dependency-order',
          `Site “${site.name}” depends on “${other.name}”, but cuts over ${shown(site.cutover)}, not after “${other.name}” (${shown(other.cutover)}).`,
          site.plan.location,
        ),
      )
    }
  }
}

/**
 * An exception past its last day at the time point, whatever its class. A
 * `legal` or `operational` exception may be open-ended: it holds until the
 * law or the operation changes. A `preference` with no expiry is said, as it
 * is rejected by default and is never found expired (sponsor, 2026-10-29).
 */
function expiredExceptions(context: Context, out: Finding[]): void {
  for (const site of context.sites) {
    for (const exception of site.plan.exceptions ?? []) {
      const what = `Exception "${exception.id}" of site “${site.name}” (${exception.class}${exception.owner ? `, owned by ${exception.owner}` : ''})`
      if (exception.expires === undefined) {
        if (exception.class !== 'preference') continue
        out.push(
          finding(
            'advice',
            'rollout.exception-no-expiry',
            `${what} is a preference with no expiry, so it is never found expired.`,
            site.plan.location,
          ),
        )
      } else if (dayStart(addDays(exception.expires, 1)) <= context.at) {
        out.push(
          finding(
            'warning',
            'rollout.exception-expired',
            `${what} held until ${exception.expires}, and has expired.`,
            site.plan.location,
          ),
        )
      }
    }
  }
}

/**
 * The waves that must be planned in detail (proposal §5: "detail only the
 * next wave"): every wave, in order, up to and including the next, which is
 * the first with sites, all of which are still Planned at the time point. A
 * wave under way is detailed too, so a site of it still dated only to the
 * quarter is reported, not skipped because a sibling has started (sponsor,
 * 2026-10-29). With no such wave, every wave is under way.
 */
function coarseNextWave(context: Context, out: Finding[]): void {
  const next = context.waves.findIndex((wave) => {
    const sites = context.sites.filter((site) => site.wave === wave)
    return sites.length > 0 && sites.every((site) => site.phase === 'planned')
  })
  const detailed = next === -1 ? context.waves : context.waves.slice(0, next + 1)
  for (const site of datedSites(context)) {
    if (!detailed.includes(site.wave!) || site.cutover.actual !== undefined) continue
    if (site.cutover.planned!.precision !== 'quarter') continue
    const which = site.wave === context.waves[next] ? 'the next wave' : 'a wave under way'
    out.push(
      finding(
        'warning',
        'rollout.next-wave-coarse',
        `Site “${site.name}” is in ${waveName(site.wave!)}, ${which}, and its ${site.cutover.milestone.label} is still dated only to the quarter (${shown(site.cutover)}).`,
        site.plan.location,
      ),
    )
  }
}

/** Does `change`'s applicability rule pick `site`? One case per kind of rule (ADR 0013 point 4). */
export function appliesTo(
  applicability: Applicability,
  site: SitePlan,
  aggregates: (location: string, element: string) => boolean,
): boolean {
  switch (applicability.kind) {
    case 'all':
      return true
    case 'archetypes':
      return site.archetype !== undefined && applicability.archetypes.includes(site.archetype)
    case 'aggregating':
      return aggregates(site.location, applicability.element)
  }
}

/** Does the site skip the template change with this id? */
function skips(site: SitePlan, changeId: string): boolean {
  return (site.exceptions ?? []).some(
    (exception) => exception.kind === 'skip' && exception.change === changeId,
  )
}

/** The sites a template change is made at: those it applies to that do not skip it. */
function sitesMaking(context: Context, change: TemplateChange): Site[] {
  return context.sites.filter(
    (site) =>
      appliesTo(change.applicability, site.plan, context.aggregates) &&
      !skips(site.plan, change.id),
  )
}

/** A template change made at no site: none matches its rule, or every one that does skips it. */
function unappliedChanges(context: Context, out: Finding[]): void {
  for (const change of context.plan.template) {
    if (sitesMaking(context, change).length) continue
    const matched = context.sites.filter((site) =>
      appliesTo(change.applicability, site.plan, context.aggregates),
    ).length
    out.push(
      finding(
        'warning',
        'rollout.change-applies-to-no-site',
        `Template change "${change.id}" is made at no site: ${matched ? `the ${matched === 1 ? 'one site' : `${matched} sites`} it applies to ${matched === 1 ? 'skips' : 'skip'} it` : 'no site matches its applicability'}.`,
        context.rollout.id,
      ),
    )
  }
}

/** A site a `retire` or `replace` is made at, whose Location does not aggregate what it retires. */
function baselineLacksRetired(context: Context, out: Finding[]): void {
  for (const change of context.plan.template) {
    switch (change.kind) {
      case 'retire':
      case 'replace':
        break
      default:
        continue
    }
    const subject = context.elementsById.get(change.subject)
    // A subject that is not in the model is validate()'s to report.
    if (!subject) continue
    for (const site of sitesMaking(context, change)) {
      // A site whose Location is gone is validate()'s too.
      if (!site.element || context.aggregates(site.plan.location, change.subject)) continue
      out.push(
        finding(
          'warning',
          'rollout.baseline-lacks-retired',
          `Site “${site.name}” does not aggregate “${subject.name || subject.id}”, which template change "${change.id}" ${change.kind === 'retire' ? 'retires' : 'replaces'} there.`,
          site.plan.location,
        ),
      )
    }
  }
}

// ── The checks a preset adds (proposal §4.8) ─────────────────────────────────

/** A milestone a preset's check reads that the rollout's set no longer has. */
function presetMilestonesMissing(context: Context, checks: PresetChecks, out: Finding[]): void {
  const have = new Set(context.plan.milestones.map((milestone) => milestone.id))
  const needs: [string, string[]][] = [
    ['mock loads', [...(checks.mockLoads ?? [])]],
    ['freeze', checks.freeze ? [checks.freeze.start, checks.freeze.end] : []],
    [
      'reconciliation',
      checks.reconciliation ? [checks.reconciliation.signedOff, checks.reconciliation.before] : [],
    ],
  ]
  for (const [check, ids] of needs) {
    const missing = ids.filter((id) => !have.has(id))
    if (!missing.length) continue
    out.push(
      finding(
        'warning',
        'rollout.preset-milestone-missing',
        `The preset’s ${check} check reads ${missing.map((id) => `"${id}"`).join(', ')}, which the milestone set no longer has${check === 'mock loads' ? ', so every site has fewer mock loads than the preset requires' : ', so no site is checked for it'}.`,
        context.rollout.id,
      ),
    )
  }
}

function resolvedOf(site: Site, id: string): ResolvedMilestone | undefined {
  return site.milestones.find((resolved) => resolved.milestone.id === id)
}

/** A site with a mock load of the preset's not reached before its cutover. */
function mockLoads(context: Context, ids: readonly string[], out: Finding[]): void {
  for (const site of datedSites(context)) {
    const cutover = reachedDay(site.cutover)
    // A mock load the set no longer has is said once, for the rollout: this
    // counts the ones it has.
    const present = ids
      .map((id) => resolvedOf(site, id))
      .filter((resolved): resolved is ResolvedMilestone => resolved !== undefined)
    const late = present.filter((resolved) => !isDated(resolved) || reachedDay(resolved) >= cutover)
    if (!late.length) continue
    const of =
      present.length === ids.length
        ? `${ids.length} mock loads its preset requires`
        : `${present.length} mock load${present.length === 1 ? '' : 's'} the milestone set still has`
    out.push(
      finding(
        'warning',
        'rollout.mock-loads',
        `Site “${site.name}” has ${present.length - late.length} of the ${of} before its ${site.cutover.milestone.label} (${shown(site.cutover)}): ${late.map((resolved) => `${resolved.milestone.label} ${isDated(resolved) ? `is ${shown(resolved)}` : 'has no date'}`).join('; ')}.`,
        site.plan.location,
      ),
    )
  }
}

/** A freeze, from its start's first day to its end's last, that touches a blackout. */
function freezeInBlackouts(
  context: Context,
  freeze: { start: string; end: string },
  out: Finding[],
): void {
  for (const site of datedSites(context)) {
    const start = resolvedOf(site, freeze.start)
    const end = resolvedOf(site, freeze.end)
    // A milestone the set lacks is reported once, for the rollout.
    if (!start || !end) continue
    if (!isDated(start) || !isDated(end)) {
      out.push(
        finding(
          'advice',
          'rollout.freeze-unchecked',
          `Site “${site.name}” has no date for ${[start, end]
            .filter((resolved) => !isDated(resolved))
            .map((resolved) => resolved.milestone.label)
            .join(' or ')}, so its freeze is not checked against blackouts.`,
          site.plan.location,
        ),
      )
      continue
    }
    if (reachedDay(end) < reachedDay(start)) {
      out.push(
        finding(
          'advice',
          'rollout.freeze-unchecked',
          `The freeze of site “${site.name}” ends ${shown(end)} (${end.milestone.label}), before it starts ${shown(start)} (${start.milestone.label}), so it is not checked against blackouts.`,
          site.plan.location,
        ),
      )
      continue
    }
    const span = { first: spanOf(start).first, last: spanOf(end).last }
    const hit = blackoutsOf(context, site).filter((blackout) => overlaps(span, blackout))
    if (!hit.length) continue
    out.push(
      finding(
        'warning',
        'rollout.freeze-in-blackout',
        `Site “${site.name}” is frozen from ${shown(start)} to ${shown(end)}, which touches ${hit.length === 1 ? 'a blackout' : 'blackouts'}: ${blackoutNames(hit)}.`,
        site.plan.location,
      ),
    )
  }
}

/** A site whose reconciliation is not reached before its hypercare ends. */
function reconciliation(
  context: Context,
  check: { signedOff: string; before: string },
  out: Finding[],
): void {
  for (const site of datedSites(context)) {
    const signedOff = resolvedOf(site, check.signedOff)
    const before = resolvedOf(site, check.before)
    if (!signedOff || !before) continue
    if (!isDated(signedOff) || !isDated(before)) {
      out.push(
        finding(
          'advice',
          'rollout.reconciliation-unchecked',
          `Site “${site.name}” has no date for ${[signedOff, before]
            .filter((resolved) => !isDated(resolved))
            .map((resolved) => resolved.milestone.label)
            .join(' or ')}, so whether its reconciliation is signed off in time is not checked.`,
          site.plan.location,
        ),
      )
      continue
    }
    if (reachedDay(signedOff) < reachedDay(before)) continue
    out.push(
      finding(
        'warning',
        'rollout.reconciliation-late',
        `Site “${site.name}” signs reconciliation off ${shown(signedOff)}, not before ${before.milestone.label} (${shown(before)}).`,
        site.plan.location,
      ),
    )
  }
}

/**
 * A site whose data must stay in its country or region, migrated to a store
 * whose Location lies outside it. The region hierarchy is the Locations'
 * aggregation, as proposal §4.1 draws it (Region ◇— Country ◇— Site): a
 * site's country is a Location that aggregates it, its region one that
 * aggregates that. Its data moves to the successor of each `replace` made at
 * the site, the template's and its own (`add` exceptions). A store is inside
 * an area when a Location that aggregates it is the area or lies within it,
 * and every such Location must be.
 */
function residency(context: Context, field: string, out: Finding[]): void {
  const unclassed: string[] = []
  /** Restricted sites moving data to a store no Location aggregates: names by Location id, by store. */
  const unlocated = new Map<string, Map<string, string>>()
  for (const site of context.sites) {
    if (!site.element) continue
    const value = site.element.properties[field]
    if (value === undefined) {
      unclassed.push(site.name)
      continue
    }
    if (!isResidencyClass(value)) {
      out.push(
        finding(
          'advice',
          'rollout.residency-unchecked',
          `Site “${site.name}” has the residency class ${JSON.stringify(value)}, which is not none, region or country, so where its data may go is not checked.`,
          site.plan.location,
        ),
      )
      continue
    }
    if (value === 'none') continue
    const depth = value === 'country' ? 1 : 2
    const areas = ancestorsAt(context, site.plan.location, depth)
    if (!areas.length) {
      out.push(
        finding(
          'advice',
          'rollout.residency-unchecked',
          `Site “${site.name}” keeps its data in its ${value}, but no Location aggregates it ${depth === 1 ? '' : 'two levels up '}to say which ${value} that is, so where its data goes is not checked.`,
          site.plan.location,
        ),
      )
      continue
    }
    // One finding per site, naming every move that leaves the area: a site
    // with two local stores moving to one lake is one problem, not two.
    const moves: string[] = []
    for (const target of targetsOf(context, site)) {
      const locations = context.locationsAggregating(target.store)
      if (!locations.length) {
        const sites = unlocated.get(target.store) ?? new Map<string, string>()
        sites.set(site.plan.location, site.name)
        unlocated.set(target.store, sites)
        continue
      }
      const outside = locations.filter((location) => !isWithin(context, location, areas))
      if (!outside.length) continue
      moves.push(
        `${target.by} moves it to “${nameOf(context, target.store)}”, at ${outside.map((id) => `“${nameOf(context, id)}”`).join(', ')}`,
      )
    }
    if (moves.length) {
      out.push(
        finding(
          'warning',
          'rollout.residency',
          `Site “${site.name}” keeps its data in its ${value} (${areas.map((id) => nameOf(context, id)).join(', ')}), and ${moves.join('; ')}, outside it.`,
          site.plan.location,
        ),
      )
    }
  }
  for (const [store, byLocation] of unlocated) {
    const sites = [...byLocation.values()]
    out.push(
      finding(
        'advice',
        'rollout.residency-unchecked',
        `${sites.length === 1 ? `Site “${sites[0]}”, whose data must stay in its country or region,` : `${sites.length} sites whose data must stay in their country or region`} ${sites.length === 1 ? 'moves' : 'move'} it to “${nameOf(context, store)}”, which no Location aggregates, so whether it stays there is not checked.`,
        store,
      ),
    )
  }
  if (unclassed.length) {
    out.push(
      finding(
        'advice',
        'rollout.residency-unchecked',
        `${unclassed.length} site${unclassed.length === 1 ? ' has' : 's have'} no residency class (${field}), so where ${unclassed.length === 1 ? 'its' : 'their'} data may go is not checked: ${unclassed.slice(0, 3).join(', ')}${unclassed.length > 3 ? ', …' : ''}.`,
        context.rollout.id,
      ),
    )
  }
}

/**
 * Where a site's data moves: each `replace` made at it, the template's and its
 * own. A `modify` exception that purges or retains the data of a template
 * `replace` moves none of it (sponsor, 2026-10-29); one that archives it is
 * still read as a move, since the archive is the successor's.
 */
function targetsOf(context: Context, site: Site): { store: string; by: string }[] {
  const out: { store: string; by: string }[] = []
  for (const change of context.plan.template) {
    if (change.kind !== 'replace') continue
    if (!appliesTo(change.applicability, site.plan, context.aggregates)) continue
    if (skips(site.plan, change.id)) continue
    if (keepsData(site.plan, change.id)) continue
    out.push({ store: change.successor, by: `template change "${change.id}"` })
  }
  for (const exception of site.plan.exceptions ?? []) {
    if (exception.kind !== 'add' || exception.change.kind !== 'replace') continue
    out.push({ store: exception.change.successor, by: `its exception "${exception.id}"` })
  }
  return out
}

/** Does the site purge or retain, rather than move, the data of the template change with this id? */
function keepsData(site: SitePlan, changeId: string): boolean {
  return (site.exceptions ?? []).some(
    (exception) =>
      exception.kind === 'modify' &&
      exception.change === changeId &&
      (exception.disposition === 'purge' || exception.disposition === 'retain'),
  )
}

/** The Locations `depth` aggregation levels above `id`: its country at 1, its region at 2. */
function ancestorsAt(context: Context, id: string, depth: number): string[] {
  let level = [id]
  for (let step = 0; step < depth; step++) {
    level = [...new Set(level.flatMap((location) => context.locationsAggregating(location)))]
  }
  return level
}

/** Is `location` one of `areas`, or aggregated, at any depth, by one of them? */
function isWithin(context: Context, location: string, areas: readonly string[]): boolean {
  const seen = new Set<string>()
  const queue = [location]
  while (queue.length) {
    const next = queue.shift()!
    if (areas.includes(next)) return true
    if (seen.has(next)) continue
    seen.add(next)
    queue.push(...context.locationsAggregating(next))
  }
  return false
}

function nameOf(context: Context, id: string): string {
  return context.elementsById.get(id)?.name || id
}
