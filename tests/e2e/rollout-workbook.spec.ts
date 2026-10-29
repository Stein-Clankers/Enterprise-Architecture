import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { readZipDirectory, readZipEntry, writeZip } from '../../src/io/zip'
import {
  test,
  expect,
  importWithNothingToReport,
  inventoryRow,
  modelCounts,
  startEmpty,
} from './support'

/**
 * The rollout workbook (#210): export a rollout's workbook from the palette,
 * change three cells, and import it again through the preview dialog, which
 * counts exactly those three rows before anything is applied.
 *
 * The demo has no rollout yet (#212), so the journey opens one through the
 * header's Import dialog: `rollout-workspace.json`, the unit tests' rollout at
 * eight sites, written by `scripts/fixtures/build-rollout-workspace.ts`.
 */

const FIXTURE = fileURLToPath(
  new URL('../../src/io/fixtures/rollout-workspace.json', import.meta.url),
)
/** smallWorkspace's 5 elements and 4 relations, two systems and a region, the rollout, 5 waves, 8 sites. */
const COUNTS = { elements: 22, relationships: 17 }
const WORKBOOK = 'local-data-to-the-central-lake-workbook.xlsx'

async function runFromPalette(page: Page, label: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByLabel('Jump to element, run an action').fill('rollout workbook')
  await palette.getByText(label, { exact: true }).click()
}

/**
 * Change cells of the workbook's sheets as a spreadsheet would save them: each
 * cell, found by its reference, becomes an inline string. Every cell changed
 * here is already in the file, so nothing is inserted.
 */
async function editCells(
  bytes: Uint8Array,
  edits: { sheet: number; cell: string; text: string }[],
): Promise<Uint8Array> {
  const entries = await Promise.all(
    readZipDirectory(bytes).map(async (entry) => ({
      name: entry.name,
      data: await readZipEntry(bytes, entry),
    })),
  )
  for (const { sheet, cell, text } of edits) {
    const part = entries.find((entry) => entry.name === `xl/worksheets/sheet${sheet}.xml`)!
    const xml = new TextDecoder().decode(part.data)
    const pattern = new RegExp(`<c r="${cell}"[^>]*?(?:/>|>.*?</c>)`)
    expect(xml, `sheet${sheet}.xml has a cell ${cell}`).toMatch(pattern)
    part.data = new TextEncoder().encode(
      xml.replace(pattern, `<c r="${cell}" t="inlineStr"><is><t>${text}</t></is></c>`),
    )
  }
  return writeZip(entries)
}

test('export a rollout workbook, change three cells, and see the import count them', async ({
  page,
}, testInfo) => {
  await startEmpty(page)
  await importWithNothingToReport(page, FIXTURE, COUNTS)

  // Export. The workbook carries the two sites' actual days (#215) and the
  // fixture has no notes, so there is nothing to report and the dialog
  // closes once the file is downloaded.
  await runFromPalette(page, 'Export rollout workbook…')
  const exportDialog = page.getByRole('dialog', { name: 'Export rollout workbook' })
  await expect(exportDialog.getByRole('combobox', { name: 'Rollout' })).toHaveValue(
    'wp-rollout-data',
  )
  const started = page.waitForEvent('download')
  await exportDialog.getByRole('button', { name: 'Export workbook' }).click()
  const download = await started
  expect(download.suggestedFilename()).toBe(WORKBOOK)
  const exported = testInfo.outputPath(WORKBOOK)
  await download.saveAs(exported)
  await expect(exportDialog).toBeHidden()

  // Rows 1 and 2 are keys and labels; site n is row n + 2 and wave w row w + 3.
  const edited = testInfo.outputPath('edited.xlsx')
  await writeFile(
    edited,
    await editCells(new Uint8Array(await readFile(exported)), [
      { sheet: 1, cell: 'B7', text: 'Site 005, Linz' }, // Sites: name of site 5
      { sheet: 2, cell: 'B5', text: 'Wave two' }, // Waves: label of wave 2
      { sheet: 3, cell: 'E7', text: 'amber' }, // SitePlan: RAG of site 5, green
    ]),
  )

  await runFromPalette(page, 'Import rollout workbook…')
  const importDialog = page.getByRole('dialog', { name: 'Import rollout workbook' })
  const chooser = page.waitForEvent('filechooser')
  await importDialog.getByRole('button', { name: 'Choose a workbook…' }).click()
  await (await chooser).setFiles(edited)

  const count = (key: string) => importDialog.locator(`[data-count="${key}"]`)
  await expect(importDialog).toContainText('3 rows to change')
  await expect(count('sites.updated')).toHaveText('1')
  await expect(count('sites.unchanged')).toHaveText('7')
  await expect(count('waves.updated')).toHaveText('1')
  await expect(count('waves.unchanged')).toHaveText('4')
  await expect(count('sitePlans.updated')).toHaveText('1')
  await expect(count('sitePlans.unchanged')).toHaveText('7')
  for (const sheet of ['sites', 'waves', 'sitePlans']) {
    await expect(count(`${sheet}.created`)).toHaveText('0')
    await expect(count(`${sheet}.deleted`)).toHaveText('0')
  }
  // Nothing has changed until Apply.
  await expect(inventoryRow(page, 'Site 005')).toHaveCount(1)

  await importDialog.getByRole('button', { name: 'Apply' }).click()
  await expect(inventoryRow(page, 'Site 005, Linz')).toHaveCount(1)
  await expect(importDialog).toBeHidden()
  await expect(modelCounts(page)).toContainText(
    `${COUNTS.elements} elements · ${COUNTS.relationships} relations`,
  )
})
