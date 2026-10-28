import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROLLOUT_PRESETS, rolloutPlanOf, wavePlanOf, type Workspace } from '@/model'
import { toCanonicalJson } from '@/io'
import { ModelStore, updateWave } from '@/store'
import { renderApp, renderScreenAs } from '@/test/render'
import { stubDownloads } from '@/test/downloads'
import { ROLLOUT_ID, rolloutWorkspace, siteId, waveId } from '@/test/rollout-fixture'
import { RolloutScreen } from './RolloutScreen'
import { usageText } from './rollout-data'
import { overrideValue } from './plan-date-draft'

/**
 * The rollout screens' milestones, dates and phases (#213). The fixture's
 * 20-site rollout: W1 (sites 4, 8, 12, 16, 20) is dated to the day, W2 (5, 9,
 * 13) and W3 (6, 10, 14, 18) to the quarter of their freeze, W4 not at all;
 * the rollout dates its last milestone 2028-Q4. Sites 4, 8, 12, 16 and 20 set
 * their own freeze, 2027-W19; site 17 is in no wave.
 */

const SITES = 20

function storeOf(): ModelStore {
  return new ModelStore(rolloutWorkspace(SITES))
}

const json = (store: ModelStore) => toCanonicalJson(store.snapshot())
const plan = (store: ModelStore) => rolloutPlanOf(store.element(ROLLOUT_ID))!
const sitePlan = (store: ModelStore, location: string) =>
  plan(store).sites.find((site) => site.location === location)!

function row(location: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`.register__row[data-location="${location}"]`)
  if (!node) throw new Error(`No register row ${location}`)
  return node
}

function home(tab = '', role: 'writer' | 'reader' = 'writer', store = storeOf()) {
  const h = renderScreenAs(role, store, {
    route: `/rollout/${ROLLOUT_ID}${tab ? `?tab=${tab}` : ''}`,
    path: '/rollout/:id',
    screen: <RolloutScreen />,
  })
  return { ...h, store, user: userEvent.setup() }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('choosing a preset when creating a rollout (#213)', () => {
  async function create(preset?: string): Promise<Workspace> {
    const workspace = rolloutWorkspace(SITES)
    renderApp(workspace, { route: '/rollouts' })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '+ Rollout' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Network refresh')
    if (preset) {
      await user.selectOptions(screen.getByRole('combobox', { name: 'Milestones from' }), preset)
    }
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(screen.getByRole('heading', { name: 'Network refresh' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Milestones' }))
    return workspace
  }

  const listed = () =>
    [...document.querySelectorAll('[data-milestone]')].map((node) =>
      node.getAttribute('data-milestone'),
    )

  it('starts from the generic preset by default', async () => {
    await create()
    expect(listed()).toEqual(ROLLOUT_PRESETS.generic.milestones.map((m) => m.id))
  })

  it('starts from the data-migration preset when it is chosen', async () => {
    await create('Data migration')
    expect(listed()).toEqual(ROLLOUT_PRESETS.dataMigration.milestones.map((m) => m.id))
    expect(screen.getByRole('table', { name: 'Milestones' })).toHaveTextContent('freezeStart')
  })
})

describe('the milestone-set editor (#213)', () => {
  it('lists the set in order, with each phase, the rollout’s date and the sites using it', () => {
    home('milestones')
    const rows = [...document.querySelectorAll<HTMLElement>('[data-milestone]')]
    expect(rows.map((node) => node.dataset.milestone)).toEqual([
      'mappingSignedOff',
      'freezeStart',
      'reconciliationSignedOff',
      'hypercareEnd',
      'legacyDecommissioned',
    ])
    expect(rows[1]).toHaveTextContent('Cutover')
    expect(rows[4]).toHaveTextContent('2028-Q4')
    expect(rows[4]).toHaveTextContent('Done')
  })

  it('adds a milestone in one command, and adds nothing while the phase is the empty choice', async () => {
    const h = home('milestones')
    const before = h.store.history.length
    await h.user.click(screen.getByRole('button', { name: '+ Milestone' }))
    const dialog = screen.getByRole('dialog', { name: 'New milestone' })
    await h.user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'Go/no-go')
    expect(within(dialog).getByRole('combobox', { name: 'Starts phase' })).toHaveValue('')
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled()
    await h.user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Starts phase' }),
      'Preparing',
    )
    await h.user.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(h.store.history.length).toBe(before + 1)
    expect(plan(h.store).milestones.at(-1)).toEqual({
      id: 'goNoGo',
      label: 'Go/no-go',
      startsPhase: 'preparing',
    })
  })

  it('edits a label and the rollout’s date in one command', async () => {
    const h = home('milestones')
    const before = h.store.history.length
    await h.user.click(screen.getByRole('button', { name: 'Edit Freeze starts' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit milestone' })
    const label = within(dialog).getByRole('textbox', { name: 'Label' })
    await h.user.clear(label)
    await h.user.type(label, 'Freeze')
    await h.user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Rollout date precision' }),
      'Quarter',
    )
    fireEvent.change(within(dialog).getByLabelText('Rollout date day'), {
      target: { value: '2027-08-15' },
    })
    await h.user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(h.store.history.length).toBe(before + 1)
    expect(plan(h.store).milestones[1]).toEqual({
      id: 'freezeStart',
      label: 'Freeze',
      startsPhase: 'cutover',
      date: { date: '2027-07-01', precision: 'quarter' },
    })
  })

  it('moves a milestone with one command per step, and keeps focus on the button', async () => {
    const h = home('milestones')
    const before = h.store.history.length
    const later = screen.getByRole('button', { name: 'Move Freeze starts later' })
    await h.user.click(later)
    expect(plan(h.store).milestones[2]!.id).toBe('freezeStart')
    expect(h.store.history.length).toBe(before + 1)
    expect(screen.getByRole('button', { name: 'Move Freeze starts later' })).toHaveFocus()
    // At the top, earlier is nothing to do, and says so.
    const top = screen.getByRole('button', { name: 'Move Mapping signed off earlier' })
    expect(top).toHaveAttribute('aria-disabled', 'true')
    await h.user.click(top)
    expect(h.store.history.length).toBe(before + 1)
  })

  it('asks before deleting a milestone in use, deletes its dates with it, and one undo brings all back', async () => {
    const h = home('milestones')
    const before = { json: json(h.store), history: h.store.history.length }
    await h.user.click(screen.getByRole('button', { name: 'Edit Reconciliation signed off' }))
    await h.user.click(screen.getByRole('button', { name: 'Delete…' }))
    const ask = screen.getByRole('dialog', { name: 'Delete milestone' })
    expect(ask).toHaveTextContent(
      'Delete “Reconciliation signed off”? 2 waves have dates or durations for it, which are deleted with it. Undo brings them back.',
    )
    expect(within(ask).getByRole('button', { name: 'Delete milestone' })).toHaveFocus()
    await h.user.click(within(ask).getByRole('button', { name: 'Delete milestone' }))
    expect(plan(h.store).milestones.map((m) => m.id)).not.toContain('reconciliationSignedOff')
    expect(wavePlanOf(h.store.element(waveId(1)))?.milestones).not.toHaveProperty(
      'reconciliationSignedOff',
    )
    expect(h.store.history.length).toBe(before.history + 1)
    expect(screen.getByRole('button', { name: '+ Milestone' })).toHaveFocus()
    act(() => void h.store.undo())
    expect(json(h.store)).toBe(before.json)
  })

  it('cancelling the delete puts focus back on Delete…', async () => {
    const h = home('milestones')
    await h.user.click(screen.getByRole('button', { name: 'Edit Reconciliation signed off' }))
    await h.user.click(screen.getByRole('button', { name: 'Delete…' }))
    await h.user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Delete…' })).toHaveFocus()
  })

  it('refuses to delete a milestone a template change is dated from, says why, and focuses Back', async () => {
    const h = home('milestones')
    const before = json(h.store)
    await h.user.click(screen.getByRole('button', { name: 'Edit Freeze starts' }))
    await h.user.click(screen.getByRole('button', { name: 'Delete…' }))
    const ask = screen.getByRole('dialog', { name: 'Delete milestone' })
    expect(ask).toHaveTextContent(
      '“Freeze starts” cannot be deleted: the template change tc-replace-store is dated from it.',
    )
    expect(within(ask).queryByRole('button', { name: 'Delete milestone' })).toBeNull()
    expect(within(ask).getByRole('button', { name: 'Back' })).toHaveFocus()
    await h.user.keyboard('{Enter}')
    expect(json(h.store)).toBe(before)
  })

  it('shows a reader the set with no control that writes, and closes its dialog when the tab becomes one', async () => {
    const h = home('milestones')
    await h.user.click(screen.getByRole('button', { name: 'Edit Freeze starts' }))
    await h.user.type(screen.getByRole('textbox', { name: 'Label' }), ' typed')
    h.as('reader')
    expect(screen.getByRole('table', { name: 'Milestones' })).toHaveTextContent('Freeze starts')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Milestone' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull()
    h.as('writer')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(plan(h.store).milestones[1]!.label).toBe('Freeze starts')
  })

  it('words what a delete takes with it, for each count and for none', () => {
    const none = { sites: 0, waves: 0, archetypes: 0, anchoredChanges: [] }
    expect(usageText(none)).toBe('Nothing has a date or a duration for it.')
    expect(usageText({ ...none, sites: 1 })).toMatch(/^1 site has dates/)
    expect(usageText({ ...none, waves: 2 })).toMatch(/^2 waves have dates/)
    expect(usageText({ sites: 3, waves: 1, archetypes: 1, anchoredChanges: [] })).toMatch(
      /^3 sites, 1 wave and 1 archetype have dates/,
    )
  })
})

describe('a site’s dates in the register (#213)', () => {
  it('shows the cutover as set or inherited, and where an inherited one comes from', () => {
    home()
    // Site 4 sets its own freeze; site 5 inherits its wave’s, to the quarter.
    const own = row(siteId(4)).querySelector<HTMLElement>('.register__date')!
    expect(own).toHaveTextContent('2027-W19set')
    expect(own).toHaveAttribute('data-source', 'site')
    expect(own).toHaveAttribute('title', 'Freeze starts: set at the site')
    const inherited = row(siteId(5)).querySelector<HTMLElement>('.register__date')!
    expect(inherited).toHaveTextContent('2027-Q3inherited')
    expect(inherited).toHaveAttribute('title', 'Freeze starts: inherited from wave W2')
    // Site 3 is in W4, which dates no freeze: nothing to show.
    expect(row(siteId(3)).querySelector('.register__date')).toBeNull()
  })

  it('derives each site’s phase at today, and flags one overdue', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-05-20T12:00:00Z'))
    home()
    const phase = (n: number) => row(siteId(n)).querySelector<HTMLElement>('.register__phase')!
    // Site 4 froze on 10 May (its own date) and reconciles on 24 May (W1’s).
    expect(phase(4)).toHaveAttribute('data-phase', 'cutover')
    expect(phase(4)).toHaveTextContent('CutoverOVERDUE')
    // Site 5’s wave freezes in Q3: nothing reached yet, nothing overdue.
    expect(phase(5)).toHaveAttribute('data-phase', 'planned')
    expect(phase(5)).toHaveTextContent(/^Planned$/)
    expect(phase(17)).toHaveAttribute('data-phase', 'unplanned')
    // Site 1 reached the pilot’s hypercare end, 29 March, with no actual for it.
    expect(phase(1)).toHaveAttribute('data-phase', 'migrated')
    expect(phase(1)).toHaveTextContent('MigratedOVERDUE')
  })
})

describe('a site’s own dates, edited (#213)', () => {
  it('the empty precision choice clears the override, so the site inherits again, and stores no ""', async () => {
    const h = home()
    const before = h.store.history.length
    await h.user.click(screen.getByRole('button', { name: 'Dates of 004' }))
    const dialog = screen.getByRole('dialog', { name: 'Dates of 004' })
    const precision = within(dialog).getByRole('combobox', { name: 'Freeze starts precision' })
    expect(precision).toHaveValue('week')
    await h.user.selectOptions(precision, 'Inherit')
    expect(precision).toHaveValue('')
    await h.user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(h.store.history.length).toBe(before + 1)
    expect(sitePlan(h.store, siteId(4)).milestones?.freezeStart).toBeUndefined()
    expect(json(h.store)).not.toMatch(/"precision":\s*""/)
    // And the register shows the wave’s date, inherited.
    const cell = row(siteId(4)).querySelector<HTMLElement>('.register__date')!
    expect(cell).toHaveTextContent('2027-05-17inherited')
    expect(cell).toHaveAttribute('title', 'Freeze starts: inherited from wave W1')
  })

  it('sets a quarter, snapped to its first day, as the site’s own', async () => {
    const h = home()
    await h.user.click(screen.getByRole('button', { name: 'Dates of 005' }))
    const dialog = screen.getByRole('dialog', { name: 'Dates of 005' })
    await h.user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Hypercare ends precision' }),
      'Quarter',
    )
    fireEvent.change(within(dialog).getByLabelText('Hypercare ends day'), {
      target: { value: '2027-11-20' },
    })
    expect(dialog).toHaveTextContent('→ 2027-Q4')
    await h.user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(sitePlan(h.store, siteId(5)).milestones).toEqual({
      hypercareEnd: { date: '2027-10-01', precision: 'quarter' },
    })
  })

  it('saving with nothing changed records nothing', async () => {
    const h = home()
    const before = h.store.history.length
    await h.user.click(screen.getByRole('button', { name: 'Dates of 004' }))
    await h.user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.store.history.length).toBe(before)
  })

  it('reads the empty precision as inherit, never as a precision, at the door', () => {
    expect(overrideValue({ precision: '', day: '2027-05-12' })).toBeNull()
    expect(overrideValue({ precision: 'week', day: '' })).toBeNull()
    expect(overrideValue({ precision: 'week', day: '2027-05-12' })).toEqual({
      date: '2027-05-10',
      precision: 'week',
    })
    expect(overrideValue({ precision: 'week', day: '2027-02-30' })).toBeUndefined()
  })

  it('has no Dates button for a reader, and closes when the tab becomes one, writing nothing', async () => {
    const h = home()
    const before = json(h.store)
    await h.user.click(screen.getByRole('button', { name: 'Dates of 004' }))
    await h.user.selectOptions(
      screen.getByRole('combobox', { name: 'Freeze starts precision' }),
      'Inherit',
    )
    h.as('reader')
    expect(screen.getByText(`${SITES} of ${SITES} sites`)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Dates of / })).toBeNull()
    h.as('writer')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(json(h.store)).toBe(before)
  })
})

describe('the wave dialog’s milestone dates (#213)', () => {
  it('sets the dates a wave’s sites inherit, and clears one with an empty day, in one command', async () => {
    const h = home('board')
    const before = h.store.history.length
    await h.user.click(screen.getByRole('button', { name: 'Edit W1' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit wave' })
    const group = within(dialog).getByRole('group', { name: 'Dates its sites inherit' })
    fireEvent.change(within(group).getByLabelText('Hypercare ends day'), { target: { value: '' } })
    await h.user.selectOptions(
      within(group).getByRole('combobox', { name: 'Legacy decommissioned precision' }),
      'Quarter',
    )
    fireEvent.change(within(group).getByLabelText('Legacy decommissioned day'), {
      target: { value: '2027-12-01' },
    })
    await h.user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(h.store.history.length).toBe(before + 1)
    expect(wavePlanOf(h.store.element(waveId(1)))?.milestones).toEqual({
      mappingSignedOff: { date: '2027-04-05', precision: 'day' },
      freezeStart: { date: '2027-05-17', precision: 'day' },
      reconciliationSignedOff: { date: '2027-05-24', precision: 'day' },
      legacyDecommissioned: { date: '2027-10-01', precision: 'quarter' },
    })
  })

  it('keeps a date for a milestone the set no longer has, which validate() reports', async () => {
    const store = storeOf()
    const held = { date: '2027-05-03', precision: 'day' } as const
    store.updateElement(waveId(1), (wave) => {
      const plan = wavePlanOf(wave)!
      return { ...wave, plan: { ...plan, milestones: { ...plan.milestones, goLive: held } } }
    })
    const h = home('board', 'writer', store)
    await h.user.click(screen.getByRole('button', { name: 'Edit W1' }))
    await h.user.selectOptions(
      screen.getByRole('combobox', { name: 'Legacy decommissioned precision' }),
      'Quarter',
    )
    fireEvent.change(screen.getByLabelText('Legacy decommissioned day'), {
      target: { value: '2027-12-01' },
    })
    await h.user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(wavePlanOf(store.element(waveId(1)))?.milestones?.goLive).toEqual(held)
    // A new date for no milestone is still refused.
    expect(
      updateWave(store, waveId(1), {
        milestones: { goLive: { date: '2027-05-10', precision: 'day' } },
      }),
    ).toBe(false)
  })
})

describe('the wave timeline, expanded to its sites (#213)', () => {
  const tick = (location: string, milestone: string) =>
    document.querySelector<SVGRectElement>(
      `[data-site="${location}"] rect[data-milestone="${milestone}"]`,
    )

  async function timeline(...waves: string[]) {
    const h = home('timeline')
    for (const wave of waves) {
      await h.user.click(
        within(screen.getByRole('group', { name: 'Show sites of' })).getByRole('button', {
          name: wave,
        }),
      )
    }
    return h
  }

  it('draws no site until a wave is expanded, then a row per site of it', async () => {
    const h = await timeline()
    expect(document.querySelectorAll('[data-site]')).toHaveLength(0)
    const w1 = within(screen.getByRole('group', { name: 'Show sites of' })).getByRole('button', {
      name: 'W1',
    })
    await h.user.click(w1)
    expect(w1).toHaveAttribute('aria-pressed', 'true')
    expect(
      [...document.querySelectorAll('[data-site]')].map((node) => node.getAttribute('data-site')),
    ).toEqual([4, 8, 12, 16, 20].map(siteId))
    await h.user.click(w1)
    expect(document.querySelectorAll('[data-site]')).toHaveLength(0)
  })

  it('shows rolling elaboration: the next wave’s ticks to the day, a later wave’s to the quarter', async () => {
    await timeline('W1', 'W2')
    const next = tick(siteId(4), 'mappingSignedOff')!
    expect(next).toHaveAttribute('data-precision', 'day')
    expect(next).toHaveAttribute('data-source', 'wave')
    expect(next.querySelector('title')).toHaveTextContent(
      'Mapping signed off · 2027-04-05 · inherited from wave W1',
    )
    const later = tick(siteId(5), 'freezeStart')!
    expect(later).toHaveAttribute('data-precision', 'quarter')
    expect(later.querySelector('title')).toHaveTextContent(
      'Freeze starts · 2027-Q3 · inherited from wave W2',
    )
    // A quarter spans its quarter; a day is a sliver.
    expect(Number(later.getAttribute('width'))).toBeGreaterThan(150)
    expect(Number(next.getAttribute('width'))).toBeLessThan(5)
  })

  it('fills a tick the site sets, and draws an inherited one as an outline', async () => {
    await timeline('W1')
    const own = tick(siteId(4), 'freezeStart')!
    expect(own).toHaveAttribute('data-source', 'site')
    expect(own).toHaveAttribute('fill', 'var(--lc-in)')
    const inherited = tick(siteId(4), 'mappingSignedOff')!
    expect(inherited).toHaveAttribute('fill', 'var(--surface)')
    expect(inherited).toHaveAttribute('stroke', 'var(--lc-in)')
  })

  it('shows a spaced date as inherited, saying from which milestone', async () => {
    await timeline('W3')
    // Site 10 is a Plant in W3: its mapping is 42 days before W3’s freeze, in Q3.
    expect(tick(siteId(10), 'mappingSignedOff')?.querySelector('title')).toHaveTextContent(
      'Mapping signed off · 2027-Q3 · inherited: 42 days before Freeze starts',
    )
  })

  it('derives each site’s phase at the time point, not at today', async () => {
    await timeline('W1')
    const site = () => document.querySelector(`[data-site="${siteId(4)}"]`)!
    fireEvent.change(screen.getByRole('slider', { name: 'Time point' }), {
      target: { value: '2028' },
    })
    expect(site()).toHaveAttribute('data-phase', 'migrated')
    expect(site()).toHaveTextContent('004 · Migrated · overdue')
    const legend = document.querySelector<HTMLElement>('.chrome__legend')!
    expect(within(legend).getByText('Migrated, done')).toBeInTheDocument()
  })

  it('exports the expanded sites with their ticks', async () => {
    const downloads = stubDownloads()
    const h = await timeline('W2')
    await h.user.click(screen.getByRole('button', { name: 'Export SVG' }))
    const svg = await (downloads.createObjectURL.mock.calls[0]![0] as Blob).text()
    expect(svg).toContain('Freeze starts · 2027-Q3 · inherited from wave W2')
    expect(svg).toContain('>005</tspan>')
  })
})
