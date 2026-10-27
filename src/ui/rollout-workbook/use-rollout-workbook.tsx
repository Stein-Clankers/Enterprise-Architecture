import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useModelStoreContext } from '@/store'
import type { PaletteAction } from '@/ui/palette/CommandPalette'
import { RolloutWorkbookDialog, type RolloutWorkbookMode } from './RolloutWorkbookDialog'

/**
 * The palette's entries for the rollout workbook (#210) and the dialog they
 * open, for `PaletteProvider`. Exporting only reads, so it is offered to
 * every tab. Importing is offered only to the tab that holds the model, and
 * it ends when the role becomes reader (CLAUDE.md): the effect clears the
 * mode, so it does not reopen when the tab writes again, and the render gate
 * keeps the dialog off screen in the commit that makes the tab a reader.
 */
export function useRolloutWorkbook(): { actions: PaletteAction[]; dialog: ReactNode } {
  const { role } = useModelStoreContext()
  const [mode, setMode] = useState<RolloutWorkbookMode>()
  const close = useCallback(() => setMode(undefined), [])

  useEffect(() => {
    if (role === 'reader') setMode((open) => (open === 'import' ? undefined : open))
  }, [role])

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'rollout-workbook-export',
        label: 'Export rollout workbook…',
        glyph: 'XL',
        run: () => setMode('export'),
      },
      ...(role === 'writer'
        ? [
            {
              id: 'rollout-workbook-import',
              label: 'Import rollout workbook…',
              glyph: 'XL',
              run: () => setMode('import'),
            },
          ]
        : []),
    ],
    [role],
  )

  const dialog =
    mode === 'export' || (mode === 'import' && role === 'writer') ? (
      <RolloutWorkbookDialog mode={mode} onClose={close} />
    ) : null
  return { actions, dialog }
}
