import { useId } from 'react'
import { PLAN_DATE_PRECISIONS, formatPlanDate } from '@/model'
import { PRECISION_LABELS, draftValue, type PlanDateDraft } from './plan-date-draft'

/**
 * A plan date as a form edits it: a precision and a day (#211).
 *
 * A plan date is the first day of its period (ADR 0015 point 1), and a day
 * the user picks rarely is. So the field **snaps, and says so before it is
 * saved**: pick 2027-05-12 at week precision and it reads "2027-W19, from Mon
 * 2027-05-10 — snapped to the start of the week". It never hands the form a
 * value that silently becomes nothing (#222).
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function weekdayOf(day: string): string {
  return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? ''
}

export function PlanDateField({
  label,
  draft,
  onChange,
}: {
  label: string
  draft: PlanDateDraft
  onChange: (draft: PlanDateDraft) => void
}) {
  const id = useId()
  const value = draftValue(draft)
  const snapped = value && value.date !== draft.day
  return (
    <div className="dialog__field">
      <span className="dialog__label" id={`${id}-label`}>
        {label}
      </span>
      <div className="plan-date" role="group" aria-labelledby={`${id}-label`}>
        <select
          className="dialog__control plan-date__precision"
          aria-label={`${label} precision`}
          value={draft.precision}
          onChange={(event) => {
            const precision = PLAN_DATE_PRECISIONS.find((p) => p === event.target.value)
            if (precision) onChange({ ...draft, precision })
          }}
        >
          {PLAN_DATE_PRECISIONS.map((precision) => (
            <option key={precision} value={precision}>
              {PRECISION_LABELS[precision]}
            </option>
          ))}
        </select>
        <input
          className="dialog__control plan-date__day"
          type="date"
          aria-label={`${label} day`}
          value={draft.day}
          onChange={(event) => onChange({ ...draft, day: event.target.value })}
        />
      </div>
      <span
        className={`plan-date__reading${value === undefined ? ' plan-date__reading--problem' : ''}`}
        aria-live="polite"
      >
        {value === null
          ? 'Not set'
          : value === undefined
            ? 'Not a calendar day'
            : `${formatPlanDate(value)} · from ${weekdayOf(value.date)} ${value.date}${
                snapped ? ` · snapped to the start of the ${draft.precision}` : ''
              }`}
      </span>
    </div>
  )
}
