import {
  actualOnly,
  addDays,
  dayAfterPeriod,
  dayStart,
  deriveSitePhase,
  formatPlanDate,
  hasMigrated,
  periodOf,
  phaseInputs,
  plannedOnly,
  reachedAt,
  type PhaseInput,
  type PlanDate,
} from '@/model'
import type { RolloutData, WaveColumn } from './rollout-data'

/**
 * The rollout's progress (#215, proposal §6 item 6): a burn-up of the sites
 * that have reached **Migrated**, planned against actual, by week or by month,
 * with the current wave's 25%, 50% and 75% checkpoints.
 *
 * Nothing here is stored, and nothing decides a phase of its own: every count
 * is of the phase `deriveSitePhase` gives (`site-phase.ts`), from two views of
 * one site's milestones.
 *
 * - **Planned** is the phase from the planned dates alone (`plannedOnly`), so
 *   it is where the plan puts the site, whatever has been recorded. A site in
 *   no wave has no plan, so it never counts as planned to migrate.
 * - **Actual** is the phase from the actual days alone (`actualOnly`), so a
 *   planned date that has passed moves nothing. It is counted up to the time
 *   point and not after it: what has not happened yet has no count.
 *
 * A site has reached Migrated in Migrated or Done (`hasMigrated`). The sites in
 * scope are all of the rollout's sites, in a wave or not, so at any time point
 * migrated and not migrated add up to them.
 */

export const BURN_UP_GRAINS = ['week', 'month'] as const
export type BurnUpGrain = (typeof BURN_UP_GRAINS)[number]
export const BURN_UP_GRAIN_LABELS: Record<BurnUpGrain, string> = { week: 'Week', month: 'Month' }

/** CAF's checkpoints for a wave, as shares of its sites (proposal §6 item 6). */
export const CHECKPOINTS = [25, 50, 75] as const
export type CheckpointPercent = (typeof CHECKPOINTS)[number]

const DAY_MS = 86_400_000

/** One site's two views of its milestones. */
interface SiteLines {
  location: string
  wave: string | undefined
  inWave: boolean
  planned: PhaseInput[]
  actual: PhaseInput[]
}

function linesOf(data: RolloutData): SiteLines[] {
  return data.sites.map((site) => {
    const inputs = phaseInputs(site.milestones)
    return {
      location: site.location,
      wave: site.wave,
      inWave: site.wave !== undefined,
      planned: plannedOnly(inputs),
      actual: actualOnly(inputs),
    }
  })
}

const plannedMigrated = (site: SiteLines, at: number) =>
  hasMigrated(deriveSitePhase(site.planned, site.inWave, at))
const actuallyMigrated = (site: SiteLines, at: number) =>
  hasMigrated(deriveSitePhase(site.actual, site.inWave, at))

/** Every instant at which one of `inputs` is reached, in order, without repeats. */
function instants(inputs: readonly PhaseInput[]): number[] {
  const all = inputs.map(reachedAt).filter((at): at is number => at !== undefined)
  return [...new Set(all)].sort((a, b) => a - b)
}

/**
 * The first instant at which `migrated` holds for a site, among the instants
 * its milestones are reached: the only instants its phase can change at.
 */
function firstMigration(
  inputs: readonly PhaseInput[],
  migrated: (at: number) => boolean,
): number | undefined {
  return instants(inputs).find(migrated)
}

function isoDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export interface BurnUpPoint {
  /** The period as people write it: `2027-W19`, `2027-05`. */
  label: string
  /** UTC ms of the period's first instant, and of the first instant after it. */
  start: number
  end: number
  /** Sites the plan has migrated by the period's last day. */
  planned: number
  /**
   * Sites actually migrated by the period's last day, or by the time point in
   * the period that holds it. Absent for a period that starts after the time
   * point: nothing has happened in it yet.
   */
  actual?: number
  /** When `actual` was counted: the period's last day, or the time point. */
  actualAt?: number
}

export type CheckpointStatus = 'met' | 'late' | 'due' | 'unplanned'

export interface Checkpoint {
  percent: CheckpointPercent
  /** Sites of the wave that make up this share, rounded up. */
  target: number
  /** The day the plan migrates that many of the wave's sites. */
  plannedBy?: string
  /** The day that many were actually migrated, when it is by the time point. */
  reachedOn?: string
  /**
   * `met` once reached; else `late` once its planned day has passed; else
   * `due`; `unplanned` when the plan never migrates that many.
   */
  status: CheckpointStatus
}

export interface CurrentWave {
  wave: WaveColumn
  /** Its sites, and how many of them are actually migrated at the time point. */
  sites: number
  migrated: number
  checkpoints: Checkpoint[]
}

export interface BurnUp {
  grain: BurnUpGrain
  /** Every site of the rollout. */
  scope: number
  /** At the time point: actually migrated, not migrated, and migrated by the plan. */
  migrated: number
  notMigrated: number
  plannedMigrated: number
  /** One per period, from the first in which any site migrates, planned or actual, to the last. */
  points: BurnUpPoint[]
  /**
   * The first wave, in order, with a site not actually migrated at the time
   * point: the wave being worked. `undefined` when every wave is done.
   */
  current: CurrentWave | undefined
  /** Does any milestone of the set start Migrated or Done? Without one no site can migrate. */
  migrates: boolean
  at: number
}

export function burnUp(data: RolloutData, grain: BurnUpGrain): BurnUp {
  const at = data.at
  const sites = linesOf(data)
  const migrated = sites.filter((site) => actuallyMigrated(site, at)).length
  const plannedNow = sites.filter((site) => plannedMigrated(site, at)).length
  const migrates = data.plan.milestones.some((milestone) => hasMigrated(milestone.startsPhase))

  // The axis runs from the first migration to the last, planned or actual,
  // and always holds the time point.
  const firsts = sites.flatMap((site) =>
    [
      firstMigration(site.planned, (t) => plannedMigrated(site, t)),
      firstMigration(site.actual, (t) => actuallyMigrated(site, t)),
    ].filter((t): t is number => t !== undefined),
  )
  const points: BurnUpPoint[] = []
  if (firsts.length) {
    // A loop, not `Math.min(...)`: a rollout can have more sites than a call takes arguments.
    let from = at
    let to = at
    for (const first of firsts) {
      from = Math.min(from, first)
      to = Math.max(to, first)
    }
    for (
      let period: PlanDate = periodOf(isoDayOf(from), grain);
      dayStart(period.date) <= to;
      period = periodOf(dayAfterPeriod(period), grain)
    ) {
      const start = dayStart(period.date)
      const end = dayStart(dayAfterPeriod(period))
      const lastDay = end - DAY_MS
      const point: BurnUpPoint = {
        label: formatPlanDate(period),
        start,
        end,
        planned: sites.filter((site) => plannedMigrated(site, lastDay)).length,
      }
      if (start <= at) {
        const counted = Math.min(lastDay, at)
        point.actual = sites.filter((site) => actuallyMigrated(site, counted)).length
        point.actualAt = counted
      }
      points.push(point)
    }
  }

  return {
    grain,
    scope: sites.length,
    migrated,
    notMigrated: sites.length - migrated,
    plannedMigrated: plannedNow,
    points,
    current: currentWave(data, sites, at),
    migrates,
    at,
  }
}

function currentWave(
  data: RolloutData,
  sites: readonly SiteLines[],
  at: number,
): CurrentWave | undefined {
  for (const wave of data.waves) {
    const inWave = sites.filter((site) => site.wave === wave.element.id)
    const done = inWave.filter((site) => actuallyMigrated(site, at)).length
    if (done === inWave.length) continue
    return {
      wave,
      sites: inWave.length,
      migrated: done,
      checkpoints: CHECKPOINTS.map((percent) => checkpoint(percent, inWave, at)),
    }
  }
  return undefined
}

function checkpoint(
  percent: CheckpointPercent,
  sites: readonly SiteLines[],
  at: number,
): Checkpoint {
  const target = Math.ceil((sites.length * percent) / 100)
  const plannedAt = instants(sites.flatMap((site) => site.planned)).find(
    (t) => sites.filter((site) => plannedMigrated(site, t)).length >= target,
  )
  const reachedTime = instants(sites.flatMap((site) => site.actual)).find(
    (t) => t <= at && sites.filter((site) => actuallyMigrated(site, t)).length >= target,
  )
  const plannedBy = plannedAt === undefined ? undefined : isoDayOf(plannedAt)
  const reachedOn = reachedTime === undefined ? undefined : isoDayOf(reachedTime)
  const status: CheckpointStatus =
    reachedOn !== undefined
      ? 'met'
      : plannedBy === undefined
        ? 'unplanned'
        : dayStart(addDays(plannedBy, 1)) <= at
          ? 'late'
          : 'due'
  return {
    percent,
    target,
    ...(plannedBy === undefined ? {} : { plannedBy }),
    ...(reachedOn === undefined ? {} : { reachedOn }),
    status,
  }
}

// ── Colour (ADR 0013 point 9: no new tokens) ─────────────────────────────────

/**
 * The planned line is drawn in the token of Planned and the actual line in
 * that of Migrated; a checkpoint met in Migrated's, a late one in RAG red's
 * (`--lc-eol`), and one still to come in Planned's.
 */
export const BURN_UP_TOKENS = {
  planned: 'var(--lc-plan)',
  actual: 'var(--lc-act)',
  timePoint: 'var(--accent)',
} as const

export const CHECKPOINT_TOKENS: Record<CheckpointStatus, string> = {
  met: 'var(--lc-act)',
  late: 'var(--lc-eol)',
  due: 'var(--lc-plan)',
  unplanned: 'var(--lc-plan)',
}

export const CHECKPOINT_STATUS_LABELS: Record<CheckpointStatus, string> = {
  met: 'Met',
  late: 'Late',
  due: 'Due',
  unplanned: 'Not planned',
}

// ── Geometry ─────────────────────────────────────────────────────────────────

export const CHART = { width: 880, height: 300, left: 48, right: 16, top: 16, bottom: 36 }

export interface BurnUpChart {
  /** `M … L …` paths in the chart's own coordinates. */
  planned: string
  actual: string
  /** The time point's x, when it is on the axis. */
  timePoint: number | undefined
  yTicks: { y: number; label: string }[]
  xTicks: { x: number; label: string }[]
  checkpoints: { x: number; percent: CheckpointPercent; status: CheckpointStatus }[]
}

/** The burn-up drawn in a fixed box: a long rollout is denser, never wider. */
export function burnUpChart(chart: BurnUp): BurnUpChart | undefined {
  const first = chart.points[0]
  const last = chart.points.at(-1)
  if (!first || !last) return undefined
  const plotWidth = CHART.width - CHART.left - CHART.right
  const plotHeight = CHART.height - CHART.top - CHART.bottom
  const span = last.end - first.start
  const x = (ms: number) => round(CHART.left + ((ms - first.start) / span) * plotWidth)
  const y = (count: number) =>
    round(CHART.top + plotHeight - (chart.scope ? count / chart.scope : 0) * plotHeight)
  const path = (pairs: [number, number][]) =>
    pairs.map(([px, py], index) => `${index ? 'L' : 'M'}${px} ${py}`).join(' ')

  const planned = path([
    [x(first.start), y(0)],
    ...chart.points.map((point): [number, number] => [x(point.end), y(point.planned)]),
  ])
  const counted = chart.points.filter((point) => point.actual !== undefined)
  const actual = counted.length
    ? path([
        [x(first.start), y(0)],
        ...counted.map((point): [number, number] => [x(point.actualAt!), y(point.actual!)]),
      ])
    : ''

  const half = Math.round(chart.scope / 2)
  const yTicks = [...new Set([0, half, chart.scope])].map((count) => ({
    y: y(count),
    label: String(count),
  }))
  // A label at each quarter's start on the axis, or the first period's when none is.
  const xTicks: { x: number; label: string }[] = []
  for (
    let quarter = periodOf(isoDayOf(first.start), 'quarter');
    dayStart(quarter.date) < last.end;
    quarter = periodOf(dayAfterPeriod(quarter), 'quarter')
  ) {
    const start = dayStart(quarter.date)
    if (start >= first.start) xTicks.push({ x: x(start), label: formatPlanDate(quarter) })
  }
  if (!xTicks.length) xTicks.push({ x: x(first.start), label: first.label })

  const inRange = (ms: number) => ms >= first.start && ms <= last.end
  const checkpoints = (chart.current?.checkpoints ?? []).flatMap((checkpoint) =>
    checkpoint.plannedBy !== undefined && inRange(dayStart(checkpoint.plannedBy))
      ? [
          {
            x: x(dayStart(checkpoint.plannedBy)),
            percent: checkpoint.percent,
            status: checkpoint.status,
          },
        ]
      : [],
  )
  return {
    planned,
    actual,
    timePoint: inRange(chart.at) ? x(chart.at) : undefined,
    yTicks,
    xTicks,
    checkpoints,
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
