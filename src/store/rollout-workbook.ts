import { isPlanProfile, withoutRelationship, type View } from '@/model'
import type { RolloutImportPlan } from '@/io/rollout-workbook'
import type { Command, ViewChange } from './commands'
import { ReadOnlyModelError, type ModelStore } from './model-store'

/**
 * Commit a rollout workbook's dry run (#210) as **one** command, so one undo
 * step takes the whole import back. Apart from `rollouts.ts`, which #211
 * changes in parallel.
 *
 * - `'applied'`: the changes are in the model, as one entry on the stack.
 * - `'unchanged'`: the dry run changes nothing, so no command is recorded.
 * - `'stale'`: the model changed since the dry run (an element or relationship
 *   it read is no longer the one in the store, or an id it would add is taken),
 *   so nothing is applied; plan again on the model as it is.
 * - `'invalid'`: a plan profile the import would store fails its guard, so
 *   nothing is applied (CLAUDE.md, type guards on the write path).
 *
 * A reader is refused with `ReadOnlyModelError` before anything else, as every
 * rollout command does.
 */
export type ApplyRolloutImportResult = 'applied' | 'unchanged' | 'stale' | 'invalid'

export function applyRolloutImport(
  store: ModelStore,
  plan: RolloutImportPlan,
): ApplyRolloutImportResult {
  if (!store.writable) throw new ReadOnlyModelError('apply-rollout-workbook')
  const { addElements, updateElements, addRelationships, removeRelationships } = plan.changes

  // The dry run read these objects from a snapshot of the store; the store
  // replaces an object on every change, so identity says nothing has moved.
  const fresh =
    updateElements.every(({ before }) => store.element(before.id) === before) &&
    removeRelationships.every(
      (relationship) => store.relationship(relationship.id) === relationship,
    ) &&
    addElements.every((element) => store.element(element.id) === undefined) &&
    addRelationships.every((relationship) => store.relationship(relationship.id) === undefined)
  if (!fresh) return 'stale'
  if (updateElements.some(({ after }) => after.plan !== undefined && !isPlanProfile(after.plan))) {
    return 'invalid'
  }

  const commands: Command[] = [
    ...addElements.map((element): Command => ({ kind: 'add-element', element })),
    ...updateElements.map(({ before, after }): Command => ({
      kind: 'update-element',
      before,
      after,
    })),
    ...addRelationships.map((relationship): Command => ({
      kind: 'add-relationship',
      relationship,
    })),
    ...removalsWithViews(
      store,
      removeRelationships.map((relationship) => relationship.id),
    ),
  ]
  const [only] = commands
  if (!only) return 'unchanged'
  store.dispatch(commands.length === 1 ? only : { kind: 'batch', commands })
  return 'applied'
}

/**
 * Removing relationships, with their drawings taken off every view that shows
 * one. Each view changes once, carried by the first removal: two changes to one
 * view, each worked out from the view as it stands now, would each put back
 * what the other took away (as `ModelStore.removalCommands` does for elements).
 */
function removalsWithViews(store: ModelStore, ids: readonly string[]): Command[] {
  const views = new Map<string, { before: View; after: View }>()
  for (const id of ids) {
    for (const view of store.viewsDrawingRelationship(id)) {
      const change = views.get(view.id) ?? { before: view, after: view }
      change.after = withoutRelationship(change.after, id) ?? change.after
      views.set(view.id, change)
    }
  }
  const cascadedViews: ViewChange[] = [...views.values()].filter(
    (change) => change.after !== change.before,
  )
  return ids.map((id, index): Command => ({
    kind: 'remove-relationship',
    relationship: store.relationship(id)!,
    ...(index === 0 && cascadedViews.length ? { cascadedViews } : {}),
  }))
}
