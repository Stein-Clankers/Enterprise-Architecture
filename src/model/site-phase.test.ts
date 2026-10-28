import { describe, expect, it } from 'vitest'
import { addDays, dayStart, type PlanDate, type RolloutPlan, type WavePlan } from './plan'
import { ROLLOUT_PRESETS, presetPlan } from './presets'
import {
  deriveSitePhase,
  overdueMilestones,
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

  it('is Unplanned for a site in no wave, whatever its dates say', () => {
    const inputs = generic(GENERIC_DATES, { readiness: '2027-02-01' })
    expect(deriveSitePhase(inputs, false, at('2027-06-01'))).toBe('unplanned')
    expect(deriveSitePhase(inputs, true, at('2027-06-01'))).toBe('migrated')
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
