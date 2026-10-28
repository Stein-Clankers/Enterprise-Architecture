import { describe, expect, it } from 'vitest'
import {
  PLAN_DATE_PRECISIONS,
  addDays,
  dayAfterPeriod,
  formatPlanDate,
  isPlanDate,
  isWindowInOrder,
  parsePlanDate,
  periodOf,
  type PlanDate,
} from './plan'

/**
 * The calendar arithmetic of plan dates (#213, #227). `dayAfterPeriod` and
 * `periodOf` each switch over the precision, so each case has a test of its
 * own, with a fixture that reaches it and that a near miss would fail: a
 * quarter that ran two months, or a week of six days (CLAUDE.md, a switch over
 * a precision).
 */

describe('dayAfterPeriod, one case per precision (#227)', () => {
  it('quarter: the first day of the next quarter, across a year end too', () => {
    expect(dayAfterPeriod({ date: '2027-04-01', precision: 'quarter' })).toBe('2027-07-01')
    expect(dayAfterPeriod({ date: '2027-10-01', precision: 'quarter' })).toBe('2028-01-01')
  })

  it('month: the first day of the next month, across a year end too', () => {
    expect(dayAfterPeriod({ date: '2027-02-01', precision: 'month' })).toBe('2027-03-01')
    expect(dayAfterPeriod({ date: '2027-12-01', precision: 'month' })).toBe('2028-01-01')
  })

  it('week: the Monday seven days on, across a month end too', () => {
    expect(dayAfterPeriod({ date: '2027-05-10', precision: 'week' })).toBe('2027-05-17')
    expect(dayAfterPeriod({ date: '2027-05-31', precision: 'week' })).toBe('2027-06-07')
  })

  it('day: the next day, across a leap day too', () => {
    expect(dayAfterPeriod({ date: '2027-02-28', precision: 'day' })).toBe('2027-03-01')
    expect(dayAfterPeriod({ date: '2028-02-28', precision: 'day' })).toBe('2028-02-29')
  })

  it('decides whether a window ending in a quarter runs past a week that starts in it', () => {
    const start: PlanDate = { date: '2027-06-28', precision: 'week' }
    expect(isWindowInOrder(start, { date: '2027-04-01', precision: 'quarter' })).toBe(true)
    expect(isWindowInOrder(start, { date: '2027-06-21', precision: 'week' })).toBe(false)
  })
})

describe('periodOf, one case per precision (#213)', () => {
  it('quarter: the quarter’s first day', () => {
    expect(periodOf('2027-06-30', 'quarter')).toEqual({ date: '2027-04-01', precision: 'quarter' })
    expect(periodOf('2027-01-01', 'quarter')).toEqual({ date: '2027-01-01', precision: 'quarter' })
  })

  it('month: the month’s first day', () => {
    expect(periodOf('2027-05-31', 'month')).toEqual({ date: '2027-05-01', precision: 'month' })
  })

  it('week: the Monday, from a Sunday too', () => {
    expect(periodOf('2027-05-12', 'week')).toEqual({ date: '2027-05-10', precision: 'week' })
    expect(periodOf('2027-05-16', 'week')).toEqual({ date: '2027-05-10', precision: 'week' })
    expect(periodOf('2027-01-01', 'week')).toEqual({ date: '2026-12-28', precision: 'week' })
  })

  it('day: the day itself', () => {
    expect(periodOf('2027-05-12', 'day')).toEqual({ date: '2027-05-12', precision: 'day' })
  })

  it('agrees with naming the period and reading it back, for every day of two years at every precision', () => {
    let day = '2027-01-01'
    while (day < '2029-01-01') {
      for (const precision of PLAN_DATE_PRECISIONS) {
        const period = periodOf(day, precision)
        expect(isPlanDate(period)).toBe(true)
        expect(period).toEqual(parsePlanDate(formatPlanDate({ date: day, precision })))
      }
      day = addDays(day, 1)
    }
  })

  it('adds days across month and year ends, and backwards', () => {
    expect(addDays('2027-12-30', 3)).toBe('2028-01-02')
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28')
  })
})
