import { describe, expect, it } from 'vitest'
import { ROLLOUT_DEMO_ID, loadRolloutDemoWorkspace } from '@/io'
import {
  dayStart,
  rolloutPlanOf,
  type Element,
  type Milestone,
  type PlanDate,
  type SitePlan,
  type Workspace,
} from '@/model'
import { ModelStore } from '@/store'
import { smallWorkspace } from '@/test/fixtures'
import { CHART, burnUp, burnUpChart, type BurnUp } from './burn-up'
import { rolloutData } from './rollout-data'

/**
 * The burn-up's counts (#215). Every count is asserted as a number, and the
 * counts at the time point as the identity migrated + not migrated = sites
 * in scope: a one-sided bound would pass at zero.
 *
 * The rollout is written out by hand so each count can be worked out from
 * the dates below:
 *
 * | site | wave | planned Stable | actual Stable |
 * |------|------|----------------|---------------|
 * | A    | W1   | 2027-01-05     | 2027-01-03 (early) |
 * | B    | W1   | 2027-01-12     | 2027-01-14 (late)  |
 * | C    | W1   | 2027-01-20 (its wave's) | — |
 * | D    | W1   | 2027-02-10     | —             |
 * | E, F | W2   | 2027-03-10 (its wave's) | — |
 * | G    | none | 2027-01-08     | 2027-01-10    |
 *
 * G is in no wave, so its planned date commits it to nothing: it never counts
 * as planned to migrate, and counts as migrated from its actual day (ADR 0016
 * point 4). The time point is 2027-01-16, a fixed day, never today.
 */

const ROLLOUT = 'wp-r'
const AT = '2027-01-16'
const MILESTONES: Milestone[] = [
  { id: 'ready', label: 'Ready', startsPhase: 'preparing' },
  { id: 'cutover', label: 'Cutover', startsPhase: 'hypercare' },
  { id: 'stable', label: 'Stable', startsPhase: 'migrated' },
  { id: 'retired', label: 'Retired', startsPhase: 'done' },
]
const day = (date: string): PlanDate => ({ date, precision: 'day' })

function wave(id: string, order: number, stable: string): Element {
  return {
    id,
    type: 'WorkPackage',
    name: `Wave ${id}`,
    properties: {},
    plan: {
      kind: 'wave',
      rollout: ROLLOUT,
      label: id.toUpperCase().replace('WP-', ''),
      order,
      templateVersion: 1,
      milestones: { stable: day(stable) },
    },
  }
}

function site(location: string, plan: Omit<SitePlan, 'location'> = {}): SitePlan {
  return { location, ...plan }
}

function workspace(sites: SitePlan[] = SITES, milestones = MILESTONES): Workspace {
  const base = smallWorkspace()
  return {
    ...base,
    elements: [
      ...base.elements,
      ...sites.map((plan): Element => ({
        id: plan.location,
        type: 'Location',
        name: `Site ${plan.location}`,
        properties: {},
      })),
      wave('wp-w1', 0, '2027-01-20'),
      wave('wp-w2', 1, '2027-03-10'),
      {
        id: ROLLOUT,
        type: 'WorkPackage',
        name: 'Rollout',
        properties: {},
        plan: {
          kind: 'rollout',
          templateVersion: 1,
          milestones,
          template: [],
          archetypes: [],
          sites,
        },
      },
    ],
  }
}

const SITES: SitePlan[] = [
  site('a', {
    wave: 'wp-w1',
    milestones: { stable: day('2027-01-05') },
    actuals: { stable: '2027-01-03' },
  }),
  site('b', {
    wave: 'wp-w1',
    milestones: { stable: day('2027-01-12') },
    actuals: { stable: '2027-01-14' },
  }),
  site('c', { wave: 'wp-w1' }),
  site('d', { wave: 'wp-w1', milestones: { stable: day('2027-02-10') } }),
  site('e', { wave: 'wp-w2' }),
  site('f', { wave: 'wp-w2' }),
  site('g', { milestones: { stable: day('2027-01-08') }, actuals: { stable: '2027-01-10' } }),
]

/** The burn-up at `at`: a day, or an instant in UTC ms. */
function progress(
  grain: 'week' | 'month' = 'week',
  at: string | number = AT,
  model: Workspace = workspace(),
  rollout = ROLLOUT,
): BurnUp {
  const time = typeof at === 'number' ? at : dayStart(at)
  return burnUp(rolloutData(new ModelStore(model), rollout, time)!, grain)
}

const vertices = (path: string) =>
  [...path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)])

const row = (chart: BurnUp, label: string) => {
  const point = chart.points.find((candidate) => candidate.label === label)
  if (!point) throw new Error(`no point ${label}`)
  return { planned: point.planned, actual: point.actual }
}

describe('the burn-up’s counts at the time point (#215)', () => {
  it('migrated and not migrated add up to the sites in scope', () => {
    const chart = progress()
    expect(chart.scope).toBe(7)
    // A and B by their actual days, and G, in no wave, by its own.
    expect(chart.migrated).toBe(3)
    expect(chart.notMigrated).toBe(4)
    expect(chart.migrated + chart.notMigrated).toBe(chart.scope)
    // The plan has A and B by 2027-01-16; C is due on the 20th, and G has no plan.
    expect(chart.plannedMigrated).toBe(2)
  })

  it('counts at the time point, never at today', () => {
    const before = progress('week', '2027-01-02')
    expect([before.migrated, before.notMigrated, before.plannedMigrated]).toEqual([0, 7, 0])
    const later = progress('week', '2027-03-31')
    // Still three actual: no actual day was recorded after 2027-01-14.
    expect([later.migrated, later.notMigrated, later.plannedMigrated]).toEqual([3, 4, 6])
  })

  it('counts Done as migrated, and a phase before Migrated as not', () => {
    const sites = [
      site('a', { wave: 'wp-w1', actuals: { stable: '2027-01-03', retired: '2027-01-04' } }),
      site('b', { wave: 'wp-w1', actuals: { cutover: '2027-01-03' } }),
    ]
    const chart = progress('week', AT, workspace(sites))
    expect([chart.migrated, chart.notMigrated, chart.scope]).toEqual([1, 1, 2])
  })
})

describe('the burn-up, planned against actual (#215)', () => {
  it('by week: an actual before its planned date counts in the week it happened', () => {
    const chart = progress('week')
    // The axis runs from the first migration, A's actual on Sunday 3 January,
    // to the last planned one, E's and F's on 10 March.
    expect(chart.points.map((point) => point.label)).toEqual([
      '2026-W53',
      ...Array.from({ length: 10 }, (_, i) => `2027-W${String(i + 1).padStart(2, '0')}`),
    ])
    expect(row(chart, '2026-W53')).toEqual({ planned: 0, actual: 1 })
    expect(row(chart, '2027-W01')).toEqual({ planned: 1, actual: 2 })
    // The week holding the time point is counted at the time point, not its end.
    expect(row(chart, '2027-W02')).toEqual({ planned: 2, actual: 3 })
    expect(chart.points.find((p) => p.label === '2027-W02')!.actualAt).toBe(dayStart(AT))
    // After the time point nothing has happened yet, so there is no actual count.
    expect(row(chart, '2027-W03')).toEqual({ planned: 3, actual: undefined })
    expect(row(chart, '2027-W06')).toEqual({ planned: 4, actual: undefined })
    expect(row(chart, '2027-W10')).toEqual({ planned: 6, actual: undefined })
    // G is never planned: the plan's last count is every site but it.
    expect(chart.points.at(-1)!.planned).toBe(chart.scope - 1)
  })

  it('by month', () => {
    const chart = progress('month')
    expect(chart.points.map((point) => [point.label, point.planned, point.actual])).toEqual([
      ['2027-01', 3, 3],
      ['2027-02', 4, undefined],
      ['2027-03', 6, undefined],
    ])
  })

  it('a passed planned date moves only the planned line', () => {
    // At 2027-01-25 C's planned Stable has passed with no actual day.
    const chart = progress('week', '2027-01-25')
    expect(row(chart, '2027-W03')).toEqual({ planned: 3, actual: 3 })
    expect([chart.migrated, chart.plannedMigrated]).toEqual([3, 3])
  })

  it('holds the time point on the axis when it is before every migration', () => {
    const chart = progress('month', '2026-11-15')
    expect(chart.points[0]!.label).toBe('2026-11')
    expect(chart.points[0]!.actual).toBe(0)
    expect(chart.points.at(-1)!.label).toBe('2027-03')
  })

  it('has no points when no site migrates on any date, and says when no milestone can migrate', () => {
    const none = progress(
      'week',
      AT,
      workspace([site('a', { wave: 'wp-w1' })], MILESTONES.slice(0, 2)),
    )
    expect(none.points).toEqual([])
    expect(none.migrates).toBe(false)
    expect(burnUpChart(none)).toBeUndefined()
    expect(progress().migrates).toBe(true)
  })
})

describe('the current wave’s checkpoints (#215, CAF 25/50/75)', () => {
  it('is the first wave with a site not yet migrated, and each checkpoint says where it is', () => {
    const { current } = progress()
    expect(current!.wave.element.id).toBe('wp-w1')
    expect([current!.migrated, current!.sites]).toEqual([2, 4])
    expect(current!.checkpoints).toEqual([
      // One of four, A: planned for the 5th, reached on the 3rd.
      {
        percent: 25,
        target: 1,
        plannedBy: '2027-01-05',
        plannedAt: dayStart('2027-01-05'),
        reachedOn: '2027-01-03',
        status: 'met',
      },
      // Two of four, A and B: B two days late, and still met.
      {
        percent: 50,
        target: 2,
        plannedBy: '2027-01-12',
        plannedAt: dayStart('2027-01-12'),
        reachedOn: '2027-01-14',
        status: 'met',
      },
      // Three of four: C, planned for the 20th, is still to come.
      {
        percent: 75,
        target: 3,
        plannedBy: '2027-01-20',
        plannedAt: dayStart('2027-01-20'),
        status: 'due',
      },
    ])
  })

  it('is late once its planned day has passed without it, and not on that day', () => {
    expect(progress('week', '2027-01-20').current!.checkpoints[2]!.status).toBe('due')
    // Noon of the planned day is still that day: without `?at=` the time
    // point is now, never a day's start.
    expect(
      progress('week', Date.parse('2027-01-20T12:00:00Z')).current!.checkpoints[2]!.status,
    ).toBe('due')
    expect(progress('week', '2027-01-21').current!.checkpoints[2]!.status).toBe('late')
  })

  /**
   * A wave planned to the quarter: its sites migrate, by the derived phase, on
   * 1 January, but the plan shows `2027-Q1`, so the checkpoint is due until
   * the quarter ends and late from 1 April, as a milestone is overdue (ADR
   * 0016 point 5). Site P's own day shares the instant; the quarter, which
   * ends later, is the one shown, whether P comes first or last.
   */
  it.each(['first', 'last'])(
    'follows the period the plan shows: due all quarter, late once it ends (the day site %s)',
    (order) => {
      const quarter: PlanDate = { date: '2027-01-01', precision: 'quarter' }
      const daySite = site('p', { wave: 'wp-w1', milestones: { stable: day('2027-01-01') } })
      const quarterSites = ['q', 'r', 's'].map((location) => site(location, { wave: 'wp-w1' }))
      const model = workspace(
        order === 'first' ? [daySite, ...quarterSites] : [...quarterSites, daySite],
      )
      const w1 = model.elements.find((element) => element.id === 'wp-w1')!
      ;(w1.plan as { milestones: Record<string, PlanDate> }).milestones = { stable: quarter }
      const at = (time: string | number) => progress('week', time, model).current!.checkpoints
      expect(
        at('2027-02-01').map(({ plannedBy, plannedAt, status }) => [plannedBy, plannedAt, status]),
      ).toEqual([
        ['2027-Q1', dayStart('2027-01-01'), 'due'],
        ['2027-Q1', dayStart('2027-01-01'), 'due'],
        ['2027-Q1', dayStart('2027-01-01'), 'due'],
      ])
      expect(at(Date.parse('2027-03-31T12:00:00Z')).map((c) => c.status)).toEqual([
        'due',
        'due',
        'due',
      ])
      expect(at('2027-04-01').map((c) => c.status)).toEqual(['late', 'late', 'late'])
    },
  )

  /**
   * A wave that mixes precisions: X is planned for 2027-Q1, from 1 January by
   * the phase, and Y for the day 15 January. Every share counts X, so every
   * checkpoint is due until X's quarter has ended, though Y's day has passed
   * (ADR 0018 point 4). The share is never late before a site counted in it
   * is overdue.
   */
  it('is due while any site counted toward the share has a period still running', () => {
    const model = workspace([
      site('x', {
        wave: 'wp-w1',
        milestones: { stable: { date: '2027-01-01', precision: 'quarter' } },
      }),
      site('y', { wave: 'wp-w1', milestones: { stable: day('2027-01-15') } }),
    ])
    const rows = (time: string) =>
      progress('week', time, model).current!.checkpoints.map(({ target, plannedBy, status }) => [
        target,
        plannedBy,
        status,
      ])
    expect(rows('2027-01-16')).toEqual([
      [1, '2027-Q1', 'due'],
      [1, '2027-Q1', 'due'],
      [2, '2027-Q1', 'due'],
    ])
    expect(rows('2027-04-01')).toEqual([
      [1, '2027-Q1', 'late'],
      [1, '2027-Q1', 'late'],
      [2, '2027-Q1', 'late'],
    ])
  })

  /**
   * One site whose Stable is the day 1 January and whose Retired is 2027-Q1,
   * both reached that day: Stable migrates it, so the checkpoint is late from
   * 2 January, when the register flags the site overdue.
   */
  it('names the first milestone that migrates a site, and agrees with the register', () => {
    const model = workspace([
      site('z', {
        wave: 'wp-w1',
        milestones: {
          stable: day('2027-01-01'),
          retired: { date: '2027-01-01', precision: 'quarter' },
        },
      }),
    ])
    const store = new ModelStore(model)
    const data = rolloutData(store, ROLLOUT, dayStart('2027-02-01'))!
    expect(data.sites.find((row) => row.location === 'z')!.overdue).toBe(true)
    expect(
      burnUp(data, 'week').current!.checkpoints.map(({ plannedBy, status }) => [plannedBy, status]),
    ).toEqual([
      ['2027-01-01', 'late'],
      ['2027-01-01', 'late'],
      ['2027-01-01', 'late'],
    ])
  })

  /**
   * Only the milestone that migrates the site making up the share names the
   * period: not one before Migrated that the site reaches on the same day,
   * and not a later one of a site that had migrated already.
   */
  it('takes its period from the milestone that migrates the site making up the share', () => {
    const q1: PlanDate = { date: '2027-01-01', precision: 'quarter' }
    const model = workspace([
      // X migrates on 1 December, and retires in 2027-Q1, from 1 January.
      site('x', {
        wave: 'wp-w1',
        milestones: { stable: day('2026-12-01'), retired: q1 },
      }),
      // Y is ready in 2027-Q1 and migrates on 1 January: both reached that day.
      site('y', {
        wave: 'wp-w1',
        milestones: { ready: q1, stable: day('2027-01-01') },
      }),
    ])
    const checkpoints = progress('week', '2026-11-02', model).current!.checkpoints
    expect(checkpoints.map(({ target, plannedBy }) => [target, plannedBy])).toEqual([
      [1, '2026-12-01'],
      [1, '2026-12-01'],
      [2, '2027-01-01'],
    ])
  })

  it('on the demo, a wave anchored to a quarter is not late before the quarter ends', () => {
    // The pilot and W1 to W3 actually migrated, so W4 is the wave being worked:
    // its sites' hypercare ends are spaced from its 2027-Q4 freeze, and shown
    // at that quarter in the register and on the Migration tab.
    const model = loadRolloutDemoWorkspace()
    const plan = rolloutPlanOf(model.elements.find((element) => element.id === ROLLOUT_DEMO_ID))!
    const done = new Set(['wp-wave-pilot', 'wp-wave-1', 'wp-wave-2', 'wp-wave-3'])
    for (const plannedSite of plan.sites) {
      if (plannedSite.wave !== undefined && done.has(plannedSite.wave)) {
        plannedSite.actuals = { ...plannedSite.actuals, hypercareEnd: '2027-01-04' }
      }
    }
    const at = (time: string | number) => progress('week', time, model, ROLLOUT_DEMO_ID).current!
    expect(at('2027-10-18').wave.element.id).toBe('wp-wave-4')
    // Shown at the quarter, reached on the spaced days inside it: the
    // instants are not the quarter's first day, so the two are told apart.
    expect(at('2027-10-18').checkpoints.map((c) => [c.plannedBy, c.plannedAt, c.status])).toEqual([
      ['2027-Q4', dayStart('2027-10-17'), 'due'],
      ['2027-Q4', dayStart('2027-10-25'), 'due'],
      ['2027-Q4', dayStart('2027-11-02'), 'due'],
    ])
    // Drawn at those instants, inside the quarter, not on its first tick.
    const progressAt = progress('week', '2027-10-18', model, ROLLOUT_DEMO_ID)
    const chart = burnUpChart(progressAt)!
    const first = progressAt.points[0]!
    const last = progressAt.points.at(-1)!
    const x = (ms: number) =>
      Math.round(
        (CHART.left +
          ((ms - first.start) / (last.end - first.start)) *
            (CHART.width - CHART.left - CHART.right)) *
          10,
      ) / 10
    const q4 = chart.xTicks.find((tick) => tick.label === '2027-Q4')!
    expect(q4.x).toBe(x(dayStart('2027-10-01')))
    expect(chart.checkpoints.map((checkpoint) => checkpoint.x)).toEqual([
      x(dayStart('2027-10-17')),
      x(dayStart('2027-10-25')),
      x(dayStart('2027-11-02')),
    ])
    expect(chart.checkpoints[0]!.x).toBeGreaterThan(q4.x)
    expect(at(Date.parse('2027-12-31T12:00:00Z')).checkpoints.map((c) => c.status)).toEqual([
      'due',
      'due',
      'due',
    ])
    expect(at('2028-01-01').checkpoints.map((c) => c.status)).toEqual(['late', 'late', 'late'])
  })

  /**
   * A set whose phases do not ascend: Back starts Hypercare after Stable has
   * started Migrated. A's second migration, at Retired on 1 March, makes up
   * the 75% share after every first migration and the time point; the axis
   * still holds it, so the checkpoint is drawn on the plot.
   */
  it('keeps a checkpoint on the axis when the set goes back from Migrated', () => {
    const milestones: Milestone[] = [
      { id: 'stable', label: 'Stable', startsPhase: 'migrated' },
      { id: 'back', label: 'Back', startsPhase: 'hypercare' },
      { id: 'retired', label: 'Retired', startsPhase: 'done' },
    ]
    const model = workspace(
      [
        site('a', {
          wave: 'wp-w1',
          milestones: {
            stable: day('2027-01-05'),
            back: day('2027-01-10'),
            retired: day('2027-03-01'),
          },
        }),
        site('b', { wave: 'wp-w1', milestones: { stable: day('2027-02-01') } }),
      ],
      milestones,
    )
    const result = progress('week', AT, model)
    expect(result.current!.checkpoints[2]!.plannedAt).toBe(dayStart('2027-03-01'))
    expect(result.points.at(-1)!.end).toBeGreaterThan(dayStart('2027-03-01'))
    const chart = burnUpChart(result)!
    expect(chart.checkpoints).toHaveLength(3)
    for (const checkpoint of chart.checkpoints) {
      expect(checkpoint.x).toBeGreaterThanOrEqual(CHART.left)
      expect(checkpoint.x).toBeLessThanOrEqual(CHART.width - CHART.right)
    }
  })

  /** Ceil, not round or floor: 3 and 5 sites are the sizes that tell them apart. */
  it.each([
    [3, [1, 2, 3]],
    [5, [2, 3, 4]],
  ])('rounds a share of %i sites up', (count, targets) => {
    const model = workspace(
      Array.from({ length: count }, (_, index) => site(`s${index}`, { wave: 'wp-w1' })),
    )
    expect(progress('week', AT, model).current!.checkpoints.map((c) => c.target)).toEqual(targets)
  })

  it('is reached only by a day on or before the time point', () => {
    // On the 13th, B's actual day (the 14th) has not come: two of four is
    // not reached, and its planned 12th has passed.
    expect(progress('week', '2027-01-13').current!.checkpoints[1]).toEqual({
      percent: 50,
      target: 2,
      plannedBy: '2027-01-12',
      plannedAt: dayStart('2027-01-12'),
      status: 'late',
    })
  })

  it('is not planned when the plan never migrates that many', () => {
    const sites = SITES.map((plan) =>
      plan.location === 'c' || plan.location === 'd' ? site(plan.location) : plan,
    )
    const model = workspace(sites)
    // C and D in no wave: W1 is A and B, both migrated, so W2 is current;
    // with its wave's date taken away, nothing plans it.
    const w2 = model.elements.find((element) => element.id === 'wp-w2')!
    delete (w2.plan as { milestones?: unknown }).milestones
    const { current } = progress('week', AT, model)
    expect(current!.wave.element.id).toBe('wp-w2')
    // Of two sites: a quarter and a half are one site, three quarters both.
    expect(current!.checkpoints.map((checkpoint) => checkpoint.target)).toEqual([1, 1, 2])
    expect(current!.checkpoints.map((checkpoint) => checkpoint.status)).toEqual([
      'unplanned',
      'unplanned',
      'unplanned',
    ])
  })

  it('is none once every site of every wave is migrated', () => {
    const sites = ['a', 'b', 'c', 'd', 'e', 'f'].map((location, index) =>
      site(location, { wave: index < 4 ? 'wp-w1' : 'wp-w2', actuals: { stable: '2027-01-02' } }),
    )
    const chart = progress('week', AT, workspace(sites))
    expect(chart.current).toBeUndefined()
    expect([chart.migrated, chart.notMigrated, chart.scope]).toEqual([6, 0, 6])
  })
})

describe('the burn-up drawn', () => {
  it('starts both lines at zero and ends the actual line at the time point', () => {
    const chart = burnUpChart(progress('month'))!
    const planned = vertices(chart.planned)
    const actual = vertices(chart.actual)
    // A start at zero, then one vertex per month; the actual line has one month.
    expect(planned).toHaveLength(4)
    expect(actual).toHaveLength(2)
    expect(actual[0]).toEqual(planned[0])
    expect(actual[1]![0]).toBe(chart.timePoint)
    // Three of seven sites, the same height as the planned line's first month.
    expect(actual[1]![1]).toBe(planned[1]![1])
    expect(planned[3]![1]).toBeLessThan(planned[1]![1]!)
    // The checkpoints still to come and passed, at their planned days.
    expect(chart.checkpoints.map((checkpoint) => [checkpoint.percent, checkpoint.status])).toEqual([
      [25, 'met'],
      [50, 'met'],
      [75, 'due'],
    ])
  })

  it('holds the time point on the axis, with the actual line at zero, before any migration', () => {
    // A rollout planned well ahead: at 2026-01-01 the axis begins at the time point.
    const chart = burnUpChart(progress('month', '2026-01-01'))!
    expect(chart.actual).not.toBe('')
    expect(chart.timePoint).toBe(CHART.left)
    expect(vertices(chart.actual).map(([, y]) => y)).toEqual([
      CHART.height - CHART.bottom,
      CHART.height - CHART.bottom,
    ])
  })

  it('draws a passed period’s actual count where the planned one is, at its end', () => {
    const chart = burnUpChart(progress('week'))!
    const planned = vertices(chart.planned)
    const actual = vertices(chart.actual)
    // 2026-W53 and 2027-W01 have passed: both lines step at their ends.
    expect(actual[1]![0]).toBe(planned[1]![0])
    expect(actual[2]![0]).toBe(planned[2]![0])
    // The week of the time point is drawn at the time point.
    expect(actual[3]![0]).toBe(chart.timePoint)
  })

  it('labels the axis with its first period when no quarter starts on it', () => {
    // Every date in February 2027: the axis is three weeks inside Q1.
    const model = workspace([
      site('a', {
        wave: 'wp-w1',
        milestones: { stable: day('2027-02-03') },
        actuals: { stable: '2027-02-05' },
      }),
      site('b', { wave: 'wp-w1', milestones: { stable: day('2027-02-12') } }),
    ])
    const chart = burnUpChart(progress('week', '2027-02-10', model))!
    expect(chart.xTicks).toEqual([{ x: CHART.left, label: '2027-W05' }])
  })
})
