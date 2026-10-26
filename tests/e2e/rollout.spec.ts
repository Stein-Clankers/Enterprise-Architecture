import { fileURLToPath } from 'node:url'
import { test, expect, importWithNothingToReport, startEmpty } from './support'
import type { Page } from '@playwright/test'

/**
 * Journey — a 160-site rollout's register and wave board (#211).
 *
 * The model is `src/io/fixtures/rollout-160.json`, written by
 * `scripts/fixtures/build-rollout-fixture.ts` from the unit tests' generator
 * and imported through the app's own importer, as a user's file would be.
 * #212's generated demo will replace it. At 160 sites the board and the
 * register virtualise, which only a real browser lays out, so this is where
 * the keyboard path is proven at scale: a site moved by keyboard changes the
 * counts, and focus stays on the card it moved.
 *
 * The counts are hard-coded from the fixture, not read from `src/`: sites
 * 17, 34 … 153 are in no wave, which is 9 of them.
 */

const FIXTURE = fileURLToPath(new URL('../../src/io/fixtures/rollout-160.json', import.meta.url))
const MODEL = { elements: 174, relationships: 169 } as const
const ROLLOUT = 'Local data to the central lake'
const UNASSIGNED = 9

const unassignedKpi = (page: Page) => page.getByTestId('kpi-unassigned')
const column = (page: Page, id: string) => page.locator(`[data-column="${id}"]`)
const cardIn = (page: Page, columnId: string, site: string) =>
  column(page, columnId).locator(`[data-location="${site}"]`)

/** The first number of a column's `12 / 40` count. */
async function columnCount(page: Page, id: string): Promise<number> {
  const text = await column(page, id).locator('.board__count').innerText()
  return Number(/^\d+/.exec(text)?.[0])
}

async function openRollout(page: Page): Promise<void> {
  await startEmpty(page)
  await importWithNothingToReport(page, FIXTURE, MODEL)
  await page.getByRole('link', { name: /Rollouts/ }).click()
  await page.getByRole('button', { name: new RegExp(ROLLOUT) }).click()
  await expect(page.getByRole('heading', { name: ROLLOUT })).toBeVisible()
  await expect(unassignedKpi(page)).toHaveText(String(UNASSIGNED))
}

test('a site assigned by keyboard on the board changes the counts, and keeps focus', async ({
  page,
}) => {
  await openRollout(page)
  await page.getByRole('button', { name: 'Wave board' }).click()

  const before = await columnCount(page, 'wp-wave-1')
  const site = cardIn(page, 'unassigned', 'loc-site-017')
  await expect(site).toBeVisible()
  await site.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')

  await expect(unassignedKpi(page)).toHaveText(String(UNASSIGNED - 1))
  await expect(cardIn(page, 'wp-wave-1', 'loc-site-017')).toBeFocused()
  expect(await columnCount(page, 'wp-wave-1')).toBe(before + 1)

  // And by mouse: dragging a card onto a column is the same one command.
  await cardIn(page, 'unassigned', 'loc-site-034').dragTo(column(page, 'wp-wave-2'))
  await expect(unassignedKpi(page)).toHaveText(String(UNASSIGNED - 2))
  await expect(cardIn(page, 'wp-wave-2', 'loc-site-034')).toBeVisible()
})

test('the register lists all 160 sites and hands the browser only a window of them', async ({
  page,
}) => {
  await openRollout(page)
  await expect(page.getByText('160 of 160 sites')).toBeVisible()
  const rows = await page.locator('.register__row').count()
  expect(rows).toBeGreaterThan(10)
  expect(rows).toBeLessThan(150)

  // Bulk assignment: the unassigned sites, all into W4, as one step.
  await page.getByRole('combobox', { name: 'Show wave' }).selectOption({ label: 'Unassigned' })
  await expect(page.getByText(`${UNASSIGNED} of 160 sites`)).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select every site shown' }).check()
  await page.getByRole('combobox', { name: 'Assign to wave' }).selectOption({ label: 'W4' })
  await page.getByRole('button', { name: 'Assign', exact: true }).click()
  await expect(unassignedKpi(page)).toHaveText('0')
  await expect(page.getByText('0 of 160 sites')).toBeVisible()
})
