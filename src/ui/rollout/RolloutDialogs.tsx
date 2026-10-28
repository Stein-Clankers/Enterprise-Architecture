import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  isPositiveInteger,
  isWindowInOrder,
  rolloutPlanOf,
  type Element,
  type WaveWindow,
} from '@/model'
import {
  addSites,
  createRollout,
  createWave,
  deleteWave,
  planCascadeText,
  updateWave,
  useModelSelector,
  useModelStore,
} from '@/store'
import { DialogOverlay } from '@/ui/common/DialogOverlay'
import { useFocusTrap } from '@/ui/common/use-focus-trap'
import { PlanDateField } from './PlanDateField'
import { draftOf, draftValue, type PlanDateDraft } from './plan-date-draft'
import { SITE_CODE_KEY, type WaveColumn } from './rollout-data'

/**
 * The rollout screens' dialogs (#211): a new rollout, a new or edited wave,
 * and sites to add. Each saves with one command, and none commits on blur:
 * nothing is written until Save, so a reader switch that closes one loses
 * only what was typed, never writes it (CLAUDE.md, reader rules). The screen
 * that opens a dialog closes it when the tab becomes a reader.
 */

function ModalForm({
  label,
  onCancel,
  onSubmit,
  wide,
  children,
}: {
  label: string
  onCancel: () => void
  onSubmit: () => void
  wide?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLFormElement>(null)
  // The trap first, so the opener it records is the button that opened this.
  useFocusTrap(ref)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])
  return (
    <DialogOverlay onDismiss={onCancel}>
      <form
        ref={ref}
        className={`dialog${wide ? ' dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="dialog__title section-label">{label}</div>
        {children}
      </form>
    </DialogOverlay>
  )
}

/** Focus a dialog's first field as it opens, after the trap has recorded the opener. */
function useInitialFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return ref
}

// ── New rollout ──────────────────────────────────────────────────────────────

export function NewRolloutDialog({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (rollout: Element) => void
}) {
  const store = useModelStore()
  const [name, setName] = useState('')
  const nameRef = useInitialFocus<HTMLInputElement>()
  return (
    <ModalForm
      label="New rollout"
      onCancel={onCancel}
      onSubmit={() => {
        if (!name.trim()) return
        const rollout = createRollout(store, { name: name.trim() })
        if (rollout) onCreated(rollout)
      }}
    >
      <label className="dialog__field">
        <span className="dialog__label">Name</span>
        <input
          ref={nameRef}
          className="dialog__control"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="ERP rollout to every plant"
        />
      </label>
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" disabled={!name.trim()}>
          Create
        </button>
      </div>
    </ModalForm>
  )
}

// ── New or edited wave ───────────────────────────────────────────────────────

/**
 * Create a wave, or edit one: name, label, capacity and window in one Save,
 * which is one command. Delete asks first, and says what happens to the
 * wave's sites: they stay in the rollout, unassigned (ADR 0015 point 6).
 */
export function WaveDialog({
  rolloutId,
  wave,
  defaultCapacity,
  onClose,
  onDeleted,
}: {
  rolloutId: string
  /** The wave to edit; absent for a new one. */
  wave?: WaveColumn
  defaultCapacity: number | undefined
  onClose: () => void
  onDeleted: () => void
}) {
  const store = useModelStore()
  const plan = wave?.plan
  const [name, setName] = useState(wave?.element.name ?? '')
  const [label, setLabel] = useState(plan?.label ?? '')
  const [capacity, setCapacity] = useState(
    plan?.capacity === undefined ? '' : String(plan.capacity),
  )
  const [start, setStart] = useState<PlanDateDraft>(draftOf(plan?.window?.start, 'month'))
  const [end, setEnd] = useState<PlanDateDraft>(draftOf(plan?.window?.end, 'month'))
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [refused, setRefused] = useState(false)
  const nameRef = useInitialFocus<HTMLInputElement>()

  const startValue = draftValue(start)
  const endValue = draftValue(end)
  // The capacity's door: '' is "none", and `Number('')` is 0, so it is
  // matched before the guard rather than through it (CLAUDE.md, type guards).
  const capacityValue = capacity.trim() === '' ? null : Number(capacity)
  const nameMissing = !name.trim()
  const problems: string[] = []
  if (capacityValue !== null && !isPositiveInteger(capacityValue)) {
    problems.push('Capacity is a whole number of sites, from 1.')
  }
  if (startValue === undefined) problems.push('The start is not a calendar day.')
  if (endValue === undefined) problems.push('The end is not a calendar day.')
  if (startValue && endValue && !isWindowInOrder(startValue, endValue)) {
    problems.push('The end is before the start.')
  }

  // Confirming swaps the buttons that hold focus, so focus goes to the new
  // view's answer, and back to Delete… when the answer is Cancel.
  const confirmRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const confirmed = useRef(false)
  useEffect(() => {
    if (confirmingDelete) confirmRef.current?.focus()
    else if (confirmed.current) deleteRef.current?.focus()
    confirmed.current = confirmingDelete
  }, [confirmingDelete])

  const save = () => {
    if (nameMissing || problems.length) return
    const window: WaveWindow = {}
    if (startValue) window.start = startValue
    if (endValue) window.end = endValue
    const done = wave
      ? updateWave(store, wave.element.id, {
          name: name.trim(),
          label: label.trim(),
          window,
          capacity: capacityValue,
        })
      : Boolean(
          createWave(store, rolloutId, {
            name: name.trim(),
            label: label.trim(),
            ...(startValue || endValue ? { window } : {}),
            ...(capacityValue !== null ? { capacity: capacityValue } : {}),
          }),
        )
    if (done) onClose()
    else setRefused(true)
  }

  if (wave && confirmingDelete) {
    // Worded from the commands Delete dispatches, as the fact sheet's Delete
    // is (#223), so the two doors to one action say the same.
    const cascade = planCascadeText(store.removalPreview(wave.element.id), 'asked')
    return (
      <ModalForm
        label="Delete wave"
        onCancel={() => setConfirmingDelete(false)}
        onSubmit={() => {
          if (deleteWave(store, wave.element.id)) onDeleted()
        }}
      >
        <p className="dialog__help">{`Delete “${wave.element.name}”? ${cascade}`}</p>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
          <button ref={confirmRef} type="submit" className="button button--primary">
            Delete wave
          </button>
        </div>
      </ModalForm>
    )
  }

  return (
    <ModalForm label={wave ? 'Edit wave' : 'New wave'} onCancel={onClose} onSubmit={save} wide>
      <div className="wave-form">
        <label className="dialog__field">
          <span className="dialog__label">Name</span>
          <input
            ref={nameRef}
            className="dialog__control"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Wave 3: DACH plants"
          />
        </label>
        <label className="dialog__field">
          <span className="dialog__label">Label</span>
          <input
            className="dialog__control mono"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="W3"
          />
        </label>
        <label className="dialog__field">
          <span className="dialog__label">Capacity</span>
          <input
            className="dialog__control mono"
            inputMode="numeric"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            placeholder={defaultCapacity === undefined ? 'none' : `${defaultCapacity} (default)`}
          />
        </label>
        <PlanDateField label="Window start" draft={start} onChange={setStart} />
        <PlanDateField label="Window end" draft={end} onChange={setEnd} />
      </div>
      {problems.length > 0 && (
        <p className="dialog__problem" role="alert">
          {problems.join(' ')}
        </p>
      )}
      {refused && (
        <p className="dialog__problem" role="alert">
          Not saved: the model refused this wave.
        </p>
      )}
      <div className="dialog__actions">
        {wave && (
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
          disabled={nameMissing || problems.length > 0}
        >
          {wave ? 'Save' : 'Create'}
        </button>
      </div>
    </ModalForm>
  )
}

// ── Add sites ────────────────────────────────────────────────────────────────

/** Pick Locations to put in the rollout, as one command. */
export function AddSitesDialog({ rolloutId, onClose }: { rolloutId: string; onClose: () => void }) {
  const store = useModelStore()
  const candidates = useModelSelector(
    (s) => {
      const plan = rolloutPlanOf(s.element(rolloutId))
      const inPlan = new Set(plan?.sites.map((site) => site.location))
      return s
        .elementsOfType('Location')
        .filter((location) => !inPlan.has(location.id))
        .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    },
    [rolloutId],
  )
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const filterRef = useInitialFocus<HTMLInputElement>()
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle
      ? candidates.filter((location) => location.name.toLowerCase().includes(needle))
      : candidates
  }, [candidates, query])

  const toggle = (id: string) =>
    setChosen((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <ModalForm
      label="Add sites"
      wide
      onCancel={onClose}
      onSubmit={() => {
        if (chosen.size && addSites(store, rolloutId, [...chosen])) onClose()
      }}
    >
      <p className="dialog__help">
        {candidates.length
          ? 'Locations not yet in this rollout. Each one added starts unassigned.'
          : 'Every Location in the model is already in this rollout.'}
      </p>
      <input
        ref={filterRef}
        className="dialog__control"
        aria-label="Filter Locations by name"
        placeholder="Filter by name…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="add-sites">
        {shown.map((location) => {
          const code = location.properties[SITE_CODE_KEY]
          return (
            <label key={location.id} className="add-sites__row">
              <input
                type="checkbox"
                checked={chosen.has(location.id)}
                onChange={() => toggle(location.id)}
              />
              <span className="add-sites__code mono">{typeof code === 'string' ? code : '—'}</span>
              <span className="add-sites__name">{location.name}</span>
            </label>
          )
        })}
      </div>
      <div className="dialog__actions">
        <button
          type="button"
          className="button dialog__left"
          disabled={!shown.length}
          onClick={() => setChosen(new Set([...chosen, ...shown.map((location) => location.id)]))}
        >
          Select all shown
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="button button--primary" disabled={!chosen.size}>
          {chosen.size ? `Add ${chosen.size}` : 'Add'}
        </button>
      </div>
    </ModalForm>
  )
}
