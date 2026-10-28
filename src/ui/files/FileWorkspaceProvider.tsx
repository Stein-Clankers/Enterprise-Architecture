import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  importFailure,
  loadBundledDemo,
  type DemoId,
  openWorkspaceFile,
  readWorkspaceFile,
  saveWorkspaceToFile,
  supportsFileSystemAccess,
  type ExportFormat,
  type ImportResult,
  type SaveFileHandle,
  type SaveOutcome,
} from '@/io'
import { ModelStoreContext, useModelStoreContext } from '@/store'
import { useGlobalShortcut } from '@/ui/shell/global-shortcuts'
import { FileWorkspaceContext, type FileWorkspaceContextValue } from './context'
import { useSharedModel } from './use-shared-model'

/**
 * Wires files to the model (issue #11).
 *
 * The invariant this exists to hold: **the dirty counter means "differs from the
 * file"**. It clears on a successful save and only then; a cancelled picker, a
 * failed write or a download the user never confirmed all leave it alone.
 * Anything looser and the header's promise stops being true.
 */

export function FileWorkspaceProvider({ children }: { children: ReactNode }) {
  const outer = useModelStoreContext()
  const { store, role, flush } = outer
  const handleRef = useRef<SaveFileHandle | undefined>(undefined)
  const [fileName, setFileName] = useState<string | undefined>(undefined)
  const [importing, setImporting] = useState(false)
  const [lastImport, setLastImport] = useState<ImportResult | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const shared = useSharedModel(store, setNotice)
  const sharedSave = shared.save
  const closeShared = shared.close
  const inShared = shared.shared !== undefined

  const save = useCallback(
    async (format: ExportFormat = 'json', { reuseHandle = true } = {}): Promise<SaveOutcome> => {
      // A model from a shared folder saves through its guard (#147); an export
      // is still a file of its own.
      if (inShared && format === 'json' && reuseHandle) {
        await sharedSave()
        return { kind: 'cancelled' }
      }
      const outcome = await saveWorkspaceToFile(
        store.snapshot(),
        format,
        reuseHandle ? handleRef.current : undefined,
      )
      if (outcome.kind === 'saved') {
        // The one write this app can watch finish: `saveWorkspaceToFile`
        // resolves `saved` only after `writable.close()`, so the file is on
        // disk and the counter has earned the right to go to zero.
        handleRef.current = outcome.handle
        setFileName(outcome.fileName)
        store.markSaved()
        setNotice(`Saved to ${outcome.fileName}`)
      } else if (outcome.kind === 'downloaded') {
        // Deliberately does **not** mark clean. This is the Blob-and-anchor
        // fallback, which reports that a download was *offered* — a user with
        // "always ask where to save" on who presses Cancel has no file, and
        // `markSaved()` has no inverse, so a wrong SAVED here is permanent.
        // The notice says what actually happened instead.
        setFileName(outcome.fileName)
        setNotice(`Downloaded ${outcome.fileName} — still unsaved to a file you chose`)
      } else if (outcome.kind === 'failed') {
        setNotice(`Could not save: ${outcome.message}`)
      }
      return outcome
    },
    [store, inShared, sharedSave],
  )

  const applyImport = useCallback(
    (result: ImportResult, name: string, handle?: SaveFileHandle) => {
      setLastImport(result)
      if (!result.workspace) return
      // Another model replaces the shared one: give its lock back.
      void closeShared()
      // An imported model does not match any file we could write back to unless
      // we opened it through a handle, so the handle is only kept in that case.
      handleRef.current = handle
      setFileName(name || undefined)
      store.replaceWorkspace(result.workspace, { markClean: Boolean(handle) })
      if (result.problems.length === 0) setImporting(false)
    },
    [store, closeShared],
  )

  const openFile = useCallback(async () => {
    const opened = await openWorkspaceFile()
    if (!opened) return
    applyImport(opened.result, opened.fileName, opened.handle)
  }, [applyImport])

  const importFile = useCallback(
    async (file: File) => {
      // Total, like `openFile`: a read that rejects (#52) is a problem in the
      // report, not a rejection every caller has to remember to catch.
      applyImport(await readWorkspaceFile(file).catch(importFailure), file.name)
    },
    [applyImport],
  )

  const loadDemo = useCallback(
    (demo: DemoId) => {
      void closeShared()
      store.replaceWorkspace(loadBundledDemo(demo), { markClean: false })
      handleRef.current = undefined
      setFileName(undefined)
      setImporting(false)
    },
    [store, closeShared],
  )

  // ⌘S / Ctrl+S saves, as it does in every other tool that owns a file. Not
  // under a modal (#158), and the browser's own Save Page stays suppressed
  // either way: both are `global-shortcuts.ts`'s job.
  const saveFromKeys = useCallback(() => {
    if (role === 'writer') void save('json')
  }, [save, role])
  useGlobalShortcut('save', saveFromKeys)

  // Only warn about leaving when there is something to lose.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (store.dirty === 0) return
      void flush()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [store, flush])

  const value = useMemo<FileWorkspaceContextValue>(
    () => ({
      fileName: shared.shared?.model ?? fileName,
      hasHandle: inShared || Boolean(handleRef.current),
      canPickFiles: supportsFileSystemAccess(),
      importing,
      lastImport,
      notice,
      save,
      openFile,
      importFile,
      loadDemo,
      shared,
      startImport: () => {
        setLastImport(undefined)
        setImporting(true)
      },
      cancelImport: () => setImporting(false),
      dismissNotice: () => setNotice(undefined),
    }),
    [
      fileName,
      inShared,
      importing,
      lastImport,
      notice,
      save,
      openFile,
      importFile,
      loadDemo,
      shared,
    ],
  )

  // Within, a model in a shared folder is read-only unless this tab holds its
  // lock (ADR 0010). The tab's own lock still decides the takeover screen.
  const editable = role === 'writer' && (!shared.shared || shared.shared.phase === 'writer')
  // The store holds the same line as the screens, so a screen that misses its
  // own guard still cannot write (#198). A layout effect, so it holds before
  // the first event the new role can see.
  useLayoutEffect(() => store.setWritable(editable), [store, editable])
  const storeContext = useMemo(
    () => ({ ...outer, role: editable ? ('writer' as const) : ('reader' as const) }),
    [outer, editable],
  )

  return (
    <ModelStoreContext.Provider value={storeContext}>
      <FileWorkspaceContext.Provider value={value}>{children}</FileWorkspaceContext.Provider>
    </ModelStoreContext.Provider>
  )
}
