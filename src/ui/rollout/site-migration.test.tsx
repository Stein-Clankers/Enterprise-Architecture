import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom'
import { rolloutPlanOf, type Element, type SitePlan, type Workspace } from '@/model'
import { ModelStore, ModelStoreProvider } from '@/store'
import { App } from '@/app/App'
import { renderScreenAs } from '@/test/render'
import { TakesFocusAsReader } from '@/test/takes-focus-as-reader'
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
  beside?: ReactNode,
) {
  const store = new ModelStore(model)
  const h = renderScreenAs(role, store, {
    route: `/element/${id}${query}`,
    path: '/element/:id',
    screen: (
      <>
        <ElementScreen />
        {beside}
      </>
    ),
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

describe('a site’s exceptions, dependencies and plan checks on its Migration tab (#214)', () => {
  const part = (label: string) => screen.getByRole('region', { name: `${label} in ${ROLLOUT}` })
  const cells = (row: HTMLElement) =>
    [...row.querySelectorAll('th, td')].map((cell) => cell.textContent!.trim())

  it('lists each exception: what it does, to which change, its class, owner and expiry', () => {
    sheet('writer', siteId(3))
    const rows = part('Exceptions').querySelectorAll<HTMLElement>('tbody tr')
    expect([...rows].map((row) => row.getAttribute('data-exception'))).toEqual([
      'ex-003-skip',
      'ex-003-modify',
      'ex-003-add',
    ])
    expect([...rows].map(cells)).toEqual([
      ['Skips ex-003-skip', 'tc-fit', 'preference', 'Site 003 IT', '2027-06-30'],
      ['Modifies ex-003-modify', 'tc-retire-store', 'operational', 'No owner', '—'],
      ['Adds ex-003-add', 'retire sys-local-store (site only)', 'legal', 'Legal', '2028-12-31'],
    ])
  })

  it('says a site with no exception follows the template', () => {
    sheet('writer', siteId(1))
    // Present first: the block, then the empty part.
    expect(fact('wave')).toHaveTextContent('Pilot')
    expect(part('Exceptions')).toHaveTextContent('No exceptions: the site follows the template.')
    expect(part('Exceptions').querySelector('table')).toBeNull()
  })

  it('shows the sites a site waits for, and the sites that wait for it, each linked', () => {
    sheet('writer', siteId(6))
    const on = part('Dependencies').querySelector('[data-dependencies="on"]')!
    expect([...on.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['005', '002'])
    expect(on.querySelector('a')).toHaveAttribute(
      'href',
      `/element/${siteId(5)}?at=${AT}&tab=migration`,
    )
    expect(part('Dependencies').querySelector('[data-dependencies="of"]')).toHaveTextContent(
      'No site waits for this one.',
    )
  })

  it('shows, on the site waited for, who waits for it', () => {
    sheet('writer', siteId(2))
    const of = part('Dependencies').querySelector('[data-dependencies="of"]')!
    expect([...of.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['006'])
    expect(part('Dependencies').querySelector('[data-dependencies="on"]')).toHaveTextContent(
      'No site must cut over before this one.',
    )
  })

  it('lists the plan checks’ findings about this site alone, at the time point', () => {
    const codes = () =>
      [...part('Plan checks').querySelectorAll('li')].map((item) => item.getAttribute('data-code'))
    const first = sheet('writer', siteId(3))
    // At ?at=2027-03-15 site 3 is undated; its preference exception holds
    // until 2027-06-30. Site 5's blackout finding is site 5's, not shown here.
    expect(codes()).toEqual(['rollout.site-undated'])
    expect(part('Plan checks')).toHaveTextContent('Site “Site 003” has no Freeze starts date')
    first.unmount()
    sheet('writer', siteId(3), '?tab=migration&at=2027-07-01')
    expect(codes()).toEqual(['rollout.site-undated', 'rollout.exception-expired'])
    expect(
      part('Plan checks').querySelector('[data-code="rollout.exception-expired"]'),
    ).toHaveAttribute('data-severity', 'warning')
  })

  it('says when no plan check finds anything about the site', () => {
    const model = workspace()
    // Site 4's one finding is that it lacks the store the template retires;
    // skipping that change for the site leaves nothing to find.
    const rollout = rolloutPlanOf(model.elements.find((element) => element.id === ROLLOUT_ID))!
    const four = rollout.sites.find((plan) => plan.location === siteId(4))!
    four.exceptions = [
      { id: 'ex-004-skip', kind: 'skip', change: 'tc-retire-store', class: 'operational' },
    ]
    sheet('writer', siteId(4), `?tab=migration&at=${AT}`, model)
    expect(part('Exceptions').querySelector('[data-exception="ex-004-skip"]')).not.toBeNull()
    expect(part('Plan checks')).toHaveTextContent('No plan check finds anything about this site.')
    expect(part('Plan checks').querySelector('li')).toBeNull()
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

  it('stays open and says so when the model refuses a day, keeping what was typed', async () => {
    // A date input takes a five-digit year, a valid date string the store's
    // ISO day (`YYYY-MM-DD`) is not: the one value typed here that it refuses.
    const h = sheet('writer', siteId(4))
    await h.user.click(within(block()).getByRole('button', { name: `Progress in ${ROLLOUT}` }))
    const dialog = screen.getByRole('dialog', { name: 'Progress of 004' })
    const field = within(dialog).getByLabelText('Mapping signed off actual day')
    fireEvent.change(field, { target: { value: '10000-01-01' } })
    expect(field).toHaveValue('10000-01-01')
    await h.user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Not saved: the model refused these values.',
    )
    expect(screen.getByRole('dialog', { name: 'Progress of 004' })).toBe(dialog)
    expect(field).toHaveValue('10000-01-01')
    expect(h.store.history).toHaveLength(0)
    expect(site(h.store, 4)).not.toHaveProperty('actuals')
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
      // A refused save's dialog takes focus in the commit that makes the tab
      // a reader: no field of this dialog may still be on screen in it.
      const h = sheet('writer', siteId(4), undefined, undefined, <TakesFocusAsReader />)
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
      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus()
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
