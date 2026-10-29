import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayStart,
  formatPlanDate,
  type PlanDate,
  type RolloutPlan,
  type WavePlan,
} from './plan'
import { ROLLOUT_PRESETS, presetPlan } from './presets'
import {
  deriveSitePhase,
  overdueMilestones,
  phaseInputs,
  reachedAt,
  resolveSiteMilestones,
  siteStatus,
  switchMilestone,
  type PhaseInput,
} from './site-phase'

/**
 * The derived site phase and milestone resolution (#213, ADR 0013 points 5
 * and 6, ADR 0016), in the shape of `lifecycle.test.ts`: the proposal's rule
 * written out literally as the reference, then a table of the cases it does
 * not spell out.
 */

const day = (iso: string): PlanDate => ({ date: iso, precision: 'day' })
const at = (iso: string) => dayStart(iso)

/** The generic preset with a planned day for each milestone. */
const GENERIC_DATES = {
  readiness: '2027-03-01',
  goNoGo: '2027-04-05',
  cutover: '2027-04-12',
  hypercareEnd: '2027-05-10',
  legacyRetired: '2027-08-09',
}

function generic(dates: Partial<typeof GENERIC_DATES>, actuals: Record<string, string> = {}) {
  return ROLLOUT_PRESETS.generic.milestones.map((milestone): PhaseInput => ({
    startsPhase: milestone.startsPhase,
    ...(dates[milestone.id as keyof typeof GENERIC_DATES]
      ? { planned: day(dates[milestone.id as keyof typeof GENERIC_DATES]!) }
      : {}),
    ...(actuals[milestone.id] ? { actual: actuals[milestone.id] } : {}),
  }))
}

/** The proposal's rule for the generic preset (§4.5), written out literally. */
function specRule(t: string): string {
  if (t < GENERIC_DATES.readiness) return 'planned'
  if (t < GENERIC_DATES.cutover) return 'preparing'
  if (t < GENERIC_DATES.hypercareEnd) return 'hypercare'
  if (t < GENERIC_DATES.legacyRetired) return 'migrated'
  return 'done'
}

describe('the derived site phase (#213)', () => {
  it('matches the proposal’s rule for the generic preset on every day of the plan', () => {
    const inputs = generic(GENERIC_DATES)
    let t = '2027-01-01'
    const seen = new Set<string>()
    while (t < '2027-12-31') {
      const phase = deriveSitePhase(inputs, true, at(t))
      expect(phase, t).toBe(specRule(t))
      seen.add(phase)
      t = addDays(t, 1)
    }
    expect([...seen].sort()).toEqual(['done', 'hypercare', 'migrated', 'planned', 'preparing'])
  })

  it('switches exactly on the milestone’s day, not a moment before', () => {
    const inputs = generic(GENERIC_DATES)
    expect(deriveSitePhase(inputs, true, at('2027-04-12') - 1)).toBe('preparing')
    expect(deriveSitePhase(inputs, true, at('2027-04-12'))).toBe('hypercare')
  })

  it.each([
    // [case, dates, actuals, time point, phase]
    ['a time point before every milestone', GENERIC_DATES, {}, '2026-06-01', 'planned'],
    ['no dates at all', {}, {}, '2027-06-01', 'planned'],
    ['only a cutover, before it', { cutover: '2027-04-12' }, {}, '2027-04-11', 'planned'],
    ['only a cutover, after it', { cutover: '2027-04-12' }, {}, '2027-06-01', 'hypercare'],
    [
      'only the last milestone, after it',
      { legacyRetired: '2027-08-09' },
      {},
      '2027-09-01',
      'done',
    ],
    [
      'a gap in the middle: readiness and hypercare end only',
      { readiness: '2027-03-01', hypercareEnd: '2027-05-10' },
      {},
      '2027-04-20',
      'preparing',
    ],
    [
      'an actual before the planned date: reached on the actual',
      GENERIC_DATES,
      { cutover: '2027-04-01' },
      '2027-04-05',
      'hypercare',
    ],
    [
      'an actual after the planned date: not reached until the actual',
      GENERIC_DATES,
      { cutover: '2027-04-20' },
      '2027-04-15',
      'preparing',
    ],
    ['an actual with no planned date', {}, { readiness: '2027-02-01' }, '2027-02-02', 'preparing'],
  ] as const)('%s', (_, dates, actuals, t, phase) => {
    expect(deriveSitePhase(generic(dates, actuals), true, at(t))).toBe(phase)
  })

  // ADR 0016 point 4, amended 2026-10-28: a site in no wave is Unplanned only
  // while it has reached no actual date; then its phase follows its actuals.
  it('is Unplanned for a site in no wave with no actual date, whatever its planned dates say', () => {
    const inputs = generic(GENERIC_DATES)
    expect(deriveSitePhase(inputs, false, at('2027-06-01'))).toBe('unplanned')
    expect(deriveSitePhase(inputs, true, at('2027-06-01'))).toBe('migrated')
  })

  it('follows the actual dates of a site in no wave, and only those', () => {
    // An actual cutover: Hypercare from that day, Unplanned the day before.
    const cutover = generic({}, { cutover: '2027-04-20' })
    expect(deriveSitePhase(cutover, false, at('2027-04-19'))).toBe('unplanned')
    expect(deriveSitePhase(cutover, false, at('2027-04-20'))).toBe('hypercare')
    // Its planned dates are past, and do not count: only the actual readiness does.
    const planned = generic(GENERIC_DATES, { readiness: '2027-02-01' })
    expect(deriveSitePhase(planned, false, at('2027-06-01'))).toBe('preparing')
    expect(deriveSitePhase(planned, true, at('2027-06-01'))).toBe('migrated')
  })

  it('reaches a quarter-precision milestone on the first day of its quarter', () => {
    const inputs: PhaseInput[] = [
      { startsPhase: 'preparing', planned: { date: '2027-07-01', precision: 'quarter' } },
    ]
    expect(deriveSitePhase(inputs, true, at('2027-06-30'))).toBe('planned')
    expect(deriveSitePhase(inputs, true, at('2027-07-01'))).toBe('preparing')
  })
})

describe('the overdue flag (#213)', () => {
  it('is set once a planned date’s whole period has passed with no actual', () => {
    const inputs = generic({ cutover: '2027-04-12' })
    expect(overdueMilestones(inputs, at('2027-04-12'))).toEqual([])
    expect(overdueMilestones(inputs, at('2027-04-13'))).toHaveLength(1)
  })

  it('is not set when the milestone has an actual, early or late', () => {
    expect(
      overdueMilestones(
        generic({ cutover: '2027-04-12' }, { cutover: '2027-04-20' }),
        at('2027-06-01'),
      ),
    ).toEqual([])
  })

  it('waits for the end of a coarse period: a quarter is overdue only once it is over', () => {
    const inputs: PhaseInput[] = [
      { startsPhase: 'cutover', planned: { date: '2027-04-01', precision: 'quarter' } },
    ]
    expect(overdueMilestones(inputs, at('2027-06-30'))).toEqual([])
    expect(overdueMilestones(inputs, at('2027-07-01'))).toHaveLength(1)
  })
})

// ── Resolution ───────────────────────────────────────────────────────────────

/** A generic-preset rollout whose Standard archetype spaces its milestones. */
function rollout(extra: Partial<RolloutPlan> = {}): RolloutPlan {
  return {
    kind: 'rollout',
    templateVersion: 1,
    ...presetPlan(ROLLOUT_PRESETS.generic),
    template: [],
    sites: [],
    ...extra,
  }
}

const wave = (milestones?: Record<string, PlanDate>): WavePlan => ({
  kind: 'wave',
  rollout: 'r',
  label: 'W1',
  order: 1,
  templateVersion: 1,
  ...(milestones ? { milestones } : {}),
})

const resolvedOf = (resolved: ReturnType<typeof resolveSiteMilestones>, id: string) =>
  resolved.find((entry) => entry.milestone.id === id)!

describe('resolving a site’s milestone dates (#213, ADR 0016)', () => {
  it('takes the site’s own date, which is set, over its wave’s', () => {
    const resolved = resolveSiteMilestones(
      rollout(),
      { location: 'l', milestones: { cutover: day('2027-04-14') } },
      wave({ cutover: day('2027-04-12') }),
    )
    expect(resolvedOf(resolved, 'cutover')).toMatchObject({
      planned: day('2027-04-14'),
      source: 'site',
    })
  })

  it('inherits the wave’s date when the site sets none', () => {
    const resolved = resolveSiteMilestones(
      rollout(),
      { location: 'l' },
      wave({ cutover: day('2027-04-12') }),
    )
    expect(resolvedOf(resolved, 'cutover')).toMatchObject({
      planned: day('2027-04-12'),
      source: 'wave',
    })
  })

  it('inherits the rollout’s date when neither the site nor its wave sets one', () => {
    const plan = rollout()
    plan.milestones[2] = {
      ...plan.milestones[2]!,
      date: { date: '2027-04-01', precision: 'quarter' },
    }
    const resolved = resolveSiteMilestones(plan, { location: 'l' }, wave())
    expect(resolvedOf(resolved, 'cutover')).toMatchObject({
      planned: { date: '2027-04-01', precision: 'quarter' },
      source: 'rollout',
    })
  })

  it('gives a site in no wave the rollout’s dates and none of a wave’s', () => {
    const plan = rollout()
    plan.milestones[0] = { ...plan.milestones[0]!, date: day('2027-03-01') }
    const resolved = resolveSiteMilestones(plan, { location: 'l' }, undefined)
    expect(resolvedOf(resolved, 'readiness').source).toBe('rollout')
  })

  it('spaces later milestones forward from an anchor by the archetype’s durations', () => {
    const resolved = resolveSiteMilestones(
      rollout(),
      { location: 'l', archetype: 'standard' },
      wave({ readiness: day('2027-03-01') }),
    )
    // Generic: go/no-go 28 days on, cutover 7, hypercare end 28, legacy 90.
    expect(resolved.map((entry) => entry.planned?.date)).toEqual([
      '2027-03-01',
      '2027-03-29',
      '2027-04-05',
      '2027-05-03',
      '2027-08-01',
    ])
    expect(resolvedOf(resolved, 'cutover')).toMatchObject({
      source: 'spaced',
      spacedFrom: { milestone: 'goNoGo', days: 7 },
    })
  })

  it('spaces earlier milestones backward from a later anchor', () => {
    const resolved = resolveSiteMilestones(
      rollout(),
      { location: 'l', archetype: 'standard' },
      wave({ cutover: day('2027-04-12') }),
    )
    expect(resolvedOf(resolved, 'goNoGo')).toMatchObject({
      planned: day('2027-04-05'),
      source: 'spaced',
      spacedFrom: { milestone: 'cutover', days: -7 },
    })
    expect(resolvedOf(resolved, 'readiness').planned).toEqual(day('2027-03-08'))
  })

  it('keeps the anchor’s precision, and carries the exact day along the chain', () => {
    const resolved = resolveSiteMilestones(
      rollout(),
      { location: 'l', archetype: 'standard' },
      wave({ readiness: { date: '2027-01-01', precision: 'quarter' } }),
    )
    // 1 Jan + 28 + 7 + 28 = 4 March: still Q1. A chain that rounded at each
    // step would be at 1 Jan for ever; + 90 more is 2 June, Q2.
    expect(resolved.map((entry) => entry.planned)).toEqual([
      { date: '2027-01-01', precision: 'quarter' },
      { date: '2027-01-01', precision: 'quarter' },
      { date: '2027-01-01', precision: 'quarter' },
      { date: '2027-01-01', precision: 'quarter' },
      { date: '2027-04-01', precision: 'quarter' },
    ])
  })

  it('spaces nothing for a site with no archetype', () => {
    const resolved = resolveSiteMilestones(
      rollout(),
      { location: 'l' },
      wave({ readiness: day('2027-03-01') }),
    )
    expect(resolved.filter((entry) => entry.planned)).toHaveLength(1)
  })

  it('lets a site’s own date anchor the spacing after it', () => {
    const resolved = resolveSiteMilestones(
      rollout(),
      { location: 'l', archetype: 'standard', milestones: { cutover: day('2027-04-14') } },
      wave(),
    )
    expect(resolvedOf(resolved, 'hypercareEnd').planned).toEqual(day('2027-05-12'))
  })

  it('derives the phase of a spaced date from the chain’s exact day, and shows it at the anchor’s precision', () => {
    // The #229 review's example: a wave that says only `readiness: 2027-Q3`,
    // the generic preset, the Standard archetype. Every later milestone is
    // shown as 2027-Q3 (legacy retired, 90 days after hypercare, as Q4); were
    // each reached on its period's first day, the site would read Migrated on
    // 1 July and Done on 1 October, before any cutover.
    const plan = rollout()
    const site = { location: 'l', archetype: 'standard' }
    const q3 = wave({ readiness: { date: '2027-07-01', precision: 'quarter' } })
    const shown = resolveSiteMilestones(plan, site, q3).map((entry) =>
      formatPlanDate(entry.planned!),
    )
    expect(shown).toEqual(['2027-Q3', '2027-Q3', '2027-Q3', '2027-Q3', '2027-Q4'])
    // Readiness is the wave's own date, so it is reached on the quarter's
    // first day; go/no-go is 28 days on (29 July), cutover 7 more (5 August),
    // hypercare end 28 more (2 September), legacy retired 90 more (1 December).
    const phase = (t: string) => siteStatus(plan, site, q3, at(t)).phase
    expect(phase('2027-06-30')).toBe('planned')
    expect(phase('2027-07-01')).toBe('preparing')
    expect(phase('2027-08-04')).toBe('preparing')
    expect(phase('2027-08-05')).toBe('hypercare')
    expect(phase('2027-09-02')).toBe('migrated')
    expect(phase('2027-10-01')).toBe('migrated')
    expect(phase('2027-12-01')).toBe('done')
  })

  it('derives the phase of a date spaced backward from its exact day too', () => {
    // A rule applied with a sign is two cases (CLAUDE.md): the wave says only
    // `cutover: 2027-Q3`, so go/no-go is 7 days before 1 July (24 June) and
    // readiness 28 before that, 27 May, shown as 2027-Q2. Reached on the
    // quarter's first day, the site would be Preparing from 1 April.
    const plan = rollout()
    const site = { location: 'l', archetype: 'standard' }
    const q3 = wave({ cutover: { date: '2027-07-01', precision: 'quarter' } })
    const readiness = resolvedOf(resolveSiteMilestones(plan, site, q3), 'readiness')
    expect(readiness).toMatchObject({
      planned: { date: '2027-04-01', precision: 'quarter' },
      source: 'spaced',
      spacedFrom: { milestone: 'goNoGo', days: -28, day: '2027-05-27' },
    })
    const phase = (t: string) => siteStatus(plan, site, q3, at(t)).phase
    expect(phase('2027-04-01')).toBe('planned')
    expect(phase('2027-05-26')).toBe('planned')
    expect(phase('2027-05-27')).toBe('preparing')
  })

  it('reaches a milestone on its actual day before its spaced day, and its spaced day before its period', () => {
    // A precedence order is a guard per adjacent pair (CLAUDE.md).
    const plan = rollout()
    const q3 = wave({ readiness: { date: '2027-07-01', precision: 'quarter' } })
    // Actual over spaced: the spaced cutover is 5 August, the actual 20 August.
    const late = { location: 'l', archetype: 'standard', actuals: { cutover: '2027-08-20' } }
    const phase = (t: string) => siteStatus(plan, late, q3, at(t)).phase
    expect(phase('2027-08-05')).toBe('preparing')
    expect(phase('2027-08-19')).toBe('preparing')
    expect(phase('2027-08-20')).toBe('hypercare')
    // Early as well as late (ADR 0016 point 4): an actual of 20 July is
    // reached on 20 July, not on the spaced 5 August.
    const early = { location: 'l', archetype: 'standard', actuals: { cutover: '2027-07-20' } }
    expect(siteStatus(plan, early, q3, at('2027-07-19')).phase).toBe('preparing')
    expect(siteStatus(plan, early, q3, at('2027-07-20')).phase).toBe('hypercare')
    // Spaced over period: the same cutover, with no actual, is shown as
    // 2027-Q3 and reached on 5 August, not on 1 July.
    const site = { location: 'l', archetype: 'standard' }
    expect(siteStatus(plan, site, q3, at('2027-08-04')).phase).toBe('preparing')
    expect(siteStatus(plan, site, q3, at('2027-08-05')).phase).toBe('hypercare')
    // And the inputs say the same, read one by one.
    const input = {
      startsPhase: 'hypercare',
      planned: { date: '2027-07-01', precision: 'quarter' },
    } as const
    expect(reachedAt({ ...input, spacedDay: '2027-08-05', actual: '2027-08-20' })).toBe(
      at('2027-08-20'),
    )
    expect(reachedAt({ ...input, spacedDay: '2027-08-05', actual: '2027-07-20' })).toBe(
      at('2027-07-20'),
    )
    expect(reachedAt({ ...input, spacedDay: '2027-08-05' })).toBe(at('2027-08-05'))
    expect(reachedAt(input)).toBe(at('2027-07-01'))
    expect(reachedAt({ startsPhase: 'hypercare' })).toBeUndefined()
  })

  it('flags a spaced date overdue only once the period it is shown at has ended', () => {
    const plan = rollout()
    const site = { location: 'l', archetype: 'standard' }
    const q3 = wave({ readiness: { date: '2027-07-01', precision: 'quarter' } })
    // Hypercare end's exact day is 2 September, but it is shown as 2027-Q3.
    expect(siteStatus(plan, site, q3, at('2027-09-30')).overdue).toBe(false)
    expect(siteStatus(plan, site, q3, at('2027-10-01')).overdue).toBe(true)
  })

  it('carries the spaced date’s exact day into the phase inputs, and nothing for a set one', () => {
    const resolved = resolveSiteMilestones(
      rollout(),
      { location: 'l', archetype: 'standard' },
      wave({ readiness: { date: '2027-07-01', precision: 'quarter' } }),
    )
    expect(phaseInputs(resolved).map((input) => input.spacedDay)).toEqual([
      undefined,
      '2027-07-29',
      '2027-08-05',
      '2027-09-02',
      '2027-12-01',
    ])
  })

  it('a site in no wave is never overdue, and follows its actual cutover (ADR 0016, amended)', () => {
    const plan = rollout()
    plan.milestones = plan.milestones.map((milestone) => ({
      ...milestone,
      date: day(GENERIC_DATES[milestone.id as keyof typeof GENERIC_DATES]),
    }))
    // Past rollout dates and no actual: Unplanned, not overdue. The same site
    // in a wave is both Migrated and overdue, so it is the wave that decides.
    expect(siteStatus(plan, { location: 'l' }, undefined, at('2027-06-01'))).toMatchObject({
      phase: 'unplanned',
      overdue: false,
    })
    expect(siteStatus(plan, { location: 'l' }, wave(), at('2027-06-01'))).toMatchObject({
      phase: 'migrated',
      overdue: true,
    })
    // An actual cutover: its phase follows it, and it is still not overdue.
    const cutover = { location: 'l', actuals: { cutover: '2027-04-20' } }
    expect(siteStatus(plan, cutover, undefined, at('2027-06-01'))).toMatchObject({
      phase: 'hypercare',
      overdue: false,
    })
  })

  it('reads the site’s actual dates into the phase', () => {
    const status = siteStatus(
      rollout(),
      { location: 'l', actuals: { readiness: '2027-02-01' } },
      wave(),
      at('2027-02-02'),
    )
    expect(status).toMatchObject({ phase: 'preparing', overdue: false })
    expect(siteStatus(rollout(), { location: 'l' }, undefined, at('2027-02-02')).phase).toBe(
      'unplanned',
    )
  })
})

describe('the milestone a site switches over at (#213)', () => {
  it('is the first that starts Cutover', () => {
    expect(switchMilestone(ROLLOUT_PRESETS.dataMigration.milestones)?.id).toBe('freezeStart')
  })

  it('is the first that starts Hypercare in a set with no Cutover phase', () => {
    expect(switchMilestone(ROLLOUT_PRESETS.generic.milestones)?.id).toBe('cutover')
  })

  it('is none in a set with neither', () => {
    expect(switchMilestone([{ id: 'go', label: 'Go', startsPhase: 'preparing' }])).toBeUndefined()
  })
})

describe('the presets are data (#213, proposal §4.8)', () => {
  it('the data-migration preset is the proposal’s table, in order', () => {
    expect(ROLLOUT_PRESETS.dataMigration.milestones.map((m) => [m.id, m.startsPhase])).toEqual([
      ['mappingSignedOff', 'preparing'],
      ['mockLoad1', 'preparing'],
      ['mockLoad2', 'preparing'],
      ['dressRehearsal', 'preparing'],
      ['goNoGo', 'preparing'],
      ['freezeStart', 'cutover'],
      ['reconciliationSignedOff', 'hypercare'],
      ['hypercareEnd', 'migrated'],
      ['legacyReadOnly', 'migrated'],
      ['legacyDecommissioned', 'done'],
    ])
  })

  it('gives each rollout its own copy, so editing one never edits the preset', () => {
    const plan = presetPlan(ROLLOUT_PRESETS.generic)
    plan.milestones[0]!.label = 'Changed'
    plan.archetypes[0]!.durations!.goNoGo = 1
    expect(ROLLOUT_PRESETS.generic.milestones[0]!.label).toBe('Readiness starts')
    expect(ROLLOUT_PRESETS.generic.durations.goNoGo).toBe(28)
  })
})
