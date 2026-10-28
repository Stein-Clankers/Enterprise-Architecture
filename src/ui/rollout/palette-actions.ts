import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useModelSelector } from '@/store'
import type { PaletteAction } from '@/ui/palette/CommandPalette'
import { rolloutsOf } from './rollout-data'

/**
 * The command palette's way to the rollouts (#211): "Go to rollouts", and
 * "Go to rollout: <name>" for each one, so typing "rollout" lists them all.
 * Read-only navigation, so a reader gets them too.
 */
export function useRolloutActions(): PaletteAction[] {
  const navigate = useNavigate()
  const rollouts = useModelSelector((store) =>
    rolloutsOf(store).map((rollout) => ({ id: rollout.id, name: rollout.name })),
  )
  // The selector returns a fresh array per model change; key the memo on what
  // the actions say, so an unrelated edit does not re-register them.
  const key = JSON.stringify(rollouts)
  return useMemo(
    () => [
      { id: 'rollouts', label: 'Go to rollouts', glyph: 'RO', run: () => navigate('/rollouts') },
      ...rollouts.map((rollout) => ({
        id: `rollout:${rollout.id}`,
        label: `Go to rollout: ${rollout.name}`,
        glyph: 'RO',
        run: () => navigate(`/rollout/${rollout.id}`),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, key],
  )
}
