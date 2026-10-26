# The model store

In-memory typed graph, command stack, IndexedDB persistence, second-tab safety,
and the React binding. Concept reference: `design/specs/open-ea-repository-concept.md`
§5.1–5.2 (ADR-002).

| File                     | What it owns                                                         |
| ------------------------ | -------------------------------------------------------------------- |
| `model-store.ts`         | the graph: id maps, adjacency indexes, undo/redo, dirty counter      |
| `commands.ts`            | the command type, its inverse, and its human description             |
| `rollouts.ts`            | rollout, wave and site-plan commands, each one undo step (#209)      |
| `persistence.ts`         | IndexedDB via `idb` — snapshots, rolling generations, workspace list |
| `autosave.ts`            | debounced idle-scheduled writes from a live store                    |
| `tab-lock.ts`            | Web Locks writer election + BroadcastChannel takeover                |
| `context.ts`             | `useModelStore`, `useModelVersion`, `useModelSelector`               |
| `ModelStoreProvider.tsx` | boot: restore, claim the lock, wire autosave                         |

## Why in-memory

At 500–5,000 elements the whole model is single-digit megabytes, and every
referential query — neighbours, relations by type, "what does this serve" — is
faster and simpler as a Map traversal than through any storage engine. The
storage layer's only job is to survive a crash. SQLite WASM was rejected for
adding worker and wasm plumbing to get a query language that is the wrong shape
for graph traversal.

## Three invariants

1. **Indexes are never stale.** Every mutation goes through one private
   `#applyCommand`, which updates the id maps and the adjacency indexes together.
   Nothing else writes.
2. **Every mutation is a command.** Undo is a computed inverse, not a snapshot
   diff — snapshotting a 5,000-element workspace per keystroke is not an option.
   Deleting an element carries away the relationships it cascades, so undo
   restores the neighbourhood rather than an orphaned node.
3. **Subscribers see a version, not a diff.** The store is deliberately mutable;
   React subscribes to an integer through `useSyncExternalStore` and selectors
   recompute when it changes. The model never enters reconciliation.

## Persistence is a cache, not the truth

Files are the source of truth (issue #11 wires that up). Safari evicts
script-writable storage after seven days of non-use, so IndexedDB holds rolling
snapshot generations (five per workspace) and the header's save-state indicator
is what tells the user where their model actually lives.
`requestPersistentStorage()` asks for an eviction exemption; a refusal is
expected, not an error.

## Second-tab safety

Two tabs autosaving the same workspace would interleave writes and lose edits
silently. One tab holds an exclusive Web Lock and is the writer; every other tab
loads and renders the model but never writes. A reader can ask for the lock over
a BroadcastChannel — the writer steps down and the requester picks it up. The
takeover UI is issue #11.

`acquire()` uses `ifAvailable: true` so a second tab gets an immediate answer
instead of queueing behind the holder, and it resolves the role from _inside_ the
lock callback: awaiting the request promise would block until the lock is
released, which for the winning tab is never.

Browsers without Web Locks report every tab as the writer. That is the
pre-existing behaviour rather than a new hazard.
