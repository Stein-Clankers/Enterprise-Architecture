import { fileURLToPath } from 'node:url'
import { test, expect, importWithNothingToReport, startEmpty } from './support'
import type { Page } from '@playwright/test'

/**
 * Journey — a 160-site rollout's register and wave board (#211), and its
 * sites' phases and milestone dates (#213).
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

/**
 * A token's colour as the browser computes it, from a probe styled with it:
 * what an encoding promises is read off the page, never off a class name.
 */
async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  }, token)
}

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
  await expect(page.getByTestId('board-announcement')).toHaveText('017 moved to W1.')
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

  // The RAG swatch is the lifecycle ramp (ADR 0013 point 9): site 005 is
  // green, 010 amber, 007 red. Each is read off the page, against the others.
  const swatch = (site: string) =>
    page.locator(`.register__row[data-location="${site}"] .register__rag-dot`)
  const rag = { green: 'loc-site-005', amber: 'loc-site-010', red: 'loc-site-007' } as const
  const ragTokens = { green: '--lc-act', amber: '--lc-out', red: '--lc-eol' } as const
  const ragColours = new Set<string>()
  for (const key of ['green', 'amber', 'red'] as const) {
    const colour = await tokenColour(page, ragTokens[key])
    await expect(swatch(rag[key])).toHaveCSS('background-color', colour)
    ragColours.add(colour)
  }
  expect(ragColours.size).toBe(3)

  // Bulk assignment: the unassigned sites, all into W4, as one step.
  await page.getByRole('combobox', { name: 'Show wave' }).selectOption({ label: 'Unassigned' })
  await expect(page.getByText(`${UNASSIGNED} of 160 sites`)).toBeVisible()
  await page.getByRole('checkbox', { name: 'Select every site shown' }).check()
  await page.getByRole('combobox', { name: 'Assign to wave' }).selectOption({ label: 'W4' })
  await page.getByRole('button', { name: 'Assign', exact: true }).click()
  await expect(unassignedKpi(page)).toHaveText('0')
  await expect(page.getByText('0 of 160 sites')).toBeVisible()

  // W4 now holds 47 sites of 40; W1 holds 38. The load is drawn in colour on
  // the board and on the timeline, and each is read off the page.
  const within = await tokenColour(page, '--lc-in')
  const over = await tokenColour(page, '--lc-eol')
  expect(within).not.toBe(over)
  await page.getByRole('button', { name: 'Wave board' }).click()
  await expect(column(page, 'wp-wave-4')).toHaveAttribute('aria-label', /over capacity/)
  const fill = (id: string) => column(page, id).locator('.board__bar-fill')
  await expect(fill('wp-wave-1')).toHaveCSS('background-color', within)
  await expect(fill('wp-wave-4')).toHaveCSS('background-color', over)

  await page.getByRole('button', { name: 'Timeline' }).click()
  const bar = (id: string) => page.locator(`[data-wave="${id}"] rect`)
  await expect(bar('wp-wave-1')).toHaveCSS('stroke', within)
  await expect(bar('wp-wave-4')).toHaveCSS('stroke', over)
  // RAG: W4 holds red site 007, W1 amber site 020, W2 only green, the pilot none rated.
  await page.getByRole('button', { name: 'RAG', exact: true }).click()
  const timelineRag = {
    'wp-wave-4': '--lc-eol',
    'wp-wave-1': '--lc-out',
    'wp-wave-2': '--lc-act',
    'wp-wave-0': '--lc-plan',
  } as const
  const strokes = new Set<string>()
  for (const [id, token] of Object.entries(timelineRag)) {
    const colour = await tokenColour(page, token)
    await expect(bar(id)).toHaveCSS('stroke', colour)
    strokes.add(colour)
  }
  expect(strokes.size).toBe(4)
})

test('a wave with no label is headed by its name, in the interface face', async ({ page }) => {
  await openRollout(page)
  await page.getByRole('button', { name: 'Wave board' }).click()
  await page.getByRole('button', { name: 'Edit Pilot' }).click()
  await page.getByRole('textbox', { name: 'Label' }).fill('')
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  const heading = (id: string) => column(page, id).locator('.board__label')
  await expect(heading('wp-wave-0')).toHaveText('Pilot wave')
  await expect(heading('wp-wave-1')).toHaveText('W1')
  // A label is a code, in mono; a name is not.
  await expect(heading('wp-wave-1')).toHaveCSS('font-family', /JetBrains Mono/)
  await expect(heading('wp-wave-0')).not.toHaveCSS('font-family', /JetBrains Mono/)
  await expect(heading('wp-wave-0')).toHaveCSS('font-family', /Space Grotesk/)
})

/**
 * #213: the derived site phase, coloured on the lifecycle ramp (ADR 0013
 * point 9). The page's clock is fixed at 20 May 2027, so the fixture's sites
 * stand in four phases: 001 Migrated (the pilot ended hypercare on 29 March),
 * 004 Cutover (it froze on 10 May, W1 reconciles on 24 May), 005 Planned (W2
 * freezes in Q3) and 017 Unplanned (no wave). Each swatch is read off the
 * page against the others, which must all differ.
 */
test('colours each site’s phase on the lifecycle ramp, each against the others', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2027-05-20T12:00:00Z'))
  await openRollout(page)
  const phase = (site: string) =>
    page.locator(`.register__row[data-location="${site}"] .register__phase`)
  const expected = {
    'loc-site-001': ['migrated', '--lc-act'],
    'loc-site-004': ['cutover', '--lc-in'],
    'loc-site-005': ['planned', '--lc-plan'],
    'loc-site-017': ['unplanned', '--ink2'],
  } as const
  const colours = new Set<string>()
  for (const [site, [name, token]] of Object.entries(expected)) {
    await expect(phase(site)).toHaveAttribute('data-phase', name)
    const colour = await tokenColour(page, token)
    await expect(phase(site).locator('.register__phase-dot')).toHaveCSS('background-color', colour)
    colours.add(colour)
  }
  expect(colours.size).toBe(4)
  await expect(phase('loc-site-004')).toContainText('OVERDUE')
  await expect(phase('loc-site-005')).not.toContainText('OVERDUE')
})

test('the timeline expands a wave to its sites: W1 to the day, W2 to the quarter', async ({
  page,
}) => {
  await openRollout(page)
  await page.getByRole('button', { name: 'Timeline' }).click()
  const expand = page.getByRole('group', { name: 'Show sites of' })
  await expand.getByRole('button', { name: 'W1', exact: true }).click()
  await expand.getByRole('button', { name: 'W2', exact: true }).click()

  const tick = (site: string, milestone: string) =>
    page.locator(`[data-site="${site}"] rect[data-milestone="${milestone}"]`)
  const next = tick('loc-site-004', 'mappingSignedOff')
  const later = tick('loc-site-005', 'freezeStart')
  await expect(next).toHaveAttribute('data-precision', 'day')
  await expect(later).toHaveAttribute('data-precision', 'quarter')
  // The precision is what the picture shows: a quarter is a block, a day a sliver.
  const width = async (locator: typeof next) => (await locator.boundingBox())!.width
  expect(await width(later)).toBeGreaterThan(150)
  expect(await width(next)).toBeLessThan(6)

  // A set tick is filled in its phase's colour, an inherited one is an outline.
  const within = await tokenColour(page, '--lc-in')
  const own = tick('loc-site-004', 'freezeStart')
  await expect(own).toHaveAttribute('data-source', 'site')
  await expect(own).toHaveCSS('fill', within)
  await expect(next).toHaveCSS('stroke', within)
  await expect(next).not.toHaveCSS('fill', within)
})
