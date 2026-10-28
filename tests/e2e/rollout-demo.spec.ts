import { test, expect, openApp, dirtyCount } from './support'

/**
 * Journey — the generated rollout demo, opened through "Explore the demo"
 * (#212).
 *
 * The demo is `src/io/demo/rollout-demo.json`, bundled with the app and read
 * by the canonical reader a user's file goes through: this journey seeds
 * nothing itself. It proves the demo reaches the rollout home in the built
 * app, at its real scale.
 *
 * The numbers are hard-coded from what the generator promises, not read from
 * `src/`, so a change to them breaks this journey: 160 sites in 8 waves, one
 * site in no wave and one wave (W2, 20 sites of 18) over capacity.
 */

const ROLLOUT = 'Site data to the regional lakes'

test('the rollout demo opens on its home: 160 sites in 8 waves', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Explore the demo' }).click()
  await page.getByRole('button', { name: /Data-migration rollout/ }).click()

  await expect(page.getByRole('heading', { name: ROLLOUT })).toBeVisible()
  await expect(page.getByText('160 sites · 8 waves · template v2')).toBeVisible()

  const kpis = page.getByRole('region', { name: 'Rollout KPIs' })
  const perWave = kpis.getByRole('list', { name: 'Sites per wave' }).getByRole('listitem')
  await expect(perWave).toHaveCount(8)
  await expect(perWave.first()).toContainText('Pilot')
  await expect(perWave.first()).toContainText('4 / 4')
  await expect(perWave.nth(2)).toContainText('20 / 18')
  await expect(page.getByTestId('kpi-unassigned')).toHaveText('1')
  await expect(page.getByText('160 of 160 sites')).toBeVisible()

  // Loaded, not saved: the demo exists only in this browser until it is exported.
  expect(await dirtyCount(page)).toBeGreaterThan(0)
})
