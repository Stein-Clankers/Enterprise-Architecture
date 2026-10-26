import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toggleTheme } from '@/app/theme'
import { useModelStoreContext } from '@/store'
import { useCreateView } from '@/ui/views/use-create-view'
import { useSaveWorkspace } from '@/ui/shell/use-save-workspace'
import { useUndoRedo } from '@/ui/shell/use-undo-redo'
import { useGlobalShortcut } from '@/ui/shell/global-shortcuts'
import { useValidator } from '@/ui/validator/context'
import { useRolloutWorkbook } from '@/ui/rollout-workbook/use-rollout-workbook'
import { CommandPalette, type PaletteAction } from './CommandPalette'
import { PaletteContext } from './context'

/**
 * Owns palette visibility, and what the navigation and history shortcuts do.
 *
 * `⌘K` / `Ctrl+K` opens (clearing the query — the palette is remounted, so the
 * query cannot survive), `Esc` closes, bare `g` / `i` jump to the graph and the
 * inventory, and `⌘Z` / `⇧⌘Z` undo and redo. Which presses those are, and that
 * none of them acts under a modal, is `global-shortcuts.ts`'s business (#158).
 */

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { saveFile } = useSaveWorkspace()
  const { undoLabel, redoLabel, undo, redo } = useUndoRedo()
  const { role } = useModelStoreContext()
  const createView = useCreateView()
  const { validate } = useValidator()
  const [screenActions, setScreenActions] = useState<PaletteAction[]>([])
  // ── Rollout workbook (#210) ──────────────────────────────────────────────
  const rolloutWorkbook = useRolloutWorkbook()
  // ── end Rollout workbook (#210) ──────────────────────────────────────────

  const openPalette = useCallback(() => setOpen(true), [])
  const closePalette = useCallback(() => setOpen(false), [])

  const actions = useMemo<PaletteAction[]>(
    () => [
      { id: 'inventory', label: 'Go to inventory', glyph: 'IN', run: () => navigate('/inventory') },
      { id: 'graph', label: 'Go to graph', glyph: 'GR', run: () => navigate('/graph') },
      // As the validator's own button does: run now, then show the list (#193).
      {
        id: 'validate',
        label: 'Validate model',
        glyph: 'VA',
        run: () => {
          validate()
          navigate('/validate')
        },
      },
      { id: 'theme', label: 'Toggle theme', glyph: 'TH', run: () => void toggleTheme() },
      // Through the one owner, not a second copy of it. This action used to
      // inline the download and the `markSaved()` — the header's bug, reproduced
      // by copy-paste — and drop the reader-role guard the header applies, so a
      // tab demoted to reader (whose edits are memory-only, since its autosaver
      // is disabled) could still zero the one indicator that would have said so.
      { id: 'save', label: 'Save file', glyph: 'SV', run: () => void saveFile() },
      // Present only when there is a step to take, named for what it would do.
      ...(undoLabel ? [{ id: 'undo', label: `Undo: ${undoLabel}`, glyph: 'UN', run: undo }] : []),
      ...(redoLabel ? [{ id: 'redo', label: `Redo: ${redoLabel}`, glyph: 'RE', run: redo }] : []),
      // Only the tab that holds the model can make one (#130).
      ...(role === 'writer'
        ? [{ id: 'new-view', label: 'New view', glyph: 'VW', run: () => void createView() }]
        : []),
      // ── Rollout workbook (#210) ──
      ...rolloutWorkbook.actions,
      // ── end Rollout workbook (#210) ──
      ...screenActions,
    ],
    [
      navigate,
      validate,
      saveFile,
      undoLabel,
      redoLabel,
      undo,
      redo,
      role,
      createView,
      rolloutWorkbook.actions,
      screenActions,
    ],
  )

  const goToGraph = useCallback(() => navigate('/graph'), [navigate])
  const goToInventory = useCallback(() => navigate('/inventory'), [navigate])
  // Each runs only when no modal is open, the palette included (#158). Open
  // over another dialog, an action run from the palette would act behind it,
  // and the Escape that closes the palette would reach the dialog too.
  useGlobalShortcut('palette', openPalette)
  useGlobalShortcut('undo', undo)
  useGlobalShortcut('redo', redo)
  useGlobalShortcut('graph', goToGraph)
  useGlobalShortcut('inventory', goToInventory)

  const value = useMemo(
    () => ({ open, openPalette, closePalette, setScreenActions }),
    [open, openPalette, closePalette],
  )

  return (
    <PaletteContext.Provider value={value}>
      {children}
      {/* ── Rollout workbook (#210) ── */}
      {rolloutWorkbook.dialog}
      {open && (
        <CommandPalette
          onClose={closePalette}
          onOpenElement={(id) => navigate(`/element/${id}`)}
          actions={actions}
        />
      )}
    </PaletteContext.Provider>
  )
}
