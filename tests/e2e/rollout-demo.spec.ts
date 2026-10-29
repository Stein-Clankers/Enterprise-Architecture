import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { readZipDirectory, readZipEntry } from '../../src/io/zip'
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
 *
 * The demo opens at the day it is planned as of, 2026-10-23
 * (`ROLLOUT_DEMO_AS_OF`), so the pilot is under way, W1 is the next wave and
 * is planned to the day, and W4 to W7 are planned to the quarter (#213's last
 * criterion, on the timeline and in the workbook).
 */

const ROLLOUT = 'Site data to the regional lakes'
const AS_OF = '2026-10-23'
const WORKBOOK = 'site-data-to-the-regional-lakes-workbook.xlsx'
/** The pilot's four sites, one per region. */
const PILOT = ['loc-site-it-02', 'loc-site-dk-01', 'loc-site-ca-04', 'loc-site-jp-02']
/** A W1 site that sets its own cutover day, and a W4 site that inherits its wave's quarter. */
const NEXT = 'loc-site-at-06'
const LATER = 'loc-site-be-04'

async function openDemo(page: Page): Promise<void> {
  await openApp(page)
  await page.getByRole('button', { name: 'Explore the demo' }).click()
  await page.getByRole('button', { name: /Data-migration rollout/ }).click()
  await expect(page.getByRole('heading', { name: ROLLOUT })).toBeVisible()
}

/**
 * Each wave's `milestone.freezeStart` cell on the workbook's Waves sheet, by
 * wave id, read from the file's XML: the Waves sheet is the second, row 1
 * holds the keys, and the workbook writes text to the shared strings.
 */
async function freezeStartOfWaves(bytes: Uint8Array): Promise<(wave: string) => string> {
  const part = async (name: string) => {
    const entry = readZipDirectory(bytes).find((candidate) => candidate.name === name)!
    return new TextDecoder().decode(await readZipEntry(bytes, entry))
  }
  const strings = [...(await part('xl/sharedStrings.xml')).matchAll(/<si>(.*?)<\/si>/gs)].map(
    ([, si]) => [...si!.matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map(([, t]) => t).join(''),
  )
  const sheet = await part('xl/worksheets/sheet2.xml')
  const rows = [...sheet.matchAll(/<row[^>]*>(.*?)<\/row>/gs)].map(
    ([, row]) =>
      new Map(
        [...row!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)].map(
          ([, column, attributes, body]) => {
            const value = /<v>(.*?)<\/v>/s.exec(body ?? '')?.[1]
            const text = attributes!.includes('t="s"') ? strings[Number(value)] : value
            return [column!, text ?? ''] as const
          },
        ),
      ),
  )
  const columnOf = (key: string) =>
    [...rows[0]!].find(([, text]) => text === key)?.[0] ?? `no ${key} column`
  const id = columnOf('id')
  const freeze = columnOf('milestone.freezeStart')
  return (wave) => rows.find((row) => row.get(id) === wave)?.get(freeze) ?? `no row ${wave}`
}

test('the rollout demo opens on its home: 160 sites in 8 waves', async ({ page }) => {
  await openDemo(page)
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
  expect(await dirtyCount(page)).toBe(1)
})

/**
 * The demo's five seeded problems (#214), as the plan checks find them at the
 * as-of day: the subject and code of each, hard-coded from the checked-in
 * demo. The blackout site's freeze is in the Q1 close too, so the
 * data-migration preset's freeze check finds it as well.
 */
const SEEDED_PROBLEMS = [
  ['rollout.site-unassigned', 'loc-site-us-06'],
  ['rollout.wave-over-capacity', 'wp-wave-2'],
  ['rollout.cutover-in-blackout', 'loc-site-de-12'],
  ['rollout.dependency-order', 'loc-site-de-09'],
  ['rollout.freeze-in-blackout', 'loc-site-de-12'],
  ['rollout.residency', 'loc-site-ch-01'],
] as const

test('the plan checks find the demo’s five seeded problems, and nothing else (#214)', async ({
  page,
}) => {
  await openDemo(page)
  // The home has rendered its rollout before anything is asserted of the checks.
  await expect(page.getByText('160 sites · 8 waves · template v2')).toBeVisible()
  await expect(page.getByTestId('kpi-plan-warnings')).toHaveText(String(SEEDED_PROBLEMS.length))

  await page.getByRole('button', { name: 'Plan checks' }).click()
  const checks = page.getByRole('region', { name: 'Plan checks' })
  await expect(checks.getByTestId('plan-check-summary')).toHaveText('6 warnings')
  const findings = checks.getByRole('listitem')
  await expect(findings).toHaveCount(SEEDED_PROBLEMS.length)
  for (const [index, [code, subject]] of SEEDED_PROBLEMS.entries()) {
    await expect(findings.nth(index)).toContainText(`${code} · ${subject}`)
  }
  await expect(findings.nth(3)).toContainText('depends on')

  // A finding opens its subject: the site that waits for its hub.
  await findings.nth(3).getByRole('link').click()
  await expect(page).toHaveURL(/\/element\/loc-site-de-09$/)
})

test('the demo opens at its as-of day, with the pilot under way', async ({ page }) => {
  await openDemo(page)
  await expect(page).toHaveURL(new RegExp(`\\?at=${AS_OF}$`))
  await expect(page.getByText(`Phase at ${AS_OF}`, { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Show wave' }).selectOption({ label: 'Pilot' })
  const phase = (site: string) =>
    page.locator(`.register__row[data-location="${site}"] .register__phase`)
  for (const site of PILOT) await expect(phase(site)).toHaveAttribute('data-phase', 'preparing')

  // #233: at 1280×720 the Site column was 0px wide for a writer. A pilot
  // site's name is visible, and opens its fact sheet.
  expect(page.viewportSize()).toEqual({ width: 1280, height: 720 })
  const name = page.locator(`.register__row[data-location="${PILOT[0]}"] .register__name`)
  await expect(name).toBeVisible()
  await name.click()
  await expect(page).toHaveURL(new RegExp(`/element/${PILOT[0]}$`))
})

test('the next wave is planned to the day and later waves to the quarter (#213)', async ({
  page,
}, testInfo) => {
  await openDemo(page)

  // On the timeline: a day is a sliver, a quarter a block.
  await page.getByRole('button', { name: 'Timeline' }).click()
  const expand = page.getByRole('group', { name: 'Show sites of' })
  await expand.getByRole('button', { name: 'W1', exact: true }).click()
  await expand.getByRole('button', { name: 'W4', exact: true }).click()
  const tick = (site: string) =>
    page.locator(`[data-site="${site}"] rect[data-milestone="freezeStart"]`)
  await expect(tick(NEXT)).toHaveAttribute('data-precision', 'day')
  await expect(tick(NEXT)).toHaveAttribute('data-source', 'site')
  await expect(tick(LATER)).toHaveAttribute('data-precision', 'quarter')
  await expect(tick(LATER)).toHaveAttribute('data-source', 'wave')
  const width = async (site: string) => (await tick(site).boundingBox())!.width
  expect(await width(LATER)).toBeGreaterThan(20 * (await width(NEXT)))

  // In the workbook: the Waves sheet writes each wave's date in its precision.
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByLabel('Jump to element, run an action').fill('rollout workbook')
  await palette.getByText('Export rollout workbook…', { exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export rollout workbook' })
  await expect(dialog.getByRole('combobox', { name: 'Rollout' })).toHaveValue(
    'wp-rollout-site-data',
  )
  const started = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export workbook' }).click()
  const download = await started
  expect(download.suggestedFilename()).toBe(WORKBOOK)
  const exported = testInfo.outputPath(WORKBOOK)
  await download.saveAs(exported)

  const freeze = await freezeStartOfWaves(new Uint8Array(await readFile(exported)))
  expect(freeze('wp-wave-1')).toBe('2027-03-22')
  expect(freeze('wp-wave-4')).toBe('2027-Q4')
  expect(freeze('wp-wave-7')).toBe('2028-Q3')
})
