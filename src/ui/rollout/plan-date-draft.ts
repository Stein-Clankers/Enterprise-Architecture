import { isPlanDatePrecision, type PlanDate, type PlanDatePrecision } from '@/model'
import { snapPlanDate } from '@/store'

/** A plan date as a form holds it while it is edited: a day and a precision. */
export interface PlanDateDraft {
  day: string
  precision: PlanDatePrecision
}

export const PRECISION_LABELS: Record<PlanDatePrecision, string> = {
  quarter: 'Quarter',
  month: 'Month',
  week: 'Week',
  day: 'Day',
}

/**
 * The draft as the plan date it will store, snapped to its period's first
 * day: `null` for an empty field, `undefined` for a day that is not one.
 */
export function draftValue(draft: PlanDateDraft): PlanDate | null | undefined {
  if (draft.day === '') return null
  return snapPlanDate(draft.day, draft.precision)
}

export function draftOf(value: PlanDate | undefined, precision: PlanDatePrecision): PlanDateDraft {
  return value ? { day: value.date, precision: value.precision } : { day: '', precision }
}

/** A row as the form holds it: `''` is the empty choice, which inherits. */
export interface OverrideDraft {
  precision: PlanDatePrecision | ''
  day: string
}

/**
 * The write path's door for one row: `null` inherits, a `PlanDate` is the
 * site's own, snapped to its period, and `undefined` is a day that is not one.
 * The select's empty value never reaches the model as a precision: it fails
 * `isPlanDatePrecision` and inherits (CLAUDE.md, type guards on the write path).
 */
export function overrideValue(draft: OverrideDraft): PlanDate | null | undefined {
  if (!isPlanDatePrecision(draft.precision) || draft.day === '') return null
  return snapPlanDate(draft.day, draft.precision)
}
