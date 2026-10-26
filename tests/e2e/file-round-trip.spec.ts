import { writeFile } from 'node:fs/promises'
import {
  test,
  expect,
  loadDemo,
  saveWorkspaceFile,
  importWorkspaceFile,
  inventoryCounts,
  modelCounts,
  dirtyCount,
  DEMO,
} from './support'

/**
 * Journey 5 — file round trip.
 *
 * Files are the source of truth (concept §5.2) and canonical JSON has to be
 * deterministic (ADR 0004), which together make one assertion worth more than
 * any count: export → import → export must be **byte-identical**. If it is not,
 * the format is not git-friendly and browser storage has quietly become the
 * real repository.
 *
 * Manual counterpart: `tests/manual/file-round-trip.md`.
 */

test('export, reimport and export again produces the same bytes', async ({ page }, testInfo) => {
  await loadDemo(page)
  const beforeSave = await dirtyCount(page)
  expect(beforeSave).toBeGreaterThan(0)

  const exported = await saveWorkspaceFile(page, testInfo.outputPath('first-export.json'))

  // The counter deliberately does **not** move here. This harness puts Chromium
  // on the download path, and a Blob URL plus an anchor click reports that a
  // file was *offered*, not that it landed — a user who cancels the OS dialog
  // has nothing on disk, and `markSaved()` has no inverse. Only the File System
  // Access handle, which resolves after `writable.close()`, clears it (#29).
  expect(await dirtyCount(page)).toBe(beforeSave)
  await expect(page.getByRole('status')).toContainText('Downloaded archisurance.json')

  const parsed: unknown = JSON.parse(exported)
  expect(parsed).toMatchObject({ schemaVersion: 6, name: 'ArchiSurance' })
  // The demo mints a fresh workspace id on every load (#24), so the value is not
  // fixed — but it must be present and well-formed, because the round trip below
  // depends on the file carrying it.
  expect((parsed as { id: string }).id).toMatch(/^ws-/)
  expect(exported.endsWith('\n')).toBe(true)

  await importWorkspaceFile(page, testInfo.outputPath('first-export.json'))

  // An import with nothing to report closes its own dialog; the report only
  // stays up when there is something the user needs to know.
  await expect(page.getByRole('dialog', { name: 'Import' })).toBeHidden()

  expect(await inventoryCounts(page)).toEqual({ shown: DEMO.elements, total: DEMO.elements })
  // Relationships come back too, which the element count alone would not show.
  await expect(modelCounts(page)).toContainText(
    `${DEMO.elements} elements · ${DEMO.relationships} relations`,
  )

  const reexported = await saveWorkspaceFile(page, testInfo.outputPath('second-export.json'))
  expect(reexported).toBe(exported)
})

test('an unreadable file is reported rather than swallowed', async ({ page }, testInfo) => {
  await loadDemo(page)

  const junk = testInfo.outputPath('not-a-model.json')
  await writeFile(junk, '{ "elements": [ }', 'utf8')

  await importWorkspaceFile(page, junk)

  const dialog = page.getByRole('dialog', { name: 'Import' })
  await expect(dialog).toContainText('Nothing could be read from that file.')
  await expect(dialog).toContainText('not valid JSON')

  // The workspace that was already open is untouched.
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(await inventoryCounts(page)).toEqual({ shown: DEMO.elements, total: DEMO.elements })
})
