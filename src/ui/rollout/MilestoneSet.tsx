import { useEffect, useRef, useState } from 'react'
import {
  MILESTONE_PHASES,
  SITE_PHASE_LABELS,
  formatPlanDate,
  isMilestonePhase,
  type Milestone,
  type MilestonePhase,
} from '@/model'
import {
  addMilestone,
  milestoneUsage,
  moveMilestone,
  removeMilestone,
  updateMilestone,
  useModelStore,
} from '@/store'
import { PlanDateField } from './PlanDateField'
import { ModalForm } from './RolloutDialogs'
import { useInitialFocus } from './use-initial-focus'
import { draftOf, draftValue, type PlanDateDraft } from './plan-date-draft'
import { SITE_PHASE_TOKENS, usageText, type RolloutData } from './rollout-data'

/**
 * The milestone-set editor (#213, proposal §4.2): the rollout's milestones in
 * the order the phase is derived walking them, each with the phase it starts
 * and the rollout's own date, which a site inherits last. Every change is one
 * command: adding, editing, moving and deleting. Deleting asks first, saying
 * what uses the milestone, and one undo brings all of it back.
 *
 * A reader sees the set and no control that writes; the screen closes an open
 * dialog when the tab becomes a reader.
 */

const COLUMNS_WRITER = '36px minmax(0,1.4fr) minmax(0,1fr) 140px 110px 64px 150px'
const COLUMNS_READER = '36px minmax(0,1.4fr) minmax(0,1fr) 140px 110px 64px'

export function MilestoneSet({
  data,
  readOnly,
  onEdit,
  addRef,
}: {
  data: RolloutData
  readOnly: boolean
  /** Open the milestone dialog: for `milestone`, or for a new one. */
  onEdit: (milestone?: Milestone) => void
  addRef: React.RefObject<HTMLButtonElement>
}) {
  const store = useModelStore()
  const columns = readOnly ? COLUMNS_READER : COLUMNS_WRITER
  const milestones = data.plan.milestones
  const move = (milestone: Milestone, by: -1 | 1) =>
    moveMilestone(store, data.rollout.id, milestone.id, by)

  return (
    <div className="milestones">
      <div className="milestones__controls">
        <p className="milestones__help">
          A site’s phase is the one its last reached milestone starts, walking this list in order. A
          site’s date comes from the site, else its wave, else the rollout’s date here.
        </p>
        {!readOnly && (
          <button
            ref={addRef}
            type="button"
            className="button button--primary"
            onClick={() => onEdit()}
          >
            + Milestone
          </button>
        )}
      </div>
      <div className="table" role="table" aria-label="Milestones">
        <div className="table__header" style={{ gridTemplateColumns: columns }} role="row">
          <span>#</span>
          <span>Milestone</span>
          <span>Id</span>
          <span>Starts phase</span>
          <span>Rollout date</span>
          <span className="table__right">Sites</span>
          {!readOnly && <span />}
        </div>
        {milestones.length === 0 ? (
          <p className="table__empty">This rollout has no milestones yet.</p>
        ) : (
          milestones.map((milestone, index) => {
            const usage = milestoneUsage(store, data.rollout.id, milestone.id)
            return (
              <div
                key={milestone.id}
                className="table__row"
                style={{ gridTemplateColumns: columns }}
                role="row"
                data-milestone={milestone.id}
              >
                <span className="mono">{index + 1}</span>
                <span className="table__name">{milestone.label}</span>
                <span className="mono table__secondary">{milestone.id}</span>
                <span className="register__phase">
                  <span
                    className="register__phase-dot"
                    style={{ background: SITE_PHASE_TOKENS[milestone.startsPhase] }}
                    aria-hidden="true"
                  />
                  {SITE_PHASE_LABELS[milestone.startsPhase]}
                </span>
                <span className="mono">
                  {milestone.date ? formatPlanDate(milestone.date) : '—'}
                </span>
                <span className="mono table__right">{usage.sites}</span>
                {!readOnly && (
                  <span className="milestones__actions">
                    <button
                      type="button"
                      className="milestones__move"
                      aria-label={`Move ${milestone.label} earlier`}
                      aria-disabled={index === 0}
                      onClick={() => move(milestone, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="milestones__move"
                      aria-label={`Move ${milestone.label} later`}
                      aria-disabled={index === milestones.length - 1}
                      onClick={() => move(milestone, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="board__edit"
                      aria-label={`Edit ${milestone.label}`}
                      onClick={() => onEdit(milestone)}
                    >
                      Edit
                    </button>
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ── The milestone dialog ─────────────────────────────────────────────────────

/**
 * Add or edit one milestone: its label, the phase it starts and the rollout's
 * own date for it, in one Save, which is one command. The phase select of a
 * new milestone starts empty, and an empty choice saves nothing (CLAUDE.md,
 * type guards on the write path).
 */
export function MilestoneDialog({
  rolloutId,
  milestone,
  onClose,
  onDeleted,
}: {
  rolloutId: string
  milestone?: Milestone
  onClose: () => void
  onDeleted: () => void
}) {
  const store = useModelStore()
  const [label, setLabel] = useState(milestone?.label ?? '')
  const [phase, setPhase] = useState<MilestonePhase | ''>(milestone?.startsPhase ?? '')
  const [date, setDate] = useState<PlanDateDraft>(draftOf(milestone?.date, 'quarter'))
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [refused, setRefused] = useState(false)
  const labelRef = useInitialFocus<HTMLInputElement>()

  const dateValue = draftValue(date)
  const problems: string[] = []
  if (dateValue === undefined) problems.push('The rollout date is not a calendar day.')
  const incomplete = !label.trim() || phase === ''

  const confirmRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const confirmed = useRef(false)
  useEffect(() => {
    if (confirmingDelete) confirmRef.current?.focus()
    else if (confirmed.current) deleteRef.current?.focus()
    confirmed.current = confirmingDelete
  }, [confirmingDelete])

  const save = () => {
    if (incomplete || problems.length) return
    const done = milestone
      ? updateMilestone(store, rolloutId, milestone.id, {
          label,
          startsPhase: phase,
          date: dateValue ?? null,
        })
      : addMilestone(store, rolloutId, {
          label,
          startsPhase: phase,
          ...(dateValue ? { date: dateValue } : {}),
        }) !== undefined
    if (done) onClose()
    else setRefused(true)
  }

  if (milestone && confirmingDelete) {
    const usage = milestoneUsage(store, rolloutId, milestone.id)
    const blocked = usage.anchoredChanges.length > 0
    return (
      <ModalForm
        label="Delete milestone"
        onCancel={() => setConfirmingDelete(false)}
        onSubmit={() => {
          if (blocked) return
          if (removeMilestone(store, rolloutId, milestone.id)) onDeleted()
          else setRefused(true)
        }}
      >
        <p className="dialog__help">
          {blocked
            ? `“${milestone.label}” cannot be deleted: the template ${usage.anchoredChanges.length === 1 ? 'change' : 'changes'} ${usage.anchoredChanges.join(', ')} ${usage.anchoredChanges.length === 1 ? 'is' : 'are'} dated from it. Date ${usage.anchoredChanges.length === 1 ? 'it' : 'them'} from another milestone first.`
            : `Delete “${milestone.label}”? ${usageText(usage)}`}
        </p>
        {refused && (
          <p className="dialog__problem" role="alert">
            Not deleted: the model refused it.
          </p>
        )}
        <div className="dialog__actions">
          <button
            ref={blocked ? confirmRef : undefined}
            type="button"
            className="button"
            onClick={() => setConfirmingDelete(false)}
          >
            {blocked ? 'Back' : 'Cancel'}
          </button>
          {!blocked && (
            <button ref={confirmRef} type="submit" className="button button--primary">
              Delete milestone
            </button>
          )}
        </div>
      </ModalForm>
    )
  }

  return (
    <ModalForm
      label={milestone ? 'Edit milestone' : 'New milestone'}
      onCancel={onClose}
      onSubmit={save}
    >
      <label className="dialog__field">
        <span className="dialog__label">Label</span>
        <input
          ref={labelRef}
          className="dialog__control"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Go/no-go"
        />
      </label>
      <label className="dialog__field">
        <span className="dialog__label">Starts phase</span>
        <select
          className="dialog__control"
          value={phase}
          onChange={(event) => {
            const value = event.target.value
            setPhase(isMilestonePhase(value) ? value : '')
          }}
        >
          <option value="">Choose a phase</option>
          {MILESTONE_PHASES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {SITE_PHASE_LABELS[candidate]}
            </option>
          ))}
        </select>
      </label>
      <PlanDateField label="Rollout date" draft={date} onChange={setDate} />
      {milestone && (
        <p className="dialog__help">
          Its id, <span className="mono">{milestone.id}</span>, names its columns in the workbook
          and stays as it is.
        </p>
      )}
      {problems.length > 0 && (
        <p className="dialog__problem" role="alert">
          {problems.join(' ')}
        </p>
      )}
      {refused && (
        <p className="dialog__problem" role="alert">
          Not saved: the model refused this milestone.
        </p>
      )}
      <div className="dialog__actions">
        {milestone && (
          <button
            ref={deleteRef}
            type="button"
            className="button dialog__left"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete…
          </button>
        )}
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="button button--primary"
          disabled={incomplete || problems.length > 0}
        >
          {milestone ? 'Save' : 'Add'}
        </button>
      </div>
    </ModalForm>
  )
}
