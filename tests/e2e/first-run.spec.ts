import { test, expect, openApp, inventoryCounts, dirtyCount, DEMO } from './support'

/**
 * Journey 2 — first run.
 *
 * The empty state is the moment the tool earns a few more minutes or gets
 * closed, so the shape of it is load-bearing: **exactly three actions**, and the
 * one that shows the product working has to work.
 *
 * Manual counterpart: `tests/manual/first-run.md`.
 */

test('a cold browser offers exactly three actions', async ({ page }) => {
  await openApp(page)

  await expect(page.getByRole('heading', { name: 'Archipelago' })).toBeVisible()
  await expect(page.getByRole('button')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Start empty' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import a file' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Explore the demo' })).toBeVisible()

  // The promise the empty state makes about where the data goes.
  await expect(page.getByText('runs entirely in this browser')).toBeVisible()
})

test('exploring the insurance demo fills the inventory', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Explore the demo' }).click()
  await page.getByRole('button', { name: /Insurance landscape/ }).click()

  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible()
  expect(await inventoryCounts(page)).toEqual({ shown: DEMO.elements, total: DEMO.elements })

  // The nav counts the same model the inventory is showing.
  const nav = page.getByRole('navigation', { name: 'Model' })
  await expect(nav.getByRole('link', { name: 'Inventory' })).toContainText(String(DEMO.elements))

  // Loaded, not saved: the demo exists only in this browser until it is exported.
  expect(await dirtyCount(page)).toBeGreaterThan(0)
})

test('starting empty opens an empty inventory', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Start empty' }).click()

  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible()
  expect(await inventoryCounts(page)).toEqual({ shown: 0, total: 0 })
  await expect(page.getByRole('button', { name: '+ Element' })).toBeEnabled()
})
