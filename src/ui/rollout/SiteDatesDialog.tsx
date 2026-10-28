import { Fragment, useState } from 'react'
import { PLAN_DATE_PRECISIONS, formatPlanDate, isPlanDatePrecision, type PlanDate } from '@/model'
import { setKey } from '@/io'
import { setSiteMilestones, useModelStore } from '@/store'
import { ModalForm } from './RolloutDialogs'
import { useInitialFocus } from './use-initial-focus'
import { PRECISION_LABELS, overrideValue, type OverrideDraft } from './plan-date-draft'
import { PlanSource } from './SiteRegister'
import { sourceText, type RolloutData } from './rollout-data'

/**
 * One site's own milestone dates (#213). Each milestone shows the date the
 * site has now and whether it is set or inherited, and a precision and a day
 * to set its own. **Inherit**, the precision select's empty choice, clears the
 * site's date, so it inherits again from its wave or the rollout (ADR 0016).
 * Save is one command; nothing is written before it.
 */

export function SiteDatesDialog({
  data,
  location,
  onClose,
}: {
  data: RolloutData
  location: string
  onClose: () => void
}) {
  const store = useModelStore()
  const site = data.sites.find((candidate) => candidate.location === location)
  const own = data.plan.sites.find((candidate) => candidate.location === location)?.milestones
  const [drafts, setDrafts] = useState<Record<string, OverrideDraft>>(() =>
    Object.fromEntries(
      data.plan.milestones.map((milestone) => {
        const value = own?.[milestone.id]
        return [
          milestone.id,
          value ? { precision: value.precision, day: value.date } : { precision: '', day: '' },
        ]
      }),
    ),
  )
  const [refused, setRefused] = useState(false)
  const firstRef = useInitialFocus<HTMLSelectElement>()
  const wave = data.waves.find((column) => column.element.id === site?.wave)
  const waveLabel = wave ? wave.plan.label || wave.element.name : undefined
  const name = site ? (site.code ?? site.name) : location

  const changes: Record<string, PlanDate | null> = {}
  const unreadable: string[] = []
  for (const milestone of data.plan.milestones) {
    const value = overrideValue(drafts[milestone.id]!)
    const before = own?.[milestone.id]
    if (value === undefined) unreadable.push(milestone.label)
    else if (value === null ? before !== undefined : !samePlanDate(value, before)) {
      setKey(changes, milestone.id, value)
    }
  }

  const save = () => {
    if (unreadable.length) return
    if (!Object.keys(changes).length) return onClose()
    if (setSiteMilestones(store, data.rollout.id, location, changes)) onClose()
    else setRefused(true)
  }

  return (
    <ModalForm label={`Dates of ${name}`} onCancel={onClose} onSubmit={save} wide>
      <p className="dialog__help">
        A date the site sets is its own. Choose <strong>Inherit</strong> to take its wave’s date, or
        the rollout’s.
      </p>
      <div className="site-dates" role="group" aria-label={`Milestones of ${name}`}>
        <span className="site-dates__head">Milestone</span>
        <span className="site-dates__head">Now</span>
        <span className="site-dates__head">Precision</span>
        <span className="site-dates__head">Day</span>
        {data.plan.milestones.map((milestone, index) => {
          const resolved = site?.milestones.find((entry) => entry.milestone.id === milestone.id)
          const draft = drafts[milestone.id]!
          const value = overrideValue(draft)
          const set = (next: Partial<OverrideDraft>) =>
            setDrafts((was) => ({ ...was, [milestone.id]: { ...draft, ...next } }))
          return (
            <Fragment key={milestone.id}>
              <span>{milestone.label}</span>
              <span
                className="site-dates__now"
                title={resolved ? sourceText(resolved, waveLabel, data.plan.milestones) : undefined}
              >
                {resolved?.planned ? (
                  <>
                    <span className="mono">{formatPlanDate(resolved.planned)}</span>
                    <PlanSource set={resolved.source === 'site'} />
                  </>
                ) : (
                  <span className="mono">—</span>
                )}
                {value ? (
                  <span className="mono plan-source">{`→ ${formatPlanDate(value)}`}</span>
                ) : null}
              </span>
              <select
                ref={index === 0 ? firstRef : undefined}
                className="dialog__control"
                aria-label={`${milestone.label} precision`}
                value={draft.precision}
                onChange={(event) => {
                  const precision = event.target.value
                  set({ precision: isPlanDatePrecision(precision) ? precision : '' })
                }}
              >
                <option value="">Inherit</option>
                {PLAN_DATE_PRECISIONS.map((precision) => (
                  <option key={precision} value={precision}>
                    {PRECISION_LABELS[precision]}
                  </option>
                ))}
              </select>
              <input
                className="dialog__control"
                type="date"
                aria-label={`${milestone.label} day`}
                value={draft.day}
                disabled={draft.precision === ''}
                onChange={(event) => set({ day: event.target.value })}
              />
            </Fragment>
          )
        })}
      </div>
      {unreadable.length > 0 && (
        <p className="dialog__problem" role="alert">
          {`Not a calendar day: ${unreadable.join(', ')}.`}
        </p>
      )}
      {refused && (
        <p className="dialog__problem" role="alert">
          Not saved: the model refused these dates.
        </p>
      )}
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" disabled={unreadable.length > 0}>
          Save
        </button>
      </div>
    </ModalForm>
  )
}

function samePlanDate(a: PlanDate, b: PlanDate | undefined): boolean {
  return a.date === b?.date && a.precision === b.precision
}
