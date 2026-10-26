import { describe, expect, it } from 'vitest'
import { ROLLOUT_ID, rolloutWorkspace, waveId } from '@/test/rollout-fixture'
import {
  archetypeIdOf,
  formatPlanDate,
  isAnchoredDate,
  isApplicability,
  isArchetype,
  isBlackout,
  isChangeEntry,
  isIsoDay,
  isMilestone,
  isPlanDate,
  isRolloutPlan,
  isSitePlan,
  isTemplateChange,
  isWavePlan,
  parsePlanDate,
  rolloutPlanOf,
  toPlanDate,
  waveIdOf,
  wavesOf,
  type PlanDate,
  type TemplateChange,
  type WavePlan,
} from './plan'
import type { Element } from './workspace'

describe('plan dates (#209, ADR 0013 point 5)', () => {
  it('reads and writes each precision in the form people write it', () => {
    const cases: [string, PlanDate][] = [
      ['2027-Q2', { date: '2027-04-01', precision: 'quarter' }],
      ['2027-05', { date: '2027-05-01', precision: 'month' }],
      ['2027-W19', { date: '2027-05-10', precision: 'week' }],
      ['2027-05-12', { date: '2027-05-12', precision: 'day' }],
    ]
    for (const [text, date] of cases) {
      expect(parsePlanDate(text)).toEqual(date)
      expect(formatPlanDate(date)).toBe(text)
      expect(isPlanDate(date)).toBe(true)
    }
  })

  it('numbers weeks as ISO 8601 does, across a year boundary', () => {
    // 2026-12-28 is a Monday in week 53 of 2026; 2027-01-04 starts week 1 of 2027.
    expect(formatPlanDate({ date: '2026-12-28', precision: 'week' })).toBe('2026-W53')
    expect(parsePlanDate('2026-W53')).toEqual({ date: '2026-12-28', precision: 'week' })
    expect(parsePlanDate('2027-W01')).toEqual({ date: '2027-01-04', precision: 'week' })
    // 2025-12-29 is the Monday of week 1 of 2026.
    expect(formatPlanDate({ date: '2025-12-29', precision: 'week' })).toBe('2026-W01')
  })

  it('round-trips every Monday and every first of the month over four years', () => {
    for (let day = Date.UTC(2026, 0, 1); day < Date.UTC(2030, 0, 1); day += 86_400_000) {
      const iso = new Date(day).toISOString().slice(0, 10)
      for (const precision of ['quarter', 'month', 'week', 'day'] as const) {
        const date = toPlanDate(iso, precision)
        if (date) expect(parsePlanDate(formatPlanDate(date))).toEqual(date)
      }
    }
  })

  it('refuses a week the year does not have, and anything that is not one of the four forms', () => {
    expect(parsePlanDate('2027-W53')).toBeUndefined()
    expect(parsePlanDate('2027-W00')).toBeUndefined()
    for (const text of ['2027-Q5', '2027-13', '2027-02-30', '27-05', '2027/05/12', '', 'Q2 2027']) {
      expect(parsePlanDate(text), text).toBeUndefined()
    }
  })

  it('holds a period by its first day, so a period has one spelling (ADR 0004)', () => {
    expect(isPlanDate({ date: '2027-04-01', precision: 'quarter' })).toBe(true)
    expect(isPlanDate({ date: '2027-05-01', precision: 'quarter' })).toBe(false)
    expect(isPlanDate({ date: '2027-05-12', precision: 'month' })).toBe(false)
    expect(isPlanDate({ date: '2027-05-11', precision: 'week' })).toBe(false)
  })

  it('a form value that is not a plan date yields undefined, not a value the schema rejects', () => {
    expect(toPlanDate('', 'day')).toBeUndefined()
    expect(toPlanDate('2027-05-12', '')).toBeUndefined()
    expect(toPlanDate('2027-05-12', 'fortnight')).toBeUndefined()
    expect(toPlanDate('2027-02-30', 'day')).toBeUndefined()
    expect(toPlanDate('2027-05-12', 'day')).toEqual({ date: '2027-05-12', precision: 'day' })
  })

  it('takes only the two keys, so nothing it holds is dropped unseen', () => {
    expect(isPlanDate({ date: '2027-05-12', precision: 'day', note: 'x' })).toBe(false)
    expect(isIsoDay('2027-5-12')).toBe(false)
    expect(isIsoDay('0099-01-01')).toBe(true)
  })
})

describe('the plan guards (#209)', () => {
  const workspace = rolloutWorkspace(12)
  const rollout = rolloutPlanOf(workspace.elements.find((element) => element.id === ROLLOUT_ID))!

  it('accept the fixture: a rollout and its waves', () => {
    expect(isRolloutPlan(rollout)).toBe(true)
    for (const element of workspace.elements) {
      if (element.plan?.kind === 'wave') expect(isWavePlan(element.plan)).toBe(true)
    }
  })

  it('accept every kind of change entry, and refuse a field on the wrong kind', () => {
    for (const change of rollout.template) {
      expect(isTemplateChange(change), change.id).toBe(true)
      const { applicability: _, ...entry } = change
      expect(isChangeEntry(entry), change.id).toBe(true)
      // A change entry carries no applicability; only a template change does.
      expect(isChangeEntry(change), change.id).toBe(false)
    }
    const base = { id: 'c', subject: 'e', date: { anchor: 'm', offsetDays: 3 } }
    expect(isChangeEntry({ ...base, kind: 'retire', successor: 'x' })).toBe(false)
    expect(isChangeEntry({ ...base, kind: 'replace' })).toBe(false)
    expect(isChangeEntry({ ...base, kind: 'modify', field: 'technicalFit', value: 5 })).toBe(false)
    expect(isChangeEntry({ ...base, kind: 'modify', field: 'technicalFit', value: 'Invest' })).toBe(
      false,
    )
    expect(
      isChangeEntry({ ...base, kind: 'modify', field: 'timeClassification', value: 'Invest' }),
    ).toBe(true)
    expect(isChangeEntry({ ...base, kind: 'modify', field: 'owner', value: 'x' })).toBe(false)
    expect(isChangeEntry({ ...base, kind: 'rename' })).toBe(false)
  })

  it('refuse an anchored date that is not a whole number of days', () => {
    expect(isAnchoredDate({ anchor: 'cutover', offsetDays: 30 })).toBe(true)
    expect(isAnchoredDate({ anchor: 'cutover', offsetDays: 1.5 })).toBe(false)
    expect(isAnchoredDate({ anchor: '', offsetDays: 1 })).toBe(false)
  })

  it('refuse an applicability with no archetypes, or the same one twice', () => {
    expect(isApplicability({ kind: 'archetypes', archetypes: [] })).toBe(false)
    expect(isApplicability({ kind: 'archetypes', archetypes: ['a', 'a'] })).toBe(false)
    expect(isApplicability({ kind: 'some' })).toBe(false)
  })

  it('refuse a rollout with two milestones, archetypes or site plans of one id', () => {
    const twice = <T>(list: T[]): T[] => [...list, list[0]!]
    expect(isRolloutPlan({ ...rollout, milestones: twice(rollout.milestones) })).toBe(false)
    expect(isRolloutPlan({ ...rollout, archetypes: twice(rollout.archetypes) })).toBe(false)
    expect(isRolloutPlan({ ...rollout, sites: twice(rollout.sites) })).toBe(false)
    expect(isRolloutPlan({ ...rollout, template: twice(rollout.template) })).toBe(false)
  })

  it('refuse every shape with a key they do not know', () => {
    const extra = { surprise: true }
    expect(isRolloutPlan({ ...rollout, ...extra })).toBe(false)
    expect(isMilestone({ ...rollout.milestones[0], ...extra })).toBe(false)
    expect(isArchetype({ ...rollout.archetypes[0], ...extra })).toBe(false)
    expect(isBlackout({ ...rollout.constraints!.blackouts![0], ...extra })).toBe(false)
    expect(isSitePlan({ ...rollout.sites[0], ...extra })).toBe(false)
    expect(isTemplateChange({ ...rollout.template[0], ...extra } as TemplateChange)).toBe(false)
    const wave = workspace.elements.find((element) => element.id === waveId(1))!.plan as WavePlan
    expect(isWavePlan({ ...wave, ...extra })).toBe(false)
  })

  it('refuse a blackout that ends before it starts, and a capacity of nought', () => {
    expect(isBlackout({ id: 'b', start: '2027-02-01', end: '2027-01-31' })).toBe(false)
    const wave = workspace.elements.find((element) => element.id === waveId(1))!.plan as WavePlan
    expect(isWavePlan({ ...wave, capacity: 0 })).toBe(false)
    expect(isWavePlan({ ...wave, templateVersion: 0 })).toBe(false)
  })

  it('refuse a site plan with an empty reference, a bad date or empty notes', () => {
    expect(isSitePlan({ location: '' })).toBe(false)
    expect(isSitePlan({ location: 'l', wave: '' })).toBe(false)
    expect(isSitePlan({ location: 'l', actuals: { cutover: '2027-02-30' } })).toBe(false)
    expect(
      isSitePlan({
        location: 'l',
        milestones: { cutover: { date: '2027-05-12', precision: 'week' } },
      }),
    ).toBe(false)
    expect(isSitePlan({ location: 'l', rag: 'blue' })).toBe(false)
    expect(isSitePlan({ location: 'l', notes: 'kept' })).toBe(true)
  })
})

describe('the write path’s doors (#209)', () => {
  const workspace = rolloutWorkspace(12)
  const byId = new Map(workspace.elements.map((element) => [element.id, element]))
  const element = (id: string) => byId.get(id)
  const plan = rolloutPlanOf(byId.get(ROLLOUT_ID))!

  it('let a wave of the rollout through', () => {
    expect(waveIdOf(waveId(2), ROLLOUT_ID, element)).toBe(waveId(2))
  })

  it('stop an empty <select> value, an unknown id, a non-wave and another rollout’s wave', () => {
    const other: Element = {
      id: 'wp-other-wave',
      type: 'WorkPackage',
      name: 'Other',
      properties: {},
      plan: { kind: 'wave', rollout: 'wp-other', label: 'X', order: 1, templateVersion: 1 },
    }
    byId.set(other.id, other)
    for (const value of ['', 'wp-nope', 'loc-emea', ROLLOUT_ID, other.id, undefined, null, 3]) {
      expect(waveIdOf(value, ROLLOUT_ID, element), String(value)).toBeUndefined()
    }
  })

  it('let only the rollout’s own archetypes through', () => {
    expect(archetypeIdOf('plant', plan)).toBe('plant')
    for (const value of ['', 'Plant', 'warehouse', null, undefined]) {
      expect(archetypeIdOf(value, plan), String(value)).toBeUndefined()
    }
  })

  it('list a rollout’s waves by order, then id', () => {
    const tied: Element = {
      ...byId.get(waveId(1))!,
      id: 'wp-wave-0b',
      plan: { ...(byId.get(waveId(1))!.plan as WavePlan), order: 0 },
    }
    const waves = wavesOf([...workspace.elements, tied], ROLLOUT_ID).map((wave) => wave.id)
    expect(waves).toEqual([waveId(0), 'wp-wave-0b', waveId(1), waveId(2), waveId(3), waveId(4)])
  })
})
