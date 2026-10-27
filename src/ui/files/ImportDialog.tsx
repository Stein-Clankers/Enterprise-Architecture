import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { summariseProblems, type ImportProblem } from '@/io'
import { supportsDirectoryAccess } from '@/io/shared-folder'
import { DialogOverlay } from '@/ui/common/DialogOverlay'
import { useFocusTrap } from '@/ui/common/use-focus-trap'
import { useFileWorkspace } from './context'

/**
 * The import dialog (issue #11), wrapped around the structured problems from #5.
 *
 * A model file is usually mostly right, so the dialog shows what came in *and*
 * what did not: an unknown element type, a relationship whose target was
 * deleted, the diagrams we do not read yet. Silently dropping any of those would
 * leave an architect wondering why their counts are wrong.
 */

export function ImportDialog() {
  const { importing } = useFileWorkspace()
  // Mounted only while open, so `useFocusTrap` runs its entry on open and its
  // restore on close. A component that renders `null` never unmounts, so a trap
  // installed here would take focus once at boot and give it back never.
  return importing ? <ImportDialogBody /> : null
}

function ImportDialogBody() {
  const { lastImport, importFile, openFile, cancelImport, canPickFiles } = useFileWorkspace()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  // The dialog says `aria-modal`; this is what makes that true. Without it Tab
  // walked into the chrome behind the overlay — where Enter reaches SAVE FILE —
  // and closing dropped focus on `<body>` rather than back on Import.
  useFocusTrap(dialogRef)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelImport()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [cancelImport])

  const problems = lastImport?.problems ?? []
  const errors = problems.filter((p) => p.severity === 'error')
  const rest = problems.filter((p) => p.severity !== 'error')

  return (
    <DialogOverlay onDismiss={cancelImport}>
      <div
        ref={dialogRef}
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Import"
      >
        <div className="dialog__title section-label">Import a model</div>

        <p className="dialog__help">
          An Archi model (.archimate), ArchiMate Model Exchange Format XML from Archi and other
          certified tools, or canonical JSON from Archipelago. Views and folders come with it.
        </p>

        <div className="dialog__actions dialog__actions--start">
          <input
            ref={inputRef}
            type="file"
            accept=".json,.xml,.archimate,application/json,application/xml"
            className="visually-hidden"
            aria-label="Choose a file to import"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              setBusy(true)
              // `importFile` reports a file it cannot read (#52), but whatever
              // else throws, the buttons come back: without this they stayed
              // disabled for the life of the dialog.
              try {
                await importFile(file)
              } finally {
                setBusy(false)
                event.target.value = ''
              }
            }}
          />
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Choose a file…
          </button>
          {canPickFiles && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void openFile()}
              title="Open through the file picker so later saves write back to the same file"
            >
              Open and keep linked
            </button>
          )}
          {supportsDirectoryAccess() && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                cancelImport()
                navigate('/folder')
              }}
              title="A folder OneDrive, SharePoint or a network drive keeps in step, where one person edits a model at a time"
            >
              Open a shared folder…
            </button>
          )}
        </div>

        {!supportsDirectoryAccess() && (
          <p className="dialog__help">
            Shared folders need a Chromium browser, such as Edge or Chrome: Firefox and Safari
            cannot write into a folder you pick.
          </p>
        )}

        {lastImport && (
          <div className="import-report">
            <div className="import-report__head">
              {lastImport.workspace ? (
                <span>
                  {lastImport.workspace.elements.length} elements ·{' '}
                  {lastImport.workspace.relationships.length} relationships
                </span>
              ) : (
                <span>Nothing could be read from that file.</span>
              )}
              <span className="sheet__note">{summariseProblems(problems)}</span>
            </div>
            {[...errors, ...rest].length > 0 && (
              <ul className="import-report__list">
                {[...errors, ...rest].slice(0, 40).map((problem, index) => (
                  <ProblemRow key={`${problem.code}-${index}`} problem={problem} />
                ))}
                {problems.length > 40 && (
                  <li className="import-report__more">
                    …and {problems.length - 40} more of the same kind.
                  </li>
                )}
              </ul>
            )}
          </div>
        )}

        <div className="dialog__actions">
          <button type="button" className="button" onClick={cancelImport}>
            {lastImport?.workspace ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </DialogOverlay>
  )
}

function ProblemRow({ problem }: { problem: ImportProblem }) {
  return (
    <li className={`import-report__row import-report__row--${problem.severity}`}>
      <span className="import-report__severity">{problem.severity}</span>
      <span>
        {problem.message}
        {problem.line !== undefined && <span className="sheet__note"> line {problem.line}</span>}
      </span>
    </li>
  )
}
