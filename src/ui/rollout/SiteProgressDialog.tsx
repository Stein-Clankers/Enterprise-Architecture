import { Fragment, useState } from 'react'
import { GO_NO_GO_DECISIONS, SITE_RAGS, formatPlanDate, type SiteRag } from '@/model'
import { getKey, setKey } from '@/io'
import { setSiteProgress, useModelStore } from '@/store'
import { ModalForm } from './RolloutDialogs'
import { useInitialFocus } from './use-initial-focus'
import { PlanSource } from './SiteRegister'
import { GO_NO_GO_LABELS, type RolloutData } from './rollout-data'

/**
 * One site's progress (#215): the day each milestone was actually reached,
 * its RAG and its go/no-go decision, which the PMO otherwise returns in the
 * rollout workbook. A blank day clears an actual. Save is one command
 * (`setSiteProgress`), and nothing is written before it, so a tab that
 * becomes a reader while this is open loses what was typed, never writes it.
 */

const RAG_LABELS: Record<SiteRag, string> = { green: 'Green', amber: 'Amber', red: 'Red' }

export function SiteProgressDialog({
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
  const plan = data.plan.sites.find((candidate) => candidate.location === location)
  const [actuals, setActuals] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const milestone of data.plan.milestones) {
      setKey(out, milestone.id, getKey(plan?.actuals, milestone.id) ?? '')
    }
    return out
  })
  const [rag, setRag] = useState<string>(plan?.rag ?? '')
  const [goNoGo, setGoNoGo] = useState<string>(plan?.goNoGo ?? '')
  const [refused, setRefused] = useState(false)
  const firstRef = useInitialFocus<HTMLInputElement>()
  const name = site ? (site.code ?? site.name) : location

  const save = () => {
    // A date input holds a calendar day or nothing, so a draft is a day or a
    // blank, which clears; the store's guard refuses anything else.
    const changed: Record<string, string | null> = {}
    for (const milestone of data.plan.milestones) {
      const draft = getKey(actuals, milestone.id) ?? ''
      const before = getKey(plan?.actuals, milestone.id)
      if (draft === '' ? before !== undefined : draft !== before) {
        setKey(changed, milestone.id, draft === '' ? null : draft)
      }
    }
    const changes = {
      ...(Object.keys(changed).length ? { actuals: changed } : {}),
      // The selects' empty option clears; any other value goes through the
      // store's guards, so a value no RAG or decision names is refused.
      ...(rag !== (plan?.rag ?? '') ? { rag: rag === '' ? null : rag } : {}),
      ...(goNoGo !== (plan?.goNoGo ?? '') ? { goNoGo: goNoGo === '' ? null : goNoGo } : {}),
    }
    if (!Object.keys(changes).length) return onClose()
    if (setSiteProgress(store, data.rollout.id, location, changes)) onClose()
    else setRefused(true)
  }

  return (
    <ModalForm label={`Progress of ${name}`} onCancel={onClose} onSubmit={save} wide>
      <p className="dialog__help">
        The day each milestone was actually reached. An actual day counts before the planned date,
        early or late; a blank day clears it.
      </p>
      <div className="site-progress" role="group" aria-label={`Actual days of ${name}`}>
        <span className="site-dates__head">Milestone</span>
        <span className="site-dates__head">Planned</span>
        <span className="site-dates__head">Actual day</span>
        {data.plan.milestones.map((milestone, index) => {
          const resolved = site?.milestones.find((entry) => entry.milestone.id === milestone.id)
          return (
            <Fragment key={milestone.id}>
              <span>{milestone.label}</span>
              <span className="site-dates__now">
                {resolved?.planned ? (
                  <>
                    <span className="mono">{formatPlanDate(resolved.planned)}</span>
                    <PlanSource set={resolved.source === 'site'} />
                  </>
                ) : (
                  <span className="mono">—</span>
                )}
              </span>
              <input
                ref={index === 0 ? firstRef : undefined}
                className="dialog__control mono"
                type="date"
                aria-label={`${milestone.label} actual day`}
                value={getKey(actuals, milestone.id) ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setActuals((was) => {
                    const next = { ...was }
                    setKey(next, milestone.id, value)
                    return next
                  })
                }}
              />
            </Fragment>
          )
        })}
      </div>
      <div className="site-progress__judgements">
        <label className="dialog__field">
          <span className="dialog__label">RAG</span>
          <select
            className="dialog__control"
            value={rag}
            onChange={(event) => setRag(event.target.value)}
          >
            <option value="">Not rated</option>
            {SITE_RAGS.map((value) => (
              <option key={value} value={value}>
                {RAG_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="dialog__field">
          <span className="dialog__label">Go/no-go</span>
          <select
            className="dialog__control"
            value={goNoGo}
            onChange={(event) => setGoNoGo(event.target.value)}
          >
            <option value="">Not decided</option>
            {GO_NO_GO_DECISIONS.map((value) => (
              <option key={value} value={value}>
                {GO_NO_GO_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {refused && (
        <p className="dialog__problem" role="alert">
          Not saved: the model refused these values.
        </p>
      )}
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button button--primary">
          Save
        </button>
      </div>
    </ModalForm>
  )
}
