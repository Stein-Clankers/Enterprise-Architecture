import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { emptyWorkspace } from '@/model'
import { loadDemoWorkspace } from '@/io'
import { stubDownloads } from '@/test/downloads'
import { renderApp } from '@/test/render'
import { applyTheme } from '@/app/theme'

function demo() {
  return loadDemoWorkspace()
}

/** The percentage the health footer is actually showing. */
function healthPercent(): string {
  return screen.getByText(/^\d+$/, { selector: '.health__number' }).textContent ?? ''
}

/** The bar next to it — the number can be right while the bar is not. */
function healthBar(): HTMLElement {
  const fill = document.querySelector<HTMLElement>('.health__fill')
  if (!fill) throw new Error('no .health__fill in the document')
  return fill
}

beforeEach(() => {
  applyTheme('light')
})

describe('header', () => {
  it('carries the brand, the search button and the version chip', () => {
    renderApp(demo())
    expect(screen.getByText('Archipelago')).toBeInTheDocument()
    expect(screen.getByText('0.2')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Search elements, relations, actions/ }),
    ).toBeVisible()
    expect(screen.getByText('⌘K')).toBeVisible()
  })

  it('shows the save state and its trust tooltip', () => {
    renderApp(demo())
    expect(screen.getByText('LOCAL · SAVED')).toBeInTheDocument()
    expect(screen.getByTitle(/Model lives in this browser/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SAVE FILE' })).toBeEnabled()
  })

  it('counts unsaved changes, and a download it cannot see does not clear them', async () => {
    // jsdom has no Blob URL plumbing; the download itself is not what is under test.
    const { createObjectURL, click } = stubDownloads()

    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Explore the demo/ }))
    await user.click(screen.getByRole('button', { name: /Insurance landscape/ }))
    expect(screen.getByText('LOCAL · 1 UNSAVED')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'SAVE FILE' }))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled())
    expect(click).toHaveBeenCalled()

    // jsdom has no File System Access API, so `save()` takes the download path.
    // The file was offered, not observed. An anchor click cannot report whether
    // anything reached disk — a user with "always ask where to save" on who
    // presses Cancel has no file — and `markSaved()` has no inverse, so a wrong
    // SAVED here is permanent. Only the `saved` outcome, which resolves after
    // `writable.close()`, has earned the right to clear the counter.
    expect(screen.getByText('LOCAL · 1 UNSAVED')).toBeInTheDocument()
    expect(screen.queryByText('LOCAL · SAVED')).not.toBeInTheDocument()
  })

  it('offers Import and Export', () => {
    renderApp(demo())
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  it('toggles the theme on <html>', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    expect(document.documentElement.dataset.theme).toBe('light')
    await user.click(screen.getByRole('button', { name: /Switch to dark theme/ }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    await user.click(screen.getByRole('button', { name: /Switch to light theme/ }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('left nav', () => {
  it('shows the live element count on Inventory', () => {
    renderApp(demo())
    const inventory = screen.getByRole('link', { name: /Inventory/ })
    expect(within(inventory).getByText('29')).toBeInTheDocument()
  })

  it('draws the five phase-2 reports as inert items with an explanation', () => {
    renderApp(demo())
    for (const label of ['Capability map', 'Landscape', 'Roadmap', 'Matrix', 'Portfolio']) {
      const item = screen.getByRole('button', { name: new RegExp(label) })
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).toHaveAttribute('title', 'Planned for phase 2')
    }
    expect(screen.getAllByText('P2')).toHaveLength(5)
  })

  it('marks the current route as active', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    expect(screen.getByRole('link', { name: /Inventory/ }).className).toContain('nav__item--active')

    await user.click(screen.getByRole('link', { name: /Dependency graph/ }))
    expect(screen.getByRole('heading', { name: 'Dependency graph' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Dependency graph/ }).className).toContain(
      'nav__item--active',
    )
  })
})

describe('model health footer', () => {
  it('reports completeness, counts and the owner gap', () => {
    renderApp(demo())
    expect(screen.getByText('29 elements · 47 relations')).toBeInTheDocument()
    // ArchiSurance Netherlands is the one element the demo leaves without an owner.
    expect(screen.getByText('1 element missing an owner')).toBeInTheDocument()
    // The demo's own score under the rule in `src/model/README.md`, asserted as a
    // value rather than a range: `>0` with `<=100` brackets every percentage there
    // is, so it holds for a hardcoded one too — `health: 1` in LeftNav passed it.
    expect(healthPercent()).toBe('93')
    expect(healthBar()).toHaveStyle({ width: '93%' })
  })

  it('updates live when the model changes', async () => {
    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    const user = userEvent.setup()
    // An empty browser lands on the first-run screen, not on the chrome, so the
    // empty "before" state is no longer observable through the nav — #29 replaced
    // the inventory's interim demo button with FirstRun. The assertions below
    // still fail against a hardcoded health, which is what they are for.
    await user.click(screen.getByRole('button', { name: /Explore the demo/ }))
    await user.click(screen.getByRole('button', { name: /Insurance landscape/ }))
    expect(screen.getByText('29 elements · 47 relations')).toBeInTheDocument()
    // Health has to move with the model, not just the counts beside it: both are
    // rendered by LeftNav, and asserting only the counts left completeness free.
    expect(healthPercent()).toBe('93')
    expect(healthBar()).toHaveStyle({ width: '93%' })
    expect(screen.getByText('LOCAL · 1 UNSAVED')).toBeInTheDocument()
  })
})

describe('workspace switcher', () => {
  it('shows the workspace name and opens a menu', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'ArchiSurance' })
    expect(button).toBeInTheDocument()

    await user.click(button)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'New workspace…' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Rename…' })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'ArchiSurance' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
