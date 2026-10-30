import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROLLOUT_DEMO_AS_OF, ROLLOUT_DEMO_ID, loadRolloutDemoWorkspace } from '@/io'
import { dayStart, rolloutPlanOf, type Element, type Workspace } from '@/model'
import { ModelStore } from '@/store'
import { renderScreenAs } from '@/test/render'
import { ROLLOUT_ID, rolloutWorkspace, siteId } from '@/test/rollout-fixture'
import { RolloutScreen } from './RolloutScreen'
import { burnUp, burnUpChart } from './burn-up'
import { rolloutData } from './rollout-data'

/**
 * The rollout's Progress tab (#215). The clock is fixed in mid-2028, when the
 * demo's plan has migrated 135 of its 160 sites, so a count of none migrated
 * by the plan can only come from `?at=`.
 */

const TODAY = new Date('2028-06-01T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
})

afterEach(() => {
  vi.useRealTimers()
})

function progress(
  query: string,
  model: Workspace = loadRolloutDemoWorkspace(),
  id = ROLLOUT_DEMO_ID,
) {
  const store = new ModelStore(model)
  const h = renderScreenAs('writer', store, {
    route: `/rollout/${id}?tab=progress${query}`,
    path: '/rollout/:id',
    screen: <RolloutScreen />,
  })
  return { ...h, store, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) }
}

const count = (key: string) => document.querySelector(`[data-count="${key}"]`)!.textContent
const counts = () => ({
  migrated: Number(count('migrated')),
  notMigrated: Number(count('not-migrated')),
  scope: Number(count('scope')),
  planned: Number(count('planned')),
})
const statuses = () =>
  [...document.querySelectorAll('.burn-up__checkpoints [data-status]')].map((cell) =>
    cell.getAttribute('data-status'),
  )
const line = (name: string) => document.querySelector(`[data-line="${name}"]`)

describe('the rollout’s Progress tab (#215)', () => {
  it('counts at the demo’s ?at=: none migrated, none by the plan, and every checkpoint still due', () => {
    progress(`&at=${ROLLOUT_DEMO_AS_OF}`)
    expect(screen.getByRole('button', { name: 'Progress' })).toHaveAttribute('aria-current', 'page')
    expect(counts()).toEqual({ migrated: 0, notMigrated: 160, scope: 160, planned: 0 })
    expect(screen.getByText(new RegExp(`time point ${ROLLOUT_DEMO_AS_OF}$`))).toBeInTheDocument()
    const wave = screen.getByRole('region', { name: 'Current wave' })
    expect(wave).toHaveTextContent('Pilot')
    expect(count('wave')).toBe('0 of 4 migrated')
    expect(
      [...wave.querySelectorAll('tbody tr')].map((row) =>
        [...row.querySelectorAll('td')].map((cell) => cell.textContent!.trim()),
      ),
    ).toEqual([
      ['25%', '1', '2026-12-06', '—', 'Due'],
      ['50%', '2', '2026-12-18', '—', 'Due'],
      ['75%', '3', '2026-12-22', '—', 'Due'],
    ])
    expect(statuses()).toEqual(['due', 'due', 'due'])
    expect(line('planned')).toBeInTheDocument()
    expect(line('time-point')).toBeInTheDocument()
  })

  it('counts at today without ?at=: the plan is ahead, and the checkpoints are late', () => {
    progress('')
    expect(screen.getByText(/time point today$/)).toBeInTheDocument()
    expect(counts()).toEqual({ migrated: 0, notMigrated: 160, scope: 160, planned: 135 })
    expect(statuses()).toEqual(['late', 'late', 'late'])
  })

  it('draws the burn-up by week, then by month, from the derived counts', async () => {
    const h = progress(`&at=${ROLLOUT_DEMO_AS_OF}`)
    const group = screen.getByRole('group', { name: 'Burn-up by' })
    const data = rolloutData(h.store, ROLLOUT_DEMO_ID, dayStart(ROLLOUT_DEMO_AS_OF))!
    const week = burnUpChart(burnUp(data, 'week'))!
    const month = burnUpChart(burnUp(data, 'month'))!
    expect(week.planned).not.toBe(month.planned)
    expect(within(group).getByRole('button', { name: 'WEEK' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(line('planned')).toHaveAttribute('d', week.planned)
    await h.user.click(within(group).getByRole('button', { name: 'MONTH' }))
    expect(within(group).getByRole('button', { name: 'MONTH' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(line('planned')).toHaveAttribute('d', month.planned)
    expect(screen.getByRole('img', { name: /^Burn-up of sites migrated, by month/ })).toBeVisible()
    // The counts are of the time point, not of the grain.
    expect(counts()).toEqual({ migrated: 0, notMigrated: 160, scope: 160, planned: 0 })
  })

  it('counts an actual Migrated day before its planned one, and the identity holds', () => {
    const model = rolloutWorkspace(8)
    // Site 1's hypercare ends on 2027-03-10, before its planned 2027-03-29.
    const site = rolloutPlanOf(model.elements.find((e) => e.id === ROLLOUT_ID))!.sites[0]!
    site.actuals = { ...site.actuals, hypercareEnd: '2027-03-10' }
    progress('&at=2027-03-15', model, ROLLOUT_ID)
    const at = counts()
    expect(at.migrated + at.notMigrated).toBe(at.scope)
    expect(at).toEqual({ migrated: 1, notMigrated: 7, scope: 8, planned: 0 })
    expect(line('actual')).toBeInTheDocument()
  })
})

describe('the Progress tab’s empty states (#215)', () => {
  function single(milestone: { id: string; label: string; startsPhase: 'migrated' | 'preparing' }) {
    const model = rolloutWorkspace(8)
    const rollout: Element = {
      id: 'wp-network',
      type: 'WorkPackage',
      name: 'Network refresh',
      properties: {},
      plan: {
        kind: 'rollout',
        templateVersion: 1,
        milestones: [milestone],
        template: [],
        archetypes: [],
        sites: [{ location: siteId(1) }, { location: siteId(2) }],
      },
    }
    model.elements.push(rollout)
    return progress('', model, 'wp-network')
  }

  it('says no site can migrate when no milestone starts Migrated or Done', () => {
    single({ id: 'prep', label: 'Prep', startsPhase: 'preparing' })
    expect(counts()).toEqual({ migrated: 0, notMigrated: 2, scope: 2, planned: 0 })
    expect(screen.getByText(/No milestone of this rollout starts Migrated or Done/)).toBeVisible()
    expect(screen.queryByRole('img', { name: /^Burn-up/ })).toBeNull()
    expect(screen.getByText('This rollout has no waves yet.')).toBeVisible()
  })

  it('says no site is planned to migrate when no date says when', () => {
    single({ id: 'cutover', label: 'Cutover', startsPhase: 'migrated' })
    expect(screen.getByText('No site is planned to reach Migrated yet.')).toBeVisible()
    expect(screen.queryByRole('img', { name: /^Burn-up/ })).toBeNull()
  })
})
