import {
  DEFAULT_TAG_GROUP,
  SCHEMA_VERSION,
  completenessScore,
  destinationRoot,
  elementFolderRoot,
  isWithinFolder,
  modelHealth,
  elementsInView,
  relationshipsInView,
  removeConnections,
  rolloutPlanOf,
  wavePlanOf,
  wavesOf,
  removeNodes,
  viewsReferencedBy,
  withoutElement,
  withoutRelationship,
  withoutViewReference,
  type Element,
  type ElementNode,
  type FileableKind,
  type Folder,
  type FolderDestination,
  type Relationship,
  type RelationshipType,
  type ReportDefinition,
  type TagGroup,
  type RelationshipConnection,
  type View,
  type ViewConnection,
  type ViewNode,
  type Workspace,
} from '@/model'
import {
  commandSubjects,
  describeCommand,
  documentWorkspace,
  invert,
  type Command,
  type CommandRecord,
  type ViewChange,
} from './commands'
import { newId } from './ids'

/**
 * The in-memory model store (concept §5.1–5.2, ADR-002).
 *
 * The whole workspace lives in memory as Maps plus adjacency indexes; IndexedDB
 * is only crash-safe persistence and files are the real source of truth. At
 * 500–5,000 elements every referential query is faster and simpler as a Map
 * traversal than through a storage engine, so the store owns the graph and the
 * persistence layer just mirrors it.
 *
 * Three invariants hold at all times:
 *
 * 1. **Indexes are never stale.** Every mutation goes through `#applyCommand`,
 *    which updates the id maps and the adjacency indexes together.
 * 2. **Every mutation is a command.** Nothing writes to the maps directly, so
 *    undo/redo and the dirty counter cannot drift from what the user did.
 * 3. **Subscribers see a version, not a diff.** The store is mutable by design;
 *    React reads through `useModelSelector`, which recomputes on version change.
 *
 * And one guard: **a reader tab writes nothing** (#198). While `writable` is
 * false, every write throws before it changes anything, so a screen that misses
 * its own reader guard cannot write.
 */

export interface StoreListener {
  (): void
}

/** Adjacency, kept in sync on every mutation. */
interface Indexes {
  bySource: Map<string, Set<string>>
  byTarget: Map<string, Set<string>>
  byType: Map<RelationshipType, Set<string>>
  elementsByType: Map<string, Set<string>>
  /** Element id → ids of the views that draw it (#75: "Appears in views"). */
  viewsByElement: Map<string, Set<string>>
  /** Relationship id → ids of the views that draw it. */
  viewsByRelationship: Map<string, Set<string>>
  /** View id → ids of the views holding a reference to it. */
  viewsByReference: Map<string, Set<string>>
}

export interface ModelStoreOptions {
  /** Author recorded on history entries. */
  author?: string
  /** How many undo steps to keep. */
  historyLimit?: number
}

const DEFAULT_HISTORY_LIMIT = 200

/**
 * A write to a store whose tab is a reader (#198). It throws rather than doing
 * nothing so a missed reader guard in the UI shows up, in a test or the console,
 * instead of looking like an edit that took.
 */
export class ReadOnlyModelError extends Error {
  constructor(what: string) {
    super(`This tab is a reader, so the model cannot change (${what})`)
    this.name = 'ReadOnlyModelError'
  }
}

export class ModelStore {
  // Assigned by `#adopt` from the constructor; the initialisers are here only
  // because TypeScript cannot see a definite assignment through a method call.
  #id = ''
  #name = ''
  #documentation: string | undefined
  #schemaVersion = SCHEMA_VERSION
  #elements = new Map<string, Element>()
  #relationships = new Map<string, Relationship>()
  #views = new Map<string, View>()
  #folders = new Map<string, Folder>()
  #reports: ReportDefinition[] = []
  #tagGroups: TagGroup[] = []
  #propertyTypes: Record<string, string> | undefined
  #language: string | undefined
  #indexes: Indexes = emptyIndexes()

  #undo: CommandRecord[] = []
  #redo: CommandRecord[] = []
  #history: CommandRecord[] = []
  #dirty = 0
  #version = 0
  #revision = 0
  #listeners = new Set<StoreListener>()
  #writable = true
  #author: string
  #historyLimit: number

  constructor(workspace: Workspace, options: ModelStoreOptions = {}) {
    this.#author = options.author ?? 'you'
    this.#historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT
    this.#adopt(workspace)
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  get id(): string {
    return this.#id
  }

  get name(): string {
    return this.#name
  }

  /** The model's own documentation (Archi's "Purpose"), absent when there is none. */
  get documentation(): string | undefined {
    return this.#documentation
  }

  /** Bumped on every change; the subscription key for React. */
  get version(): number {
    return this.#version
  }

  /**
   * Bumped on every change to the model, and not on a save, which changes only
   * what is unsaved. What the validator (#193) compares to say its last run
   * is out of date: a save must not make it say so.
   */
  get revision(): number {
    return this.#revision
  }

  /** Unsaved-change count behind the header's `LOCAL · n UNSAVED` indicator. */
  get dirty(): number {
    return this.#dirty
  }

  /** False while the tab is a reader: every write throws (#198). */
  get writable(): boolean {
    return this.#writable
  }

  get elementCount(): number {
    return this.#elements.size
  }

  get relationshipCount(): number {
    return this.#relationships.size
  }

  get viewCount(): number {
    return this.#views.size
  }

  /** Saved report definitions. */
  get reports(): readonly ReportDefinition[] {
    return this.#reports
  }

  get tagGroups(): readonly TagGroup[] {
    return this.#tagGroups
  }

  /** Applied commands, newest last. */
  get history(): readonly CommandRecord[] {
    return this.#history
  }

  get canUndo(): boolean {
    return this.#undo.length > 0
  }

  get canRedo(): boolean {
    return this.#redo.length > 0
  }

  /** What `undo()` would revert, for the controls' tooltips (#88). */
  get nextUndo(): CommandRecord | undefined {
    return this.#undo.at(-1)
  }

  /** What `redo()` would re-apply. */
  get nextRedo(): CommandRecord | undefined {
    return this.#redo.at(-1)
  }

  element(id: string): Element | undefined {
    return this.#elements.get(id)
  }

  relationship(id: string): Relationship | undefined {
    return this.#relationships.get(id)
  }

  /** Live view of the element map — do not mutate. */
  elements(): IterableIterator<Element> {
    return this.#elements.values()
  }

  relationships(): IterableIterator<Relationship> {
    return this.#relationships.values()
  }

  elementList(): Element[] {
    return [...this.#elements.values()]
  }

  relationshipList(): Relationship[] {
    return [...this.#relationships.values()]
  }

  view(id: string): View | undefined {
    return this.#views.get(id)
  }

  viewList(): View[] {
    return [...this.#views.values()]
  }

  folder(id: string): Folder | undefined {
    return this.#folders.get(id)
  }

  folderList(): Folder[] {
    return [...this.#folders.values()]
  }

  /** Views that draw `elementId` — the fact sheet's "Appears in views". */
  viewsDrawing(elementId: string): View[] {
    return this.#resolveViews(this.#indexes.viewsByElement.get(elementId))
  }

  /** Views that draw `relationshipId`. */
  viewsDrawingRelationship(relationshipId: string): View[] {
    return this.#resolveViews(this.#indexes.viewsByRelationship.get(relationshipId))
  }

  /** Views that hold a reference to view `viewId`. */
  viewsReferencing(viewId: string): View[] {
    return this.#resolveViews(this.#indexes.viewsByReference.get(viewId))
  }

  elementsOfType(type: string): Element[] {
    const ids = this.#indexes.elementsByType.get(type)
    if (!ids) return []
    return [...ids].flatMap((id) => {
      const element = this.#elements.get(id)
      return element ? [element] : []
    })
  }

  /** Relationships leaving `elementId`. */
  outgoing(elementId: string): Relationship[] {
    return this.#resolve(this.#indexes.bySource.get(elementId))
  }

  /** Relationships arriving at `elementId`. */
  incoming(elementId: string): Relationship[] {
    return this.#resolve(this.#indexes.byTarget.get(elementId))
  }

  /**
   * Every relationship touching `elementId`, in either direction — each once.
   *
   * A self-relation sits in both indexes, so the plain concatenation returned it
   * twice. That is not only a duplicated row on the fact sheet and a relation
   * count one too high: `removeElement` builds its cascade from this list, so
   * deleting the element recorded the same relationship twice and undo put back
   * two of it.
   */
  relationshipsOf(elementId: string): Relationship[] {
    const seen = new Set<string>()
    const out: Relationship[] = []
    for (const relationship of [...this.outgoing(elementId), ...this.incoming(elementId)]) {
      if (seen.has(relationship.id)) continue
      seen.add(relationship.id)
      out.push(relationship)
    }
    return out
  }

  relationshipsOfType(type: RelationshipType): Relationship[] {
    return this.#resolve(this.#indexes.byType.get(type))
  }

  /** Distinct elements one hop away, in either direction. */
  neighbours(elementId: string): Element[] {
    const seen = new Set<string>()
    const out: Element[] = []
    for (const relationship of this.relationshipsOf(elementId)) {
      const otherId = relationship.source === elementId ? relationship.target : relationship.source
      if (otherId === elementId || seen.has(otherId)) continue
      seen.add(otherId)
      const element = this.#elements.get(otherId)
      if (element) out.push(element)
    }
    return out
  }

  relationCount(elementId: string): number {
    const source = this.#indexes.bySource.get(elementId)
    const target = this.#indexes.byTarget.get(elementId)
    if (!source || !target) return (source?.size ?? 0) + (target?.size ?? 0)
    // A self-relation is in both sets and is still one relationship.
    let both = 0
    for (const id of source) if (target.has(id)) both += 1
    return source.size + target.size - both
  }

  completeness(elementId: string): number {
    const element = this.#elements.get(elementId)
    if (!element) return 0
    return completenessScore(element, { relationCount: this.relationCount(elementId) })
  }

  /** Mean element completeness — the nav footer's model health. */
  health(): number {
    return modelHealth(
      [...this.#elements.values()].map((element) =>
        completenessScore(element, { relationCount: this.relationCount(element.id) }),
      ),
    )
  }

  /** History entries touching one element, newest first — the fact sheet timeline. */
  historyFor(elementId: string): CommandRecord[] {
    return this.#history
      .filter((record) => commandSubjects(record.command).includes(elementId))
      .reverse()
  }

  /**
   * A plain, serialisable snapshot. Arrays are copies; the caller owns them.
   *
   * This is the model's only exit: SAVE FILE, Export and autosave all read it,
   * so a `Workspace` field missing here is gone from every file the product
   * writes. It mirrors `#adopt` field for field — change one, change both, and
   * `model-store.test.ts` fails if a round trip through the store loses
   * anything, which is the guard rather than either author's memory.
   */
  snapshot(): Workspace {
    return {
      id: this.#id,
      name: this.#name,
      ...(this.#documentation !== undefined ? { documentation: this.#documentation } : {}),
      schemaVersion: this.#schemaVersion,
      elements: [...this.#elements.values()],
      relationships: [...this.#relationships.values()],
      views: [...this.#views.values()],
      folders: [...this.#folders.values()],
      reports: [...this.#reports],
      tagGroups: [...this.#tagGroups],
      // Absent, not empty, when nothing is declared: canonical JSON omits the
      // key entirely, so a workspace without declared types keeps the bytes it
      // had before this field existed (ADR 0004).
      ...(this.#propertyTypes ? { propertyTypes: { ...this.#propertyTypes } } : {}),
      ...(this.#language !== undefined ? { language: this.#language } : {}),
    }
  }

  // ── Subscribing ────────────────────────────────────────────────────────────

  subscribe(listener: StoreListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  // ── Mutating ───────────────────────────────────────────────────────────────

  /**
   * Apply a command, record it for undo, and notify.
   * This is the only write path into the model.
   */
  dispatch(command: Command): CommandRecord {
    this.#assertWritable(command.kind)
    this.#applyCommand(command)
    const record: CommandRecord = {
      id: newId('cmd'),
      label: describeCommand(command),
      at: Date.now(),
      author: this.#author,
      command,
    }
    this.#undo.push(record)
    if (this.#undo.length > this.#historyLimit) this.#undo.shift()
    this.#redo = []
    this.#history.push(record)
    if (this.#history.length > this.#historyLimit) this.#history.shift()
    this.#dirty += 1
    this.#bump()
    return record
  }

  /** Run several mutations as one undoable step. */
  transaction(mutate: (draft: TransactionDraft) => void): CommandRecord | undefined {
    const collected: Command[] = []
    mutate({
      addElement: (element) => collected.push({ kind: 'add-element', element }),
      updateElement: (before, after) => collected.push({ kind: 'update-element', before, after }),
      removeElement: (element, cascaded, cascadedViews) =>
        collected.push({
          kind: 'remove-element',
          element,
          cascaded,
          ...(cascadedViews?.length ? { cascadedViews } : {}),
        }),
      addRelationship: (relationship) => collected.push({ kind: 'add-relationship', relationship }),
      updateRelationship: (before, after) =>
        collected.push({ kind: 'update-relationship', before, after }),
      removeRelationship: (relationship) =>
        collected.push({ kind: 'remove-relationship', relationship }),
    })
    if (collected.length === 0) return undefined
    return this.dispatch(
      collected.length === 1 && collected[0]
        ? collected[0]
        : { kind: 'batch', commands: collected },
    )
  }

  addElement(element: Element): Element {
    this.dispatch({ kind: 'add-element', element })
    return element
  }

  /** Replace an element wholesale; `before` is captured for you. */
  updateElement(id: string, change: (element: Element) => Element): Element | undefined {
    const before = this.#elements.get(id)
    if (!before) return undefined
    const after = change(structuredClone(before))
    this.dispatch({ kind: 'update-element', before, after })
    return after
  }

  /**
   * Deleting an element cascades to every relationship touching it, and to its
   * drawings in every view — with the connections attached to them — as one
   * undoable command.
   */
  removeElement(id: string): void {
    // One step, whatever it cascades to; none when there is no such element.
    // A plan element's cascade is more than one command (#222).
    const commands = this.removalCommands([id])
    const [only] = commands
    if (commands.length === 1 && only) this.dispatch(only)
    else if (commands.length) this.dispatch({ kind: 'batch', commands })
  }

  /**
   * The commands that delete several elements together, worked out but not
   * dispatched, so a caller can put them in one batch with its own (#209: a
   * wave goes, and its sites are unassigned, in one step).
   *
   * Each element carries the relationships it cascades, each relationship
   * once even when it joins two of the elements going, so undo restores it
   * once. The drawings come off every view in one change per view, carried by
   * the first command: two changes to one view, each worked out from the view
   * as it stands now, would each put back what the other took away.
   *
   * The views touched are every view drawing one of the elements or one of
   * the relationships going with them. Normally the second set is inside the
   * first, but a connection the validator would flag (drawn between the wrong
   * nodes) can draw a relationship in a view that does not draw its element,
   * and must not outlive it either.
   *
   * **Plans cascade too** (#222), so no caller can leave a plan dangling: a
   * rollout takes its waves with it, and a wave going unassigns its sites in
   * its rollout, in an update that comes first in the list, unless that
   * rollout is going as well. Without this, Delete on a wave's fact sheet left
   * every site of it pointing at a wave that no longer existed.
   */
  removalCommands(ids: Iterable<string>): Command[] {
    const requested = new Set(ids)
    for (const id of [...requested]) {
      if (!rolloutPlanOf(this.#elements.get(id))) continue
      for (const wave of wavesOf(this.#elements.values(), id)) requested.add(wave.id)
    }
    const elements: Element[] = []
    for (const id of requested) {
      const element = this.#elements.get(id)
      if (element) elements.push(element)
    }
    const taken = new Set<string>()
    const removals = elements.map((element) => {
      const cascaded = this.relationshipsOf(element.id).filter((r) => !taken.has(r.id))
      for (const relationship of cascaded) taken.add(relationship.id)
      return { element, cascaded }
    })
    const touched = new Set<string>()
    for (const { element } of removals) {
      for (const viewId of this.#indexes.viewsByElement.get(element.id) ?? []) touched.add(viewId)
    }
    for (const relationshipId of taken) {
      for (const viewId of this.#indexes.viewsByRelationship.get(relationshipId) ?? []) {
        touched.add(viewId)
      }
    }
    const cascadedViews = this.#viewChanges(touched, (view) => {
      let after = view
      for (const { element } of removals) after = withoutElement(after, element.id) ?? after
      for (const relationshipId of taken)
        after = withoutRelationship(after, relationshipId) ?? after
      return after === view ? undefined : after
    })
    return [
      ...this.#unassignCommands(elements, requested),
      ...removals.map(({ element, cascaded }, index): Command => ({
        kind: 'remove-element',
        element,
        cascaded,
        ...(index === 0 && cascadedViews.length ? { cascadedViews } : {}),
      })),
    ]
  }

  /**
   * One update per rollout that keeps sites in a wave among `elements`,
   * taking those sites out of it. The sites stay in the rollout with their
   * dates (ADR 0015 point 6). A rollout that is itself going needs none.
   */
  #unassignCommands(elements: Element[], going: Set<string>): Command[] {
    const byRollout = new Map<string, Set<string>>()
    for (const element of elements) {
      const wave = wavePlanOf(element)
      if (!wave || going.has(wave.rollout)) continue
      const waves = byRollout.get(wave.rollout) ?? new Set<string>()
      waves.add(element.id)
      byRollout.set(wave.rollout, waves)
    }
    const commands: Command[] = []
    for (const [rolloutId, waves] of byRollout) {
      const rollout = this.#elements.get(rolloutId)
      const plan = rolloutPlanOf(rollout)
      if (!rollout || !plan) continue
      if (!plan.sites.some((site) => site.wave !== undefined && waves.has(site.wave))) continue
      const sites = plan.sites.map((site) => {
        if (site.wave === undefined || !waves.has(site.wave)) return site
        const { wave: _, ...rest } = site
        return rest
      })
      commands.push({
        kind: 'update-element',
        before: rollout,
        after: { ...rollout, plan: { ...plan, sites } },
      })
    }
    return commands
  }

  addRelationship(relationship: Relationship): Relationship {
    this.dispatch({ kind: 'add-relationship', relationship })
    return relationship
  }

  updateRelationship(
    id: string,
    change: (relationship: Relationship) => Relationship,
  ): Relationship | undefined {
    const before = this.#relationships.get(id)
    if (!before) return undefined
    const after = change(structuredClone(before))
    this.dispatch({ kind: 'update-relationship', before, after })
    return after
  }

  /** Deleting a relationship removes its drawings from every view, in the same step. */
  removeRelationship(id: string): void {
    const relationship = this.#relationships.get(id)
    if (!relationship) return
    const cascadedViews = this.#viewChanges(this.#indexes.viewsByRelationship.get(id), (view) =>
      withoutRelationship(view, id),
    )
    this.dispatch({
      kind: 'remove-relationship',
      relationship,
      ...(cascadedViews.length ? { cascadedViews } : {}),
    })
  }

  // ── Views ──────────────────────────────────────────────────────────────────

  addView(view: View): View {
    this.dispatch({ kind: 'add-view', view })
    return view
  }

  /**
   * Replace a view; `before` is captured for you. `change` gets the view itself,
   * not a copy, and must return a new one without mutating it (the pure
   * operations in `model/views.ts` and `ui/views/edit.ts` do). Not copying is
   * what keeps the identity of every node and connection an edit does not touch,
   * so the canvas redraws only what changed (ADR 0006, Consequences). In
   * development and tests the view is frozen first, so a `change` that mutates
   * it throws instead of corrupting the undo history.
   *
   * A `change` that returns the view it was given changes nothing, and records
   * no command.
   */
  updateView(id: string, change: (view: View) => View): View | undefined {
    const before = this.#views.get(id)
    if (!before) return undefined
    if (import.meta.env.DEV) deepFreeze(before)
    const after = change(before)
    if (after === before) return before
    this.dispatch({ kind: 'update-view', before, after })
    return after
  }

  /** Deleting a view also removes the references other views hold to it. */
  removeView(id: string): void {
    const view = this.#views.get(id)
    if (!view) return
    const referrers = new Set(this.#indexes.viewsByReference.get(id))
    referrers.delete(id) // its references to itself go with it
    const cascadedViews = this.#viewChanges(referrers, (other) => withoutViewReference(other, id))
    this.dispatch({
      kind: 'remove-view',
      view,
      ...(cascadedViews.length ? { cascadedViews } : {}),
    })
  }

  addNode(viewId: string, node: ViewNode): ViewNode | undefined {
    return this.updateView(viewId, (view) => ({ ...view, nodes: [...view.nodes, node] }))
      ? node
      : undefined
  }

  updateNode(viewId: string, nodeId: string, change: (node: ViewNode) => ViewNode): void {
    const view = this.#views.get(viewId)
    if (!view?.nodes.some((node) => node.id === nodeId)) return
    this.updateView(viewId, (draft) => {
      const node = draft.nodes.find((n) => n.id === nodeId)!
      const next = change(node)
      // Unchanged: hand the view back, which updateView records as nothing.
      if (next === node) return draft
      return { ...draft, nodes: draft.nodes.map((n) => (n === node ? next : n)) }
    })
  }

  /**
   * Remove a node and its connections. Nodes nested in it stay where they were
   * drawn, lifted to its parent (see `removeNodes`).
   */
  removeNode(viewId: string, nodeId: string): void {
    const view = this.#views.get(viewId)
    if (!view?.nodes.some((node) => node.id === nodeId)) return
    this.updateView(viewId, (draft) => removeNodes(draft, new Set([nodeId])))
  }

  /**
   * Create a relationship and draw it in a view, as one command (#129): one undo
   * takes both away. The connection must draw `relationship` between drawings
   * of its two elements; nothing is dispatched if the view is not there.
   */
  addRelationshipInView(
    viewId: string,
    relationship: Relationship,
    connection: RelationshipConnection,
  ): boolean {
    const before = this.#views.get(viewId)
    if (!before) return false
    const after: View = { ...before, connections: [...before.connections, connection] }
    this.dispatch({
      kind: 'batch',
      commands: [
        { kind: 'add-relationship', relationship },
        { kind: 'update-view', before, after },
      ],
    })
    return true
  }

  /**
   * Change a view and add the elements and relationships it draws, as one
   * command (#131): a nesting and the relationships it means are one step, and
   * so is a new element placed in a container with them; one undo takes it all
   * away. Elements and relationships are added first, so the view never draws
   * what the model does not hold. A `change` that returns the view it was
   * given, with nothing to add, records nothing, as `updateView`.
   */
  updateViewAdding(
    id: string,
    change: (view: View) => View,
    adding: { elements?: readonly Element[]; relationships?: readonly Relationship[] },
  ): View | undefined {
    const before = this.#views.get(id)
    if (!before) return undefined
    if (import.meta.env.DEV) deepFreeze(before)
    const after = change(before)
    const commands: Command[] = [
      ...(adding.elements ?? []).map((element): Command => ({ kind: 'add-element', element })),
      ...(adding.relationships ?? []).map((relationship): Command => ({
        kind: 'add-relationship',
        relationship,
      })),
      ...(after === before ? [] : [{ kind: 'update-view', before, after } as const]),
    ]
    if (commands.length === 0) return before
    this.dispatch(commands.length === 1 ? commands[0]! : { kind: 'batch', commands })
    return after
  }

  /**
   * Create an element and draw it in a view, as one command (#130): placing a
   * new element from the palette is one step, and one undo takes both away.
   * The node must draw `element`; nothing is dispatched if the view is not there.
   */
  addElementInView(viewId: string, element: Element, node: ElementNode): boolean {
    const before = this.#views.get(viewId)
    if (!before) return false
    const after: View = { ...before, nodes: [...before.nodes, node] }
    this.dispatch({
      kind: 'batch',
      commands: [
        { kind: 'add-element', element },
        { kind: 'update-view', before, after },
      ],
    })
    return true
  }

  addConnection(viewId: string, connection: ViewConnection): ViewConnection | undefined {
    return this.updateView(viewId, (view) => ({
      ...view,
      connections: [...view.connections, connection],
    }))
      ? connection
      : undefined
  }

  updateConnection(
    viewId: string,
    connectionId: string,
    change: (connection: ViewConnection) => ViewConnection,
  ): void {
    const view = this.#views.get(viewId)
    if (!view?.connections.some((connection) => connection.id === connectionId)) return
    this.updateView(viewId, (draft) => {
      const connection = draft.connections.find((c) => c.id === connectionId)!
      const next = change(connection)
      if (next === connection) return draft
      return {
        ...draft,
        connections: draft.connections.map((c) => (c === connection ? next : c)),
      }
    })
  }

  removeConnection(viewId: string, connectionId: string): void {
    const view = this.#views.get(viewId)
    if (!view?.connections.some((connection) => connection.id === connectionId)) return
    this.updateView(viewId, (draft) => removeConnections(draft, new Set([connectionId])))
  }

  // ── Folders ────────────────────────────────────────────────────────────────

  addFolder(folder: Folder): Folder {
    this.dispatch({ kind: 'add-folder', folder })
    return folder
  }

  /** Rename or move a folder; `before` is captured for you. */
  updateFolder(id: string, change: (folder: Folder) => Folder): Folder | undefined {
    const before = this.#folders.get(id)
    if (!before) return undefined
    const after = change(structuredClone(before))
    this.dispatch({ kind: 'update-folder', before, after })
    return after
  }

  /**
   * Delete a folder, and keep what was in it. Its subfolders and members move up
   * to where the folder itself sat — the parent folder, or the top-level group —
   * in the same undoable step. Folders are organisation, not semantics (#75), so
   * removing one must never take model content with it.
   */
  removeFolder(id: string): void {
    const folder = this.#folders.get(id)
    if (!folder) return
    const commands: Command[] = []
    const rehome = <T extends { folder?: string }>(item: T): T => {
      const moved = { ...item }
      if (folder.parent === undefined) delete moved.folder
      else moved.folder = folder.parent
      return moved
    }
    for (const child of this.#folders.values()) {
      if (child.parent !== id) continue
      const after: Folder = { ...child }
      delete after.parent
      if (folder.parent === undefined) {
        if (folder.root !== undefined) after.root = folder.root
      } else after.parent = folder.parent
      commands.push({ kind: 'update-folder', before: child, after })
    }
    for (const element of this.#elements.values()) {
      if (element.folder === id) {
        commands.push({ kind: 'update-element', before: element, after: rehome(element) })
      }
    }
    for (const relationship of this.#relationships.values()) {
      if (relationship.folder === id) {
        commands.push({
          kind: 'update-relationship',
          before: relationship,
          after: rehome(relationship),
        })
      }
    }
    for (const view of this.#views.values()) {
      if (view.folder === id)
        commands.push({ kind: 'update-view', before: view, after: rehome(view) })
    }
    commands.push({ kind: 'remove-folder', folder })
    const only = commands.length === 1 ? commands[0] : undefined
    this.dispatch(only ?? { kind: 'batch', commands })
  }

  /**
   * File an element, relationship, view or folder somewhere else in the model
   * tree, as one undoable command (#80). Refused — `false`, nothing dispatched —
   * when the destination is not in the model, is in another group than the
   * object belongs in, or (for a folder) is the folder itself or inside it. A
   * move to where the object already is succeeds without a command, so a drop
   * back onto its own folder does not put a no-op on the undo stack.
   */
  moveToFolder(kind: FileableKind, id: string, destination: FolderDestination): boolean {
    if ('folder' in destination && !this.#folders.has(destination.folder)) return false
    const root = destinationRoot(destination, this.#folders)
    if (root === undefined) return false
    const into = 'folder' in destination ? destination.folder : undefined
    const refile = <T extends { folder?: string }>(item: T): T => {
      const moved = { ...item }
      if (into === undefined) delete moved.folder
      else moved.folder = into
      return moved
    }

    switch (kind) {
      case 'element': {
        const element = this.#elements.get(id)
        if (!element || elementFolderRoot(element.type) !== root) return false
        if (element.folder === into) return true
        this.dispatch({ kind: 'update-element', before: element, after: refile(element) })
        return true
      }
      case 'relationship': {
        const relationship = this.#relationships.get(id)
        if (!relationship || root !== 'relations') return false
        if (relationship.folder === into) return true
        this.dispatch({
          kind: 'update-relationship',
          before: relationship,
          after: refile(relationship),
        })
        return true
      }
      case 'view': {
        const view = this.#views.get(id)
        if (!view || root !== 'views') return false
        if (view.folder === into) return true
        this.dispatch({ kind: 'update-view', before: view, after: refile(view) })
        return true
      }
      case 'folder': {
        const folder = this.#folders.get(id)
        if (!folder || destinationRoot({ folder: id }, this.#folders) !== root) return false
        if (into !== undefined && isWithinFolder(into, id, this.#folders)) return false
        if (
          into === undefined
            ? folder.root === root && folder.parent === undefined
            : folder.parent === into && folder.root === undefined
        ) {
          return true
        }
        const after: Folder = { ...folder }
        delete after.parent
        delete after.root
        if (into === undefined) after.root = root
        else after.parent = into
        this.dispatch({ kind: 'update-folder', before: folder, after })
        return true
      }
    }
  }

  rename(name: string): void {
    if (name === this.#name) return
    this.dispatch({ kind: 'rename-workspace', before: this.#name, after: name })
  }

  /** Sets the model's documentation; `''` clears it, so it is absent rather than empty (#171). */
  document(documentation: string): void {
    const after = documentation === '' ? undefined : documentation
    if (after === this.#documentation) return
    this.dispatch(documentWorkspace(this.#documentation, after))
  }

  undo(): CommandRecord | undefined {
    this.#assertWritable('undo')
    const record = this.#undo.pop()
    if (!record) return undefined
    this.#applyCommand(invert(record.command))
    this.#redo.push(record)
    this.#dirty += 1
    this.#bump()
    return record
  }

  redo(): CommandRecord | undefined {
    this.#assertWritable('redo')
    const record = this.#redo.pop()
    if (!record) return undefined
    this.#applyCommand(record.command)
    this.#undo.push(record)
    this.#dirty += 1
    this.#bump()
    return record
  }

  /**
   * Whether this tab may change the model. The file provider sets it from the
   * same role the screens read: the tab's writer lock and, in a shared folder,
   * the folder's lock (ADR 0010). Loading a workspace (`replaceWorkspace`) stays
   * open to a reader, which is how it follows the writer's saves.
   */
  setWritable(writable: boolean): void {
    this.#writable = writable
  }

  /** Called after a successful file save: the model and the file now agree. */
  markSaved(): void {
    if (this.#dirty === 0) return
    this.#dirty = 0
    this.#bump({ model: false })
  }

  /**
   * Called after a save that wrote the model as it stood when `dirty` read
   * `count`. A change made while the write was under way is not in the file,
   * so it still counts (#147).
   */
  markSavedThrough(count: number): void {
    const next = Math.max(0, this.#dirty - count)
    if (next === this.#dirty) return
    this.#dirty = next
    this.#bump({ model: false })
  }

  /**
   * Replace the entire model — used by import, "load demo" and workspace switching.
   *
   * `markClean` says whether the new model already matches a file **on disk**, and
   * it has no default on purpose: of the three call sites this had when the
   * default existed, two took it and both were wrong, and the one that got it
   * right had to say so explicitly. A silent wrong default is now a compile error.
   *
   * Only a file we watched being written earns `true`. A snapshot out of
   * IndexedDB does not — browser storage is a cache, so a workspace that has only
   * ever lived there matches no file anywhere and the header must not say SAVED.
   *
   * The count restarts rather than accumulating: the old number counted edits to
   * a model that is no longer loaded, so carrying it forward would attribute
   * another workspace's unsaved work to this one.
   */
  replaceWorkspace(workspace: Workspace, { markClean }: { markClean: boolean }): void {
    this.#adopt(workspace)
    this.#undo = []
    this.#redo = []
    this.#history = []
    this.#dirty = markClean ? 0 : 1
    this.#bump()
  }

  /**
   * Make sure a tag name exists in a tag group, adding it to the first one if
   * not. Returns whether anything was added.
   *
   * `workspace.tagGroups` is the sole source of the inventory's tag facets and of
   * every tag's colour, so a tag written only onto an element is invisible to
   * both: tag twelve applications from their fact sheets and none of them can be
   * filtered by it, each chip painted in the neutral fallback.
   */
  registerTag(tag: string): boolean {
    this.#assertWritable('register-tag')
    const name = tag.trim()
    if (!name) return false
    if (this.#tagGroups.some((group) => group.tags.some((t) => t.name === name))) return false

    const [first, ...rest] = this.#tagGroups
    const target = first ?? { ...DEFAULT_TAG_GROUP, tags: [] }
    this.#tagGroups = [
      { ...target, tags: [...target.tags, { name, colourToken: 'var(--bd2)' }] },
      ...(first ? rest : this.#tagGroups),
    ]
    return true
  }

  saveReport(report: ReportDefinition): void {
    this.#assertWritable('save-report')
    const index = this.#reports.findIndex((r) => r.id === report.id)
    if (index >= 0) this.#reports[index] = report
    else this.#reports.push(report)
    this.#dirty += 1
    this.#bump()
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #assertWritable(what: string): void {
    if (!this.#writable) throw new ReadOnlyModelError(what)
  }

  #resolve(ids: Set<string> | undefined): Relationship[] {
    if (!ids || ids.size === 0) return []
    const out: Relationship[] = []
    for (const id of ids) {
      const relationship = this.#relationships.get(id)
      if (relationship) out.push(relationship)
    }
    return out
  }

  #resolveViews(ids: Set<string> | undefined): View[] {
    if (!ids || ids.size === 0) return []
    const out: View[] = []
    for (const id of ids) {
      const view = this.#views.get(id)
      if (view) out.push(view)
    }
    return out
  }

  /** Apply `change` to each of `viewIds`, keeping the ones it actually changed. */
  #viewChanges(
    viewIds: Iterable<string> | undefined,
    change: (view: View) => View | undefined,
  ): ViewChange[] {
    const changes: ViewChange[] = []
    for (const id of viewIds ?? []) {
      const before = this.#views.get(id)
      if (!before) continue
      const after = change(before)
      if (after && after !== before) changes.push({ before, after })
    }
    return changes
  }

  /**
   * Take on a workspace's identity and all of its non-indexed content.
   *
   * The constructor and `replaceWorkspace` both need this. When they each kept
   * their own copy, a field added to `Workspace` had to be remembered in three
   * places — and `propertyTypes` (#37) was remembered in none of them, so the
   * exchange type declarations died between the importer and every file the
   * product writes (#48). One place to add a field, one place to mirror it.
   */
  #adopt(workspace: Workspace): void {
    this.#id = workspace.id
    this.#name = workspace.name
    this.#documentation = workspace.documentation
    this.#schemaVersion = workspace.schemaVersion || SCHEMA_VERSION
    this.#reports = [...workspace.reports]
    this.#folders = new Map(workspace.folders.map((folder) => [folder.id, folder]))
    this.#tagGroups = [...workspace.tagGroups]
    this.#propertyTypes = workspace.propertyTypes ? { ...workspace.propertyTypes } : undefined
    this.#language = workspace.language
    this.#load(workspace)
  }

  #load(workspace: Workspace): void {
    this.#elements = new Map(workspace.elements.map((element) => [element.id, element]))
    this.#relationships = new Map(workspace.relationships.map((r) => [r.id, r]))
    this.#indexes = emptyIndexes()
    for (const element of this.#elements.values()) this.#indexElement(element)
    for (const relationship of this.#relationships.values()) this.#indexRelationship(relationship)
    this.#views = new Map(workspace.views.map((view) => [view.id, view]))
    for (const view of this.#views.values()) this.#indexView(view)
  }

  #bump({ model }: { model: boolean } = { model: true }): void {
    this.#version += 1
    if (model) this.#revision += 1
    for (const listener of this.#listeners) listener()
  }

  #applyCommand(command: Command): void {
    switch (command.kind) {
      case 'add-element':
        this.#insertElement(command.element)
        break
      case 'update-element':
        this.#insertElement(command.after)
        break
      case 'remove-element':
        this.#applyViewChanges(command.cascadedViews)
        for (const relationship of command.cascaded) this.#deleteRelationship(relationship.id)
        this.#deleteElement(command.element.id)
        break
      case 'add-relationship':
        this.#insertRelationship(command.relationship)
        break
      case 'update-relationship':
        this.#deleteRelationship(command.before.id)
        this.#insertRelationship(command.after)
        break
      case 'remove-relationship':
        this.#applyViewChanges(command.cascadedViews)
        this.#deleteRelationship(command.relationship.id)
        break
      case 'add-view':
        this.#insertView(command.view)
        break
      case 'update-view':
        this.#deleteView(command.before.id)
        this.#insertView(command.after)
        break
      case 'remove-view':
        this.#applyViewChanges(command.cascadedViews)
        this.#deleteView(command.view.id)
        break
      case 'add-folder':
        this.#folders.set(command.folder.id, command.folder)
        break
      case 'update-folder':
        this.#folders.delete(command.before.id)
        this.#folders.set(command.after.id, command.after)
        break
      case 'remove-folder':
        this.#folders.delete(command.folder.id)
        break
      case 'rename-workspace':
        this.#name = command.after
        break
      case 'document-workspace':
        this.#documentation = command.after
        break
      case 'batch':
        for (const inner of command.commands) this.#applyCommand(inner)
        break
    }
  }

  #applyViewChanges(changes: readonly ViewChange[] | undefined): void {
    for (const change of changes ?? []) {
      this.#deleteView(change.before.id)
      this.#insertView(change.after)
    }
  }

  #insertView(view: View): void {
    const existing = this.#views.get(view.id)
    if (existing) this.#unindexView(existing)
    this.#views.set(view.id, view)
    this.#indexView(view)
  }

  #deleteView(id: string): void {
    const view = this.#views.get(id)
    if (!view) return
    this.#unindexView(view)
    this.#views.delete(id)
  }

  #indexView(view: View): void {
    for (const id of elementsInView(view)) addTo(this.#indexes.viewsByElement, id, view.id)
    for (const id of relationshipsInView(view))
      addTo(this.#indexes.viewsByRelationship, id, view.id)
    for (const id of viewsReferencedBy(view)) addTo(this.#indexes.viewsByReference, id, view.id)
  }

  #unindexView(view: View): void {
    for (const id of elementsInView(view)) removeFrom(this.#indexes.viewsByElement, id, view.id)
    for (const id of relationshipsInView(view)) {
      removeFrom(this.#indexes.viewsByRelationship, id, view.id)
    }
    for (const id of viewsReferencedBy(view))
      removeFrom(this.#indexes.viewsByReference, id, view.id)
  }

  #insertElement(element: Element): void {
    const existing = this.#elements.get(element.id)
    if (existing) this.#unindexElement(existing)
    this.#elements.set(element.id, element)
    this.#indexElement(element)
  }

  #deleteElement(id: string): void {
    const element = this.#elements.get(id)
    if (!element) return
    this.#unindexElement(element)
    this.#elements.delete(id)
  }

  #insertRelationship(relationship: Relationship): void {
    const existing = this.#relationships.get(relationship.id)
    if (existing) this.#unindexRelationship(existing)
    this.#relationships.set(relationship.id, relationship)
    this.#indexRelationship(relationship)
  }

  #deleteRelationship(id: string): void {
    const relationship = this.#relationships.get(id)
    if (!relationship) return
    this.#unindexRelationship(relationship)
    this.#relationships.delete(id)
  }

  #indexElement(element: Element): void {
    addTo(this.#indexes.elementsByType, element.type, element.id)
  }

  #unindexElement(element: Element): void {
    removeFrom(this.#indexes.elementsByType, element.type, element.id)
  }

  #indexRelationship(relationship: Relationship): void {
    addTo(this.#indexes.bySource, relationship.source, relationship.id)
    addTo(this.#indexes.byTarget, relationship.target, relationship.id)
    addTo(this.#indexes.byType, relationship.type, relationship.id)
  }

  #unindexRelationship(relationship: Relationship): void {
    removeFrom(this.#indexes.bySource, relationship.source, relationship.id)
    removeFrom(this.#indexes.byTarget, relationship.target, relationship.id)
    removeFrom(this.#indexes.byType, relationship.type, relationship.id)
  }
}

export interface TransactionDraft {
  addElement(element: Element): void
  updateElement(before: Element, after: Element): void
  /** Pass the views the element is drawn in, or the drawings are left dangling. */
  removeElement(element: Element, cascaded: Relationship[], cascadedViews?: ViewChange[]): void
  addRelationship(relationship: Relationship): void
  updateRelationship(before: Relationship, after: Relationship): void
  removeRelationship(relationship: Relationship): void
}

function emptyIndexes(): Indexes {
  return {
    bySource: new Map(),
    byTarget: new Map(),
    byType: new Map(),
    elementsByType: new Map(),
    viewsByElement: new Map(),
    viewsByRelationship: new Map(),
    viewsByReference: new Map(),
  }
}

function addTo<K>(index: Map<K, Set<string>>, key: K, id: string): void {
  const bucket = index.get(key)
  if (bucket) bucket.add(id)
  else index.set(key, new Set([id]))
}

function removeFrom<K>(index: Map<K, Set<string>>, key: K, id: string): void {
  const bucket = index.get(key)
  if (!bucket) return
  bucket.delete(id)
  if (bucket.size === 0) index.delete(key)
}

/** Freeze a value and everything it holds; already-frozen parts are skipped. */
function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
}
