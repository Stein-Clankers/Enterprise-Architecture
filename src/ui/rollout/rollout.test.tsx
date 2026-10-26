import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rolloutPlanOf, validate, wavePlanOf, type Workspace } from '@/model'
import { toCanonicalJson } from '@/io'
import { ModelStore, addSites, assignSites, createRollout, createWave, deleteWave } from '@/store'
import { renderApp, renderScreenAs } from '@/test/render'
import { TakesFocusAsReader } from '@/test/takes-focus-as-reader'
import { stubDownloads } from '@/test/downloads'
import { ROLLOUT_ID, rolloutWorkspace, siteId, waveId } from '@/test/rollout-fixture'
import { LIST_WINDOW } from '@/ui/inventory/list-window'
import { ElementScreen } from '@/ui/factsheet/ElementScreen'
import { RolloutScreen } from './RolloutScreen'
import { CARD_PITCH } from './WaveBoard'

/**
 * The rollout screens (#211). The fixture's 20-site rollout has five waves
 * (Pilot, W1–W4); site 017 is in none. Each acceptance criterion's test
 * names the feature it fails without.
 */

const SITES = 20

function workspace(sites = SITES): Workspace {
  return rolloutWorkspace(sites)
}

function storeOf(sites = SITES): ModelStore {
  return new ModelStore(workspace(sites))
}

const json = (store: ModelStore) => toCanonicalJson(store.snapshot())
const sitePlan = (store: ModelStore, location: string) =>
  rolloutPlanOf(store.element(ROLLOUT_ID))!.sites.find((site) => site.location === location)!

function column(id: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-column="${id}"]`)
  if (!node) throw new Error(`No board column ${id}`)
  return node
}

function card(location: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-location="${location}"]`)
  if (!node) throw new Error(`No card ${location}`)
  return node
}

/** The board as a writer or a reader, with the role in the test's hands. */
function board(role: 'writer' | 'reader' = 'writer', store = storeOf(), extra?: JSX.Element) {
  const h = renderScreenAs(role, store, {
    route: `/rollout/${ROLLOUT_ID}?tab=board`,
    path: '/rollout/:id',
    screen: (
      <>
        <RolloutScreen />
        {extra}
      </>
    ),
  })
  return { ...h, store, user: userEvent.setup() }
}

describe('the rollout home (#211)', () => {
  it('shows the KPIs: sites, unassigned, sites per wave and per region', () => {
    renderApp(workspace(), { route: `/rollout/${ROLLOUT_ID}` })
    expect(screen.getByRole('heading', { name: 'Local data to the central lake' })).toBeVisible()
    const kpis = screen.getByRole('region', { name: 'Rollout KPIs' })
    expect(within(kpis).getByTestId('kpi-unassigned')).toHaveTextContent('1')
    const perWave = within(kpis).getByRole('list', { name: 'Sites per wave' })
    // Pilot holds sites 1 and 2 of a capacity of 5; the rest share W1–W4.
    expect(within(perWave).getByText('Pilot').nextSibling).toHaveTextContent('2 / 5')
    const perRegion = within(kpis).getByRole('list', { name: 'Sites per region' })
    expect(within(perRegion).getByText('EMEA').nextSibling).toHaveTextContent(String(SITES))
  })

  it('is reached from the nav and from the command palette', async () => {
    renderApp(workspace(), { route: '/inventory' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: /Rollouts/ }))
    await user.click(screen.getByRole('button', { name: /Local data to the central lake/ }))
    expect(screen.getByRole('heading', { name: 'Local data to the central lake' })).toBeVisible()

    await user.click(screen.getByRole('link', { name: /Inventory/ }))
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeVisible()
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('Go to rollout: Local')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('heading', { name: 'Local data to the central lake' })).toBeVisible()
  })

  it('makes a rollout from the list and opens it', async () => {
    renderApp(workspace(), { route: '/rollouts' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '+ Rollout' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Network refresh')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('heading', { name: 'Network refresh' })).toBeVisible()
    expect(screen.getByText('No sites in this rollout yet.')).toBeInTheDocument()
  })
})

describe('navigating from one rollout to another (#211)', () => {
  /** A second rollout, B, with two sites of its own in one wave. */
  function twoRollouts(): Workspace {
    const store = storeOf()
    const b = createRollout(store, { name: 'Network refresh' })!
    const wave = createWave(store, b.id, { name: 'Network W1', label: 'NW1' })!
    addSites(store, b.id, [siteId(3), siteId(4)])
    assignSites(store, b.id, [siteId(3)], wave.id)
    return store.snapshot()
  }

  it('shows b’s sites and keeps no filter, selection or tab state from a', async () => {
    renderApp(twoRollouts(), { route: `/rollout/${ROLLOUT_ID}` })
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Filter sites by code or name' }), '01')
    await user.click(screen.getByRole('checkbox', { name: 'Select 010' }))
    expect(screen.getByRole('group', { name: 'Selected sites' })).toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('Go to rollout: Network')
    await user.keyboard('{Enter}')

    expect(screen.getByRole('heading', { name: 'Network refresh' })).toBeVisible()
    expect(screen.getByText('2 of 2 sites')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Filter sites by code or name' })).toHaveValue('')
    expect(screen.queryByRole('group', { name: 'Selected sites' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Select 003' })).not.toBeChecked()
  })
})

describe('the site register (#211)', () => {
  it('lists the rollout’s sites with wave, archetype, cutover and RAG', () => {
    renderApp(workspace(), { route: `/rollout/${ROLLOUT_ID}` })
    expect(screen.getByText(`${SITES} of ${SITES} sites`)).toBeInTheDocument()
    // Site 004 overrides its freeze, which starts the cutover phase, at week precision.
    const row = card(siteId(4))
    expect(within(row).getByText('2027-W19')).toBeInTheDocument()
    expect(within(row).getByText('Plant')).toBeInTheDocument()
    expect(within(card(siteId(7))).getByText('RED')).toBeInTheDocument()
  })

  it('assigns every selected site to a wave as one command, and one undo puts them back', async () => {
    const store = storeOf()
    renderScreenAs('writer', store, {
      route: `/rollout/${ROLLOUT_ID}`,
      path: '/rollout/:id',
      screen: <RolloutScreen />,
    })
    const user = userEvent.setup()
    const before = { json: json(store), history: store.history.length }
    const picked = [siteId(3), siteId(5), siteId(17)]
    for (const location of picked) {
      await user.click(within(card(location)).getByRole('checkbox'))
    }
    await user.selectOptions(screen.getByRole('combobox', { name: 'Assign to wave' }), 'W4')
    await user.click(screen.getByRole('button', { name: 'Assign' }))

    expect(store.history.length).toBe(before.history + 1)
    for (const location of picked) expect(sitePlan(store, location).wave).toBe(waveId(4))
    act(() => void store.undo())
    expect(json(store)).toBe(before.json)
  })

  it('has no selection as a reader, and loses its selection when the tab becomes one', async () => {
    const h = board('writer')
    await h.user.click(screen.getByRole('button', { name: 'Site register' }))
    await h.user.click(within(card(siteId(3))).getByRole('checkbox'))
    expect(screen.getByRole('group', { name: 'Selected sites' })).toBeInTheDocument()
    h.as('reader')
    expect(screen.getByText(`${SITES} of ${SITES} sites`)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Selected sites' })).toBeNull()
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    h.as('writer')
    expect(within(card(siteId(3))).getByRole('checkbox')).not.toBeChecked()
    expect(screen.queryByRole('group', { name: 'Selected sites' })).toBeNull()
  })
})

describe('the wave board, by keyboard (#211)', () => {
  it('picks a card up, moves it two columns right, and drops it: one command, focus on the moved card', async () => {
    const h = board()
    const before = h.store.history.length
    expect(within(column('unassigned')).getByText('017')).toBeInTheDocument()

    card(siteId(17)).focus()
    await h.user.keyboard(' ')
    expect(card(siteId(17))).toHaveAttribute('aria-pressed', 'true')
    await h.user.keyboard('{ArrowRight}{ArrowRight}')
    expect(column(waveId(1))).toHaveClass('board__column--target')
    await h.user.keyboard('{Enter}')

    expect(h.store.history.length).toBe(before + 1)
    expect(sitePlan(h.store, siteId(17)).wave).toBe(waveId(1))
    // Where focus lands is the criterion: on the card, in its new column.
    expect(document.activeElement).toBe(card(siteId(17)))
    expect(column(waveId(1)).contains(document.activeElement)).toBe(true)
    expect(within(column('unassigned')).queryByText('017')).toBeNull()
  })

  it('puts the card back on Escape, and on a drop where it started', async () => {
    const h = board()
    const before = json(h.store)
    card(siteId(17)).focus()
    await h.user.keyboard(' {ArrowRight}{Escape}')
    expect(card(siteId(17))).toHaveAttribute('aria-pressed', 'false')
    await h.user.keyboard(' {ArrowRight}{ArrowLeft}{Enter}')
    expect(json(h.store)).toBe(before)
    expect(document.activeElement).toBe(card(siteId(17)))
  })

  it('moves focus along a column with the up and down arrows', async () => {
    board()
    const first = within(column(waveId(0))).getAllByRole('button', { name: /Site/ })
    first[0]!.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(first[1])
  })
})

describe('the wave board, by drag and drop (#211)', () => {
  const transfer = () => ({ setData: () => {}, effectAllowed: '', dropEffect: '' })

  it('assigns the dropped site as one command, and focuses the moved card', () => {
    const h = board()
    const before = h.store.history.length
    fireEvent.dragStart(card(siteId(17)), { dataTransfer: transfer() })
    fireEvent.dragOver(column(waveId(2)), { dataTransfer: transfer() })
    expect(column(waveId(2))).toHaveClass('board__column--target')
    fireEvent.drop(column(waveId(2)), { dataTransfer: transfer() })
    expect(h.store.history.length).toBe(before + 1)
    expect(sitePlan(h.store, siteId(17)).wave).toBe(waveId(2))
    expect(document.activeElement).toBe(card(siteId(17)))
  })

  it('unassigns a site dropped on Unassigned', () => {
    const h = board()
    fireEvent.dragStart(card(siteId(1)), { dataTransfer: transfer() })
    fireEvent.dragOver(column('unassigned'), { dataTransfer: transfer() })
    fireEvent.drop(column('unassigned'), { dataTransfer: transfer() })
    expect(sitePlan(h.store, siteId(1)).wave).toBeUndefined()
  })

  it('flags a column over capacity', () => {
    const store = storeOf()
    // The pilot holds two sites; a capacity of one puts it over.
    store.updateElement(waveId(0), (wave) => ({
      ...wave,
      plan: { ...wavePlanOf(wave)!, capacity: 1 },
    }))
    board('writer', store)
    expect(column(waveId(0))).toHaveAccessibleName('Pilot: 2 sites of 1, over capacity')
    expect(within(column(waveId(0))).getByText('OVER +1')).toBeInTheDocument()
    expect(within(column(waveId(1))).queryByText(/OVER/)).toBeNull()
  })
})

describe('the wave board as a reader (#211)', () => {
  const transfer = () => ({ setData: () => {}, effectAllowed: '', dropEffect: '' })

  it('renders every card without drag handles, and nothing picks up', async () => {
    const h = board('reader')
    expect(within(column(waveId(0))).getByText('001')).toBeInTheDocument()
    expect(screen.queryAllByTestId('drag-handle')).toEqual([])
    expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    const before = json(h.store)
    card(siteId(17)).focus()
    await h.user.keyboard(' {ArrowRight}{Enter}')
    expect(json(h.store)).toBe(before)
  })

  it('ends a keyboard pick-up when the tab becomes a reader mid-move', async () => {
    const h = board('writer')
    const before = json(h.store)
    card(siteId(17)).focus()
    await h.user.keyboard(' {ArrowRight}')
    expect(card(siteId(17))).toHaveAttribute('aria-pressed', 'true')
    h.as('reader')
    expect(within(column('unassigned')).getByText('017')).toBeInTheDocument()
    expect(document.querySelector('[aria-pressed="true"]')).toBeNull()
    expect(document.querySelector('.board__column--target')).toBeNull()
    card(siteId(17)).focus()
    await h.user.keyboard('{Enter}')
    expect(json(h.store)).toBe(before)
    // And the pick-up does not come back when the tab can write again.
    h.as('writer')
    expect(card(siteId(17))).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelector('.board__column--target')).toBeNull()
  })

  it('ends a drag when the tab becomes a reader mid-drag: the drop finds nothing in hand', () => {
    const h = board('writer')
    const before = json(h.store)
    fireEvent.dragStart(card(siteId(17)), { dataTransfer: transfer() })
    fireEvent.dragOver(column(waveId(2)), { dataTransfer: transfer() })
    h.as('reader')
    expect(within(column(waveId(2))).getByText('Wave 2')).toBeInTheDocument()
    expect(document.querySelector('.board__column--target')).toBeNull()
    fireEvent.drop(column(waveId(2)), { dataTransfer: transfer() })
    expect(json(h.store)).toBe(before)
    // And the drag does not come back when the tab can write again.
    h.as('writer')
    fireEvent.drop(column(waveId(2)), { dataTransfer: transfer() })
    expect(json(h.store)).toBe(before)
  })
})

describe('the wave controls (#211)', () => {
  it('creates a wave, snapping a week date to its Monday and saying so before saving (#222)', async () => {
    const h = board()
    await h.user.click(screen.getByRole('button', { name: '+ Wave' }))
    const dialog = screen.getByRole('dialog', { name: 'New wave' })
    await h.user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Wave 5')
    await h.user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'W5')
    await h.user.type(within(dialog).getByRole('textbox', { name: 'Capacity' }), '12')
    await h.user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Window start precision' }),
      'week',
    )
    fireEvent.change(within(dialog).getByLabelText('Window start day'), {
      target: { value: '2027-05-12' },
    })
    expect(dialog).toHaveTextContent(
      '2027-W19 · from Mon 2027-05-10 · snapped to the start of the week',
    )
    await h.user.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    const wave = [...h.store.elements()].find((element) => element.name === 'Wave 5')
    expect(wavePlanOf(wave)).toMatchObject({
      label: 'W5',
      capacity: 12,
      window: { start: { date: '2027-05-10', precision: 'week' } },
    })
  })

  it('refuses visibly an end before the start, and a capacity of nought', async () => {
    const h = board()
    await h.user.click(screen.getByRole('button', { name: 'Edit W1' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit wave' })
    fireEvent.change(within(dialog).getByLabelText('Window end day'), {
      target: { value: '2026-01-01' },
    })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The end is before the start.')
    await h.user.clear(within(dialog).getByRole('textbox', { name: 'Capacity' }))
    await h.user.type(within(dialog).getByRole('textbox', { name: 'Capacity' }), '0')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Capacity is a whole number')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('renames a wave and sets its capacity in one command', async () => {
    const h = board()
    const before = h.store.history.length
    await h.user.click(screen.getByRole('button', { name: 'Edit W1' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit wave' })
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    await h.user.clear(name)
    await h.user.type(name, 'First wave')
    await h.user.type(within(dialog).getByRole('textbox', { name: 'Capacity' }), '9')
    await h.user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(h.store.history.length).toBe(before + 1)
    expect(h.store.element(waveId(1))?.name).toBe('First wave')
    expect(wavePlanOf(h.store.element(waveId(1)))?.capacity).toBe(9)
    // Focus goes back to the Edit button that opened the dialog.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit W1' }))
  })

  it('deletes a wave after asking, unassigns its sites, and puts focus on + Wave', async () => {
    const h = board()
    const inWave = rolloutPlanOf(h.store.element(ROLLOUT_ID))!.sites.filter(
      (site) => site.wave === waveId(1),
    )
    expect(inWave.length).toBeGreaterThan(0)
    await h.user.click(screen.getByRole('button', { name: 'Edit W1' }))
    await h.user.click(screen.getByRole('button', { name: 'Delete…' }))
    const confirm = screen.getByRole('dialog', { name: 'Delete wave' })
    expect(confirm).toHaveTextContent(`Its ${inWave.length} sites stay in the rollout, unassigned`)
    expect(document.activeElement).toBe(
      within(confirm).getByRole('button', { name: 'Delete wave' }),
    )
    await h.user.click(within(confirm).getByRole('button', { name: 'Delete wave' }))

    expect(h.store.element(waveId(1))).toBeUndefined()
    for (const site of inWave) expect(sitePlan(h.store, site.location).wave).toBeUndefined()
    expect(validate(h.store.snapshot()).findings).toEqual([])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Wave' }))
  })

  it('cancelling the delete puts focus back on Delete…', async () => {
    const h = board()
    await h.user.click(screen.getByRole('button', { name: 'Edit W1' }))
    await h.user.click(screen.getByRole('button', { name: 'Delete…' }))
    await h.user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete…' }))
  })

  it('closes when the tab becomes a reader, and writes nothing typed into it', async () => {
    const h = board('writer', storeOf(), <TakesFocusAsReader />)
    const before = json(h.store)
    await h.user.click(screen.getByRole('button', { name: 'Edit W1' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await h.user.type(name, ' renamed')
    h.as('reader')
    expect(within(column(waveId(1))).getByText('W1')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(json(h.store)).toBe(before)
    h.as('writer')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the Add sites dialog when the tab becomes a reader', async () => {
    const h = board()
    await h.user.click(screen.getByRole('button', { name: '+ Sites' }))
    expect(screen.getByRole('dialog', { name: 'Add sites' })).toBeInTheDocument()
    h.as('reader')
    expect(screen.getByRole('heading', { name: 'Local data to the central lake' })).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('adds Locations to the rollout as one command', async () => {
    const h = board()
    const before = h.store.history.length
    await h.user.click(screen.getByRole('button', { name: '+ Sites' }))
    const dialog = screen.getByRole('dialog', { name: 'Add sites' })
    await h.user.click(within(dialog).getByRole('checkbox', { name: /EMEA/ }))
    await h.user.click(within(dialog).getByRole('button', { name: 'Add 1' }))
    expect(h.store.history.length).toBe(before + 1)
    expect(sitePlan(h.store, 'loc-emea')).toEqual({ location: 'loc-emea' })
  })
})

describe('what the rollout screens say when there is nothing to show (#211)', () => {
  it('says so for an id that is no rollout', () => {
    renderApp(workspace(), { route: `/rollout/${waveId(1)}` })
    expect(screen.getByText(waveId(1))).toBeInTheDocument()
    expect(screen.getByText(/No rollout with the id/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All rollouts' })).toBeInTheDocument()
  })

  it('says the model refused a wave deleted while its dialog was open, and keeps the dialog', async () => {
    const h = board()
    await h.user.click(screen.getByRole('button', { name: 'Edit W1' }))
    act(() => void deleteWave(h.store, waveId(1)))
    await h.user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('dialog', { name: 'Edit wave' })).toHaveTextContent(
      'Not saved: the model refused this wave.',
    )
  })

  it('draws no timeline, and exports none, for a rollout with no waves or no windows', async () => {
    const store = storeOf()
    const rollout = createRollout(store, { name: 'Network refresh' })!
    renderScreenAs('writer', store, {
      route: `/rollout/${rollout.id}?tab=timeline`,
      path: '/rollout/:id',
      screen: <RolloutScreen />,
    })
    expect(screen.getByText('This rollout has no waves yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export SVG' })).toBeDisabled()
    act(() => void createWave(store, rollout.id, { name: 'Network W1', label: 'NW1' }))
    expect(screen.getByText(/No wave has a window yet/)).toBeInTheDocument()
    expect(screen.getByText('No window yet: NW1')).toBeInTheDocument()
  })
})

describe('Delete on a wave’s fact sheet cascades the plan (#222)', () => {
  it('unassigns its sites, so validate() finds nothing dangling', async () => {
    const store = storeOf()
    renderScreenAs('writer', store, {
      route: `/element/${waveId(2)}`,
      path: '/element/:id',
      screen: <ElementScreen />,
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete…' }))
    await user.click(screen.getByRole('button', { name: 'Delete from model' }))
    expect(store.element(waveId(2))).toBeUndefined()
    expect(validate(store.snapshot()).findings).toEqual([])
  })
})

describe('the wave timeline (#211)', () => {
  it('draws a bar per wave with a window under the shared report chrome', async () => {
    const h = board()
    await h.user.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(screen.getByRole('heading', { name: 'Wave timeline' })).toBeVisible()
    expect(screen.getByText(/^5 waves · 20 sites · 1 unassigned · time point \d{4}$/)).toBeVisible()
    const bars = document.querySelectorAll('[data-wave]')
    expect(bars).toHaveLength(5)
    // The last wave is planned to the quarter with no end: drawn open.
    const last = document.querySelector(`[data-wave="${waveId(4)}"] rect`)
    expect(last).toHaveAttribute('stroke-dasharray', '4 3')
    expect(screen.getByText('2027-Q1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export SVG' })).toBeEnabled()

    const legend = document.querySelector<HTMLElement>('.chrome__legend')!
    expect(within(legend).getByText('Over capacity')).toBeInTheDocument()
    await h.user.click(screen.getByRole('button', { name: 'RAG' }))
    expect(within(legend).getByText('Worst site red')).toBeInTheDocument()
    expect(within(legend).queryByText('Over capacity')).toBeNull()
  })

  it('exports the timeline as an SVG of the bars on screen', async () => {
    const downloads = stubDownloads()
    const h = board()
    await h.user.click(screen.getByRole('button', { name: 'Timeline' }))
    await h.user.click(screen.getByRole('button', { name: 'Export SVG' }))
    const blob = downloads.createObjectURL.mock.calls[0]![0] as Blob
    const svg = await blob.text()
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/)
    expect(svg).toContain('Local data to the central lake: wave timeline')
    expect(svg.match(/<rect x=/g)).toHaveLength(5)
    expect(svg).toContain('2 / 5 sites')
  })
})

describe('at 160 sites (#211, scale)', () => {
  /**
   * jsdom gives every box a height of 0, so a virtualiser renders nothing and
   * a bound like "fewer than 150" holds over an empty board. The stub gives
   * the scroll containers a viewport, as the inventory's own scale test does,
   * and the bounds below hold on both sides.
   */
  const VIEWPORT = 600
  let offsetHeight: PropertyDescriptor | undefined
  beforeEach(() => {
    offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('board__cards') || this.classList.contains('table__scroll')
          ? VIEWPORT
          : CARD_PITCH
      },
    })
  })
  afterEach(() => {
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
  })

  it('renders the board within the list window, and fast', () => {
    const start = performance.now()
    board('writer', storeOf(160))
    const elapsed = performance.now() - start
    const cards = document.querySelectorAll('.board-card')
    // Six columns, each showing about a viewport of cards: some in every
    // column, and far fewer than the 160 sites.
    expect(cards.length).toBeGreaterThanOrEqual(6 * Math.floor(VIEWPORT / CARD_PITCH))
    expect(cards.length).toBeLessThan(LIST_WINDOW)
    for (const id of ['unassigned', waveId(0), waveId(1)]) {
      expect(column(id).querySelectorAll('.board-card').length).toBeGreaterThan(0)
    }
    // A regression guard, loose by an order of magnitude, as the store's are.
    expect(elapsed).toBeLessThan(3_000)
  })

  it('renders the register within the list window', () => {
    renderScreenAs('writer', storeOf(160), {
      route: `/rollout/${ROLLOUT_ID}`,
      path: '/rollout/:id',
      screen: <RolloutScreen />,
    })
    expect(screen.getByText('160 of 160 sites')).toBeInTheDocument()
    const rows = document.querySelectorAll('.register__row')
    expect(rows.length).toBeGreaterThanOrEqual(Math.floor(VIEWPORT / CARD_PITCH))
    expect(rows.length).toBeLessThan(LIST_WINDOW)
  })
})
