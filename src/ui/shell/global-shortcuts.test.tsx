import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadDemoWorkspace } from '@/io'
import { stubDownloads } from '@/test/downloads'
import { renderApp } from '@/test/render'
import { SHORTCUT_IDS, type ShortcutId } from './global-shortcuts'

/**
 * No global shortcut acts under a modal dialog (#158).
 *
 * A dialog is what the keys are for while it is open. ⌘K skipped the check the
 * undo and single-letter bindings had: the palette opened over the nesting
 * prompt, and placing an element from it dropped the move the prompt was
 * asking about, while the Escape that closed the palette also answered the
 * prompt. Each binding here is driven with a dialog open, at the body, past the
 * text-field guards, so only the modal check can stop it. The same press is
 * then repeated with the dialog closed, and must act: a binding that never
 * fires at all would otherwise pass as guarded.
 *
 * Every binding in `SHORTCUTS` must have a row here, and the last tests count
 * every key listener in the app, so a binding written beside the dispatcher
 * rather than through it fails here too.
 */

let createObjectURL: ReturnType<typeof stubDownloads>['createObjectURL']

beforeEach(() => {
  createObjectURL = stubDownloads().createObjectURL
})

type User = ReturnType<typeof userEvent.setup>

const undoButton = () => screen.getByRole('button', { name: 'Undo' })
const redoButton = () => screen.getByRole('button', { name: 'Redo' })

/** One undoable change: a new element, made from the inventory. */
async function makeAChange(user: User) {
  await user.click(screen.getByRole('button', { name: '+ Element' }))
  await user.type(screen.getByLabelText(/Name/), 'Shortcut probe')
  await user.click(screen.getByRole('button', { name: 'Create' }))
  expect(undoButton()).toBeEnabled()
}

interface Binding {
  readonly id: ShortcutId
  readonly name: string
  readonly key: KeyboardEventInit
  readonly route: string
  readonly prepare?: (user: User) => Promise<void>
  /** Is the browser's own action for the press (Save Page, the address bar) kept away even under a dialog? */
  readonly claimsBrowserKey?: true
  /** Has the binding done what it does? */
  readonly acted: () => boolean
}

const BINDINGS: readonly Binding[] = [
  {
    id: 'palette',
    name: '⌘K opens the palette',
    key: { key: 'k', metaKey: true },
    claimsBrowserKey: true,
    route: '/inventory',
    acted: () => screen.queryByRole('dialog', { name: 'Command palette' }) !== null,
  },
  {
    id: 'palette',
    name: 'Ctrl+K opens the palette',
    key: { key: 'k', ctrlKey: true },
    claimsBrowserKey: true,
    route: '/inventory',
    acted: () => screen.queryByRole('dialog', { name: 'Command palette' }) !== null,
  },
  ...[
    { name: '⌘Z undoes', key: { key: 'z', metaKey: true } },
    { name: 'Ctrl+Z undoes', key: { key: 'z', ctrlKey: true } },
  ].map((b): Binding => ({
    id: 'undo',
    ...b,
    route: '/inventory',
    prepare: makeAChange,
    acted: () => !redoButton().hasAttribute('disabled'),
  })),
  ...[
    { name: '⇧⌘Z redoes', key: { key: 'z', metaKey: true, shiftKey: true } },
    { name: 'Ctrl+Y redoes', key: { key: 'y', ctrlKey: true } },
  ].map((b): Binding => ({
    id: 'redo',
    ...b,
    route: '/inventory',
    prepare: async (user: User) => {
      await makeAChange(user)
      await user.click(undoButton())
      expect(redoButton()).toBeEnabled()
    },
    acted: () => redoButton().hasAttribute('disabled'),
  })),
  {
    id: 'graph',
    name: 'g opens the graph',
    key: { key: 'g' },
    route: '/inventory',
    acted: () => screen.queryByRole('heading', { name: 'Dependency graph' }) !== null,
  },
  {
    id: 'inventory',
    name: 'i opens the inventory',
    key: { key: 'i' },
    route: '/graph',
    acted: () => screen.queryByRole('heading', { name: 'Inventory' }) !== null,
  },
  {
    id: 'save',
    name: '⌘S saves',
    key: { key: 's', metaKey: true },
    claimsBrowserKey: true,
    route: '/inventory',
    acted: () => createObjectURL.mock.calls.length > 0,
  },
  {
    id: 'save',
    name: 'Ctrl+S saves',
    key: { key: 's', ctrlKey: true },
    claimsBrowserKey: true,
    route: '/inventory',
    acted: () => createObjectURL.mock.calls.length > 0,
  },
]

describe('the global shortcuts, under a modal dialog (#158)', () => {
  it.each(BINDINGS)('$name, but not while a dialog is open', async (binding) => {
    renderApp(loadDemoWorkspace(), { route: binding.route })
    const user = userEvent.setup()
    await binding.prepare?.(user)
    expect(binding.acted()).toBe(false)

    // Any modal will do; the import dialog is in the header on every screen.
    await user.click(screen.getByRole('button', { name: 'Import' }))
    const dialog = screen.getByRole('dialog', { name: 'Import' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // `fireEvent` answers whether the default survived. Undo keeps it for the
    // dialog's own fields; ⌘S never gets the browser's Save Page.
    expect(fireEvent.keyDown(document.body, binding.key)).toBe(!binding.claimsBrowserKey)
    // Give anything that slipped through a beat to land: a save is async.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(binding.acted()).toBe(false)
    expect(screen.getByRole('dialog', { name: 'Import' })).toBe(dialog)

    // Closed, the same press acts, so the one above was stopped by the guard.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Import' })).not.toBeInTheDocument()
    fireEvent.keyDown(document.body, binding.key)
    await waitFor(() => expect(binding.acted()).toBe(true))
  })

  it('has a row for every binding the dispatcher runs', () => {
    expect(new Set(BINDINGS.map((binding) => binding.id))).toEqual(new Set(SHORTCUT_IDS))
  })
})

/**
 * How many key listeners a source file adds. It fails closed: any
 * `addEventListener` counts unless it is called directly with a string naming
 * an event other than a key's, so an event type it cannot read, a call through
 * `.call`, and a listener on any receiver (`globalThis`, an alias,
 * `document.documentElement`) all count. So does assigning `onkeydown` and its
 * siblings. JSX's `onKeyDown` is not global and does not count.
 */
function keyListeners(source: string): number {
  const added = source.match(/addEventListener(?!(?:\?\.)?\(\s*(['"])(?!key)[a-z]+\1)/g) ?? []
  const assigned = source.match(/\bonkey(?:down|up|press)\s*=(?!=)/g) ?? []
  return added.length + assigned.length
}

describe('keyListeners', () => {
  it.each([
    "window.addEventListener('keydown', f)",
    'document.addEventListener("keyup", f, true)',
    'document.body.addEventListener(`keypress`, f)',
    "globalThis.addEventListener('keydown', f)",
    "const t = window; t.addEventListener('keydown', f)",
    "document.documentElement.addEventListener('keydown', f)",
    "self.addEventListener?.('keydown', f)",
    'window.addEventListener(type, f)',
    'window.addEventListener(`${kind}`, f)',
    "EventTarget.prototype.addEventListener.call(window, 'keydown', f)",
    'window.onkeydown = f',
    'document.onkeyup=f',
  ])('counts %s', (source) => {
    expect(keyListeners(source)).toBe(1)
  })

  it.each([
    "window.addEventListener('mousedown', f)",
    "document.fonts.addEventListener?.('loadingdone', f)",
    "window.removeEventListener('keydown', f)",
    '<div onKeyDown={f} />',
    'if (el.onkeydown === f) {}',
  ])('does not count %s', (source) => {
    expect(keyListeners(source)).toBe(0)
  })
})

describe('every key listener in the app', () => {
  /** The dispatcher: the one listener for global bindings, each driven above. */
  const GLOBAL = { 'src/ui/shell/GlobalShortcutsProvider.tsx': 1 }
  /**
   * Listeners added only while their own modal or menu is open, which serve it.
   * Counted per file, so a second listener in one of them is a new entry here.
   */
  const OWNED = {
    'src/ui/common/use-focus-trap.ts': 1, // the open modal's Tab trap
    'src/ui/factsheet/AddRelationDialog.tsx': 1, // the dialog's Escape
    'src/ui/files/ImportDialog.tsx': 1, // the dialog's Escape
    'src/ui/inventory/CreateElementDialog.tsx': 1, // the dialog's Escape
    'src/ui/rollout/RolloutDialogs.tsx': 1, // the rollout dialogs' Escape, while open
    'src/ui/rollout-workbook/RolloutWorkbookDialog.tsx': 1, // the dialog's Escape
    'src/ui/shell/WorkspaceSwitcher.tsx': 1, // its menu's Escape, while open
    'src/ui/views/ConnectDialogs.tsx': 1, // the dialogs' Escape
  }

  // Untracked files too, so a new listener fails before it is committed. The
  // test support in `src/test/` stubs browser APIs and is not the app.
  const counts = Object.fromEntries(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
      .filter((path) => !path.startsWith('src/test/') && existsSync(path))
      .map((path) => [path, keyListeners(readFileSync(path, 'utf8'))] as const)
      .filter(([, count]) => count > 0),
  )

  it('finds the dispatcher', () => {
    expect(counts).toMatchObject(GLOBAL)
  })

  it('has each one accounted for, so a global binding goes through the dispatcher', () => {
    // A new entry here hears every key on the page. If it binds a shortcut,
    // make it a row in SHORTCUTS and register it with useGlobalShortcut; if it
    // serves only an open modal or menu of its own, count it in OWNED.
    expect(counts).toEqual({ ...GLOBAL, ...OWNED })
  })
})
