import {
  addDays,
  dayAfterPeriod,
  dayStart,
  isIsoDay,
  periodOf,
  type Milestone,
  type MilestonePhase,
  type PlanDate,
  type RolloutPlan,
  type SitePhase,
  type SitePlan,
  type WavePlan,
} from './plan'
// The file has no imports, so the model can use it without a cycle.
import { getKey } from '@/io/records'

/**
 * A site's milestone dates and its phase, derived (#213, ADR 0013 points 5
 * and 6, ADR 0016). Nothing here is stored: the screens, the timeline and the
 * workbook work these out from the plan each time they need them, as the
 * lifecycle phase is worked out from an element's dates (`lifecycle.ts`).
 *
 * ## How a site's milestone date resolves
 *
 * For each milestone of the rollout's set, in order:
 *
 * 1. **the site's own date** (`SitePlan.milestones`), which is **set**;
 * 2. else **its wave's** (`WavePlan.milestones`), **inherited**;
 * 3. else **the rollout's** (`Milestone.date`), **inherited**.
 *
 * A milestone none of the three dates is then **spaced** from a neighbour by
 * the site's archetype's `durations`, which give the days from the previous
 * milestone to each one:
 *
 * 4. forward: from the milestone before it, when that one resolved and the
 *    archetype has a duration for this one, walking the set in order, so a
 *    chain of spaced dates follows one anchor;
 * 5. else backward: from the milestone after it, minus that one's duration,
 *    walking the set in reverse.
 *
 * A spaced date keeps the **precision of the date it is spaced from**: a wave
 * anchored at 2027-Q3 spaces its sites' later milestones in quarters, never in
 * days it does not know. The chain carries the exact day and snaps each date
 * to its period only at the end (`periodOf`), so three spacings of 42 days
 * from a quarter are 126 days from its first day, not three roundings. A
 * spaced date is inherited, and keeps that exact day (`spacedFrom.day`): the
 * phase is derived from it, while the date is shown at its period (ADR 0016
 * point 4, amended 2026-10-28).
 *
 * Every record is read by milestone id through `getKey`: a user names the
 * milestones, and "Constructor" is the id `constructor`, which a plain
 * object would otherwise find on `Object.prototype` (#229 review).
 *
 * A site in no wave inherits nothing from a wave; it still inherits the
 * rollout's dates.
 */

/** Where a site's planned date for a milestone came from. Only `site` is set. */
export type DateSource = 'site' | 'wave' | 'rollout' | 'spaced'

export interface ResolvedMilestone {
  milestone: Milestone
  /** The planned date, or `undefined` when nothing resolves one. */
  planned?: PlanDate
  source?: DateSource
  /**
   * For a spaced date: the milestone it is spaced from, by how many days, and
   * the exact day the chain reaches, which `planned` snaps to its period. The
   * day is derived each time and never stored.
   */
  spacedFrom?: { milestone: string; days: number; day: string }
  /** The day it was actually reached, when the site records one. */
  actual?: string
}

/** Is this date one the site sets, rather than one it inherits? */
export function isSet(resolved: ResolvedMilestone): boolean {
  return resolved.source === 'site'
}

/**
 * Every milestone of `plan`'s set, in order, with `site`'s resolved planned
 * date and its actual date. `wave` is the site's wave when it is a wave of
 * this rollout, else `undefined`.
 */
export function resolveSiteMilestones(
  plan: RolloutPlan,
  site: SitePlan,
  wave: WavePlan | undefined,
): ResolvedMilestone[] {
  const durations = plan.archetypes.find((archetype) => archetype.id === site.archetype)?.durations
  const out: ResolvedMilestone[] = []
  /** The exact day each resolved date stands for, before it is snapped. */
  const days: (string | undefined)[] = []
  for (const milestone of plan.milestones) {
    const resolved: ResolvedMilestone = { milestone }
    const own = getKey(site.milestones, milestone.id)
    const fromWave = getKey(wave?.milestones, milestone.id)
    if (own) Object.assign(resolved, { planned: own, source: 'site' })
    else if (fromWave) Object.assign(resolved, { planned: fromWave, source: 'wave' })
    else if (milestone.date) Object.assign(resolved, { planned: milestone.date, source: 'rollout' })
    const actual = getKey(site.actuals, milestone.id)
    if (isIsoDay(actual)) resolved.actual = actual
    out.push(resolved)
    days.push(resolved.planned?.date)
  }

  const space = (index: number, from: number, gap: number) => {
    const anchor = out[from]!
    const day = addDays(days[from]!, gap)
    out[index]!.planned = periodOf(day, anchor.planned!.precision)
    out[index]!.source = 'spaced'
    out[index]!.spacedFrom = { milestone: anchor.milestone.id, days: gap, day }
    days[index] = day
  }
  if (durations) {
    for (let index = 1; index < out.length; index++) {
      const gap = getKey(durations, out[index]!.milestone.id)
      if (!out[index]!.planned && out[index - 1]!.planned && gap !== undefined) {
        space(index, index - 1, gap)
      }
    }
    for (let index = out.length - 2; index >= 0; index--) {
      const gap = getKey(durations, out[index + 1]!.milestone.id)
      if (!out[index]!.planned && out[index + 1]!.planned && gap !== undefined) {
        space(index, index + 1, -gap)
      }
    }
  }
  return out
}

// ── The derived site phase ───────────────────────────────────────────────────

/** What the phase is derived from, per milestone in the set's order. */
export interface PhaseInput {
  startsPhase: MilestonePhase
  planned?: PlanDate
  /**
   * For a spaced date, the exact day the chain reaches (`spacedFrom.day`):
   * the day it counts as reached, where `planned` is the period it is shown at.
   */
  spacedDay?: string
  actual?: string
}

/**
 * What the phase and the overdue flag are derived from, for a site's resolved
 * milestones. The register (`siteStatus`) and the timeline both build their
 * inputs here, so the two cannot derive a phase from different days.
 */
export function phaseInputs(milestones: readonly ResolvedMilestone[]): PhaseInput[] {
  return milestones.map((resolved) => {
    const input: PhaseInput = { startsPhase: resolved.milestone.startsPhase }
    if (resolved.planned) input.planned = resolved.planned
    if (resolved.spacedFrom) input.spacedDay = resolved.spacedFrom.day
    if (resolved.actual !== undefined) input.actual = resolved.actual
    return input
  })
}

/**
 * When a milestone counts as reached: its actual day, which takes precedence.
 * Else, for a spaced date, the exact day its chain reaches, though it is shown
 * at its anchor's precision: a wave that says only `readiness: 2027-Q3` must
 * not put every later milestone of a Standard site on 1 July (ADR 0016 point
 * 4, amended 2026-10-28). Else the first day of its planned period.
 * `undefined` when it has none of these.
 */
export function reachedAt(input: PhaseInput): number | undefined {
  if (input.actual !== undefined) return dayStart(input.actual)
  if (input.spacedDay !== undefined) return dayStart(input.spacedDay)
  return input.planned ? dayStart(input.planned.date) : undefined
}

/**
 * The phase at `at` (UTC ms), as `deriveLifecyclePhase` derives a lifecycle
 * phase (ADR 0013 point 6): the phase started by the last milestone, walking
 * the set in order, that has been reached. An actual date takes precedence
 * over the planned one, early or late.
 *
 * A site in a wave that has reached no milestone yet, or whose milestones have
 * no dates, is **Planned**.
 *
 * A site in **no wave** has no plan its dates commit it to, so only its actual
 * days count: it is **Unplanned** until the first of them (proposal §4.5:
 * "no wave → Unplanned"), and from then on its phase follows them, as actual
 * dates take precedence (ADR 0013 point 6). This is how a site whose wave was
 * deleted after its cutover still reads as migrated (ADR 0016 point 4, amended
 * 2026-10-28; ADR 0015 point 6).
 */
export function deriveSitePhase(
  inputs: readonly PhaseInput[],
  inWave: boolean,
  at: number,
): SitePhase {
  let phase: SitePhase = inWave ? 'planned' : 'unplanned'
  for (const input of inputs) {
    const reached = inWave
      ? reachedAt(input)
      : input.actual === undefined
        ? undefined
        : dayStart(input.actual)
    if (reached !== undefined && reached <= at) phase = input.startsPhase
  }
  return phase
}

/**
 * The milestones overdue at `at`: a planned date whose whole period has passed
 * with no actual date. A computed flag, not a phase (proposal §4.5). It reads
 * the period a date is shown at, never a spaced date's exact day, so a date is
 * never overdue before the period it shows has ended.
 */
export function overdueMilestones<T extends PhaseInput>(inputs: readonly T[], at: number): T[] {
  return inputs.filter(
    (input) =>
      input.actual === undefined &&
      input.planned !== undefined &&
      dayStart(dayAfterPeriod(input.planned)) <= at,
  )
}

/** A site's milestones, phase and overdue flag at `at`. */
export interface SiteStatus {
  milestones: ResolvedMilestone[]
  phase: SitePhase
  overdue: boolean
}

export function siteStatus(
  plan: RolloutPlan,
  site: SitePlan,
  wave: WavePlan | undefined,
  at: number,
): SiteStatus {
  const milestones = resolveSiteMilestones(plan, site, wave)
  const inputs = phaseInputs(milestones)
  const inWave = wave !== undefined
  return {
    milestones,
    phase: deriveSitePhase(inputs, inWave, at),
    // A site in no wave has no plan to be late against (ADR 0016 point 5).
    overdue: inWave && overdueMilestones(inputs, at).length > 0,
  }
}

/**
 * The milestone at which a site switches over, which the register shows as
 * its cutover: the first that starts Cutover, or, in a set with no Cutover
 * phase (the generic preset's cutover starts Hypercare, proposal §4.5), the
 * first that starts Hypercare.
 */
export function switchMilestone(milestones: readonly Milestone[]): Milestone | undefined {
  return (
    milestones.find((milestone) => milestone.startsPhase === 'cutover') ??
    milestones.find((milestone) => milestone.startsPhase === 'hypercare')
  )
}
