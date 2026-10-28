import { readFile } from 'node:fs/promises'
import { expect, test as base, type Locator, type Page } from '@playwright/test'

/**
 * Shared harness for the end-to-end journeys (issue #19).
 *
 * Three things live here so the specs can stay readable:
 *
 * - **Isolation.** Playwright gives every test its own browser context, so
 *   IndexedDB, localStorage and the Web Lock start empty — no reset hook needed
 *   between tests. `clearBrowserState` exists for the case a *single* test needs
 *   to go back to a cold browser mid-flight.
 * - **A console-error guard**, on by default. A React app can render the right
 *   pixels while throwing in an effect; the journeys would pass and the app would
 *   be broken. Every test fails if anything reaches `console.error` or escapes as
 *   an uncaught exception.
 * - **Selectors**, in one place. Where a locator has to reach for a class name
 *   rather than a role, it is here rather than scattered through five specs.
 */

/**
 * What the bundled demo workspace contains.
 *
 * Hard-coded on purpose: importing the count from `src/` would make the test
 * agree with the code by construction. These are the numbers the demo's own
 * provenance note promises, and a change to them should break this harness.
 */
export const DEMO = { elements: 29, relationships: 47 } as const

/** IndexedDB database name from `src/store/persistence.ts`. */
const DB_NAME = 'archipelago'

/**
 * Console output that says nothing about the app.
 *
 * Chromium requests `/favicon.ico` on every navigation and logs the 404; the app
 * ships no icon yet (that belongs to the release checklist, #20).
 */
const IGNORED_CONSOLE_ERRORS = [/favicon\.ico/]

export interface AppFixtures {
  /** Console errors and uncaught exceptions seen so far in this test. */
  consoleErrors: string[]
  /** Set to true in a test that provokes an error on purpose. */
  allowConsoleErrors: boolean
  /**
   * Keep the view editor's grid and guide snapping (#136), on by default as in
   * Archi. Off unless a journey asks: the others drag shapes to the pixel, and
   * snapping would move where they land. Set only when nothing is stored, so a
   * journey that changes the preference and reloads keeps its own.
   */
  snapping: boolean
}

/** `GRID_STORAGE_KEY` in `src/ui/views/grid-preferences.ts`. */
const GRID_STORAGE_KEY = 'archipelago.view-grid'

export const test = base.extend<AppFixtures>({
  allowConsoleErrors: [false, { option: true }],
  snapping: [false, { option: true }],

  page: async ({ page, snapping }, use) => {
    if (!snapping) {
      await page.addInitScript((key) => {
        try {
          if (localStorage.getItem(key) === null) {
            localStorage.setItem(key, JSON.stringify({ snap: false, guides: false }))
          }
        } catch {
          // A journey that blocks storage gets Archi's defaults, as a user would.
        }
      }, GRID_STORAGE_KEY)
    }
    // The File System Access API opens a *native* picker, which no browser
    // automation can drive. Hiding it puts Chromium on the download and
    // <input type=file> path that Firefox and Safari use anyway, so the file
    // journeys exercise the fallback every non-Chromium user gets.
    await page.addInitScript(() => {
      for (const name of ['showSaveFilePicker', 'showOpenFilePicker', 'showDirectoryPicker']) {
        Object.defineProperty(window, name, { value: undefined, configurable: true })
      }
    })
    await use(page)
  },

  consoleErrors: [
    async ({ page, allowConsoleErrors }, use) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        const text = message.text()
        if (IGNORED_CONSOLE_ERRORS.some((pattern) => pattern.test(text))) return
        errors.push(text)
      })
      page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`))

      await use(errors)

      if (!allowConsoleErrors) {
        expect(errors, 'the app wrote to the console while this journey ran').toEqual([])
      }
    },
    { auto: true },
  ],
})

export { expect }

// ── Locators ─────────────────────────────────────────────────────────────────

/** `LOCAL · SAVED` / `LOCAL · 3 UNSAVED` in the header. */
export function saveStateLabel(page: Page): Locator {
  return page.locator('.save-state__label')
}

/** `12 of 29 elements · 2 filters (AND)` under the inventory title. */
export function inventoryResult(page: Page): Locator {
  return page.locator('.inventory__result')
}

/** `29 elements · 47 relations` in the nav's model-health block. */
export function modelCounts(page: Page): Locator {
  return page.locator('.health__counts')
}

/** The drawn nodes on the dependency-graph canvas, one per placed element. */
export function graphNodes(page: Page): Locator {
  return page.locator('.gnode')
}

/**
 * `29 nodes · 47 relations · time point 2026` under a report title — and
 * `· laying out…` appended to it for as long as the graph has no layout.
 */
export function reportStats(page: Page): Locator {
  return page.locator('.chrome__stats')
}

/** A row in the inventory table, addressed by element name. */
export function inventoryRow(page: Page, name: string): Locator {
  return page.locator('.table__row').filter({ hasText: name })
}

/**
 * A facet option in the filter rail, by its visible label.
 *
 * Matched on the label span rather than the button's accessible name: the name
 * carries the count, and "Business" would otherwise also match the saved search
 * "Business capabilities".
 */
export function facetOption(page: Page, label: string): Locator {
  return page
    .locator('.rail__option')
    .filter({ has: page.locator('.rail__option-label', { hasText: exactly(label) }) })
}

/** The count badge a facet option carries (global counts, not co-filtered). */
export async function facetCount(page: Page, label: string): Promise<number> {
  return Number(await facetOption(page, label).locator('.rail__option-count').innerText())
}

/** A saved search in the filter rail, by its visible label. */
export function savedSearch(page: Page, label: string): Locator {
  return page
    .locator('.rail__saved')
    .filter({ has: page.locator('.rail__saved-label', { hasText: exactly(label) }) })
}

/** How many elements a saved search says it returns. */
export async function savedSearchCount(page: Page, label: string): Promise<number> {
  return Number(await savedSearch(page, label).locator('.rail__saved-count').innerText())
}

/** An assessment cell on the fact sheet, by its key ("Functional fit"). */
export function assessmentCell(page: Page, key: string): Locator {
  return page
    .locator('.assessment__cell')
    .filter({ has: page.locator('.assessment__key', { hasText: exactly(key) }) })
}

/** AND / OR / NOT. */
export function combinator(page: Page, mode: 'AND' | 'OR' | 'NOT'): Locator {
  return page.getByRole('group', { name: 'Facet combinator' }).getByRole('button', { name: mode })
}

// ── Readings ─────────────────────────────────────────────────────────────────

/** How many changes the header says are unsaved. `LOCAL · SAVED` reads as zero. */
export async function dirtyCount(page: Page): Promise<number> {
  const label = await saveStateLabel(page).innerText()
  const match = /(\d+) UNSAVED$/.exec(label)
  if (match?.[1]) return Number(match[1])
  if (label.endsWith('· SAVED')) return 0
  throw new Error(`Unreadable save-state label: “${label}”`)
}

/** `{ shown, total }` from the inventory result line. */
export async function inventoryCounts(page: Page): Promise<{ shown: number; total: number }> {
  const text = await inventoryResult(page).innerText()
  const match = /^(\d+) of (\d+) element/.exec(text)
  if (!match?.[1] || !match[2]) throw new Error(`Unreadable inventory result line: “${text}”`)
  return { shown: Number(match[1]), total: Number(match[2]) }
}

/** Just the left-hand number of the result line, for `expect.poll`. */
export async function shownCount(page: Page): Promise<number> {
  return (await inventoryCounts(page)).shown
}

/**
 * Wait for the inventory to finish re-rendering, then read the result line.
 *
 * A click on a facet or a combinator updates the URL synchronously and the DOM a
 * render later, so reading the count straight after the click reads the previous
 * one. `summary` is the part of the result line that proves the new state has
 * landed — `2 filters (OR)`, and so on.
 */
export async function countsAfter(
  page: Page,
  summary: string | RegExp,
): Promise<{ shown: number; total: number }> {
  await expect(inventoryResult(page)).toContainText(summary)
  return inventoryCounts(page)
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** Open the app at the Pages base path (or a deep link below it). */
export async function openApp(page: Page, path = ''): Promise<void> {
  await page.goto(`./${path}`)
}

/**
 * Seed the demo workspace **through the app's own import path**: the first-run
 * screen's "Explore the demo", then its insurance landscape, parses the bundled
 * exchange XML with the same importer a user's file goes through. Nothing is
 * injected into the store.
 */
export async function loadDemo(page: Page): Promise<void> {
  await openApp(page)
  await page.getByRole('button', { name: 'Explore the demo' }).click()
  await page.getByRole('button', { name: /Insurance landscape/ }).click()
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible()
  await expect(inventoryResult(page)).toContainText(`of ${DEMO.elements} elements`)
}

/** Start from the first-run screen with an empty workspace. */
export async function startEmpty(page: Page): Promise<void> {
  await openApp(page)
  await page.getByRole('button', { name: 'Start empty' }).click()
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible()
}

/** Open an element's fact sheet from the inventory table. */
export async function openElement(page: Page, name: string): Promise<void> {
  await inventoryRow(page, name).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

/**
 * Press SAVE FILE, keep the download at `target`, and return what was written.
 *
 * With the File System Access API hidden (see the `page` fixture) this is the
 * download path: an anchor with a blob URL, which Playwright intercepts.
 */
export async function saveWorkspaceFile(page: Page, target: string): Promise<string> {
  const started = page.waitForEvent('download')
  await page.getByRole('button', { name: 'SAVE FILE' }).click()
  const download = await started
  await download.saveAs(target)
  return readFile(target, 'utf8')
}

/** Import a file through the header's Import dialog, as a user would. */
export async function importWorkspaceFile(page: Page, source: string): Promise<void> {
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import' })
  await expect(dialog).toBeVisible()

  const chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Choose a file…' }).click()
  await (await chooser).setFiles(source)
}

/**
 * Import a file with nothing to report, whose dialog closes on its own. Archi's
 * fixtures are such files since #95 kept the model's purpose. Presence first:
 * the counts say the model landed, and only then does the closed dialog say
 * there was nothing to report.
 */
export async function importWithNothingToReport(
  page: Page,
  source: string,
  counts: { elements: number; relationships: number },
): Promise<void> {
  await importWorkspaceFile(page, source)
  await expect(modelCounts(page)).toContainText(
    `${counts.elements} elements · ${counts.relationships} relations`,
  )
  await expect(page.getByRole('dialog', { name: 'Import' })).toBeHidden()
}

// ── Browser storage ──────────────────────────────────────────────────────────

/**
 * Wait until autosave has written the workspace to IndexedDB.
 *
 * Autosave is debounced (800ms) and runs in an idle callback, so a reload issued
 * straight after an edit can beat it. Anything that asserts on what survives a
 * reload waits on this first.
 */
export async function waitForPersistedWorkspace(page: Page, elementCount: number): Promise<void> {
  await expect
    .poll(() => persistedElementCount(page), {
      message: `IndexedDB never received a workspace with ${elementCount} elements`,
      timeout: 15_000,
    })
    .toBe(elementCount)
}

/** Largest element count among the workspaces in IndexedDB; -1 if there are none. */
function persistedElementCount(page: Page): Promise<number> {
  return page.evaluate(async (dbName) => {
    // Opening a database that does not exist would *create* an empty one at
    // version 1, and the app's own openDB would then never run its upgrade.
    const databases = await indexedDB.databases()
    if (!databases.some((entry) => entry.name === dbName)) return -1

    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open(dbName)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('workspaces')) {
          db.close()
          resolve(-1)
          return
        }
        const all = db.transaction('workspaces', 'readonly').objectStore('workspaces').getAll()
        all.onerror = () => {
          db.close()
          reject(all.error)
        }
        all.onsuccess = () => {
          const counts = (all.result as { elementCount: number }[]).map((row) => row.elementCount)
          db.close()
          resolve(counts.length > 0 ? Math.max(...counts) : -1)
        }
      }
    })
  }, DB_NAME)
}

/**
 * Put the browser back to a cold start: no workspaces, no theme preference.
 * Between tests this is unnecessary — every test gets a fresh context.
 */
export async function clearBrowserState(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const entry of await indexedDB.databases()) {
      const name = entry.name
      if (!name) continue
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = () => resolve()
        request.onerror = () => resolve()
        request.onblocked = () => resolve()
      })
    }
    localStorage.clear()
  })
}

/** `hasText` matches substrings; this pins it to the whole label. */
function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

/**
 * The facets a URL is carrying, decoded.
 *
 * Each facet is percent-encoded before the join, so a label containing the
 * separator cannot split into two on the way back (#26). Tests assert the
 * facets, not the escaped spelling — the encoding is an implementation detail
 * and pinning it makes every future escaping fix look like a regression.
 */
export function facetsIn(url: string): string[] {
  const raw = new URL(url).searchParams.get('facets')
  if (!raw) return []
  return raw.split(',').map(decodeURIComponent)
}
