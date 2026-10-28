import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROLLOUT_DEMO_AS_OF, ROLLOUT_DEMO_ID, loadRolloutDemoWorkspace } from '@/io'
import { rolloutPlanOf } from '@/model'
import { ModelStore } from '@/store'
import { renderScreenAs } from '@/test/render'
import { RolloutScreen } from './RolloutScreen'

/**
 * The rollout home's time point in the URL, `?at=` (#212): the rollout demo
 * opens at the day it is planned as of, so its pilot shows as under way
 * whatever today is. The clock is fixed in mid-2028, when every pilot site
 * is long Done, so a phase of Preparing can only come from `?at=`.
 */

const TODAY = new Date('2028-06-01T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
})

afterEach(() => {
  vi.useRealTimers()
})

const store = () => new ModelStore(loadRolloutDemoWorkspace())
const pilot = (s: ModelStore) =>
  rolloutPlanOf(s.element(ROLLOUT_DEMO_ID))!.sites.filter((site) => site.wave === 'wp-wave-pilot')

function home(query: string) {
  const s = store()
  const h = renderScreenAs('writer', s, {
    route: `/rollout/${ROLLOUT_DEMO_ID}${query}`,
    path: '/rollout/:id',
    screen: <RolloutScreen />,
  })
  return { ...h, store: s, user: userEvent.setup() }
}

/** The register's phase of each pilot site, with the register filtered to the pilot. */
async function pilotPhases(h: ReturnType<typeof home>): Promise<(string | null)[]> {
  await h.user.selectOptions(screen.getByRole('combobox', { name: 'Show wave' }), 'Pilot')
  return pilot(h.store).map((site) =>
    document
      .querySelector(`.register__row[data-location="${site.location}"] .register__phase`)!
      .getAttribute('data-phase'),
  )
}

describe('the rollout home’s time point (#212)', () => {
  it('derives the phase at ?at=, and says so in the register', async () => {
    const h = home(`?at=${ROLLOUT_DEMO_AS_OF}`)
    expect(screen.getByText(`Phase at ${ROLLOUT_DEMO_AS_OF}`)).toBeInTheDocument()
    expect(await pilotPhases(h)).toEqual(['preparing', 'preparing', 'preparing', 'preparing'])
  })

  it('stays at today without ?at=', async () => {
    const h = home('')
    expect(screen.getByText('Phase today')).toBeInTheDocument()
    expect(await pilotPhases(h)).toEqual(['done', 'done', 'done', 'done'])
  })

  it('ignores an ?at= that is not a calendar day, and stays at today', async () => {
    const h = home('?at=2026-02-30')
    expect(screen.getByText('Phase today')).toBeInTheDocument()
    expect(await pilotPhases(h)).toEqual(['done', 'done', 'done', 'done'])
  })

  it('keeps ?at= on the timeline until the slider moves to a year', async () => {
    const h = home(`?at=${ROLLOUT_DEMO_AS_OF}&tab=timeline`)
    expect(screen.getByText(new RegExp(`time point ${ROLLOUT_DEMO_AS_OF}$`))).toBeInTheDocument()
    await h.user.click(
      within(screen.getByRole('group', { name: 'Show sites of' })).getByRole('button', {
        name: 'Pilot',
      }),
    )
    const site = () => document.querySelector(`[data-site="${pilot(h.store)[0]!.location}"]`)!
    expect(site()).toHaveAttribute('data-phase', 'preparing')
    expect(screen.getByRole('slider', { name: 'Time point' })).toHaveValue('2026')

    fireEvent.change(screen.getByRole('slider', { name: 'Time point' }), {
      target: { value: '2028' },
    })
    expect(screen.getByText(/time point 2028$/)).toBeInTheDocument()
    expect(site()).toHaveAttribute('data-phase', 'done')
  })
})
