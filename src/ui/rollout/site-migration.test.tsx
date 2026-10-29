import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { rolloutPlanOf, type Element, type SitePlan, type Workspace } from '@/model'
import { ModelStore, ModelStoreProvider } from '@/store'
import { App } from '@/app/App'
import { renderScreenAs } from '@/test/render'
import { ROLLOUT_ID, rolloutWorkspace, siteId } from '@/test/rollout-fixture'
import { ElementScreen } from '@/ui/factsheet/ElementScreen'

/**
 * The site fact sheet's Migration tab (#215, proposal §6 item 7).
 *
 * The clock is fixed in mid-2029, when every site of the fixture is long Done
 * by its plan, so a phase of Hypercare or Preparing can only come from `?at=`.
 */

const TODAY = new Date('2029-06-01T12:00:00Z')
const AT = '2027-03-15'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
})

afterEach(() => {
  vi.useRealTimers()
})

const ROLLOUT = 'Local data to the central lake'

function workspace(): Workspace {
  return rolloutWorkspace(8)
}

function sheet(
  role: 'writer' | 'reader',
  id: string,
  query = `?tab=migration&at=${AT}`,
  model = workspace(),
) {
  const store = new ModelStore(model)
  const h = renderScreenAs(role, store, {
    route: `/element/${id}${query}`,
    path: '/element/:id',
    screen: <ElementScreen />,
  })
  return { ...h, store, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) }
}

const block = (name = ROLLOUT) => screen.getByRole('region', { name: `Migration in ${name}` })
const fact = (key: string, name = ROLLOUT) =>
  block(name).querySelector(`[data-fact="${key}"]`) as HTMLElement
const milestone = (id: string) => block().querySelector(`tr[data-milestone="${id}"]`) as HTMLElement
const site = (s: ModelStore, n: number) =>
  rolloutPlanOf(s.element(ROLLOUT_ID))!.sites.find((plan) => plan.location === siteId(n))!

describe('a site’s Migration tab (#215)', () => {
  it('shows the wave, archetype, phase at ?at=, RAG and decision of each rollout the site is in', () => {
    sheet('writer', siteId(1))
    expect(screen.getByRole('button', { name: 'Migration' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(fact('wave')).toHaveTextContent('Pilot')
    expect(fact('archetype')).toHaveTextContent('Office')
    // At 2027-03-15 site 1 has cut over (2027-03-02) and signed off its
    // reconciliation by plan (2027-03-01): Hypercare, where today says Done.
    expect(fact('phase')).toHaveAttribute('data-phase', 'hypercare')
    expect(block()).toHaveTextContent(`Phase at ${AT}`)
    expect(fact('rag')).toHaveTextContent('Not rated')
    expect(fact('go-no-go')).toHaveTextContent('GO')
  })

  it('lists every milestone: planned, set or inherited, beside its actual day', () => {
    sheet('writer', siteId(1))
    const rows = block().querySelectorAll('tbody tr')
    expect(rows).toHaveLength(6)
    // Inherited from the pilot wave, and reached on its own day.
    expect(milestone('freezeStart')).toHaveTextContent('Freeze starts2027-02-22inherited2027-03-02')
    expect(milestone('freezeStart').querySelector('[data-source]')).toHaveAttribute(
      'data-source',
      'wave',
    )
    expect(milestone('constructor')).toHaveTextContent('2027-02-15')
    expect(milestone('reconciliationSignedOff').querySelector('[data-actual]')).toHaveTextContent(
      '—',
    )
    // Site 4 sets its own freeze, at week precision.
    sheet('writer', siteId(4))
    const own = screen
      .getAllByRole('region', { name: `Migration in ${ROLLOUT}` })
      .at(-1)!
      .querySelector('tr[data-milestone="freezeStart"]')!
    expect(own).toHaveTextContent('2027-W19set')
  })

  it('stays at today without ?at=, and says so', () => {
    sheet('writer', siteId(1), '?tab=migration')
    expect(block()).toHaveTextContent('Phase today')
    expect(fact('phase')).toHaveAttribute('data-phase', 'done')
  })

  it('shows one block for each rollout the site is in', () => {
    const model = workspace()
    const second: Element = {
      id: 'wp-network',
      type: 'WorkPackage',
      name: 'Network refresh',
      properties: {},
      plan: {
        kind: 'rollout',
        templateVersion: 1,
        milestones: [{ id: 'cutover', label: 'Cutover', startsPhase: 'migrated' }],
        template: [],
        archetypes: [],
        sites: [{ location: siteId(1), rag: 'red' } satisfies SitePlan],
      },
    }
    model.elements.push(second)
    sheet('writer', siteId(1), `?tab=migration&at=${AT}`, model)
    expect(screen.getAllByRole('region', { name: /^Migration in / })).toHaveLength(2)
    expect(fact('wave', 'Network refresh')).toHaveTextContent('No wave')
    expect(fact('phase', 'Network refresh')).toHaveAttribute('data-phase', 'unplanned')
    expect(fact('rag', 'Network refresh')).toHaveTextContent('RED')
  })

  it('is offered only to a site of a rollout, and ?tab=migration is Overview for anything else', () => {
    sheet('writer', 'loc-emea')
    expect(screen.getByRole('heading', { level: 1, name: 'EMEA' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: 'Migration' })).toBeNull()
    expect(screen.queryByRole('region', { name: /^Migration in / })).toBeNull()
  })

  it('switches between Overview and Migration by the URL', async () => {
    const h = sheet('writer', siteId(1), '')
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('region', { name: /^Migration in / })).toBeNull()
    await h.user.click(screen.getByRole('button', { name: 'Migration' }))
    expect(block()).toBeInTheDocument()
    await h.user.click(screen.getByRole('button', { name: 'Overview' }))
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('region', { name: /^Migration in / })).toBeNull()
  })
})

describe('editing from the Migration tab (#215)', () => {
  it('saves actual days, the RAG and the decision as one command, and focus goes back', async () => {
    const h = sheet('writer', siteId(4))
    const opener = within(block()).getByRole('button', { name: `Progress in ${ROLLOUT}` })
    await h.user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Progress of 004' })
    // An actual day before its planned 2027-04-05.
    await h.user.type(within(dialog).getByLabelText('Mapping signed off actual day'), '2027-03-10')
    await h.user.selectOptions(within(dialog).getByRole('combobox', { name: 'RAG' }), 'amber')
    await h.user.selectOptions(within(dialog).getByRole('combobox', { name: 'Go/no-go' }), 'no-go')
    await h.user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(site(h.store, 4)).toMatchObject({
      actuals: { mappingSignedOff: '2027-03-10' },
      rag: 'amber',
      goNoGo: 'no-go',
    })
    expect(h.store.history).toHaveLength(1)
    expect(opener).toHaveFocus()
    // The tab shows what was saved, and the phase it gives at ?at=.
    expect(milestone('mappingSignedOff').querySelector('[data-actual]')).toHaveTextContent(
      '2027-03-10',
    )
    expect(fact('phase')).toHaveAttribute('data-phase', 'preparing')
    expect(fact('rag')).toHaveTextContent('AMBER')
    expect(fact('go-no-go')).toHaveTextContent('NO-GO')
  })

  it('clears with the empty choice and a blank day, never storing an empty value', async () => {
    const h = sheet('writer', siteId(1))
    await h.user.click(within(block()).getByRole('button', { name: `Progress in ${ROLLOUT}` }))
    const dialog = screen.getByRole('dialog', { name: 'Progress of 001' })
    await h.user.clear(within(dialog).getByLabelText('Freeze starts actual day'))
    await h.user.selectOptions(within(dialog).getByRole('combobox', { name: 'Go/no-go' }), '')
    await h.user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(site(h.store, 1).actuals).toEqual({
      mappingSignedOff: '2027-02-12',
      constructor: '2027-02-15',
    })
    expect(site(h.store, 1)).not.toHaveProperty('goNoGo')
  })

  it('records nothing when nothing changed, and Cancel writes nothing', async () => {
    const h = sheet('writer', siteId(1))
    const open = () =>
      h.user.click(within(block()).getByRole('button', { name: `Progress in ${ROLLOUT}` }))
    await open()
    await h.user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await open()
    await h.user.selectOptions(screen.getByRole('combobox', { name: 'RAG' }), 'red')
    await h.user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(h.store.history).toHaveLength(0)
    expect(h.store.dirty).toBe(0)
  })

  it('edits the site’s own planned dates with the rollout’s dialog', async () => {
    const h = sheet('writer', siteId(4))
    await h.user.click(within(block()).getByRole('button', { name: `Dates in ${ROLLOUT}` }))
    const dialog = screen.getByRole('dialog', { name: 'Dates of 004' })
    await h.user.selectOptions(within(dialog).getByLabelText('Freeze starts precision'), '')
    await h.user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(site(h.store, 4).milestones?.freezeStart).toBeUndefined()
    expect(h.store.history).toHaveLength(1)
    expect(milestone('freezeStart').querySelector('[data-source]')).toHaveAttribute(
      'data-source',
      'wave',
    )
  })
})

describe('the Migration tab for a reader (#215)', () => {
  it('shows every block, and no edit button', () => {
    sheet('reader', siteId(1))
    expect(fact('phase')).toHaveAttribute('data-phase', 'hypercare')
    expect(within(block()).queryAllByRole('button')).toEqual([])
  })

  it.each(['Progress', 'Dates'])(
    'closes the %s dialog when the tab becomes a reader, writes nothing, and does not reopen it',
    async (kind) => {
      const h = sheet('writer', siteId(4))
      await h.user.click(within(block()).getByRole('button', { name: `${kind} in ${ROLLOUT}` }))
      const dialog = screen.getByRole('dialog', { name: `${kind} of 004` })
      await h.user.selectOptions(
        within(dialog).getAllByRole('combobox')[0]!,
        within(dialog)
          .getAllByRole('combobox')[0]!
          .querySelectorAll('option')[1]!
          .getAttribute('value')!,
      )
      h.as('reader')
      // Present first: the block is there, as a reader's.
      expect(fact('wave')).toHaveTextContent('W1')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(h.store.dirty).toBe(0)
      h.as('writer')
      expect(within(block()).getByRole('button', { name: `${kind} in ${ROLLOUT}` })).toBeVisible()
      expect(screen.queryByRole('dialog')).toBeNull()
    },
  )
})

describe('going from one site to another (#215, key on the route parameter)', () => {
  let navigate: NavigateFunction
  function Navigator() {
    navigate = useNavigate()
    useLocation()
    return null
  }

  it('carries no open dialog or draft of one site onto the next', async () => {
    const store = new ModelStore(workspace())
    render(
      <MemoryRouter initialEntries={[`/element/${siteId(1)}?tab=migration&at=${AT}`]}>
        <Navigator />
        <ModelStoreProvider initialWorkspace={store.snapshot()} ephemeral>
          <App />
        </ModelStoreProvider>
      </MemoryRouter>,
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(await screen.findByRole('button', { name: `Progress in ${ROLLOUT}` }))
    const dialog = screen.getByRole('dialog', { name: 'Progress of 001' })
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'RAG' }), 'red')

    act(() => navigate(`/element/${siteId(2)}?tab=migration&at=${AT}`))
    // Present first: site 2's sheet, on its Migration tab.
    expect(await screen.findByRole('heading', { level: 1, name: 'Site 002' })).toBeInTheDocument()
    expect(fact('wave')).toHaveTextContent('Pilot')
    expect(screen.queryByRole('dialog')).toBeNull()

    // Site 2's own dialog holds site 2's values, not site 1's draft.
    await user.click(screen.getByRole('button', { name: `Progress in ${ROLLOUT}` }))
    const next = screen.getByRole('dialog', { name: 'Progress of 002' })
    expect(within(next).getByRole('combobox', { name: 'RAG' })).toHaveValue('')
    expect(within(next).getByRole('combobox', { name: 'Go/no-go' })).toHaveValue('')
    expect(within(next).getByLabelText('Constructor actual day')).toHaveValue('')
  })
})

describe('the register opens a site on its Migration tab, at the screen’s time point', () => {
  it('carries ?at= to the fact sheet', async () => {
    const store = new ModelStore(workspace())
    render(
      <MemoryRouter initialEntries={[`/rollout/${ROLLOUT_ID}?at=${AT}`]}>
        <ModelStoreProvider initialWorkspace={store.snapshot()} ephemeral>
          <App />
        </ModelStoreProvider>
      </MemoryRouter>,
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const row = (await screen.findAllByRole('button', { name: 'Site 001' }))[0]!
    await user.click(row)
    expect(await screen.findByRole('heading', { level: 1, name: 'Site 001' })).toBeInTheDocument()
    expect(fact('phase')).toHaveAttribute('data-phase', 'hypercare')
    expect(block()).toHaveTextContent(`Phase at ${AT}`)
  })

  it('without ?at=, opens it at today', async () => {
    render(
      <MemoryRouter initialEntries={[`/rollout/${ROLLOUT_ID}`]}>
        <ModelStoreProvider initialWorkspace={workspace()} ephemeral>
          <App />
        </ModelStoreProvider>
      </MemoryRouter>,
    )
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click((await screen.findAllByRole('button', { name: 'Site 001' }))[0]!)
    expect(await screen.findByRole('heading', { level: 1, name: 'Site 001' })).toBeInTheDocument()
    expect(fact('phase')).toHaveAttribute('data-phase', 'done')
    expect(block()).toHaveTextContent('Phase today')
  })
})
