import {
  rolloutPlanOf,
  typeLabel,
  wavePlanOf,
  type Element,
  type Folder,
  type Milestone,
  type RolloutPlan,
  type Relationship,
  type View,
} from '@/model'
import { getKey } from '@/io/records'

/**
 * Every mutation is a command.
 *
 * Commands carry both the before and after state of what they touch, so undo is
 * a pure inverse rather than a snapshot diff — at 5,000 elements, snapshotting
 * the whole workspace per keystroke is not an option. Deleting an element also
 * carries the relationships that were cascaded away with it, so undo restores
 * the neighbourhood, not just the node.
 *
 * `batch` exists for anything that must undo in one step: an Excel import, a
 * multi-field edit on the fact sheet, a bulk retag.
 *
 * A view is replaced whole on every edit (`update-view`): the store's node and
 * connection operations compute the new view and dispatch one. At a few hundred
 * nodes a view is small, and one command shape for every diagram edit is one
 * inverse to get right rather than six. Removing an element or relationship
 * carries the views it was drawn in as `cascadedViews`, so deleting a drawn
 * element and undoing it restores the drawings with it.
 */

/** A view as it was and as it became. */
export interface ViewChange {
  before: View
  after: View
}

export type Command =
  | { kind: 'add-element'; element: Element }
  | { kind: 'update-element'; before: Element; after: Element }
  | {
      kind: 'remove-element'
      element: Element
      cascaded: Relationship[]
      cascadedViews?: ViewChange[]
    }
  | { kind: 'add-relationship'; relationship: Relationship }
  | { kind: 'update-relationship'; before: Relationship; after: Relationship }
  | { kind: 'remove-relationship'; relationship: Relationship; cascadedViews?: ViewChange[] }
  | { kind: 'add-view'; view: View }
  | { kind: 'update-view'; before: View; after: View }
  | { kind: 'remove-view'; view: View; cascadedViews?: ViewChange[] }
  | { kind: 'add-folder'; folder: Folder }
  | { kind: 'update-folder'; before: Folder; after: Folder }
  | { kind: 'remove-folder'; folder: Folder }
  | { kind: 'rename-workspace'; before: string; after: string }
  /** The model's own documentation (#171); absent is undocumented, never `''`. */
  | { kind: 'document-workspace'; before?: string; after?: string }
  | { kind: 'batch'; commands: Command[] }

/** An applied command, as the fact sheet's HISTORY section reads it. */
export interface CommandRecord {
  id: string
  /** Human sentence: "Created Application Component «CRM System»". */
  label: string
  /** Epoch ms. */
  at: number
  author: string
  command: Command
}

/** The subject an entry concerns, so history can be filtered per element. */
export function commandSubjects(command: Command): string[] {
  switch (command.kind) {
    case 'add-element':
      return [command.element.id]
    case 'update-element':
      return [command.after.id]
    case 'remove-element':
      return [
        command.element.id,
        ...command.cascaded.flatMap((r) => [r.source, r.target]),
        ...viewIds(command.cascadedViews),
      ]
    case 'add-relationship':
      return [command.relationship.id, command.relationship.source, command.relationship.target]
    case 'update-relationship':
      return [command.after.id, command.after.source, command.after.target]
    case 'remove-relationship':
      return [
        command.relationship.id,
        command.relationship.source,
        command.relationship.target,
        ...viewIds(command.cascadedViews),
      ]
    case 'add-view':
      return [command.view.id]
    case 'update-view':
      return [command.after.id]
    case 'remove-view':
      return [command.view.id, ...viewIds(command.cascadedViews)]
    case 'add-folder':
      return [command.folder.id]
    case 'update-folder':
      return [command.after.id]
    case 'remove-folder':
      return [command.folder.id]
    case 'rename-workspace':
    case 'document-workspace':
      return []
    case 'batch':
      return command.commands.flatMap(commandSubjects)
  }
}

/** One-line description, as the history timeline and the undo tooltip print it. */
export function describeCommand(command: Command): string {
  switch (command.kind) {
    case 'add-element':
      return `Created ${typeLabel(command.element.type)} “${command.element.name}”`
    case 'update-element':
      return describeElementUpdate(command.before, command.after)
    case 'remove-element':
      return command.cascaded.length
        ? `Deleted “${command.element.name}” and ${command.cascaded.length} relation${command.cascaded.length === 1 ? '' : 's'}`
        : `Deleted “${command.element.name}”`
    case 'add-relationship':
      return `Added ${command.relationship.type} relation`
    case 'update-relationship':
      return command.before.folder !== command.after.folder &&
        sameApartFromFolder(command.before, command.after)
        ? `Moved ${command.after.type} relation`
        : `Updated ${command.after.type} relation`
    case 'remove-relationship':
      return `Removed ${command.relationship.type} relation`
    case 'add-view':
      return `Created view “${command.view.name}”`
    case 'update-view':
      return describeViewUpdate(command.before, command.after)
    case 'remove-view':
      return `Deleted view “${command.view.name}”`
    case 'add-folder':
      return `Created folder “${command.folder.name}”`
    case 'update-folder':
      return command.before.name !== command.after.name
        ? `Renamed folder “${command.before.name}” to “${command.after.name}”`
        : `Moved folder “${command.after.name}”`
    case 'remove-folder':
      return `Deleted folder “${command.folder.name}”`
    case 'rename-workspace':
      return `Renamed workspace to “${command.after}”`
    case 'document-workspace':
      return command.after === undefined
        ? 'Cleared the workspace documentation'
        : 'Edited the workspace documentation'
    case 'batch': {
      const [first, second] = command.commands
      if (command.commands.length === 1 && first) return describeCommand(first)
      // A relationship drawn as it was made (#129): one step, so one sentence.
      if (
        command.commands.length === 2 &&
        first?.kind === 'add-relationship' &&
        second?.kind === 'update-view'
      ) {
        return `Added ${first.relationship.type} relation to “${second.after.name}”`
      }
      // An element placed from the palette (#130): made and drawn in one step.
      if (
        command.commands.length === 2 &&
        first?.kind === 'add-element' &&
        second?.kind === 'update-view'
      ) {
        return `Added ${typeLabel(first.element.type)} “${first.element.name}” to “${second.after.name}”`
      }
      // A milestone deleted with the waves' dates for it (#213, #229 review).
      if (first?.kind === 'update-element' && command.commands.slice(1).every(isWaveUpdate)) {
        const said = describeMilestoneRemoval(
          first.before,
          first.after,
          command.commands.length - 1,
        )
        if (said) return said
      }
      return `${command.commands.length} changes`
    }
  }
}

/** Name the fields that actually changed — vague history entries are useless. */
function describeElementUpdate(before: Element, after: Element): string {
  if (before.folder !== after.folder && sameApartFromFolder(before, after)) {
    return `Moved “${after.name}”`
  }
  const milestones = describeMilestoneChange(before, after)
  if (milestones) return milestones
  const changed: string[] = []
  if (before.name !== after.name) changed.push('name')
  if (before.documentation !== after.documentation) changed.push('documentation')
  if (JSON.stringify(before.properties) !== JSON.stringify(after.properties)) {
    changed.push('properties')
  }
  if (JSON.stringify(before.profile) !== JSON.stringify(after.profile)) changed.push('assessment')
  if (JSON.stringify(before.plan) !== JSON.stringify(after.plan)) changed.push('plan')
  const what = changed.length ? changed.join(', ') : 'element'
  return `Updated ${what} of “${after.name}”`
}

// ── Milestone commands (#213) ────────────────────────────────────────────────

/**
 * A rollout's milestone set or its sites' milestone dates, changed by one of
 * the milestone commands (`store/rollouts.ts`): which milestone, and what was
 * done to it. Every one of them is an `update-element` of the rollout, so
 * without this each read "Updated plan of “<rollout>”", whichever milestone
 * it touched (#229 review, finding 4). `undefined` for any other plan change.
 */
function describeMilestoneChange(before: Element, after: Element): string | undefined {
  if (!sameApart(before, after, 'plan')) return undefined
  const was = rolloutPlanOf(before)
  const now = rolloutPlanOf(after)
  if (!was || !now) return undefined
  const rollout = `“${after.name}”`
  const removed = describeMilestoneRemoval(before, after, 0)
  if (removed) return removed
  if (!sameApart(was, now, 'milestones')) {
    return sameApart(was, now, 'sites') ? siteDatesText(was, now, rollout) : undefined
  }
  const wasIds = was.milestones.map((milestone) => milestone.id)
  const nowIds = now.milestones.map((milestone) => milestone.id)
  const added = now.milestones.filter((milestone) => !wasIds.includes(milestone.id))
  if (added.length === 1 && nowIds.length === wasIds.length + 1) {
    return `Added milestone “${added[0]!.label}” to ${rollout}`
  }
  if (nowIds.length !== wasIds.length || added.length) return undefined
  const changed = now.milestones.filter(
    (milestone) =>
      JSON.stringify(milestone) !==
      JSON.stringify(was.milestones.find((candidate) => candidate.id === milestone.id)),
  )
  if (changed.length === 1) return `Updated milestone “${changed[0]!.label}” of ${rollout}`
  // A move swaps two neighbours: the one that was first now follows the other.
  const moved = wasIds.findIndex((id, index) => nowIds[index] !== id)
  if (changed.length === 0 && moved >= 0) {
    const first = was.milestones[moved]!
    const second = was.milestones[moved + 1]
    if (second && nowIds[moved] === second.id && nowIds[moved + 1] === first.id) {
      return `Moved milestone “${first.label}” after “${second.label}” in ${rollout}`
    }
  }
  return undefined
}

/**
 * A milestone deleted from a rollout, with what went with it: the sites'
 * dates for it, the waves' (`waves`, one update each in the same batch) and
 * the archetypes' durations. `undefined` when `before` to `after` is not the
 * deletion of exactly one milestone.
 */
function describeMilestoneRemoval(
  before: Element,
  after: Element,
  waves: number,
): string | undefined {
  const was = rolloutPlanOf(before)
  const now = rolloutPlanOf(after)
  if (!was || !now || now.milestones.length !== was.milestones.length - 1) return undefined
  const ids = new Set(now.milestones.map((milestone) => milestone.id))
  const gone = was.milestones.filter((milestone) => !ids.has(milestone.id))
  if (gone.length !== 1) return undefined
  const id = gone[0]!.id
  const has = (record: Record<string, unknown> | undefined) =>
    record !== undefined && Object.hasOwn(record, id)
  const sites = was.sites.filter((site) => has(site.milestones) || has(site.actuals)).length
  const archetypes = was.archetypes.filter((archetype) => has(archetype.durations)).length
  const dates = listed(
    [sites && plural(sites, 'site'), waves && plural(waves, 'wave')].filter(
      (part): part is string => Boolean(part),
    ),
  )
  const with_ = [
    dates && `its dates on ${dates}`,
    archetypes &&
      `its ${archetypes === 1 ? 'duration' : 'durations'} in ${plural(archetypes, 'archetype')}`,
  ].filter((part): part is string => Boolean(part))
  const subject = `Deleted milestone “${gone[0]!.label}” from “${after.name}”`
  return with_.length ? `${subject}, with ${with_.join(' and ')}` : subject
}

/** One site's (or several sites') own milestone dates changed: which milestones. */
function siteDatesText(was: RolloutPlan, now: RolloutPlan, rollout: string): string | undefined {
  const before = new Map(was.sites.map((site) => [site.location, site]))
  const touched = new Set<string>()
  let sites = 0
  for (const site of now.sites) {
    const old = before.get(site.location)
    if (!old || JSON.stringify(old) === JSON.stringify(site)) continue
    if (!sameApart(old, site, 'milestones')) return undefined
    sites++
    for (const id of new Set([
      ...Object.keys(old.milestones ?? {}),
      ...Object.keys(site.milestones ?? {}),
    ])) {
      // By `getKey`: a milestone id is a user's, and may be `constructor`.
      const a = getKey(old.milestones, id)
      const b = getKey(site.milestones, id)
      if (a?.date !== b?.date || a?.precision !== b?.precision) touched.add(id)
    }
  }
  if (!sites || before.size !== now.sites.length) return undefined
  const labels = now.milestones
    .filter((milestone: Milestone) => touched.has(milestone.id))
    .map((milestone) => `“${milestone.label}”`)
  if (!labels.length) return undefined
  return `Updated the ${listed(labels)} ${labels.length === 1 ? 'date' : 'dates'} of ${plural(sites, 'site')} in ${rollout}`
}

function isWaveUpdate(command: Command): boolean {
  return command.kind === 'update-element' && wavePlanOf(command.after) !== undefined
}

/** True when two objects differ in nothing but `key`. */
function sameApart<T extends object>(a: T, b: T, key: keyof T): boolean {
  const { [key]: _a, ...restA } = a
  const { [key]: _b, ...restB } = b
  return JSON.stringify(restA) === JSON.stringify(restB)
}

/** "a", "a and b", "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length < 2) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/**
 * Say what a view edit did, from the two states — the store's node and
 * connection operations all arrive here as one `update-view`.
 */
function describeViewUpdate(before: View, after: View): string {
  const name = `“${after.name}”`
  const added = countNew(after.nodes, before.nodes)
  const removed = countNew(before.nodes, after.nodes)
  const linked = countNew(after.connections, before.connections)
  const unlinked = countNew(before.connections, after.connections)
  if (added && !removed) return `Added ${plural(added, 'node')} to ${name}`
  if (removed && !added) return `Removed ${plural(removed, 'node')} from ${name}`
  if (!added && !removed && linked && !unlinked)
    return `Added ${plural(linked, 'connection')} to ${name}`
  if (!added && !removed && unlinked && !linked) {
    return `Removed ${plural(unlinked, 'connection')} from ${name}`
  }
  if (before.name !== after.name) return `Renamed view “${before.name}” to ${name}`
  if (before.folder !== after.folder && sameApartFromFolder(before, after)) {
    return `Moved view ${name}`
  }
  return `Edited view ${name}`
}

/** True when two versions of an object differ in nothing but their folder. */
function sameApartFromFolder<T extends { folder?: string }>(before: T, after: T): boolean {
  const { folder: _before, ...restBefore } = before
  const { folder: _after, ...restAfter } = after
  return JSON.stringify(restBefore) === JSON.stringify(restAfter)
}

function countNew(items: readonly { id: string }[], against: readonly { id: string }[]): number {
  const known = new Set(against.map((item) => item.id))
  return items.filter((item) => !known.has(item.id)).length
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function viewIds(changes: readonly ViewChange[] | undefined): string[] {
  return changes?.map((change) => change.after.id) ?? []
}

/** Swap before and after — the undo of a set of cascaded view edits. */
function restoreViews(changes: readonly ViewChange[] | undefined): Command[] {
  return (changes ?? []).map((change): Command => ({
    kind: 'update-view',
    before: change.after,
    after: change.before,
  }))
}

/** The inverse of a command — what undo applies. */
export function invert(command: Command): Command {
  switch (command.kind) {
    case 'add-element':
      return { kind: 'remove-element', element: command.element, cascaded: [] }
    case 'update-element':
      return { kind: 'update-element', before: command.after, after: command.before }
    case 'remove-element':
      return {
        kind: 'batch',
        commands: [
          { kind: 'add-element', element: command.element },
          ...command.cascaded.map((relationship): Command => ({
            kind: 'add-relationship',
            relationship,
          })),
          // After the relationships: a restored view's connections refer to them.
          ...restoreViews(command.cascadedViews),
        ],
      }
    case 'add-relationship':
      return { kind: 'remove-relationship', relationship: command.relationship }
    case 'update-relationship':
      return { kind: 'update-relationship', before: command.after, after: command.before }
    case 'remove-relationship': {
      const add: Command = { kind: 'add-relationship', relationship: command.relationship }
      return command.cascadedViews?.length
        ? { kind: 'batch', commands: [add, ...restoreViews(command.cascadedViews)] }
        : add
    }
    case 'add-view':
      return { kind: 'remove-view', view: command.view }
    case 'update-view':
      return { kind: 'update-view', before: command.after, after: command.before }
    case 'remove-view': {
      const add: Command = { kind: 'add-view', view: command.view }
      return command.cascadedViews?.length
        ? { kind: 'batch', commands: [add, ...restoreViews(command.cascadedViews)] }
        : add
    }
    case 'add-folder':
      return { kind: 'remove-folder', folder: command.folder }
    case 'update-folder':
      return { kind: 'update-folder', before: command.after, after: command.before }
    case 'remove-folder':
      return { kind: 'add-folder', folder: command.folder }
    case 'rename-workspace':
      return { kind: 'rename-workspace', before: command.after, after: command.before }
    case 'document-workspace':
      return documentWorkspace(command.after, command.before)
    case 'batch':
      // Undo a batch back to front, so ordering constraints hold in reverse.
      return { kind: 'batch', commands: [...command.commands].reverse().map(invert) }
  }
}

/** Built so an absent side stays absent: `exactOptionalPropertyTypes` holds the line. */
export function documentWorkspace(before: string | undefined, after: string | undefined): Command {
  return {
    kind: 'document-workspace',
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  }
}
