import { readFile, writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { readZipDirectory, readZipEntry, writeZip } from '../../src/io/zip'
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

/** The workbook's parts, by name, as the zip holds them. */
async function workbookParts(bytes: Uint8Array): Promise<{ name: string; data: Uint8Array }[]> {
  return Promise.all(
    readZipDirectory(bytes).map(async (entry) => ({
      name: entry.name,
      data: await readZipEntry(bytes, entry),
    })),
  )
}

const text = (part: { data: Uint8Array }) => new TextDecoder().decode(part.data)
const sheetPart = (sheet: number) => `xl/worksheets/sheet${sheet}.xml`
const CELL = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs

/**
 * A sheet of the workbook as its rows of cells by column letter, read from
 * the file's XML: the workbook writes text to the shared strings, and row 1
 * holds the keys. `column(key)` is the letter of a key's column.
 */
function readSheet(parts: { name: string; data: Uint8Array }[], sheet: number) {
  const strings = [
    ...text(parts.find((part) => part.name === 'xl/sharedStrings.xml')!).matchAll(
      /<si>(.*?)<\/si>/gs,
    ),
  ].map(([, si]) => [...si!.matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map(([, t]) => t).join(''))
  const xml = text(parts.find((part) => part.name === sheetPart(sheet))!)
  const rows = [...xml.matchAll(/<row r="(\d+)"[^>]*>(.*?)<\/row>/gs)].map(([, number, row]) => ({
    number: Number(number),
    cells: new Map(
      [...row!.matchAll(CELL)].map(([, column, attributes, body]) => {
        const value = /<v>(.*?)<\/v>/s.exec(body ?? '')?.[1]
        const inline = /<t[^>]*>(.*?)<\/t>/s.exec(body ?? '')?.[1]
        const cell = attributes!.includes('t="s"') ? strings[Number(value)] : (inline ?? value)
        return [column!, cell ?? ''] as const
      }),
    ),
  }))
  const column = (key: string) => {
    const found = [...rows[0]!.cells].find(([, cell]) => cell === key)?.[0]
    expect(found, `a ${key} column on sheet ${sheet}`).toBeDefined()
    return found!
  }
  return { rows, column }
}

/** Each wave's `milestone.freezeStart` cell on the workbook's Waves sheet (the second), by wave id. */
async function freezeStartOfWaves(bytes: Uint8Array): Promise<(wave: string) => string> {
  const { rows, column } = readSheet(await workbookParts(bytes), 2)
  const id = column('id')
  const freeze = column('milestone.freezeStart')
  return (wave) =>
    rows.find((row) => row.cells.get(id) === wave)?.cells.get(freeze) ?? `no row ${wave}`
}

const columnIndex = (letters: string) =>
  [...letters].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0)

/**
 * Type into the SitePlan sheet (the third) as a spreadsheet would save it:
 * each cell, found by its site's row and its key's column, becomes an inline
 * string. The workbook leaves an empty cell out of the file, so a cell not
 * there yet is inserted in column order.
 */
async function typeIntoSitePlan(
  bytes: Uint8Array,
  edits: { location: string; key: string; text: string }[],
): Promise<Uint8Array> {
  const parts = await workbookParts(bytes)
  const { rows, column } = readSheet(parts, 3)
  const part = parts.find((candidate) => candidate.name === sheetPart(3))!
  let xml = text(part)
  for (const edit of edits) {
    const letter = column(edit.key)
    const row = rows.find((candidate) => candidate.cells.get(column('location')) === edit.location)
    expect(row, `a SitePlan row for ${edit.location}`).toBeDefined()
    const pattern = new RegExp(`(<row r="${row!.number}"[^>]*>)(.*?)(</row>)`, 's')
    expect(xml).toMatch(pattern)
    xml = xml.replace(pattern, (_, open: string, body: string, close: string) => {
      const cells = [...body.matchAll(CELL)]
        .filter(([, candidate]) => candidate !== letter)
        .map(([cell, candidate]) => ({ column: candidate!, cell }))
      cells.push({
        column: letter,
        cell: `<c r="${letter}${row!.number}" t="inlineStr"><is><t>${edit.text}</t></is></c>`,
      })
      cells.sort((a, b) => columnIndex(a.column) - columnIndex(b.column))
      return `${open}${cells.map(({ cell }) => cell).join('')}${close}`
    })
  }
  part.data = new TextEncoder().encode(xml)
  return writeZip(parts)
}

async function runFromPalette(page: Page, label: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByLabel('Jump to element, run an action').fill('rollout workbook')
  await palette.getByText(label, { exact: true }).click()
}

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
 * The six findings of the demo's five seeded problems (#214), as the plan
 * checks find them at the as-of day: the subject and code of each, hard-coded
 * from the checked-in demo. The blackout site's freeze is in the Q1 close
 * too, and checks are independent (ADR 0017 point 5): its cutover and its
 * freeze are each found.
 */
const SEEDED_PROBLEMS = [
  ['rollout.site-unassigned', 'loc-site-us-06'],
  ['rollout.wave-over-capacity', 'wp-wave-2'],
  ['rollout.cutover-in-blackout', 'loc-site-de-12'],
  ['rollout.dependency-order', 'loc-site-de-09'],
  ['rollout.freeze-in-blackout', 'loc-site-de-12'],
  ['rollout.residency', 'loc-site-ch-01'],
] as const

test('the plan checks find six findings for the demo’s five seeded problems, and nothing else (#214)', async ({
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
  await expect(page).toHaveURL(new RegExp(`/element/${PILOT[0]}\\?tab=migration&at=${AS_OF}$`))
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
  await runFromPalette(page, 'Export rollout workbook…')
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

/**
 * #215's PMO round trip: the PMO types ten actual days into the demo's
 * workbook, and the import moves the pilot's phases, the burn-up and the
 * site's Migration tab. The page's clock is fixed in mid-2028, when every
 * pilot site is Done by its plan, so only the demo's `?at=` and the typed days
 * can give the phases below: today's date cannot satisfy this journey.
 */
test('actual days typed into the workbook move the phases, the burn-up and the Migration tab (#215)', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2028-06-01T12:00:00Z'))
  await openDemo(page)
  await expect(page).toHaveURL(new RegExp(`\\?at=${AS_OF}$`))

  // Before: the pilot is preparing, and nothing has migrated.
  await page.getByRole('combobox', { name: 'Show wave' }).selectOption({ label: 'Pilot' })
  const phase = (site: string) =>
    page.locator(`.register__row[data-location="${site}"] .register__phase`)
  for (const site of PILOT) await expect(phase(site)).toHaveAttribute('data-phase', 'preparing')
  await page.getByRole('button', { name: 'Progress', exact: true }).click()
  const count = (key: string) => page.locator(`.burn-up__counts [data-count="${key}"]`)
  await expect(count('migrated')).toHaveText('0')
  await expect(count('not-migrated')).toHaveText('160')
  await expect(count('scope')).toHaveText('160')
  await expect(count('planned')).toHaveText('0')
  await expect(page.locator('[data-line="planned"]')).toBeVisible()
  // The actual line runs along zero up to the time point.
  const flat = await page.locator('[data-line="actual"]').getAttribute('d')
  expect(flat).toBeTruthy()

  // Export the workbook, as the PMO receives it.
  await runFromPalette(page, 'Export rollout workbook…')
  const exportDialog = page.getByRole('dialog', { name: 'Export rollout workbook' })
  const started = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'Export workbook' }).click()
  const exported = testInfo.outputPath(WORKBOOK)
  await (await started).saveAs(exported)
  // The demo's notes are the one thing the workbook leaves out (#215 carries
  // the actual days), and the dialog stays to say so.
  await expect(exportDialog).toContainText('3 sites have notes, which this workbook does not carry')
  await expect(exportDialog).not.toContainText('actual')
  await exportDialog.getByRole('button', { name: 'Done' }).click()
  await expect(exportDialog).toBeHidden()

  // Ten actual days: three pilot sites freeze, sign off and end their
  // hypercare before the as-of day, ahead of their plan; the fourth has only
  // frozen.
  const edits = PILOT.slice(0, 3).flatMap((location) => [
    { location, key: 'actual.freezeStart', text: '2026-10-19' },
    { location, key: 'actual.reconciliationSignedOff', text: '2026-10-20' },
    { location, key: 'actual.hypercareEnd', text: '2026-10-22' },
  ])
  edits.push({ location: PILOT[3]!, key: 'actual.freezeStart', text: '2026-10-21' })
  expect(edits).toHaveLength(10)
  const edited = testInfo.outputPath('actuals.xlsx')
  await writeFile(edited, await typeIntoSitePlan(new Uint8Array(await readFile(exported)), edits))

  await runFromPalette(page, 'Import rollout workbook…')
  const importDialog = page.getByRole('dialog', { name: 'Import rollout workbook' })
  const chooser = page.waitForEvent('filechooser')
  await importDialog.getByRole('button', { name: 'Choose a workbook…' }).click()
  await (await chooser).setFiles(edited)
  const tally = (key: string) => importDialog.locator(`[data-count="${key}"]`)
  await expect(importDialog).toContainText('4 rows to change')
  await expect(tally('sitePlans.updated')).toHaveText('4')
  await expect(tally('sitePlans.unchanged')).toHaveText('156')
  await expect(tally('sites.updated')).toHaveText('0')
  await expect(tally('waves.updated')).toHaveText('0')
  await importDialog.getByRole('button', { name: 'Apply' }).click()
  await expect(importDialog).toBeHidden()

  // The burn-up: three migrated at the as-of day, none by the plan, and the
  // counts add up: 3 + 157 = 160.
  await expect(count('migrated')).toHaveText('3')
  await expect(count('not-migrated')).toHaveText('157')
  await expect(count('scope')).toHaveText('160')
  await expect(count('planned')).toHaveText('0')
  const wave = page.getByRole('region', { name: 'Current wave' })
  await expect(wave).toContainText('Pilot')
  await expect(wave.locator('[data-count="wave"]')).toHaveText('3 of 4 migrated')
  await expect(wave.locator('[data-status]')).toHaveText([/Met/, /Met/, /Met/])

  // Planned and actual lines in their ADR 0013 colours, read off the page.
  const planned = page.locator('[data-line="planned"]')
  const actual = page.locator('[data-line="actual"]')
  await expect(actual).toBeVisible()
  await expect(actual).not.toHaveAttribute('d', flat!)
  const stroke = (line: typeof planned) => line.evaluate((path) => getComputedStyle(path).stroke)
  const plan = await tokenColour(page, '--lc-plan')
  const act = await tokenColour(page, '--lc-act')
  expect(plan).not.toBe(act)
  expect(await stroke(planned)).toBe(plan)
  expect(await stroke(actual)).toBe(act)
  expect(await stroke(page.locator('[data-line="time-point"]'))).toBe(
    await tokenColour(page, '--accent'),
  )

  // The register: three migrated, the fourth cutting over.
  await page.getByRole('button', { name: 'Site register', exact: true }).click()
  await page.getByRole('combobox', { name: 'Show wave' }).selectOption({ label: 'Pilot' })
  await expect(phase(PILOT[0]!)).toHaveAttribute('data-phase', 'migrated')
  await expect(phase(PILOT[1]!)).toHaveAttribute('data-phase', 'migrated')
  await expect(phase(PILOT[2]!)).toHaveAttribute('data-phase', 'migrated')
  await expect(phase(PILOT[3]!)).toHaveAttribute('data-phase', 'cutover')

  // The site's Migration tab: the typed days beside the planned ones.
  await page.locator(`.register__row[data-location="${PILOT[0]}"] .register__name`).click()
  await expect(page).toHaveURL(new RegExp(`/element/${PILOT[0]}\\?tab=migration&at=${AS_OF}$`))
  const block = page.getByRole('region', { name: `Migration in ${ROLLOUT}` })
  await expect(block).toBeVisible()
  await expect(block.locator('[data-fact="phase"]')).toHaveAttribute('data-phase', 'migrated')
  await expect(block).toContainText(`Phase at ${AS_OF}`)
  const actualOf = (milestone: string) =>
    block.locator(`tr[data-milestone="${milestone}"] [data-actual]`)
  await expect(actualOf('hypercareEnd')).toHaveText('2026-10-22')
  await expect(actualOf('hypercareEnd')).toBeVisible()
  await expect(actualOf('legacyDecommissioned')).toHaveText('—')
  // The archetype shows whole: an ellipsis is invisible to toHaveText.
  const archetype = block.locator('.migration__archetype')
  await expect(archetype).toBeVisible()
  const fits = await archetype.evaluate((cell) => ({
    width: cell.scrollWidth <= cell.clientWidth,
    height: cell.scrollHeight <= cell.clientHeight,
  }))
  expect(fits).toEqual({ width: true, height: true })
})
