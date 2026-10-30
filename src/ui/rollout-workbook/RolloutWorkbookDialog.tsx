import { useEffect, useRef, useState } from 'react'
import { rolloutPlanOf, type Element } from '@/model'
import { summariseProblems, type ImportProblem } from '@/io'
import { downloadBlob } from '@/io/file-download'
import {
  exportRolloutWorkbook,
  planRolloutImport,
  rolloutWorkbookFileName,
  type RolloutImportPlan,
  type Tally,
} from '@/io/rollout-workbook'
import { readXlsx } from '@/io/xlsx-read'
import { writeXlsx, XlsxWriteError } from '@/io/xlsx-write'
import { newId, useModelSelector, useModelStoreContext } from '@/store'
import { applyRolloutImport } from '@/store/rollout-workbook'
import { DialogOverlay } from '@/ui/common/DialogOverlay'
import { useFocusTrap } from '@/ui/common/use-focus-trap'
import './rollout-workbook.css'

/**
 * The rollout workbook's way in (#210), until the rollout screens (#211) give
 * it a place of their own: two command-palette entries and one dialog.
 *
 * Export writes the chosen rollout's workbook through the app's download
 * path. Import reads a workbook, shows the dry run (how many rows of each
 * sheet it creates, updates and deletes, and every problem), and applies it
 * as one command only when asked. Only the tab that holds the model is
 * offered the import, and the dialog ends when the role becomes reader
 * (CLAUDE.md): the effect closes it and the render gate keeps it off screen
 * in the commit that makes the tab a reader.
 */

export type RolloutWorkbookMode = 'export' | 'import'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** By name, then id, in code-unit order, so the list is the same on every machine (ADR 0004). */
function byName(a: Element, b: Element): number {
  const order = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  return order(a.name, b.name) || order(a.id, b.id)
}

export function RolloutWorkbookDialog({
  mode,
  onClose,
}: {
  mode: RolloutWorkbookMode
  onClose: () => void
}) {
  const { store } = useModelStoreContext()
  const rollouts = useModelSelector((s) =>
    s
      .elementList()
      .filter((element) => rolloutPlanOf(element))
      .sort(byName),
  )
  const [chosen, setChosen] = useState<string>()
  const rolloutId = rollouts.some((rollout) => rollout.id === chosen) ? chosen : rollouts[0]?.id
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const title = mode === 'export' ? 'Export rollout workbook' : 'Import rollout workbook'
  return (
    <DialogOverlay onDismiss={onClose}>
      <div
        ref={dialogRef}
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog__title section-label">{title}</div>
        {rollouts.length === 0 ? (
          <>
            <p className="dialog__help">This model has no rollout yet.</p>
            <div className="dialog__actions">
              <button type="button" className="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="dialog__field">
              <span className="dialog__label">Rollout</span>
              <select
                className="dialog__control"
                value={rolloutId}
                onChange={(event) => setChosen(event.target.value)}
              >
                {rollouts.map((rollout) => (
                  <option key={rollout.id} value={rollout.id}>
                    {rollout.name || rollout.id}
                  </option>
                ))}
              </select>
            </label>
            {mode === 'export' ? (
              <ExportBody key={rolloutId} rolloutId={rolloutId!} onClose={onClose} />
            ) : (
              // Keyed on the rollout: a preview is of one rollout, never carried to another.
              <ImportBody key={rolloutId} rolloutId={rolloutId!} onClose={onClose} store={store} />
            )}
          </>
        )}
      </div>
    </DialogOverlay>
  )
}

function ExportBody({ rolloutId, onClose }: { rolloutId: string; onClose: () => void }) {
  const { store } = useModelStoreContext()
  const [outcome, setOutcome] = useState<{ file?: string; problems: ImportProblem[] }>()

  const exportNow = () => {
    // The dialog lists only the model's rollouts, as of this render.
    const rollout = store.element(rolloutId)!
    const result = exportRolloutWorkbook(store.snapshot(), rolloutId)!
    let bytes: Uint8Array
    try {
      bytes = writeXlsx(result.workbook)
    } catch (error) {
      if (!(error instanceof XlsxWriteError)) throw error
      setOutcome({
        problems: [
          { severity: 'error', code: 'rollout-workbook.write-refused', message: error.message },
        ],
      })
      return
    }
    const file = rolloutWorkbookFileName(rollout.name)
    downloadBlob(file, new Blob([bytes], { type: XLSX_TYPE }))
    // Nothing to say: the download is the whole answer.
    if (result.problems.length === 0) onClose()
    else setOutcome({ file, problems: result.problems })
  }

  return (
    <>
      <p className="dialog__help">
        One sheet each for the sites, the waves, the site plan, the site exceptions and the
        dependencies between sites, and the milestones and template for reference. Edit it in Excel
        and import it again: row 1 holds the keys the import reads.
      </p>
      {outcome && (
        <ProblemReport
          head={outcome.file ? `Downloaded ${outcome.file}` : 'Nothing was downloaded.'}
          problems={outcome.problems}
        />
      )}
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          {outcome ? 'Done' : 'Cancel'}
        </button>
        {!outcome && (
          <button type="button" className="button button--primary" onClick={exportNow}>
            Export workbook
          </button>
        )}
      </div>
    </>
  )
}

type Preview =
  | { file: string; plan: RolloutImportPlan; problems: ImportProblem[] }
  | { file: string; plan?: undefined; problems: ImportProblem[] }

const SHEETS: { key: keyof RolloutImportPlan['tallies']; label: string }[] = [
  { key: 'sites', label: 'Sites' },
  { key: 'waves', label: 'Waves' },
  { key: 'sitePlans', label: 'SitePlan' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'dependencies', label: 'Dependencies' },
]
const COUNTS: (keyof Tally)[] = ['created', 'updated', 'deleted', 'unchanged']

function ImportBody({
  rolloutId,
  onClose,
  store,
}: {
  rolloutId: string
  onClose: () => void
  store: ReturnType<typeof useModelStoreContext>['store']
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Preview>()
  const [refusal, setRefusal] = useState<string>()

  const read = async (file: File) => {
    setBusy(true)
    setRefusal(undefined)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const result = await readXlsx(bytes, file.name)
    if (!result.workbook) {
      setPreview({ file: file.name, problems: result.problems })
    } else {
      const plan = planRolloutImport(store.snapshot(), rolloutId, result.workbook, newId, file.name)
      setPreview({ file: file.name, plan, problems: [...result.problems, ...plan.problems] })
    }
    setBusy(false)
  }

  const apply = () => {
    if (!preview?.plan) return
    const outcome = applyRolloutImport(store, preview.plan)
    if (outcome === 'applied' || outcome === 'unchanged') {
      onClose()
      return
    }
    setPreview(undefined)
    setRefusal(
      outcome === 'stale'
        ? 'The model changed after this preview, so nothing was applied. Choose the file again to preview it against the model as it is now.'
        : 'The import would store a plan the model does not accept, so nothing was applied. Please report this file.',
    )
  }

  const changes = preview?.plan
    ? SHEETS.reduce((n, { key }) => {
        const tally = preview.plan!.tallies[key]
        return n + tally.created + tally.updated + tally.deleted
      }, 0)
    : 0

  return (
    <>
      <p className="dialog__help">
        A workbook exported from this rollout and edited. A blank cell deletes its value, and a
        column that is not there leaves its values as they are. Nothing changes until you apply.
      </p>
      <div className="dialog__actions dialog__actions--start">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="visually-hidden"
          aria-label="Choose a workbook to import"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void read(file)
          }}
        />
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose a workbook…
        </button>
        {preview && <span className="rollout-workbook__file">{preview.file}</span>}
      </div>

      {refusal && (
        <p className="dialog__problem" role="alert">
          {refusal}
        </p>
      )}

      {preview?.plan && (
        <table className="rollout-workbook__tallies" aria-label="What the import changes">
          <thead>
            <tr>
              <th scope="col">Sheet</th>
              {COUNTS.map((count) => (
                <th key={count} scope="col">
                  {count}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SHEETS.map(({ key, label }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                {COUNTS.map((count) => (
                  <td key={count} data-count={`${key}.${count}`}>
                    {preview.plan!.tallies[key][count]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {preview && (
        <ProblemReport
          head={
            preview.plan
              ? `${changes} row${changes === 1 ? '' : 's'} to change`
              : 'Nothing could be read from that file.'
          }
          problems={preview.problems}
        />
      )}

      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        {preview?.plan && (
          <button type="button" className="button button--primary" onClick={apply}>
            Apply
          </button>
        )}
      </div>
    </>
  )
}

/** How many problems to list; the rest are counted, never hidden. */
const SHOWN = 40

function ProblemReport({ head, problems }: { head: string; problems: ImportProblem[] }) {
  const ordered = [
    ...problems.filter((p) => p.severity === 'error'),
    ...problems.filter((p) => p.severity === 'warning'),
    ...problems.filter((p) => p.severity === 'info'),
  ]
  return (
    <div className="import-report">
      <div className="import-report__head">
        <span>{head}</span>
        <span className="sheet__note">{summariseProblems(problems)}</span>
      </div>
      {ordered.length > 0 && (
        <ul className="import-report__list">
          {ordered.slice(0, SHOWN).map((problem, index) => (
            <li
              key={`${problem.code}-${index}`}
              className={`import-report__row import-report__row--${problem.severity}`}
            >
              <span className="import-report__severity">{problem.severity}</span>
              <span>{problem.message}</span>
            </li>
          ))}
          {ordered.length > SHOWN && (
            <li className="import-report__more">…and {ordered.length - SHOWN} more.</li>
          )}
        </ul>
      )}
    </div>
  )
}
