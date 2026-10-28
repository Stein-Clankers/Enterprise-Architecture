import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyWorkspace } from '@/model'
import { loadDemoWorkspace } from '@/io'
import { ModelStore } from '@/store'
import { pressOutside } from '@/test/dialogs'
import { renderApp, renderScreenAs } from '@/test/render'
import { smallWorkspace, syntheticWorkspace } from '@/test/fixtures'
import { InventoryScreen } from './InventoryScreen'
import { VIRTUALISE_ABOVE } from './InventoryTable'

/** The fake viewport the virtualisation tests give the scroll container. */
const VIEWPORT = 600
/** Matches `estimateSize` in InventoryTable, which tracks `--rowh`. */
const ROW_HEIGHT = 38

function demo() {
  return loadDemoWorkspace()
}

function rows() {
  // Every table row is a button whose accessible name starts with its type code.
  return screen.getAllByRole('button').filter((node) => node.className.startsWith('table__row'))
}

function cards() {
  return screen.getAllByRole('button').filter((node) => node.className.startsWith('card'))
}

describe('inventory list', () => {
  it('lists every element with the handoff columns', () => {
    renderApp(demo())
    expect(screen.getByText('29 of 29 elements')).toBeInTheDocument()
    expect(rows()).toHaveLength(29)

    const header = screen.getByRole('row')
    for (const column of [
      'Element',
      'Type',
      'Lifecycle',
      'Fit F / T',
      'Crit.',
      'Time',
      'Complete',
    ]) {
      expect(within(header).getByText(column)).toBeInTheDocument()
    }
  })

  it('shows derived lifecycle, assessments and completeness per row', () => {
    renderApp(demo())
    const row = rows().find((node) => node.textContent?.includes('CRM System'))!
    expect(within(row).getByText('AC')).toBeInTheDocument()
    expect(within(row).getByText('Application Component')).toBeInTheDocument()
    expect(within(row).getByText('Active')).toBeInTheDocument()
    expect(within(row).getByText('High')).toBeInTheDocument()
    expect(within(row).getByText('Migrate')).toBeInTheDocument()
  })

  it('renders an element that carries no portfolio profile', () => {
    renderApp(demo())
    const row = rows().find((node) => node.textContent?.includes('Claim Handling'))!
    expect(within(row).getByText('Capability')).toBeInTheDocument()
    // Undated elements are Active, unassessed criticality shows an em dash.
    expect(within(row).getByText('Active')).toBeInTheDocument()
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('opens the fact sheet when a row is clicked', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(rows().find((node) => node.textContent?.includes('Payment Gateway'))!)
    expect(screen.getByRole('heading', { name: 'Payment Gateway' })).toBeInTheDocument()
  })

  it('switches to cards and back', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'CARDS' }))
    expect(cards()).toHaveLength(29)
    expect(screen.queryByRole('row')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'TABLE' }))
    expect(rows()).toHaveLength(29)
  })
})

describe('filtering', () => {
  it('filters by facet and updates the result line', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Application 11$/ }))
    expect(screen.getByText('11 of 29 elements · 1 filter (AND)')).toBeInTheDocument()
    expect(rows()).toHaveLength(11)
  })

  it('ORs within a group and ANDs across groups', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Application 11$/ }))
    await user.click(screen.getByRole('button', { name: /^Technology 4$/ }))
    expect(rows()).toHaveLength(15) // within the layer group, options OR

    await user.click(screen.getByRole('button', { name: /^Invest 4$/ }))
    // Now: (application OR technology) AND Invest.
    const names = rows().map((row) => row.textContent ?? '')
    expect(names).toHaveLength(4)
    expect(names.every((name) => name.includes('Invest'))).toBe(true)
  })

  it('switches to OR and NOT', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    // Technology (4) and Invest (4 applications) are disjoint sets, so the three
    // modes give three visibly different answers over the same two facets.
    await user.click(screen.getByRole('button', { name: /^Technology 4$/ }))
    await user.click(screen.getByRole('button', { name: /^Invest 4$/ }))
    expect(rows()).toHaveLength(0) // AND: nothing is both

    await user.click(screen.getByRole('button', { name: 'OR' }))
    expect(screen.getByText(/2 filters \(OR\)/)).toBeInTheDocument()
    expect(rows()).toHaveLength(8)

    await user.click(screen.getByRole('button', { name: 'NOT' }))
    expect(rows()).toHaveLength(29 - 8)
    const remaining = rows().map((row) => row.textContent ?? '')
    expect(remaining.every((name) => !name.includes('Invest'))).toBe(true)
  })

  it('ANDs the name query on top of facets', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Application 11$/ }))
    await user.type(screen.getByLabelText('Filter by name'), 'policy')
    // "Policy Administration" is a Capability, so the layer facet excludes it and
    // only the application named for a policy system survives.
    const names = rows().map((row) => row.textContent ?? '')
    expect(names).toHaveLength(1)
    expect(names[0]).toContain('Home & Away Policy Administration')
  })

  it('keeps facet counts global rather than co-filtered', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    const technology = screen.getByRole('button', { name: /^Technology 4$/ })
    await user.click(screen.getByRole('button', { name: /^Application 11$/ }))
    // Selecting Application does not shrink the Technology count to zero.
    expect(technology).toHaveTextContent('4')
  })

  it('applies a saved search including its combinator', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'OR' }))
    await user.click(screen.getByRole('button', { name: /End-of-life applications/ }))

    expect(screen.getByRole('button', { name: 'AND' })).toHaveAttribute('aria-pressed', 'true')
    const names = rows().map((row) => row.textContent ?? '')
    expect(names).toHaveLength(2)
    expect(names.some((name) => name.includes('Legal Aid Backoffice'))).toBe(true)
  })

  it('shows a chip per facet and removes one at a time', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Application 11$/ }))
    await user.click(screen.getByRole('button', { name: /^Invest 4$/ }))
    // The rail's own label, not the enum behind it: this chip used to read
    // "LAYER app" and announce as "Remove filter Layer app".
    expect(screen.getByRole('button', { name: 'Remove filter Layer Application' })).toBeVisible()
    expect(screen.getByText('Application', { selector: '.chip__value' })).toBeInTheDocument()
    expect(screen.queryByText('app', { selector: '.chip__value' })).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Remove filter Time classification Invest' }),
    )
    expect(screen.getByText(/1 filter \(AND\)/)).toBeInTheDocument()
    expect(rows()).toHaveLength(11)
  })

  it('clears facets and the query together', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Application 11$/ }))
    await user.type(screen.getByLabelText('Filter by name'), 'crm')
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.getByText('29 of 29 elements')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by name')).toHaveValue('')
  })

  it('says what to do when nothing matches', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Filter by name'), 'zzzz')
    expect(screen.getByText(/No elements match this filter/)).toBeInTheDocument()
    expect(screen.getByText(/switch the combinator to OR/)).toBeInTheDocument()
  })
})

describe('filter state in the URL', () => {
  it('restores facets, combinator, query and view from a link', () => {
    renderApp(demo(), {
      route: '/inventory?q=policy&facets=layer:app&mode=OR&view=cards',
    })
    expect(screen.getByLabelText('Filter by name')).toHaveValue('policy')
    expect(screen.getByRole('button', { name: 'OR' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'CARDS' })).toHaveAttribute('aria-pressed', 'true')
    expect(cards()).toHaveLength(1)
  })

  it('ignores a nonsense mode rather than breaking the screen', () => {
    renderApp(demo(), { route: '/inventory?mode=XOR' })
    expect(screen.getByRole('button', { name: 'AND' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('round-trips a facet value containing the separator', async () => {
    // A tag is whatever the architect typed, so the comma that separates facets
    // is a character the values are entitled to contain. `Risk, high` used to
    // come back as `tag:Risk` plus `high`.
    const workspace = demo()
    workspace.tagGroups = [
      {
        id: 'tg-risk',
        name: 'Risk',
        multiSelect: true,
        tags: [{ name: 'Risk, high', colourToken: '--tag-1' }],
      },
    ]
    workspace.elements[0]!.profile = { ...workspace.elements[0]?.profile, tags: ['Risk, high'] }

    renderApp(workspace)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Risk, high 1$/ }))

    expect(screen.getByText('1 of 29 elements · 1 filter (AND)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter Tags Risk, high' })).toBeVisible()
    expect(rows()).toHaveLength(1)
  })

  it('round-trips a facet value that looks like its own escaped form', async () => {
    // The decoder has to be unambiguous too: a tag literally named `a%2Cb` must
    // not come back as `a,b`.
    const workspace = demo()
    workspace.tagGroups = [
      {
        id: 'tg-odd',
        name: 'Odd',
        multiSelect: true,
        tags: [{ name: 'a%2Cb', colourToken: '--tag-2' }],
      },
    ]
    workspace.elements[0]!.profile = { ...workspace.elements[0]?.profile, tags: ['a%2Cb'] }

    renderApp(workspace)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^a%2Cb 1$/ }))

    expect(screen.getByText('1 of 29 elements · 1 filter (AND)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter Tags a%2Cb' })).toBeVisible()
  })

  it('drops a facet it cannot parse rather than counting one it cannot show', () => {
    renderApp(demo(), { route: '/inventory?facets=bogus&mode=OR' })

    // Three readings used to disagree: the result line counted it, the chip bar
    // rendered nothing to remove it with, and the filter skipped it — so OR mode
    // showed "0 of 29 elements · 1 filter (OR)" and an empty state pointing at a
    // facet that is not on screen.
    expect(screen.getByText('29 of 29 elements')).toBeInTheDocument()
    expect(screen.queryByText(/filter \(OR\)/)).not.toBeInTheDocument()
    expect(rows()).toHaveLength(29)
  })

  it('counts a repeated facet once', () => {
    renderApp(demo(), { route: '/inventory?facets=layer%3Aapp,layer%3Aapp' })
    expect(screen.getByText('11 of 29 elements · 1 filter (AND)')).toBeInTheDocument()
  })
})

describe('at 5,000 elements', () => {
  /**
   * jsdom gives every element a zero-height box, so the virtualiser concluded
   * there was no viewport to fill and rendered **nothing** — and
   * `toBeLessThan(150)` is satisfied by zero, so the sole evidence for the
   * 5,000-element criterion was a green test over an empty table. Giving the
   * scroll container a height is what makes the virtualised branch run at all;
   * the assertions below then bound the row count on both sides.
   */
  let offsetHeight: PropertyDescriptor | undefined

  beforeEach(() => {
    // `@tanstack/virtual-core` measures with `offsetWidth`/`offsetHeight`, which
    // jsdom pins at 0 — hence the empty table. It calls back synchronously on
    // mount, so no ResizeObserver stub is needed.
    offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('table__scroll') ? VIEWPORT : ROW_HEIGHT
      },
    })
  })

  afterEach(() => {
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
  })

  it('renders the visible rows and only those', () => {
    renderApp(syntheticWorkspace(5_000))
    expect(screen.getByText('5000 of 5000 elements')).toBeInTheDocument()

    // Bounded above by the viewport rather than the model — and below by the
    // viewport too, which is the half that was missing: a virtualised branch
    // that regressed to rendering nothing would leave an empty table under a
    // header reading "5000 of 5000 elements" and the suite would stay green.
    const rendered = rows().length
    expect(rendered).toBeGreaterThanOrEqual(Math.floor(VIEWPORT / ROW_HEIGHT))
    expect(rendered).toBeLessThan(VIRTUALISE_ABOVE)

    // And they are real rows carrying real data, not placeholders.
    expect(within(rows()[0]!).getByText(/^Capability 0$/)).toBeInTheDocument()
  })

  it('keeps the cards view off the same cliff', async () => {
    renderApp(syntheticWorkspace(5_000), { route: '/inventory?view=cards' })
    const user = userEvent.setup()

    // The table's virtualiser never covered this view, so `?view=cards` mounted
    // 5,000 card buttons. It now windows and says so.
    expect(cards().length).toBeLessThanOrEqual(VIRTUALISE_ABOVE)
    expect(screen.getByText(/Showing 150 of 5000 matches/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Switch to the table' }))
    expect(screen.getByRole('button', { name: 'TABLE' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders small workspaces without the virtualiser', () => {
    renderApp(demo())
    expect(rows()).toHaveLength(29)
  })
})

describe('creating an element', () => {
  it('creates through the command stack and opens the fact sheet', async () => {
    renderApp(emptyWorkspace('ws-empty', 'Empty'))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Explore the demo/ }))
    await user.click(screen.getByRole('button', { name: /Insurance landscape/ }))
    await user.click(screen.getByRole('button', { name: '+ Element' }))

    await user.type(screen.getByLabelText(/Name/), 'Fraud Detection Service')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByRole('heading', { name: 'Fraud Detection Service' })).toBeInTheDocument()
    // One change for loading the demo, one for the new element.
    expect(screen.getByText('LOCAL · 2 UNSAVED')).toBeInTheDocument()
  })

  it('does not let a bare g throw away what was typed into the dialog', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '+ Element' }))
    await user.type(screen.getByLabelText(/Name/), 'Fraud Detection')

    // Tab moves focus to a button, which is not a typing target — so the guard
    // that watches for text fields stopped applying and the next `g` navigated
    // to the graph, unmounting the dialog and discarding the name.
    await user.tab()
    await user.keyboard('g')

    expect(screen.getByRole('dialog', { name: 'New element' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Name/)).toHaveValue('Fraud Detection')
    expect(screen.queryByRole('heading', { name: 'Dependency graph' })).not.toBeInTheDocument()
  })

  it('closes on a press outside, and gives focus back to + Element (#157)', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    const opener = screen.getByRole('button', { name: '+ Element' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'New element' })
    // `aria-modal` promises focus enters and stays; it starts on the name.
    expect(screen.getByLabelText(/Name/)).toHaveFocus()
    await pressOutside(user, dialog)
    expect(screen.queryByRole('dialog', { name: 'New element' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('keeps focus inside the create dialog, and gives it back on Escape (#157)', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    const opener = screen.getByRole('button', { name: '+ Element' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'New element' })
    for (let i = 0; i < 8; i += 1) await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'New element' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('will not create an unnamed element', async () => {
    renderApp(demo())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '+ Element' }))
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'New element' })).not.toBeInTheDocument()
  })
})

describe('a new element, when the tab becomes a reader (#198)', () => {
  function inventory() {
    const store = new ModelStore(smallWorkspace())
    const h = renderScreenAs('writer', store, {
      route: '/inventory',
      path: '/inventory',
      screen: <InventoryScreen />,
    })
    return { ...h, store, user: userEvent.setup() }
  }
  const dialog = () => screen.queryByRole('dialog', { name: 'New element' })

  it('closes, so a reader is not left with a Create the store refuses', async () => {
    const h = inventory()
    await h.user.click(screen.getByRole('button', { name: '+ Element' }))
    expect(dialog()).toBeInTheDocument()
    h.as('reader')
    // Present first: the inventory is still there, as a reader's.
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument()
    expect(dialog()).toBeNull()
    expect(screen.getByRole('button', { name: '+ Element' })).toBeDisabled()
  })

  it('does not reopen when the tab can write again', async () => {
    const h = inventory()
    await h.user.click(screen.getByRole('button', { name: '+ Element' }))
    h.as('reader')
    h.as('writer')
    expect(screen.getByRole('button', { name: '+ Element' })).toBeEnabled()
    expect(dialog()).toBeNull()
  })
})
