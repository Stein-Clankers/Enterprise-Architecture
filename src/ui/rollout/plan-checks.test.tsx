import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { dayStart, planChecks, rolloutPlanOf } from '@/model'
import { ModelStore, createRollout, removeSites } from '@/store'
import { renderApp, renderScreenAs } from '@/test/render'
import { ROLLOUT_ID, rolloutWorkspace, siteId } from '@/test/rollout-fixture'
import { RolloutScreen } from './RolloutScreen'
import { summary } from './PlanChecks'

/**
 * The rollout's Plan checks tab and its KPI (#214). The 20-site fixture at
 * 29 October 2026 has site 017 in no wave, cutovers in the audit and
 * year-end blackouts, and template changes some sites cannot make.
 */

const SITES = 20
const AT = '2026-10-29'

function open(store = new ModelStore(rolloutWorkspace(SITES))) {
  renderScreenAs('writer', store, {
    route: `/rollout/${ROLLOUT_ID}?tab=checks&at=${AT}`,
    path: '/rollout/:id',
    screen: <RolloutScreen />,
  })
  return { store, user: userEvent.setup() }
}

const expected = (store: ModelStore) =>
  planChecks(
    { elements: store.elementList(), relationships: store.relationshipList() },
    ROLLOUT_ID,
    dayStart(AT),
  )

describe('the Plan checks tab (#214)', () => {
  it('lists every finding at the screen’s time point, warnings before advice', () => {
    const { store } = open()
    const checks = screen.getByRole('region', { name: 'Plan checks' })
    const findings = expected(store)
    const warnings = findings.filter((finding) => finding.severity === 'warning')
    const advice = findings.filter((finding) => finding.severity === 'advice')
    expect(warnings.length).toBeGreaterThan(0)
    expect(advice.length).toBeGreaterThan(0)
    const section = (name: string) =>
      within(checks).getByRole('region', { name: new RegExp(`^${name}`) })
    expect(within(section('Warnings')).getAllByRole('listitem')).toHaveLength(warnings.length)
    expect(within(section('Advice')).getAllByRole('listitem')).toHaveLength(advice.length)
    expect(within(checks).getByTestId('plan-check-summary')).toHaveTextContent(
      `${warnings.length} warnings · ${advice.length} advice`,
    )
    // In the order the checks give them.
    expect(
      within(section('Warnings'))
        .getAllByRole('listitem')
        .map((item) => item.querySelector('.validator__message')!.textContent),
    ).toEqual(warnings.map((finding) => finding.message))
  })

  it('links a finding to its subject’s fact sheet, and shows its code in mono', () => {
    open()
    const unassigned = screen.getByRole('link', { name: /Site “Site 017” is in no wave/ })
    expect(unassigned).toHaveAttribute('href', `/element/${siteId(17)}`)
    const meta = within(unassigned).getByText(`rollout.site-unassigned · ${siteId(17)}`)
    expect(meta).toHaveClass('mono')
  })

  it('lists a finding whose subject is gone, and it opens nothing', () => {
    const store = new ModelStore(rolloutWorkspace(SITES))
    store.removeElement(siteId(17))
    open(store)
    const row = screen.getByText(`rollout.site-unassigned · ${siteId(17)} · no longer in the model`)
    expect(row.closest('a')).toBeNull()
  })

  it('says when no check finds anything', () => {
    const store = new ModelStore(rolloutWorkspace(4))
    const rollout = createRollout(store, { name: 'Empty' })!
    renderScreenAs('writer', store, {
      route: `/rollout/${rollout.id}?tab=checks`,
      path: '/rollout/:id',
      screen: <RolloutScreen />,
    })
    expect(screen.getByRole('heading', { name: 'Empty' })).toBeVisible()
    expect(screen.getByText('No plan check finds anything at this time point.')).toBeVisible()
    expect(screen.getByTestId('plan-check-summary')).toHaveTextContent('0 findings')
    expect(screen.getByTestId('kpi-plan-warnings')).toHaveTextContent('0')
  })

  it('is a tab of the rollout home, reached by its button', async () => {
    renderApp(rolloutWorkspace(SITES), { route: `/rollout/${ROLLOUT_ID}?at=${AT}` })
    const user = userEvent.setup()
    expect(screen.getByText(`${SITES} sites · 5 waves · template v2`)).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Plan checks' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Plan checks' }))
    expect(screen.getByRole('region', { name: 'Plan checks' })).toBeVisible()
  })
})

describe('the plan warnings KPI (#214)', () => {
  it('counts the warnings, not the advice, and flags them', () => {
    const { store } = open()
    const warnings = expected(store).filter((finding) => finding.severity === 'warning').length
    const kpi = screen.getByTestId('kpi-plan-warnings')
    expect(kpi).toHaveTextContent(String(warnings))
    expect(kpi).toHaveClass('kpi__value--alert')
    expect(expected(store).length).toBeGreaterThan(warnings)
  })

  it('follows the model: a change that clears a warning lowers it', () => {
    const { store } = open()
    const before = Number(screen.getByTestId('kpi-plan-warnings').textContent)
    // Site 017, in no wave, leaves the rollout.
    act(() => {
      removeSites(store, ROLLOUT_ID, [siteId(17)])
    })
    expect(rolloutPlanOf(store.element(ROLLOUT_ID))!.sites).toHaveLength(SITES - 1)
    expect(Number(screen.getByTestId('kpi-plan-warnings').textContent)).toBe(before - 1)
  })
})

describe('the summary line', () => {
  it.each([
    [[], '0 findings'],
    [['warning'], '1 warning'],
    [['warning', 'warning', 'advice'], '2 warnings · 1 advice'],
    [['advice'], '1 advice'],
    [['error', 'error'], '2 errors'],
  ] as const)('%o is “%s”', (severities, text) => {
    expect(summary(severities.map((severity) => ({ severity, code: 'x', message: 'x' })))).toBe(
      text,
    )
  })
})
