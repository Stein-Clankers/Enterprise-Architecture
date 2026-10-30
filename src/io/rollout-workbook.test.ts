import { describe, expect, it } from 'vitest'
import {
  dayStart,
  resolveSiteMilestones,
  rolloutPlanOf,
  siteStatus,
  wavePlanOf,
  type Element,
  type View,
  type Workspace,
} from '@/model'
import { fixtureBytes } from '@/test/fixture-bytes'
import { ROLLOUT_ID, rolloutWorkspace, siteId, waveId } from '@/test/rollout-fixture'
import { ModelStore, ReadOnlyModelError } from '@/store/model-store'
import { applyRolloutImport } from '@/store/rollout-workbook'
import { toCanonicalJson } from './canonical-json'
import { readXlsx } from './xlsx-read'
import { writeXlsx } from './xlsx-write'
import {
  booleanCell,
  cellReference,
  dateCell,
  EMPTY,
  numberCell,
  textCell,
  type ReadCell,
  type Sheet,
  type Workbook,
} from './xlsx'
import {
  exportRolloutWorkbook,
  planRolloutImport,
  rolloutWorkbookFileName,
  SITE_CODE_KEY,
  type NewId,
  type RolloutImportPlan,
  type Tally,
} from './rollout-workbook'

/**
 * The rollout workbook (#210). Every import here goes through a real `.xlsx`:
 * exported, written, read, edited as Excel would hold the edit, and planned.
 * The fixture is #209's data-migration rollout at 24 sites, so every kind of
 * site plan is in it (see `rollout-fixture.ts`).
 */

const SITE_COUNT = 24
const FILE = 'rollout.xlsx'

function workspace(): Workspace {
  return rolloutWorkspace(SITE_COUNT)
}

/** Deterministic ids for what an import creates. */
function counter(): NewId {
  let n = 0
  return (prefix) => `${prefix}-new-${++n}`
}

function exported(model: Workspace = workspace()): Workbook {
  return exportRolloutWorkbook(model, ROLLOUT_ID)!.workbook
}

/** The workbook through a real file: written, then read back. */
async function throughFile(workbook: Workbook): Promise<Workbook<ReadCell>> {
  const read = await readXlsx(writeXlsx(workbook), FILE)
  expect(read.problems).toEqual([])
  return read.workbook!
}

async function exportedFile(model: Workspace = workspace()): Promise<Workbook<ReadCell>> {
  return throughFile(exported(model))
}

function sheetOf<C>(workbook: Workbook<C>, name: string): Sheet<C> {
  const sheet = workbook.sheets.find((candidate) => candidate.name === name)
  if (!sheet) throw new Error(`no sheet ${name}`)
  return sheet
}

function columnOf(sheet: Sheet<ReadCell>, key: string): number {
  const column = (sheet.rows[0] ?? []).findIndex(
    (cell) => cell.kind === 'string' && cell.value === key,
  )
  if (column < 0) throw new Error(`no column ${key} in ${sheet.name}`)
  return column
}

/** The 0-based row whose first column holds `id`. */
function rowOf(sheet: Sheet<ReadCell>, id: string): number {
  const row = sheet.rows.findIndex((cells, index) => {
    const first = cells[0]
    return index >= 2 && first?.kind === 'string' && first.value === id
  })
  if (row < 0) throw new Error(`no row ${id} in ${sheet.name}`)
  return row
}

/** Set one cell, as typing it in Excel would; returns its 1-based row and A1 reference. */
function set(
  workbook: Workbook<ReadCell>,
  name: string,
  id: string,
  key: string,
  cell: ReadCell,
): { row: number; cell: string } {
  const sheet = sheetOf(workbook, name)
  const row = rowOf(sheet, id)
  const column = columnOf(sheet, key)
  const cells = sheet.rows[row]!
  while (cells.length <= column) cells.push(EMPTY)
  cells[column] = cell
  return { row: row + 1, cell: cellReference(row, column) }
}

/** Delete a whole column, as Excel does. */
function dropColumn(workbook: Workbook<ReadCell>, name: string, key: string): void {
  const sheet = sheetOf(workbook, name)
  const column = columnOf(sheet, key)
  for (const row of sheet.rows) row.splice(column, 1)
}

/** Append a row; returns its 1-based number. */
function addRow(
  workbook: Workbook<ReadCell>,
  name: string,
  cells: Record<string, ReadCell>,
): number {
  const sheet = sheetOf(workbook, name)
  const row: ReadCell[] = []
  for (const [key, cell] of Object.entries(cells)) {
    const column = columnOf(sheet, key)
    while (row.length <= column) row.push(EMPTY)
    row[column] = cell
  }
  sheet.rows.push(row)
  return sheet.rows.length
}

function plan(model: Workspace, workbook: Workbook<ReadCell>): RolloutImportPlan {
  return planRolloutImport(model, ROLLOUT_ID, workbook, counter(), FILE)
}

/** Plan on the store's own snapshot and commit, as the dialog does. */
function commit(model: Workspace, workbook: Workbook<ReadCell>) {
  const store = new ModelStore(model)
  const before = store.snapshot()
  const dryRun = planRolloutImport(before, ROLLOUT_ID, workbook, counter(), FILE)
  const result = applyRolloutImport(store, dryRun)
  return { store, before, dryRun, result, after: store.snapshot() }
}

const element = (model: Workspace, id: string) => model.elements.find((e) => e.id === id)!
const sitePlan = (model: Workspace, location: string) =>
  rolloutPlanOf(element(model, ROLLOUT_ID))!.sites.find((site) => site.location === location)
const wavePlan = (model: Workspace, id: string) => wavePlanOf(element(model, id))!

const NONE: Tally = { created: 0, updated: 0, deleted: 0, unchanged: 0 }
const tallied = (rows: Partial<Tally>): Tally => ({ ...NONE, ...rows })

/** A problem naming its sheet, row and column, and the cell they meet in. */
function at(code: string, sheet: string, row: number, column: string, cell: string) {
  return expect.objectContaining({
    code,
    sheet,
    row,
    column,
    cell,
    file: FILE,
    message: expect.stringContaining(`Sheet “${sheet}”, row ${row}, column ${column} (${cell})`),
  })
}

/** What removing site 5 says of the fixture's site 6, which depends on it (#214). */
const DROPPED_5_FROM_6 = {
  severity: 'info',
  code: 'rollout-workbook.dependency-dropped',
  file: FILE,
  sheet: 'Sites',
  subject: siteId(6),
  message: `Sheet “Sites”: the Sites sheet takes "${siteId(5)}" out of the rollout, so "${siteId(6)}" no longer depends on it.`,
}

/** What removing site `n` says of each of its exceptions, which leave with it (#214). */
const exceptionsDropped = (n: number, ...ids: string[]) =>
  ids.map((id) => ({
    severity: 'info',
    code: 'rollout-workbook.exception-dropped',
    file: FILE,
    sheet: 'Sites',
    subject: siteId(n),
    message: `Sheet “Sites”: the Sites sheet takes "${siteId(n)}" out of the rollout, and its exception "${id}" with it.`,
  }))

/** Site 3's three exceptions, by id. */
const DROPPED_OF_3 = exceptionsDropped(3, 'ex-003-add', 'ex-003-modify', 'ex-003-skip')

/** Every path whose value differs, elements and relationships keyed by id. */
function changedPaths(before: Workspace, after: Workspace): string[] {
  const keyed = (model: Workspace) => ({
    elements: Object.fromEntries(model.elements.map((e) => [e.id, e])),
    relationships: Object.fromEntries(model.relationships.map((r) => [r.id, r])),
    views: Object.fromEntries(model.views.map((v) => [v.id, v])),
  })
  const paths: string[] = []
  const walk = (a: unknown, b: unknown, path: string) => {
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const key of [...keys].sort())
        walk(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        )
    } else if (a !== b) paths.push(path)
  }
  walk(keyed(before), keyed(after), '')
  return paths
}

/**
 * The tallies an applied import shows in the model, worked out from the model
 * alone: the oracle the preview's counts are held to.
 */
function appliedTallies(before: Workspace, after: Workspace) {
  const sites = (model: Workspace) =>
    new Map(rolloutPlanOf(element(model, ROLLOUT_ID))!.sites.map((s) => [s.location, s]))
  const [was, is] = [sites(before), sites(after)]
  const touches = (model: Workspace, location: string) =>
    model.relationships.filter((r) => r.target === location && r.type === 'Aggregation')
  const json = (value: unknown) => JSON.stringify(value)
  let created = 0
  let updated = 0
  for (const location of is.keys()) {
    const old = before.elements.find((e) => e.id === location)
    if (!old) created++
    else if (
      !was.has(location) ||
      json(old) !== json(element(after, location)) ||
      json(touches(before, location)) !== json(touches(after, location))
    )
      updated++
  }
  const deleted = [...was.keys()].filter((location) => !is.has(location)).length
  const waves = after.elements.filter(
    (e) => wavePlanOf(e) && json(e) !== json(element(before, e.id)),
  ).length
  const sitePlans = [...is].filter(
    ([location, site]) => was.has(location) && json(site) !== json(was.get(location)),
  ).length
  return { sites: { created, updated, deleted }, waves, sitePlans }
}

function countsOf(dryRun: RolloutImportPlan) {
  const { sites, waves, sitePlans } = dryRun.tallies
  return {
    sites: { created: sites.created, updated: sites.updated, deleted: sites.deleted },
    waves: waves.updated,
    sitePlans: sitePlans.updated,
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

describe('the exported workbook (#210)', () => {
  it('holds Sites, Waves, SitePlan, Exceptions, Dependencies, Milestones and Template, technical keys in row 1 and labels in row 2', () => {
    const workbook = exported()
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
      'Sites',
      'Waves',
      'SitePlan',
      'Exceptions',
      'Dependencies',
      'Milestones',
      'Template',
    ])
    const keys = (name: string) =>
      sheetOf(workbook, name).rows[0]!.map((cell) => (cell as { value: string }).value)
    expect(keys('Sites')).toEqual(['id', 'name', 'parent', SITE_CODE_KEY, 'action'])
    expect(keys('Waves')).toEqual([
      'id',
      'label',
      'order',
      'windowStart',
      'windowEnd',
      'capacity',
      'templateVersion',
      'milestone.mappingSignedOff',
      'milestone.constructor',
      'milestone.freezeStart',
      'milestone.reconciliationSignedOff',
      'milestone.hypercareEnd',
      'milestone.legacyDecommissioned',
    ])
    expect(keys('Milestones')).toEqual(['id', 'label', 'startsPhase', 'date'])
    expect(keys('SitePlan')).toEqual([
      'location',
      'name',
      'wave',
      'archetype',
      'rag',
      'goNoGo',
      'milestone.mappingSignedOff',
      'actual.mappingSignedOff',
      'milestone.constructor',
      'actual.constructor',
      'milestone.freezeStart',
      'actual.freezeStart',
      'milestone.reconciliationSignedOff',
      'actual.reconciliationSignedOff',
      'milestone.hypercareEnd',
      'actual.hypercareEnd',
      'milestone.legacyDecommissioned',
      'actual.legacyDecommissioned',
    ])
    // Each date column says whose date it is: a site's own, or one its sites
    // inherit; and each actual column that it is the day it happened (#215).
    expect(sheetOf(workbook, 'SitePlan').rows[1]!.slice(10, 12)).toEqual([
      textCell('Freeze starts (set at the site; blank: inherit)'),
      textCell('Freeze starts: actual day (2027-05-12; blank: not reached)'),
    ])
    expect(sheetOf(workbook, 'Waves').rows[1]![9]).toEqual(
      textCell('Freeze starts (its sites inherit this)'),
    )
    expect(sheetOf(workbook, 'Sites').rows[1]![3]).toEqual(textCell('Code'))
  })

  it('writes a site, a wave and a site plan as the model holds them', () => {
    const workbook = exported()
    const sites = sheetOf(workbook, 'Sites')
    expect(sites.rows[2]).toEqual([
      textCell(siteId(1)),
      textCell('Site 001'),
      textCell('loc-emea'),
      textCell('001'),
      EMPTY,
    ])
    expect(sheetOf(workbook, 'Waves').rows.slice(2, 4)).toEqual([
      [
        textCell(waveId(0)),
        textCell('Pilot'),
        numberCell(0),
        textCell('2027-01'),
        textCell('2027-03'),
        numberCell(5),
        numberCell(1),
        textCell('2027-01-11'),
        textCell('2027-02-01'),
        textCell('2027-02-22'),
        textCell('2027-03-01'),
        textCell('2027-03-29'),
        EMPTY,
      ],
      [
        textCell(waveId(1)),
        textCell('W1'),
        numberCell(1),
        textCell('2027-04'),
        textCell('2027-06'),
        EMPTY,
        numberCell(2),
        textCell('2027-04-05'),
        textCell('2027-04-19'),
        textCell('2027-05-17'),
        textCell('2027-05-24'),
        textCell('2027-06-21'),
        EMPTY,
      ],
    ])
    // The milestone set, read-only, with the rollout's own date for the last one.
    expect(sheetOf(workbook, 'Milestones').rows.at(-1)).toEqual([
      textCell('legacyDecommissioned'),
      textCell('Legacy decommissioned'),
      textCell('done'),
      textCell('2028-Q4'),
    ])
    // Site 12: a wave, no archetype, no RAG, a month, a week and a day
    // override, and no actual day.
    expect(sheetOf(workbook, 'SitePlan').rows[2 + 11]).toEqual([
      textCell(siteId(12)),
      textCell('Site 012'),
      textCell(waveId(1)),
      EMPTY,
      EMPTY,
      EMPTY,
      textCell('2027-03'),
      EMPTY,
      EMPTY,
      EMPTY,
      textCell('2027-W19'),
      EMPTY,
      EMPTY,
      EMPTY,
      textCell('2027-07-13'),
      EMPTY,
      EMPTY,
      EMPTY,
    ])
    expect(sheetOf(workbook, 'SitePlan').rows[2 + 9]!.slice(3, 5)).toEqual([
      textCell('plant'),
      textCell('amber'),
    ])
    // Site 1: actual days, `constructor`'s among them, as text in their own
    // columns beside the planned ones; and its go/no-go decision (#215).
    const site1 = sheetOf(workbook, 'SitePlan').rows[2]!
    expect(site1.slice(5, 11)).toEqual([
      textCell('go'),
      EMPTY,
      textCell('2027-02-12'),
      EMPTY,
      textCell('2027-02-15'),
      EMPTY,
    ])
    expect(site1[11]).toEqual(textCell('2027-03-02'))
  })

  it('writes waves in their order, even when the model lists them the other way round', () => {
    const model = workspace()
    model.elements.reverse()
    const ids = sheetOf(exported(model), 'Waves')
      .rows.slice(2)
      .map((row) => (row[0] as { value: string }).value)
    expect(ids).toEqual([0, 1, 2, 3, 4].map(waveId))
  })

  it('lists every site field the sites have, the code first, then by key', () => {
    const model = workspace()
    Object.assign(element(model, siteId(2)).properties, {
      'archipelago.site.volume': 1200,
      'archipelago.site.active': true,
      owner: 'not a site field',
    })
    const sites = sheetOf(exported(model), 'Sites')
    expect(sites.rows[0]!.map((cell) => (cell as { value: string }).value)).toEqual([
      'id',
      'name',
      'parent',
      SITE_CODE_KEY,
      'archipelago.site.active',
      'archipelago.site.volume',
      'action',
    ])
    expect(sites.rows[3]!.slice(4, 6)).toEqual([booleanCell(true), numberCell(1200)])
  })

  it('writes the template for reference, archetype lists as JSON', () => {
    const template = sheetOf(exported(), 'Template')
    expect(template.rows).toHaveLength(2 + 7)
    expect(template.rows[2]).toEqual([
      textCell('tc-replace-store'),
      textCell('replace'),
      textCell('sys-local-store'),
      textCell('sys-central-store'),
      EMPTY,
      EMPTY,
      EMPTY,
      textCell('freezeStart'),
      numberCell(0),
      textCell('aggregating'),
      textCell('sys-local-store'),
      EMPTY,
    ])
    expect(template.rows[8]![11]).toEqual(textCell('["office","plant"]'))
    expect(template.rows[6]![5]).toEqual(numberCell(4))
    expect(template.rows[5]![5]).toEqual(textCell('Eliminate'))
  })

  it('says what it cannot carry: a second parent region, notes and site blackouts', () => {
    const model = workspace()
    model.elements.push({ id: 'loc-dach', type: 'Location', name: 'DACH', properties: {} })
    model.relationships.push({
      id: 'rel-dach-003',
      type: 'Aggregation',
      source: 'loc-dach',
      target: siteId(3),
      properties: {},
    })
    const { workbook, problems } = exportRolloutWorkbook(model, ROLLOUT_ID)!
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'rollout-workbook.parents-not-carried',
        subject: siteId(3),
        severity: 'info',
      }),
      expect.objectContaining({
        code: 'rollout-workbook.not-carried',
        message: expect.stringContaining('3 sites have notes or blackouts of their own'),
      }),
    ])
    // The first by id, so the same model always shows the same one.
    expect(sheetOf(workbook, 'Sites').rows[4]![2]).toEqual(textCell('loc-dach'))
  })

  it('is no workbook for an id that is no rollout', () => {
    expect(exportRolloutWorkbook(workspace(), waveId(0))).toBeUndefined()
  })

  it('writes the same bytes for the same model', () => {
    expect(writeXlsx(exported())).toEqual(writeXlsx(exported()))
  })

  it('names its file after the rollout', () => {
    expect(rolloutWorkbookFileName('Local data to the central lake')).toBe(
      'local-data-to-the-central-lake-workbook.xlsx',
    )
    expect(rolloutWorkbookFileName('Überall')).toBe('berall-workbook.xlsx')
    expect(rolloutWorkbookFileName('???')).toBe('rollout-workbook.xlsx')
  })
})

// ── Import: the acceptance of #210 ───────────────────────────────────────────

describe('export, edit, import (#210 acceptance)', () => {
  it('an unedited workbook changes nothing and records no command', async () => {
    const { dryRun, result, store, before, after } = commit(workspace(), await exportedFile())
    expect(dryRun.problems).toEqual([])
    expect(dryRun.tallies).toEqual({
      sites: tallied({ unchanged: SITE_COUNT }),
      waves: tallied({ unchanged: 5 }),
      sitePlans: tallied({ unchanged: SITE_COUNT }),
      exceptions: tallied({ unchanged: 4 }),
      dependencies: tallied({ unchanged: 2 }),
    })
    expect(result).toBe('unchanged')
    expect(store.canUndo).toBe(false)
    expect(toCanonicalJson(after)).toBe(toCanonicalJson(before))
  })

  it('three cells edited change those three values only, and the preview counts what the commit applies', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Sites', siteId(5), 'name', textCell('Site 005, Linz'))
    set(workbook, 'Waves', waveId(2), 'capacity', numberCell(30))
    set(workbook, 'SitePlan', siteId(8), 'milestone.freezeStart', textCell('2027-Q3'))

    const { dryRun, result, store, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(dryRun.tallies).toEqual({
      sites: tallied({ updated: 1, unchanged: SITE_COUNT - 1 }),
      waves: tallied({ updated: 1, unchanged: 4 }),
      sitePlans: tallied({ updated: 1, unchanged: SITE_COUNT - 1 }),
      exceptions: tallied({ unchanged: 4 }),
      dependencies: tallied({ unchanged: 2 }),
    })
    expect(result).toBe('applied')

    expect(changedPaths(before, after)).toEqual([
      `elements.${siteId(5)}.name`,
      `elements.${ROLLOUT_ID}.plan.sites.7.milestones.freezeStart.date`,
      `elements.${ROLLOUT_ID}.plan.sites.7.milestones.freezeStart.precision`,
      `elements.${waveId(2)}.plan.capacity`,
    ])
    expect(element(after, siteId(5)).name).toBe('Site 005, Linz')
    expect(wavePlan(after, waveId(2)).capacity).toBe(30)
    expect(sitePlan(after, siteId(8))!.milestones!.freezeStart).toEqual({
      date: '2027-07-01',
      precision: 'quarter',
    })
    expect(appliedTallies(before, after)).toEqual(countsOf(dryRun))

    // One undo step takes the whole import back.
    expect(store.history).toHaveLength(1)
    store.undo()
    expect(toCanonicalJson(store.snapshot())).toBe(toCanonicalJson(before))
    expect(store.canUndo).toBe(false)
  })

  it('creating, removing and re-parenting sites count as the commit applies them', async () => {
    const workbook = await exportedFile()
    addRow(workbook, 'Sites', {
      name: textCell('Site 900'),
      parent: textCell('loc-emea'),
      [SITE_CODE_KEY]: textCell('900'),
    })
    set(workbook, 'Sites', siteId(3), 'action', textCell('remove'))
    set(workbook, 'Sites', siteId(4), 'parent', EMPTY)
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual(DROPPED_OF_3)
    expect(dryRun.tallies.exceptions).toEqual(tallied({ deleted: 3, unchanged: 1 }))
    expect(dryRun.tallies.sites).toEqual(
      tallied({ created: 1, updated: 1, deleted: 1, unchanged: SITE_COUNT - 2 }),
    )
    expect(appliedTallies(before, after)).toEqual(countsOf(dryRun))
  })
})

describe('a blank cell deletes the value (#94)', () => {
  it.each([
    ['SitePlan', siteId(10), 'rag', (m: Workspace) => sitePlan(m, siteId(10))!.rag, 'amber'],
    ['SitePlan', siteId(1), 'wave', (m: Workspace) => sitePlan(m, siteId(1))!.wave, waveId(0)],
    [
      'SitePlan',
      siteId(1),
      'archetype',
      (m: Workspace) => sitePlan(m, siteId(1))!.archetype,
      'office',
    ],
    [
      'SitePlan',
      siteId(8),
      'milestone.freezeStart',
      (m: Workspace) => sitePlan(m, siteId(8))!.milestones,
      {
        freezeStart: { date: '2027-05-10', precision: 'week' },
        constructor: { date: '2027-04-01', precision: 'month' },
      },
      // A blank deletes that date and no other: the `constructor` date stays.
      { constructor: { date: '2027-04-01', precision: 'month' } },
    ],
    [
      'Sites',
      siteId(2),
      SITE_CODE_KEY,
      (m: Workspace) => element(m, siteId(2)).properties[SITE_CODE_KEY],
      '002',
    ],
    [
      'Sites',
      siteId(2),
      'parent',
      (m: Workspace) =>
        m.relationships.filter((r) => r.target === siteId(2)).map((r) => r.source)[0],
      'loc-emea',
    ],
    ['Waves', waveId(0), 'capacity', (m: Workspace) => wavePlan(m, waveId(0)).capacity, 5],
    [
      'Waves',
      waveId(1),
      'windowEnd',
      (m: Workspace) => wavePlan(m, waveId(1)).window,
      {
        start: { date: '2027-04-01', precision: 'month' },
        end: { date: '2027-06-01', precision: 'month' },
      },
      { start: { date: '2027-04-01', precision: 'month' } },
    ],
  ])('%s %s %s', async (sheet, id, key, read, was, now: unknown = undefined) => {
    const workbook = await exportedFile()
    set(workbook, sheet, id, key, EMPTY)
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(read(before)).toEqual(was)
    expect(read(after)).toEqual(now)
    expect(appliedTallies(before, after)).toEqual(countsOf(dryRun))
  })

  it('a blank window start and end take the window away; a blank label is an empty one', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Waves', waveId(1), 'windowStart', EMPTY)
    set(workbook, 'Waves', waveId(1), 'windowEnd', EMPTY)
    set(workbook, 'Waves', waveId(1), 'label', EMPTY)
    set(workbook, 'Sites', siteId(1), 'name', EMPTY)
    const { after } = commit(workspace(), workbook)
    expect(wavePlan(after, waveId(1))).not.toHaveProperty('window')
    expect(wavePlan(after, waveId(1)).label).toBe('')
    expect(element(after, siteId(1)).name).toBe('')
  })

  it('the last milestone override blanked leaves no milestones record', async () => {
    const workbook = await exportedFile()
    for (const key of ['milestone.mappingSignedOff', 'milestone.hypercareEnd'])
      set(workbook, 'SitePlan', siteId(6), key, EMPTY)
    const { after } = commit(workspace(), workbook)
    expect(sitePlan(after, siteId(6))).not.toHaveProperty('milestones')
  })
})

describe('a missing column leaves its values untouched (#94)', () => {
  it.each([
    ['SitePlan', 'rag'],
    ['SitePlan', 'wave'],
    ['SitePlan', 'archetype'],
    ['SitePlan', 'milestone.freezeStart'],
    ['SitePlan', 'name'],
    ['Sites', 'name'],
    ['Sites', SITE_CODE_KEY],
    ['Sites', 'parent'],
    ['Sites', 'action'],
    ['Waves', 'label'],
    ['Waves', 'order'],
    ['Waves', 'capacity'],
    ['Waves', 'windowStart'],
    ['Waves', 'templateVersion'],
  ])('%s without %s', async (sheet, key) => {
    const workbook = await exportedFile()
    // Blank the whole column first, which would delete every value…
    const target = sheetOf(workbook, sheet)
    const column = columnOf(target, key)
    for (const row of target.rows.slice(2)) if (row.length > column) row[column] = EMPTY
    // …then take the column away, which must leave every value as it was.
    dropColumn(workbook, sheet, key)
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(changedPaths(before, after)).toEqual([])
  })

  it('a sheet the workbook does not hold leaves its values untouched, and says so', async () => {
    const workbook = await exportedFile()
    workbook.sheets = workbook.sheets.filter((sheet) => sheet.name !== 'SitePlan')
    set(workbook, 'Waves', waveId(3), 'label', textCell('Summer'))
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      expect.objectContaining({
        code: 'rollout-workbook.sheet-missing',
        sheet: 'SitePlan',
        severity: 'info',
      }),
    ])
    expect(changedPaths(before, after)).toEqual([`elements.${waveId(3)}.plan.label`])
  })
})

// ── Import: what cannot be applied ───────────────────────────────────────────

describe('every value that cannot be applied is a problem naming its sheet, row and column', () => {
  it('an unknown wave id in the site plan; the site keeps its wave', async () => {
    const workbook = await exportedFile()
    const where = set(workbook, 'SitePlan', siteId(4), 'wave', textCell('wp-wave-99'))
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.wave-unknown', 'SitePlan', where.row, 'wave', where.cell),
    ])
    expect(dryRun.tallies.sitePlans).toEqual(tallied({ unchanged: SITE_COUNT }))
    expect(dryRun.changes.updateElements).toEqual([])
  })

  it('a wave of another rollout is no wave of this one', async () => {
    const model = workspace()
    model.elements.push({
      id: 'wp-other-wave',
      type: 'WorkPackage',
      name: 'Other',
      properties: {},
      plan: { kind: 'wave', rollout: 'wp-other', label: 'O', order: 1, templateVersion: 1 },
    })
    const workbook = await exportedFile(model)
    const where = set(workbook, 'SitePlan', siteId(4), 'wave', textCell('wp-other-wave'))
    expect(plan(model, workbook).problems).toEqual([
      at('rollout-workbook.wave-unknown', 'SitePlan', where.row, 'wave', where.cell),
    ])
  })

  it('an unknown wave id in the Waves sheet, and a wave of another rollout', async () => {
    const model = workspace()
    model.elements.push({
      id: 'wp-other-wave',
      type: 'WorkPackage',
      name: 'Other',
      properties: {},
      plan: { kind: 'wave', rollout: 'wp-other', label: 'O', order: 1, templateVersion: 1 },
    })
    const workbook = await exportedFile(model)
    const row = addRow(workbook, 'Waves', { id: textCell('wp-wave-99'), label: textCell('W99') })
    const other = addRow(workbook, 'Waves', {
      id: textCell('wp-other-wave'),
      label: textCell('Mine now'),
    })
    const dryRun = plan(model, workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.wave-unknown', 'Waves', row, 'id', `A${row}`),
      at('rollout-workbook.wave-unknown', 'Waves', other, 'id', `A${other}`),
    ])
    expect(dryRun.tallies.waves).toEqual(tallied({ unchanged: 5 }))
    expect(dryRun.changes.updateElements).toEqual([])
  })

  it('a wave row with no id: waves are created in the app', async () => {
    const workbook = await exportedFile()
    const row = addRow(workbook, 'Waves', { label: textCell('W9'), order: numberCell(9) })
    expect(plan(workspace(), workbook).problems).toEqual([
      at('rollout-workbook.wave-id-missing', 'Waves', row, 'id', `A${row}`),
    ])
  })

  it('a site id that is not in the model, in Sites', async () => {
    const workbook = await exportedFile()
    const row = addRow(workbook, 'Sites', {
      id: textCell('loc-nowhere'),
      name: textCell('Nowhere'),
    })
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.site-unknown', 'Sites', row, 'id', `A${row}`),
    ])
    expect(dryRun.changes).toEqual({
      addElements: [],
      updateElements: [],
      addRelationships: [],
      removeRelationships: [],
    })
  })

  it('an id in Sites that is not a Location', async () => {
    const workbook = await exportedFile()
    const row = addRow(workbook, 'Sites', { id: textCell(waveId(0)) })
    expect(plan(workspace(), workbook).problems).toEqual([
      at('rollout-workbook.site-not-location', 'Sites', row, 'id', `A${row}`),
    ])
  })

  it('a site id in SitePlan that is not a site of the rollout, nor in the model', async () => {
    const workbook = await exportedFile()
    const row = addRow(workbook, 'SitePlan', {
      location: textCell('loc-emea'),
      wave: textCell(waveId(1)),
    })
    const unknown = addRow(workbook, 'SitePlan', { location: textCell('loc-nowhere') })
    expect(plan(workspace(), workbook).problems).toEqual([
      at('rollout-workbook.site-unknown', 'SitePlan', row, 'location', `A${row}`),
      at('rollout-workbook.site-unknown', 'SitePlan', unknown, 'location', `A${unknown}`),
    ])
  })

  it('a site plan row with no site id', async () => {
    const workbook = await exportedFile()
    const row = addRow(workbook, 'SitePlan', { wave: textCell(waveId(1)) })
    expect(plan(workspace(), workbook).problems).toEqual([
      at('rollout-workbook.site-id-missing', 'SitePlan', row, 'location', `A${row}`),
    ])
  })

  it.each([
    ['Sites', siteId(2), 'id'],
    ['SitePlan', siteId(2), 'location'],
    ['Waves', waveId(2), 'id'],
  ])(
    'a duplicate id in %s: the first row is read and counted, the second is not',
    async (sheet, id, key) => {
      const workbook = await exportedFile()
      const target = sheetOf(workbook, sheet)
      const copy = target.rows[rowOf(target, id)]!.map((cell) => cell)
      // The copy holds an edit, which a tally taken at read time would count.
      const nameKey = sheet === 'Waves' ? 'label' : sheet === 'Sites' ? 'name' : 'rag'
      copy[columnOf(target, nameKey)] = textCell(sheet === 'SitePlan' ? 'red' : 'Edited')
      target.rows.push(copy)
      const row = target.rows.length
      const dryRun = plan(workspace(), workbook)
      expect(dryRun.problems).toEqual([
        at('rollout-workbook.duplicate-id', sheet, row, key, `A${row}`),
      ])
      expect(dryRun.problems[0]!.message).toContain(`row ${rowOf(target, id) + 1}`)
      const counted = sheet === 'Sites' ? 'sites' : sheet === 'Waves' ? 'waves' : 'sitePlans'
      expect(dryRun.tallies[counted]).toEqual(
        tallied({ unchanged: sheet === 'Waves' ? 5 : SITE_COUNT }),
      )
      expect(dryRun.changes.updateElements).toEqual([])
    },
  )

  it.each([
    ['a month that is none', textCell('2027-13')],
    ['week 53 of a year with 52', textCell('2027-W53')],
    ['a day that is none', textCell('2027-02-30')],
    ['a quarter written another way', textCell('Q2 2027')],
    ['a date with spaces around it', textCell(' 2027-05')],
    ['a number', numberCell(46519)],
    ['TRUE', booleanCell(true)],
  ])('an unparseable planned date in SitePlan: %s', async (_, cell) => {
    const workbook = await exportedFile()
    const where = set(workbook, 'SitePlan', siteId(8), 'milestone.freezeStart', cell)
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at(
        'rollout-workbook.date-unreadable',
        'SitePlan',
        where.row,
        'milestone.freezeStart',
        where.cell,
      ),
    ])
    expect(dryRun.changes.updateElements).toEqual([])
  })

  it('an unparseable window date in Waves', async () => {
    const workbook = await exportedFile()
    const where = set(workbook, 'Waves', waveId(1), 'windowStart', textCell('next spring'))
    expect(plan(workspace(), workbook).problems).toEqual([
      at('rollout-workbook.date-unreadable', 'Waves', where.row, 'windowStart', where.cell),
    ])
  })

  it.each([
    ['archetype', textCell('warehouse'), 'rollout-workbook.archetype-unknown'],
    ['rag', textCell('Green'), 'rollout-workbook.rag-unknown'],
    ['wave', numberCell(3), 'rollout-workbook.not-text'],
  ])('a %s the rollout does not know', async (key, cell, code) => {
    const workbook = await exportedFile()
    const where = set(workbook, 'SitePlan', siteId(5), key, cell)
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([at(code, 'SitePlan', where.row, key, where.cell)])
    expect(dryRun.changes.updateElements).toEqual([])
  })

  it.each([
    ['order', textCell('first'), 'rollout-workbook.number-refused'],
    ['order', numberCell(1.5), 'rollout-workbook.number-refused'],
    ['capacity', numberCell(0), 'rollout-workbook.number-refused'],
    ['templateVersion', numberCell(-1), 'rollout-workbook.number-refused'],
    ['order', EMPTY, 'rollout-workbook.value-required'],
    ['templateVersion', EMPTY, 'rollout-workbook.value-required'],
  ])('a wave %s that cannot be one', async (key, cell, code) => {
    const workbook = await exportedFile()
    const where = set(workbook, 'Waves', waveId(1), key, cell)
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([at(code, 'Waves', where.row, key, where.cell)])
    expect(dryRun.changes.updateElements).toEqual([])
  })

  it.each([
    ['an unknown element', textCell('loc-nowhere'), 'rollout-workbook.parent-unknown'],
    ['an element that is no Location', textCell(waveId(0)), 'rollout-workbook.parent-unknown'],
    ['the site itself', textCell(siteId(5)), 'rollout-workbook.parent-self'],
  ])('a parent region that is %s', async (_, cell, code) => {
    const workbook = await exportedFile()
    const where = set(workbook, 'Sites', siteId(5), 'parent', cell)
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([at(code, 'Sites', where.row, 'parent', where.cell)])
    expect(dryRun.changes.removeRelationships).toEqual([])
    expect(dryRun.changes.addRelationships).toEqual([])
  })

  it.each([
    ['an action that is none', textCell('delete')],
    ['an action that is no text', numberCell(1)],
    ['an action that could not be read', { kind: 'unreadable', text: '#N/A' } as ReadCell],
  ])('%s: the row is not read', async (_, cell) => {
    const workbook = await exportedFile()
    set(workbook, 'Sites', siteId(5), 'name', textCell('Renamed'))
    const where = set(workbook, 'Sites', siteId(5), 'action', cell)
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.action-unknown', 'Sites', where.row, 'action', where.cell),
    ])
    expect(dryRun.changes.updateElements).toEqual([])
    expect(dryRun.tallies.sites).toEqual(tallied({ unchanged: SITE_COUNT - 1 }))
  })

  it('remove on a row with no id', async () => {
    const workbook = await exportedFile()
    const row = addRow(workbook, 'Sites', { name: textCell('New'), action: textCell('remove') })
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.remove-without-id', 'Sites', row, 'id', `A${row}`),
    ])
    expect(dryRun.changes.addElements).toEqual([])
  })

  it('remove on a Location that is not a site of the rollout', async () => {
    const workbook = await exportedFile()
    const row = addRow(workbook, 'Sites', { id: textCell('loc-emea'), action: textCell('remove') })
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.remove-not-in-rollout', 'Sites', row, 'action', `E${row}`),
    ])
    expect(dryRun.tallies.sites).toEqual(tallied({ unchanged: SITE_COUNT + 1 }))
  })

  it('a row whose id could not be read, or is not text, is not read', async () => {
    const workbook = await exportedFile()
    const unreadable = set(workbook, 'Sites', siteId(5), 'id', {
      kind: 'unreadable',
      text: '#REF!',
    })
    const number = addRow(workbook, 'SitePlan', { location: numberCell(7), rag: textCell('red') })
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.row-key-unreadable', 'Sites', unreadable.row, 'id', unreadable.cell),
      at('rollout-workbook.row-key-unreadable', 'SitePlan', number, 'location', `A${number}`),
    ])
    expect(dryRun.problems[0]!.message).toContain('the cell could not be read')
    expect(dryRun.problems[1]!.message).toContain('the number 7, where an id is expected')
    expect(dryRun.tallies.sites).toEqual(tallied({ unchanged: SITE_COUNT - 1 }))
  })

  it('a cell the reader could not read leaves its value untouched', async () => {
    const workbook = await exportedFile()
    set(workbook, 'SitePlan', siteId(10), 'rag', { kind: 'unreadable', text: '#N/A' })
    set(workbook, 'SitePlan', siteId(8), 'milestone.freezeStart', {
      kind: 'unreadable',
      text: '#N/A',
    })
    set(workbook, 'Sites', siteId(2), SITE_CODE_KEY, { kind: 'unreadable', text: '#N/A' })
    const dryRun = plan(workspace(), workbook)
    // The reader has said so for each cell; nothing here repeats it.
    expect(dryRun.problems).toEqual([])
    expect(dryRun.changes.updateElements).toEqual([])
  })

  it('a site name changed in SitePlan, where it is shown and not read', async () => {
    const workbook = await exportedFile()
    const where = set(workbook, 'SitePlan', siteId(5), 'name', textCell('Renamed'))
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.read-only-changed', 'SitePlan', where.row, 'name', where.cell),
    ])
    expect(dryRun.changes.updateElements).toEqual([])
  })

  it('a site plan row for a site the Sites sheet removes is not read', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Sites', siteId(5), 'action', textCell('remove'))
    const where = set(workbook, 'SitePlan', siteId(5), 'rag', textCell('red'))
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.site-removed', 'SitePlan', where.row, 'location', `A${where.row}`),
      // Site 6 depends on site 5: a dependency on a site that leaves goes with it.
      DROPPED_5_FROM_6,
    ])
    expect(dryRun.tallies.sitePlans).toEqual(tallied({ unchanged: SITE_COUNT - 1 }))
  })

  it('a removed site’s other edits are not applied, and that is said', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Sites', siteId(5), 'name', textCell('Renamed'))
    const where = set(workbook, 'Sites', siteId(5), 'action', textCell('remove'))
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.remove-ignores-changes', 'Sites', where.row, 'action', where.cell),
      // Site 6 depends on site 5: a dependency on a site that leaves goes with it.
      DROPPED_5_FROM_6,
    ])
    expect(element(after, siteId(5)).name).toBe('Site 005')
    expect(sitePlan(after, siteId(5))).toBeUndefined()
  })
})

describe('columns and sheets that are not read are said', () => {
  it('an unknown column, a repeated one, one with no key, and an unknown milestone', async () => {
    const workbook = await exportedFile()
    // Rows read back trimmed at their last value: pad them to the header first.
    const widen = (row: ReadCell[], width: number) => {
      while (row.length < width) row.push(EMPTY)
      return row
    }
    const sites = sheetOf(workbook, 'Sites')
    const width = sites.rows[0]!.length
    sites.rows[0]!.push(textCell('colour'), textCell('name'), EMPTY)
    sites.rows[1]!.push(textCell('Colour'), textCell('Name again'), EMPTY)
    widen(sites.rows[2]!, width).push(textCell('blue'), textCell('Another name'), textCell('stray'))
    const plans = sheetOf(workbook, 'SitePlan')
    const planWidth = plans.rows[0]!.length
    plans.rows[0]!.push(textCell('milestone.goLive'), numberCell(5))
    widen(plans.rows[2]!, planWidth).push(textCell('2027-05'), textCell('2027-06'))
    const dryRun = plan(workspace(), workbook)
    const column = (n: number) => String.fromCharCode(65 + n)
    expect(dryRun.problems).toEqual([
      expect.objectContaining({
        code: 'rollout-workbook.column-unknown',
        sheet: 'Sites',
        column: 'colour',
        cell: `${column(width)}1`,
      }),
      expect.objectContaining({
        code: 'rollout-workbook.column-repeated',
        sheet: 'Sites',
        column: 'name',
        cell: `${column(width + 1)}1`,
      }),
      expect.objectContaining({
        code: 'rollout-workbook.column-unnamed',
        sheet: 'Sites',
        cell: `${column(width + 2)}1`,
      }),
      expect.objectContaining({
        code: 'rollout-workbook.column-unknown',
        sheet: 'SitePlan',
        column: 'milestone.goLive',
      }),
      expect.objectContaining({ code: 'rollout-workbook.column-unknown', sheet: 'SitePlan' }),
    ])
    // The first `name` column was read, and nothing in the others was.
    expect(dryRun.changes.updateElements).toEqual([])
  })

  it('a sheet with no key column is not read', async () => {
    const workbook = await exportedFile()
    dropColumn(workbook, 'SitePlan', 'location')
    dropColumn(workbook, 'Sites', 'id')
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      expect.objectContaining({
        code: 'rollout-workbook.key-column-missing',
        sheet: 'Sites',
        column: 'id',
        severity: 'error',
      }),
      expect.objectContaining({
        code: 'rollout-workbook.key-column-missing',
        sheet: 'SitePlan',
        column: 'location',
      }),
    ])
    // Without its ids, every row of Sites would have created a Location.
    expect(dryRun.changes.addElements).toEqual([])
  })

  it('an unknown sheet', async () => {
    const workbook = await exportedFile()
    workbook.sheets.push({ name: 'Notes', rows: [[textCell('anything')]] })
    expect(plan(workspace(), workbook).problems).toEqual([
      expect.objectContaining({ code: 'rollout-workbook.sheet-unknown', sheet: 'Notes' }),
    ])
  })

  it('a Template sheet that differs from the template is not read, and says where', async () => {
    const workbook = await exportedFile()
    const template = sheetOf(workbook, 'Template')
    template.rows[4]![1] = textCell('retire')
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      expect.objectContaining({
        code: 'rollout-workbook.template-read-only',
        sheet: 'Template',
        cell: 'B5',
        row: 5,
      }),
    ])
    expect(dryRun.changes.updateElements).toEqual([])
  })

  it('a Template row added past the template is a difference too', async () => {
    const workbook = await exportedFile()
    sheetOf(workbook, 'Template').rows.push([textCell('tc-new')])
    expect(plan(workspace(), workbook).problems).toEqual([
      expect.objectContaining({ code: 'rollout-workbook.template-read-only', cell: 'A10' }),
    ])
  })

  it('an import into an id that is no rollout changes nothing', async () => {
    const dryRun = planRolloutImport(workspace(), waveId(0), await exportedFile(), counter())
    expect(dryRun.problems).toEqual([
      expect.objectContaining({ code: 'rollout-workbook.rollout-unknown', severity: 'error' }),
    ])
    expect(dryRun.changes.updateElements).toEqual([])
  })
})

// ── Import: what it does ─────────────────────────────────────────────────────

describe('what an import does', () => {
  it('a row with no id creates a Location in the rollout, with its fields and parent region', async () => {
    const workbook = await exportedFile()
    addRow(workbook, 'Sites', {
      name: textCell('Site 900'),
      parent: textCell('loc-emea'),
      [SITE_CODE_KEY]: textCell('900'),
    })
    const { dryRun, after, store } = commit(workspace(), workbook)
    expect(dryRun.tallies.sites.created).toBe(1)
    expect(element(after, 'el-new-1')).toEqual({
      id: 'el-new-1',
      type: 'Location',
      name: 'Site 900',
      properties: { [SITE_CODE_KEY]: '900' },
    })
    expect(after.relationships.find((r) => r.id === 'rel-new-2')).toEqual({
      id: 'rel-new-2',
      type: 'Aggregation',
      source: 'loc-emea',
      target: 'el-new-1',
      properties: {},
    })
    expect(sitePlan(after, 'el-new-1')).toEqual({ location: 'el-new-1' })
    // Sorted by location, as the rollout keeps its sites (ADR 0004).
    const locations = rolloutPlanOf(element(after, ROLLOUT_ID))!.sites.map((s) => s.location)
    expect(locations).toEqual([...locations].sort())
    expect(store.history).toHaveLength(1)
  })

  it('a row with the id of a Location not yet in the rollout adds it', async () => {
    const workbook = await exportedFile()
    addRow(workbook, 'Sites', { id: textCell('loc-emea'), name: textCell('EMEA') })
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.tallies.sites).toEqual(tallied({ updated: 1, unchanged: SITE_COUNT }))
    expect(sitePlan(after, 'loc-emea')).toEqual({ location: 'loc-emea' })
  })

  it('a new parent region replaces the old; the one already there changes nothing', async () => {
    const model = workspace()
    model.elements.push({ id: 'loc-dach', type: 'Location', name: 'DACH', properties: {} })
    const workbook = await exportedFile(model)
    set(workbook, 'Sites', siteId(5), 'parent', textCell('loc-dach'))
    const { dryRun, after } = commit(model, workbook)
    expect(dryRun.changes.removeRelationships.map((r) => r.id)).toEqual(['rel-emea-005'])
    expect(after.relationships.filter((r) => r.target === siteId(5))).toEqual([
      expect.objectContaining({ source: 'loc-dach', type: 'Aggregation' }),
    ])
  })

  it('a site with two parent regions keeps both when its cell is left as exported', async () => {
    const model = workspace()
    model.elements.push({ id: 'loc-dach', type: 'Location', name: 'DACH', properties: {} })
    model.relationships.push({
      id: 'rel-dach-005',
      type: 'Aggregation',
      source: 'loc-dach',
      target: siteId(5),
      properties: {},
    })
    const { dryRun, result } = commit(model, await exportedFile(model))
    expect(dryRun.problems).toEqual([])
    expect(result).toBe('unchanged')
  })

  it('a date cell in a planned column reads as a day', async () => {
    const workbook = await exportedFile()
    set(workbook, 'SitePlan', siteId(8), 'milestone.freezeStart', dateCell('2027-05-12'))
    set(workbook, 'Waves', waveId(1), 'windowEnd', dateCell('2027-06-30'))
    const { after } = commit(workspace(), workbook)
    expect(sitePlan(after, siteId(8))!.milestones!.freezeStart).toEqual({
      date: '2027-05-12',
      precision: 'day',
    })
    expect(wavePlan(after, waveId(1)).window!.end).toEqual({ date: '2027-06-30', precision: 'day' })
  })

  it.each([
    ['2027-Q2', { date: '2027-04-01', precision: 'quarter' }],
    ['2027-05', { date: '2027-05-01', precision: 'month' }],
    ['2027-W19', { date: '2027-05-10', precision: 'week' }],
    ['2026-W53', { date: '2026-12-28', precision: 'week' }],
    ['2027-05-12', { date: '2027-05-12', precision: 'day' }],
  ])('the text %s reads by its form', async (text, date) => {
    const workbook = await exportedFile()
    set(workbook, 'SitePlan', siteId(1), 'milestone.legacyDecommissioned', textCell(text))
    const { after } = commit(workspace(), workbook)
    expect(sitePlan(after, siteId(1))!.milestones!.legacyDecommissioned).toEqual(date)
  })

  it('site fields keep the kind of value Excel holds', async () => {
    const model = workspace()
    element(model, siteId(1)).properties['archipelago.site.headcount'] = 40
    const workbook = await exportedFile(model)
    set(workbook, 'Sites', siteId(1), 'archipelago.site.headcount', numberCell(45))
    set(workbook, 'Sites', siteId(2), 'archipelago.site.headcount', textCell('about 50'))
    set(workbook, 'Sites', siteId(3), 'archipelago.site.headcount', booleanCell(false))
    set(workbook, 'Sites', siteId(4), 'archipelago.site.headcount', dateCell('2027-01-01'))
    const { after } = commit(model, workbook)
    expect(
      [1, 2, 3, 4].map((n) => element(after, siteId(n)).properties['archipelago.site.headcount']),
    ).toEqual([45, 'about 50', false, '2027-01-01'])
  })

  it('a site plan keyed to an element that is no Location is not a row of Sites', async () => {
    const model = workspace()
    model.elements.push({ id: 'grp-odd', type: 'Grouping', name: 'Odd', properties: {} })
    rolloutPlanOf(element(model, ROLLOUT_ID))!.sites.push({ location: 'grp-odd' })
    const workbook = await exportedFile(model)
    // As a row of Sites it would fail its own import, as no Location.
    expect(() => rowOf(sheetOf(workbook, 'Sites'), 'grp-odd')).toThrow()
    expect(rowOf(sheetOf(workbook, 'SitePlan'), 'grp-odd')).toBeGreaterThan(1)
    expect(plan(model, workbook).problems).toEqual([])
  })

  it('a site plan whose Location is gone still reads, with no name', async () => {
    const model = workspace()
    model.elements = model.elements.filter((e) => e.id !== siteId(5))
    model.relationships = model.relationships.filter((r) => r.target !== siteId(5))
    const workbook = await exportedFile(model)
    expect(rowOf(sheetOf(workbook, 'SitePlan'), siteId(5))).toBeGreaterThan(1)
    expect(() => rowOf(sheetOf(workbook, 'Sites'), siteId(5))).toThrow()
    set(workbook, 'SitePlan', siteId(5), 'rag', textCell('red'))
    const { dryRun, after } = commit(model, workbook)
    expect(dryRun.problems).toEqual([])
    expect(sitePlan(after, siteId(5))!.rag).toBe('red')
  })
})

describe('what an import reads, and what it leaves alone', () => {
  it('every column of Waves applies', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Waves', waveId(1), 'label', textCell('Spring'))
    set(workbook, 'Waves', waveId(1), 'order', numberCell(7))
    set(workbook, 'Waves', waveId(1), 'windowStart', textCell('2027-W14'))
    set(workbook, 'Waves', waveId(1), 'templateVersion', numberCell(1))
    // A milestone is read by its form, and a blank deletes the wave's date.
    set(workbook, 'Waves', waveId(1), 'milestone.freezeStart', textCell('2027-W21'))
    set(workbook, 'Waves', waveId(1), 'milestone.legacyDecommissioned', textCell('2027-Q4'))
    set(workbook, 'Waves', waveId(1), 'milestone.hypercareEnd', EMPTY)
    set(workbook, 'Waves', waveId(1), 'milestone.reconciliationSignedOff', EMPTY)
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(dryRun.tallies.waves).toEqual(tallied({ updated: 1, unchanged: 4 }))
    expect(wavePlan(after, waveId(1))).toEqual({
      kind: 'wave',
      rollout: ROLLOUT_ID,
      label: 'Spring',
      order: 7,
      window: {
        start: { date: '2027-04-05', precision: 'week' },
        end: { date: '2027-06-01', precision: 'month' },
      },
      templateVersion: 1,
      milestones: {
        mappingSignedOff: { date: '2027-04-05', precision: 'day' },
        constructor: { date: '2027-04-19', precision: 'day' },
        freezeStart: { date: '2027-05-24', precision: 'week' },
        legacyDecommissioned: { date: '2027-10-01', precision: 'quarter' },
      },
    })
  })

  it('a parent region is a Location aggregating the site, and nothing else is touched', async () => {
    const model = workspace()
    model.elements.push({ id: 'grp-pilots', type: 'Grouping', name: 'Pilots', properties: {} })
    model.relationships.push(
      {
        id: 'rel-group-005',
        type: 'Aggregation',
        source: 'grp-pilots',
        target: siteId(5),
        properties: {},
      },
      {
        id: 'rel-comp-005',
        type: 'Composition',
        source: 'loc-emea',
        target: siteId(5),
        properties: {},
      },
    )
    const workbook = await exportedFile(model)
    // Neither is shown as the parent: the one parent region is EMEA's Aggregation.
    expect(
      sheetOf(workbook, 'Sites').rows[rowOf(sheetOf(workbook, 'Sites'), siteId(5))]![2],
    ).toEqual(textCell('loc-emea'))
    set(workbook, 'Sites', siteId(5), 'parent', EMPTY)
    const { dryRun, after } = commit(model, workbook)
    expect(dryRun.changes.removeRelationships.map((r) => r.id)).toEqual(['rel-emea-005'])
    expect(after.relationships.filter((r) => r.target === siteId(5)).map((r) => r.id)).toEqual([
      'rel-group-005',
      'rel-comp-005',
    ])
  })

  it('a site with no parent region and a blank parent cell is unchanged', async () => {
    const model = workspace()
    model.relationships = model.relationships.filter((r) => r.id !== 'rel-emea-005')
    const { dryRun, result } = commit(model, await exportedFile(model))
    expect(dryRun.tallies.sites).toEqual(tallied({ unchanged: SITE_COUNT }))
    expect(result).toBe('unchanged')
  })

  it('a row with nothing in a column that is read is no row, so it creates nothing', async () => {
    const workbook = await exportedFile()
    const sites = sheetOf(workbook, 'Sites')
    const width = sites.rows[0]!.length
    sites.rows[0]!.push(textCell('colour'))
    // An empty row, and one whose only value is in a column that is not read.
    sites.rows.splice(3, 0, [], [...Array<ReadCell>(width).fill(EMPTY), textCell('blue')])
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      expect.objectContaining({ code: 'rollout-workbook.column-unknown', column: 'colour' }),
    ])
    expect(dryRun.changes.addElements).toEqual([])
    expect(dryRun.tallies.sites).toEqual(tallied({ unchanged: SITE_COUNT }))
  })

  it('a header cell holding empty text is no key', async () => {
    const workbook = await exportedFile()
    const sites = sheetOf(workbook, 'Sites')
    const width = sites.rows[0]!.length
    sites.rows[0]!.push(textCell(''))
    while (sites.rows[2]!.length < width) sites.rows[2]!.push(EMPTY)
    sites.rows[2]!.push(textCell('stray'))
    expect(plan(workspace(), workbook).problems).toEqual([
      expect.objectContaining({ code: 'rollout-workbook.column-unnamed', sheet: 'Sites' }),
    ])
  })

  it('a removed site’s parent change alone is said not to apply', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Sites', siteId(5), 'parent', EMPTY)
    const where = set(workbook, 'Sites', siteId(5), 'action', textCell('remove'))
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.remove-ignores-changes', 'Sites', where.row, 'action', where.cell),
      // Site 6 depends on site 5: a dependency on a site that leaves goes with it.
      DROPPED_5_FROM_6,
    ])
    expect(after.relationships.some((r) => r.id === 'rel-emea-005')).toBe(true)
  })
})

describe('names that look like the format’s own syntax round-trip (CLAUDE.md escaping)', () => {
  const NAMES = [
    'Linz, Upper Austria; Plant 2',
    'Tab\there and a\nnew line',
    'He said "go", then \'stop\'',
    '_x0041_ is not A',
    '_x005F_x0041_ looks escaped twice',
    // The escape of the next character would supply the closing underscore (#216).
    '_x0041\u0001',
    '=SUM(A1:A2)',
    '2027-Q2',
  ]

  it('as site names, on export and back, and in a new site', async () => {
    const model = workspace()
    NAMES.forEach((name, i) => (element(model, siteId(i + 1)).name = name))
    const workbook = await exportedFile(model)
    const names = sheetOf(workbook, 'Sites')
      .rows.slice(2, 2 + NAMES.length)
      .map((row) => row[1])
    expect(names).toEqual(NAMES.map(textCell))
    for (const name of NAMES) addRow(workbook, 'Sites', { name: textCell(name) })
    const { dryRun, after } = commit(model, workbook)
    expect(dryRun.problems).toEqual([])
    expect(dryRun.tallies.sites).toEqual(tallied({ created: NAMES.length, unchanged: SITE_COUNT }))
    expect(dryRun.changes.addElements.map((e) => e.name)).toEqual(NAMES)
    expect(after.elements.filter((e) => e.id.startsWith('el-new')).map((e) => e.name)).toEqual(
      NAMES,
    )
  })

  it('as milestone ids that hold the column prefix or a dot', async () => {
    const model = workspace()
    const rollout = rolloutPlanOf(element(model, ROLLOUT_ID))!
    rollout.milestones.push(
      { id: 'milestone.go', label: 'Looks like a column key', startsPhase: 'done' },
      { id: 'actual.go', label: 'Looks like an actual column', startsPhase: 'done' },
      { id: 'a.b', label: 'Dotted', startsPhase: 'done' },
    )
    rollout.sites[0]!.milestones = {
      'milestone.go': { date: '2027-04-01', precision: 'quarter' },
      'a.b': { date: '2027-05-01', precision: 'month' },
    }
    rollout.sites[0]!.actuals = { 'actual.go': '2027-04-02' }
    const workbook = await exportedFile(model)
    const keys = sheetOf(workbook, 'SitePlan').rows[0]!.slice(-6)
    expect(keys).toEqual(
      [
        'milestone.milestone.go',
        'actual.milestone.go',
        'milestone.actual.go',
        'actual.actual.go',
        'milestone.a.b',
        'actual.a.b',
      ].map(textCell),
    )
    const { dryRun, result } = commit(model, workbook)
    expect(dryRun.problems).toEqual([])
    expect(result).toBe('unchanged')
    set(workbook, 'SitePlan', siteId(1), 'milestone.a.b', textCell('2027-06'))
    set(workbook, 'SitePlan', siteId(1), 'actual.actual.go', textCell('2027-04-05'))
    set(workbook, 'SitePlan', siteId(1), 'actual.milestone.go', textCell('2027-04-06'))
    const edited = commit(model, workbook)
    expect(sitePlan(edited.after, siteId(1))!.milestones).toEqual({
      'milestone.go': { date: '2027-04-01', precision: 'quarter' },
      'a.b': { date: '2027-06-01', precision: 'month' },
    })
    expect(sitePlan(edited.after, siteId(1))!.actuals).toEqual({
      'actual.go': '2027-04-05',
      'milestone.go': '2027-04-06',
    })
  })
})

// ── The store command ────────────────────────────────────────────────────────

describe('applying an import (#210)', () => {
  async function edited() {
    const workbook = await exportedFile()
    set(workbook, 'Sites', siteId(5), 'name', textCell('Renamed'))
    return workbook
  }

  it('is refused for a reader, before anything else', async () => {
    const store = new ModelStore(workspace())
    const dryRun = planRolloutImport(store.snapshot(), ROLLOUT_ID, await edited(), counter())
    store.setWritable(false)
    expect(() => applyRolloutImport(store, dryRun)).toThrow(ReadOnlyModelError)
    store.setWritable(true)
    expect(store.element(siteId(5))!.name).toBe('Site 005')
  })

  it('is refused for a reader even when it would change nothing, so a missed guard shows', async () => {
    const store = new ModelStore(workspace())
    const dryRun = planRolloutImport(store.snapshot(), ROLLOUT_ID, await exportedFile(), counter())
    store.setWritable(false)
    expect(() => applyRolloutImport(store, dryRun)).toThrow(ReadOnlyModelError)
  })

  it.each([
    ['an element it updates changed', (s: ModelStore) => s.updateElement(siteId(5), (e) => e)],
    [
      'a relationship it removes changed',
      (s: ModelStore) => s.updateRelationship('rel-emea-004', (r) => r),
    ],
    [
      'an id it would add is taken',
      (s: ModelStore) =>
        s.addElement({ id: 'el-new-1', type: 'Location', name: 'x', properties: {} }),
    ],
    [
      'a relationship id it would add is taken',
      (s: ModelStore) =>
        s.addRelationship({
          id: 'rel-new-2',
          type: 'Aggregation',
          source: 'loc-emea',
          target: siteId(1),
          properties: {},
        }),
    ],
  ])('is refused as stale when %s since the dry run', async (_, change) => {
    const workbook = await edited()
    set(workbook, 'Sites', siteId(4), 'parent', EMPTY)
    addRow(workbook, 'Sites', { name: textCell('New'), parent: textCell('loc-emea') })
    const store = new ModelStore(workspace())
    const dryRun = planRolloutImport(store.snapshot(), ROLLOUT_ID, workbook, counter())
    change(store)
    const before = toCanonicalJson(store.snapshot())
    const history = store.history.length
    expect(applyRolloutImport(store, dryRun)).toBe('stale')
    expect(toCanonicalJson(store.snapshot())).toBe(before)
    expect(store.history).toHaveLength(history)
  })

  it('refuses a plan profile that fails its guard', async () => {
    const store = new ModelStore(workspace())
    const dryRun = planRolloutImport(store.snapshot(), ROLLOUT_ID, await edited(), counter())
    const rollout = store.element(ROLLOUT_ID)!
    const broken = { ...rollout, plan: { ...rolloutPlanOf(rollout)!, templateVersion: 0 } }
    dryRun.changes.updateElements.push({ before: rollout, after: broken as Element })
    expect(applyRolloutImport(store, dryRun)).toBe('invalid')
    expect(store.history).toHaveLength(0)
  })

  it('takes a removed parent region off the views that draw it, and undo puts it back', async () => {
    const model = workspace()
    const box = (x: number) => ({ x, y: 0, width: 120, height: 55 })
    const view: View = {
      id: 'view-regions',
      name: 'Regions',
      properties: {},
      nodes: [
        { kind: 'element', id: 'n-emea', element: 'loc-emea', bounds: box(0) },
        { kind: 'element', id: 'n-4', element: siteId(4), bounds: box(200) },
        { kind: 'element', id: 'n-6', element: siteId(6), bounds: box(400) },
      ],
      connections: [
        {
          kind: 'relationship',
          id: 'c-4',
          relationship: 'rel-emea-004',
          source: 'n-emea',
          target: 'n-4',
        },
        {
          kind: 'relationship',
          id: 'c-6',
          relationship: 'rel-emea-006',
          source: 'n-emea',
          target: 'n-6',
        },
      ],
    }
    model.views.push(view)
    const workbook = await exportedFile(model)
    set(workbook, 'Sites', siteId(4), 'parent', EMPTY)
    set(workbook, 'Sites', siteId(6), 'parent', EMPTY)
    const { store, before, after } = commit(model, workbook)
    expect(after.views[0]!.connections).toEqual([])
    // Each view changes once, on the first removal, as `removalCommands` does it.
    const batch = store.history[0]!.command
    expect(batch.kind === 'batch' && batch.commands.map((c) => 'cascadedViews' in c)).toEqual([
      true,
      false,
    ])
    expect(after.relationships.filter((r) => r.target === siteId(4))).toEqual([])
    store.undo()
    expect(toCanonicalJson(store.snapshot())).toBe(toCanonicalJson(before))
  })
})

describe('the e2e journey’s fixture', () => {
  it('is what the canonical writer writes for the rollout fixture at eight sites', () => {
    // Written by scripts/fixtures/build-rollout-workspace.ts: regenerate, never edit.
    const file = new TextDecoder().decode(fixtureBytes('rollout-workspace.json'))
    expect(file).toBe(toCanonicalJson(rolloutWorkspace(8)))
  })
})

describe('milestone dates in the workbook (#213)', () => {
  const cellOf = (workbook: Workbook<ReadCell>, name: string, id: string, key: string) => {
    const sheet = sheetOf(workbook, name)
    return sheet.rows[rowOf(sheet, id)]![columnOf(sheet, key)]
  }

  it('shows rolling elaboration: the next wave to the day, later waves to the quarter', async () => {
    const workbook = await exportedFile()
    expect(cellOf(workbook, 'Waves', waveId(1), 'milestone.freezeStart')).toEqual(
      textCell('2027-05-17'),
    )
    expect(cellOf(workbook, 'Waves', waveId(2), 'milestone.freezeStart')).toEqual(
      textCell('2027-Q3'),
    )
    expect(cellOf(workbook, 'Waves', waveId(3), 'milestone.freezeStart')).toEqual(
      textCell('2027-Q4'),
    )
  })

  it('a blank site cell clears its override, so the site inherits its wave’s date again', async () => {
    const model = workspace()
    const store = new ModelStore(model)
    // Site 4 is in W1 and sets its own freeze, at week precision.
    const site = siteId(4)
    const status = () => {
      const plan = rolloutPlanOf(store.element(ROLLOUT_ID))!
      const own = plan.sites.find((candidate) => candidate.location === site)!
      return resolveSiteMilestones(plan, own, wavePlanOf(store.element(own.wave!))).find(
        (resolved) => resolved.milestone.id === 'freezeStart',
      )
    }
    expect(status()).toMatchObject({
      source: 'site',
      planned: { date: '2027-05-10', precision: 'week' },
    })
    const workbook = await exportedFile(model)
    set(workbook, 'SitePlan', site, 'milestone.freezeStart', EMPTY)
    const dryRun = planRolloutImport(store.snapshot(), ROLLOUT_ID, workbook, counter(), FILE)
    expect(dryRun.problems).toEqual([])
    applyRolloutImport(store, dryRun)
    expect(sitePlan(store.snapshot(), site)?.milestones?.freezeStart).toBeUndefined()
    expect(status()).toMatchObject({
      source: 'wave',
      planned: { date: '2027-05-17', precision: 'day' },
    })
  })

  it('carries each precision by its text form, out and back', async () => {
    const workbook = await exportedFile()
    const forms = ['2027-Q3', '2027-08', '2027-W33', '2027-08-18'] as const
    const ids = ['mappingSignedOff', 'freezeStart', 'reconciliationSignedOff', 'hypercareEnd']
    forms.forEach((form, index) =>
      set(workbook, 'SitePlan', siteId(1), `milestone.${ids[index]}`, textCell(form)),
    )
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(sitePlan(after, siteId(1))?.milestones).toEqual({
      mappingSignedOff: { date: '2027-07-01', precision: 'quarter' },
      freezeStart: { date: '2027-08-01', precision: 'month' },
      reconciliationSignedOff: { date: '2027-08-16', precision: 'week' },
      hypercareEnd: { date: '2027-08-18', precision: 'day' },
    })
    const again = await exportedFile(after)
    forms.forEach((form, index) =>
      expect(cellOf(again, 'SitePlan', siteId(1), `milestone.${ids[index]}`)).toEqual(
        textCell(form),
      ),
    )
  })

  it('does not read the Milestones sheet, and says so when it was edited', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Milestones', 'freezeStart', 'label', textCell('Freeze'))
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      expect.objectContaining({
        code: 'rollout-workbook.milestones-read-only',
        sheet: 'Milestones',
      }),
    ])
    expect(toCanonicalJson(after)).toBe(toCanonicalJson(before))
  })

  it('reports a Waves date column for no milestone of the rollout, and reads none of it', async () => {
    const workbook = await exportedFile()
    const sheet = sheetOf(workbook, 'Waves')
    sheet.rows[0]!.push(textCell('milestone.goLive'))
    sheet.rows[rowOf(sheet, waveId(1))]!.push(textCell('2027-05-03'))
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems.map((problem) => problem.code)).toEqual([
      'rollout-workbook.column-unknown',
    ])
    expect(wavePlan(after, waveId(1)).milestones).not.toHaveProperty('goLive')
  })
})

// ── Actuals, RAG and go/no-go (#215) ─────────────────────────────────────────

describe('actual days, RAG and go/no-go from the PMO (#215)', () => {
  const PLAN = `elements.${ROLLOUT_ID}.plan.sites`
  /** Each site's derived phase at a fixed day, so today's date cannot decide it. */
  const phases = (model: Workspace, at: string) => {
    const rollout = rolloutPlanOf(element(model, ROLLOUT_ID))!
    return rollout.sites.map((site) => [
      site.location,
      siteStatus(
        rollout,
        site,
        site.wave === undefined ? undefined : wavePlanOf(element(model, site.wave)),
        dayStart(at),
      ).phase,
    ])
  }

  it('ten actual days, a RAG and a decision change those fields and nothing else', async () => {
    const workbook = await exportedFile()
    const actual = (n: number, milestone: string, day: string) =>
      set(workbook, 'SitePlan', siteId(n), `actual.${milestone}`, textCell(day))
    // Sites 1 and 2 cut over in the pilot; their hypercare ends early,
    // before its planned 2027-03-29.
    actual(1, 'reconciliationSignedOff', '2027-03-04')
    actual(1, 'hypercareEnd', '2027-03-12')
    actual(2, 'constructor', '2027-02-20')
    actual(2, 'reconciliationSignedOff', '2027-03-05')
    actual(2, 'hypercareEnd', '2027-03-14')
    // Sites of later waves start preparing before their planned mapping.
    actual(3, 'mappingSignedOff', '2027-03-01')
    actual(4, 'mappingSignedOff', '2027-03-10')
    actual(4, 'constructor', '2027-03-11')
    actual(7, 'constructor', '2027-03-02')
    actual(8, 'mappingSignedOff', '2027-03-09')
    set(workbook, 'SitePlan', siteId(5), 'rag', textCell('red'))
    set(workbook, 'SitePlan', siteId(4), 'goNoGo', textCell('go'))

    const model = workspace()
    expect(phases(model, '2027-03-15').slice(0, 8)).toEqual([
      [siteId(1), 'hypercare'],
      [siteId(2), 'hypercare'],
      [siteId(3), 'planned'],
      [siteId(4), 'planned'],
      [siteId(5), 'planned'],
      [siteId(6), 'preparing'],
      [siteId(7), 'planned'],
      [siteId(8), 'planned'],
    ])
    const { dryRun, result, store, before, after } = commit(model, workbook)
    expect(dryRun.problems).toEqual([])
    expect(dryRun.tallies).toEqual({
      sites: tallied({ unchanged: SITE_COUNT }),
      waves: tallied({ unchanged: 5 }),
      sitePlans: tallied({ updated: 7, unchanged: SITE_COUNT - 7 }),
      exceptions: tallied({ unchanged: 4 }),
      dependencies: tallied({ unchanged: 2 }),
    })
    expect(result).toBe('applied')
    expect(changedPaths(before, after)).toEqual([
      `${PLAN}.0.actuals.hypercareEnd`,
      `${PLAN}.0.actuals.reconciliationSignedOff`,
      `${PLAN}.1.actuals.constructor`,
      `${PLAN}.1.actuals.hypercareEnd`,
      `${PLAN}.1.actuals.reconciliationSignedOff`,
      `${PLAN}.2.actuals`,
      `${PLAN}.3.actuals`,
      `${PLAN}.3.goNoGo`,
      `${PLAN}.4.rag`,
      `${PLAN}.6.actuals`,
      `${PLAN}.7.actuals`,
    ])
    expect(sitePlan(after, siteId(4))).toMatchObject({
      actuals: { mappingSignedOff: '2027-03-10', constructor: '2027-03-11' },
      goNoGo: 'go',
    })
    expect(appliedTallies(before, after)).toEqual(countsOf(dryRun))
    // The phases follow the actual days, the early ones too.
    expect(phases(after, '2027-03-15').slice(0, 8)).toEqual([
      [siteId(1), 'migrated'],
      [siteId(2), 'migrated'],
      [siteId(3), 'preparing'],
      [siteId(4), 'preparing'],
      [siteId(5), 'planned'],
      [siteId(6), 'preparing'],
      [siteId(7), 'preparing'],
      [siteId(8), 'preparing'],
    ])
    expect(store.history.map((entry) => entry.label)).toEqual([
      'Updated the actual dates, RAG and go/no-go of 7 sites in “Local data to the central lake”',
    ])
    store.undo()
    expect(toCanonicalJson(store.snapshot())).toBe(toCanonicalJson(before))
  })

  it('an exported workbook with actual days re-imports to the same model', async () => {
    const { dryRun, result } = commit(workspace(), await exportedFile())
    expect(dryRun.problems).toEqual([])
    expect(result).toBe('unchanged')
    expect(sitePlan(workspace(), siteId(1))!.actuals).toEqual({
      mappingSignedOff: '2027-02-12',
      constructor: '2027-02-15',
      freezeStart: '2027-03-02',
    })
  })

  it('a blank cell, or empty text, clears an actual, a RAG and a decision', async () => {
    const workbook = await exportedFile()
    set(workbook, 'SitePlan', siteId(1), 'actual.mappingSignedOff', EMPTY)
    // Empty text looks like a blank cell on screen, and reads as one (#226).
    set(workbook, 'SitePlan', siteId(1), 'actual.freezeStart', textCell(''))
    set(workbook, 'SitePlan', siteId(1), 'goNoGo', textCell(''))
    set(workbook, 'SitePlan', siteId(2), 'actual.mappingSignedOff', EMPTY)
    set(workbook, 'SitePlan', siteId(2), 'actual.freezeStart', EMPTY)
    set(workbook, 'SitePlan', siteId(5), 'rag', textCell(''))
    set(workbook, 'SitePlan', siteId(6), 'goNoGo', EMPTY)
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(sitePlan(after, siteId(1))!.actuals).toEqual({ constructor: '2027-02-15' })
    expect(sitePlan(after, siteId(1))).not.toHaveProperty('goNoGo')
    // Site 2's last actual cleared: no empty record is left behind.
    expect(sitePlan(after, siteId(2))).not.toHaveProperty('actuals')
    expect(sitePlan(after, siteId(5))).not.toHaveProperty('rag')
    expect(sitePlan(after, siteId(6))).not.toHaveProperty('goNoGo')
  })

  it('reads an actual day of a milestone named __proto__ as the site’s own', async () => {
    const model = workspace()
    rolloutPlanOf(element(model, ROLLOUT_ID))!.milestones.push({
      id: '__proto__',
      label: 'Proto',
      startsPhase: 'preparing',
    })
    const workbook = await exportedFile(model)
    set(workbook, 'SitePlan', siteId(3), 'actual.__proto__', textCell('2027-03-01'))
    const { dryRun, after } = commit(model, workbook)
    expect(dryRun.problems).toEqual([])
    const actuals = sitePlan(after, siteId(3))!.actuals!
    expect(Object.getOwnPropertyDescriptor(actuals, '__proto__')!.value).toBe('2027-03-01')
  })

  it('a date cell reads as its day', async () => {
    const workbook = await exportedFile()
    set(workbook, 'SitePlan', siteId(3), 'actual.mappingSignedOff', dateCell('2027-03-01'))
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(sitePlan(after, siteId(3))!.actuals).toEqual({ mappingSignedOff: '2027-03-01' })
  })

  it('a malformed day is reported at its cell, never stored, and the actual kept', async () => {
    const workbook = await exportedFile()
    const cells = [
      set(workbook, 'SitePlan', siteId(1), 'actual.mappingSignedOff', textCell('2027-02-30')),
      set(workbook, 'SitePlan', siteId(1), 'actual.freezeStart', textCell('2027-Q1')),
      set(workbook, 'SitePlan', siteId(2), 'actual.freezeStart', textCell('03/03/2027')),
      set(workbook, 'SitePlan', siteId(3), 'actual.mappingSignedOff', numberCell(46447)),
      set(workbook, 'SitePlan', siteId(3), 'actual.constructor', booleanCell(true)),
      set(workbook, 'SitePlan', siteId(3), 'actual.freezeStart', textCell(' 2027-03-01')),
    ]
    const columns = [
      'actual.mappingSignedOff',
      'actual.freezeStart',
      'actual.freezeStart',
      'actual.mappingSignedOff',
      'actual.constructor',
      'actual.freezeStart',
    ]
    const { dryRun, result, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual(
      cells.map(({ row, cell }, index) =>
        at('rollout-workbook.actual-unreadable', 'SitePlan', row, columns[index]!, cell),
      ),
    )
    expect(dryRun.problems.map((p) => p.severity)).toEqual(cells.map(() => 'error'))
    // Each names its site, as a RAG or decision problem does.
    expect(dryRun.problems.map((p) => p.subject)).toEqual([
      siteId(1),
      siteId(1),
      siteId(2),
      siteId(3),
      siteId(3),
      siteId(3),
    ])
    expect(result).toBe('unchanged')
    expect(sitePlan(after, siteId(1))!.actuals).toEqual({
      mappingSignedOff: '2027-02-12',
      constructor: '2027-02-15',
      freezeStart: '2027-03-02',
    })
    expect(sitePlan(after, siteId(3))).not.toHaveProperty('actuals')
  })

  it('an unreadable cell leaves the actual as it is', async () => {
    const workbook = await exportedFile()
    set(workbook, 'SitePlan', siteId(1), 'actual.freezeStart', { kind: 'unreadable', text: '#N/A' })
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(sitePlan(after, siteId(1))!.actuals!.freezeStart).toBe('2027-03-02')
  })

  it('a decision that is not go or no-go is reported, and the decision kept', async () => {
    const workbook = await exportedFile()
    const { row, cell } = set(workbook, 'SitePlan', siteId(6), 'goNoGo', textCell('maybe'))
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.go-no-go-unknown', 'SitePlan', row, 'goNoGo', cell),
    ])
    expect(sitePlan(after, siteId(6))!.goNoGo).toBe('no-go')
  })

  it('a column of actual days for no milestone of the rollout is reported and not read', async () => {
    const workbook = await exportedFile()
    const sheet = sheetOf(workbook, 'SitePlan')
    const width = sheet.rows[0]!.length
    sheet.rows[0]!.push(textCell('actual.goLive'))
    for (const row of sheet.rows.slice(2)) {
      while (row.length < width) row.push(EMPTY)
      row.push(textCell('2027-01-01'))
    }
    const { dryRun, result } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      expect.objectContaining({
        code: 'rollout-workbook.column-unknown',
        sheet: 'SitePlan',
        column: 'actual.goLive',
      }),
    ])
    expect(result).toBe('unchanged')
  })

  it('a missing actual column leaves every actual of it as it is (#94)', async () => {
    const workbook = await exportedFile()
    dropColumn(workbook, 'SitePlan', 'actual.freezeStart')
    dropColumn(workbook, 'SitePlan', 'goNoGo')
    const { dryRun, result } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(result).toBe('unchanged')
  })

  it('says, on export, what a date for a milestone the set does not have leaves out; import keeps it', async () => {
    const model = workspace()
    const rollout = rolloutPlanOf(element(model, ROLLOUT_ID))!
    rollout.sites[2]!.actuals = { goLive: '2027-01-04' }
    rollout.sites[3]!.milestones = {
      ...rollout.sites[3]!.milestones,
      goLive: rollout.milestones[0]!.date ?? { date: '2027-01-01', precision: 'month' },
    }
    const { problems } = exportRolloutWorkbook(model, ROLLOUT_ID)!
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'rollout-workbook.not-carried',
      }),
      expect.objectContaining({
        severity: 'info',
        code: 'rollout-workbook.dates-not-carried',
        message: expect.stringContaining('2 sites have planned or actual dates for milestones'),
      }),
    ])
    const { after } = commit(model, await exportedFile(model))
    expect(sitePlan(after, siteId(3))!.actuals).toEqual({ goLive: '2027-01-04' })
    expect(sitePlan(after, siteId(4))!.milestones).toHaveProperty('goLive')
  })
})

// ── Exceptions and Dependencies (#214) ──────────────────────────────────────

const exceptionsOf = (model: Workspace, location: string) => sitePlan(model, location)?.exceptions
const dependsOnOf = (model: Workspace, location: string) => sitePlan(model, location)?.dependsOn
const codes = (dryRun: RolloutImportPlan) => dryRun.problems.map((problem) => problem.code)

describe('the Exceptions sheet (#214)', () => {
  it('exports one row per exception, by id, with an add’s change as canonical JSON', () => {
    const sheet = sheetOf(exported(), 'Exceptions')
    expect(sheet.rows[0]).toEqual(
      [
        'id',
        'location',
        'kind',
        'change',
        'entry',
        'offsetDays',
        'disposition',
        'class',
        'owner',
        'expires',
        'rationale',
        'action',
      ].map(textCell),
    )
    // The fixture lists site 3's exceptions out of order: the sheet sorts them.
    expect(sheet.rows.slice(2).map((row) => row[0])).toEqual(
      ['ex-003-add', 'ex-003-modify', 'ex-003-skip', 'ex-006-modify'].map(textCell),
    )
    expect(sheet.rows[2]!.slice(1, 5)).toEqual([
      textCell(siteId(3)),
      textCell('add'),
      EMPTY,
      textCell(
        '{"date":{"anchor":"hypercareEnd","offsetDays":14},"id":"site-003-retire","kind":"retire","subject":"sys-local-store"}',
      ),
    ])
    expect(sheet.rows[3]!.slice(3, 8)).toEqual([
      textCell('tc-retire-store'),
      EMPTY,
      numberCell(60),
      textCell('archive'),
      textCell('operational'),
    ])
  })

  it('an edited cell changes that exception only', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Exceptions', 'ex-003-skip', 'owner', textCell('Site 003 Ops'))
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(dryRun.tallies.exceptions).toEqual(tallied({ updated: 1, unchanged: 3 }))
    // The fixture holds site 3's list out of order and an import sorts it, so
    // the list is compared by id; nothing else in the model changed.
    const exceptions = `elements.${ROLLOUT_ID}.plan.sites.2.exceptions.`
    expect(changedPaths(before, after).filter((path) => !path.startsWith(exceptions))).toEqual([])
    const byId = (model: Workspace) =>
      Object.fromEntries(exceptionsOf(model, siteId(3))!.map((e) => [e.id, e]))
    expect(byId(after)).toEqual({
      ...byId(before),
      'ex-003-skip': { ...byId(before)['ex-003-skip'], owner: 'Site 003 Ops' },
    })
  })

  it('a blank cell deletes an optional field, and a missing column keeps it', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Exceptions', 'ex-003-skip', 'expires', EMPTY)
    dropColumn(workbook, 'Exceptions', 'rationale')
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    const skip = exceptionsOf(after, siteId(3))!.find((e) => e.id === 'ex-003-skip')!
    expect(skip).not.toHaveProperty('expires')
    expect(skip.rationale).toBe('The site keeps "its own" fit <rating> & review.')
  })

  it('a row with no id adds an exception, given an id, in its site’s sorted list', async () => {
    const workbook = await exportedFile()
    addRow(workbook, 'Exceptions', {
      location: textCell(siteId(3)),
      kind: textCell('skip'),
      change: textCell('tc-eliminate'),
      class: textCell('operational'),
    })
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(dryRun.tallies.exceptions).toEqual(tallied({ created: 1, unchanged: 4 }))
    expect(exceptionsOf(after, siteId(3))!.map((e) => e.id)).toEqual([
      'ex-003-add',
      'ex-003-modify',
      'ex-003-skip',
      'ex-new-1',
    ])
  })

  it('a row naming another site moves the exception there', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Exceptions', 'ex-003-modify', 'location', textCell(siteId(7)))
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(dryRun.tallies.exceptions).toEqual(tallied({ updated: 1, unchanged: 3 }))
    expect(exceptionsOf(after, siteId(3))!.map((e) => e.id)).toEqual(['ex-003-add', 'ex-003-skip'])
    expect(exceptionsOf(after, siteId(7))!.map((e) => e.id)).toEqual(['ex-003-modify'])
  })

  it('remove deletes an exception, and a site left with none has no list', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Exceptions', 'ex-006-modify', 'action', textCell('remove'))
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(dryRun.tallies.exceptions).toEqual(tallied({ deleted: 1, unchanged: 3 }))
    expect(sitePlan(after, siteId(6))).not.toHaveProperty('exceptions')
  })

  it('remove of an id the rollout does not have, or of a row with no id, is said', async () => {
    const workbook = await exportedFile()
    const unknown = addRow(workbook, 'Exceptions', {
      id: textCell('ex-999'),
      action: textCell('remove'),
    })
    const blank = addRow(workbook, 'Exceptions', {
      kind: textCell('skip'),
      action: textCell('remove'),
    })
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.remove-not-found', 'Exceptions', unknown, 'action', `L${unknown}`),
      at('rollout-workbook.remove-not-found', 'Exceptions', blank, 'id', `A${blank}`),
    ])
    expect(dryRun.tallies.exceptions).toEqual(tallied({ unchanged: 6 }))
  })

  it('an action that is not remove leaves the row unread', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Exceptions', 'ex-003-skip', 'owner', textCell('Nobody'))
    const where = set(workbook, 'Exceptions', 'ex-003-skip', 'action', textCell('delete'))
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.action-unknown', 'Exceptions', where.row, 'action', where.cell),
    ])
    expect(toCanonicalJson(after)).toBe(toCanonicalJson(before))
  })

  it.each([
    ['kind', textCell('waive'), 'rollout-workbook.word-unknown'],
    ['class', textCell('political'), 'rollout-workbook.word-unknown'],
    ['disposition', textCell('shred'), 'rollout-workbook.word-unknown'],
    ['expires', textCell('next June'), 'rollout-workbook.day-unreadable'],
    ['offsetDays', numberCell(1.5), 'rollout-workbook.number-refused'],
    ['owner', numberCell(7), 'rollout-workbook.not-text'],
  ])(
    'a %s cell that cannot be read leaves the whole exception as it was',
    async (key, cell, code) => {
      const workbook = await exportedFile()
      set(workbook, 'Exceptions', 'ex-003-modify', 'rationale', textCell('Changed too'))
      const where = set(workbook, 'Exceptions', 'ex-003-modify', key, cell)
      const { dryRun, before, after } = commit(workspace(), workbook)
      expect(dryRun.problems).toEqual([
        at(code, 'Exceptions', where.row, key, where.cell),
        at(
          'rollout-workbook.exception-not-applied',
          'Exceptions',
          where.row,
          'id',
          `A${where.row}`,
        ),
      ])
      expect(toCanonicalJson(after)).toBe(toCanonicalJson(before))
    },
  )

  it('an add’s entry that is no change entry is said, and nothing is applied', async () => {
    const workbook = await exportedFile()
    const where = set(workbook, 'Exceptions', 'ex-003-add', 'entry', textCell('retire it'))
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(codes(dryRun)).toEqual([
      'rollout-workbook.entry-unreadable',
      'rollout-workbook.exception-not-applied',
    ])
    expect(dryRun.problems[0]).toEqual(
      at('rollout-workbook.entry-unreadable', 'Exceptions', where.row, 'entry', where.cell),
    )
    expect(toCanonicalJson(after)).toBe(toCanonicalJson(before))
  })

  it('an edited entry changes the add’s site-only change', async () => {
    const workbook = await exportedFile()
    set(
      workbook,
      'Exceptions',
      'ex-003-add',
      'entry',
      textCell(
        '{"id":"site-003-retire","kind":"retire","subject":"sys-local-store","date":{"anchor":"hypercareEnd","offsetDays":30}}',
      ),
    )
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    const add = exceptionsOf(after, siteId(3))!.find((e) => e.id === 'ex-003-add')!
    expect(add.kind === 'add' && add.change.date).toEqual({
      anchor: 'hypercareEnd',
      offsetDays: 30,
    })
  })

  it.each([
    [
      'an anchor the milestone set does not have',
      { subject: 'sys-local-store', anchor: 'goLive' },
      ['is dated from "goLive", which is not a milestone of the rollout'],
    ],
    [
      'a subject the model does not have',
      { subject: 'sys-nowhere', anchor: 'hypercareEnd' },
      ['retires "sys-nowhere", which is not an element in the model'],
    ],
    [
      'both',
      { subject: 'sys-nowhere', anchor: 'goLive' },
      ['retires "sys-nowhere"', '; and it is dated from "goLive"'],
    ],
  ])(
    'an add’s change with %s is refused, so no change is anchored on nothing',
    async (_, refs, parts) => {
      const workbook = await exportedFile()
      const entry = {
        id: 'site-003-retire',
        kind: 'retire',
        subject: refs.subject,
        date: { anchor: refs.anchor, offsetDays: 14 },
      }
      const where = set(
        workbook,
        'Exceptions',
        'ex-003-add',
        'entry',
        textCell(JSON.stringify(entry)),
      )
      const { dryRun, before, after } = commit(workspace(), workbook)
      expect(dryRun.problems).toEqual([
        at(
          'rollout-workbook.entry-reference-unknown',
          'Exceptions',
          where.row,
          'entry',
          where.cell,
        ),
      ])
      for (const part of parts) expect(dryRun.problems[0]!.message).toContain(part)
      expect(dryRun.problems[0]!.message).toContain('so the exception was left as it was.')
      expect(toCanonicalJson(after)).toBe(toCanonicalJson(before))
    },
  )

  it('an id the rollout does not have is refused, not added beside the one it misspells', async () => {
    const workbook = await exportedFile()
    const where = set(workbook, 'Exceptions', 'ex-003-skip', 'id', textCell('ex-003-skp'))
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.exception-unknown', 'Exceptions', where.row, 'id', where.cell),
    ])
    expect(dryRun.tallies.exceptions).toEqual(tallied({ unchanged: 3 }))
    expect(toCanonicalJson(after)).toBe(toCanonicalJson(before))
  })

  it('a new add whose change names a relationship the model has is added', async () => {
    const workbook = await exportedFile()
    const relationship = workspace().relationships[0]!
    addRow(workbook, 'Exceptions', {
      kind: textCell('add'),
      class: textCell('legal'),
      location: textCell(siteId(4)),
      entry: textCell(
        JSON.stringify({
          id: 'site-004-add',
          kind: 'add',
          subject: relationship.id,
          date: { anchor: 'hypercareEnd', offsetDays: 0 },
        }),
      ),
    })
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(exceptionsOf(after, siteId(4))!.map((e) => e.id)).toEqual(['ex-new-1'])
  })

  it('a value in the column of another kind is said, on either side', async () => {
    const workbook = await exportedFile()
    const toSkip = set(workbook, 'Exceptions', 'ex-003-skip', 'entry', textCell('{}'))
    const toAdd = set(workbook, 'Exceptions', 'ex-003-add', 'change', textCell('tc-fit'))
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.cell-for-another-kind', 'Exceptions', toAdd.row, 'change', toAdd.cell),
      at('rollout-workbook.exception-not-applied', 'Exceptions', toAdd.row, 'id', `A${toAdd.row}`),
      at('rollout-workbook.cell-for-another-kind', 'Exceptions', toSkip.row, 'entry', toSkip.cell),
      at(
        'rollout-workbook.exception-not-applied',
        'Exceptions',
        toSkip.row,
        'id',
        `A${toSkip.row}`,
      ),
    ])
  })

  it('a modify that modifies nothing is no exception', async () => {
    const workbook = await exportedFile()
    const where = set(workbook, 'Exceptions', 'ex-006-modify', 'disposition', EMPTY)
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.exception-invalid', 'Exceptions', where.row, 'kind', `C${where.row}`),
    ])
    expect(toCanonicalJson(after)).toBe(toCanonicalJson(before))
  })

  it('a change the template does not have is said', async () => {
    const workbook = await exportedFile()
    const where = set(workbook, 'Exceptions', 'ex-003-skip', 'change', textCell('tc-nothing'))
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.change-unknown', 'Exceptions', where.row, 'change', where.cell),
    ])
  })

  it('a site that is not in the rollout, or no site at all, is said', async () => {
    const workbook = await exportedFile()
    const unknown = set(workbook, 'Exceptions', 'ex-003-skip', 'location', textCell('loc-emea'))
    const none = addRow(workbook, 'Exceptions', {
      kind: textCell('skip'),
      change: textCell('tc-fit'),
      class: textCell('legal'),
    })
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.site-unknown', 'Exceptions', unknown.row, 'location', unknown.cell),
      at('rollout-workbook.site-unknown', 'Exceptions', none, 'location', `B${none}`),
    ])
    expect(dryRun.problems[0]!.message).toContain('"loc-emea" is not a site of this rollout')
    expect(dryRun.problems[1]!.message).toContain('the row names no site')
  })

  it('a repeated id reads the first row only', async () => {
    const workbook = await exportedFile()
    const again = addRow(workbook, 'Exceptions', {
      id: textCell('ex-003-skip'),
      location: textCell(siteId(3)),
      kind: textCell('skip'),
      change: textCell('tc-eliminate'),
      class: textCell('legal'),
    })
    const { dryRun, before, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.duplicate-id', 'Exceptions', again, 'id', `A${again}`),
    ])
    expect(toCanonicalJson(after)).toBe(toCanonicalJson(before))
  })

  it('a removed site’s exceptions leave with it, and only an edit to one is said', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Sites', siteId(3), 'action', textCell('remove'))
    const edited = set(workbook, 'Exceptions', 'ex-003-skip', 'owner', textCell('Someone'))
    // A remove of one that leaves anyway has nothing to say.
    set(workbook, 'Exceptions', 'ex-003-add', 'action', textCell('remove'))
    const moved = set(workbook, 'Exceptions', 'ex-006-modify', 'location', textCell(siteId(3)))
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.site-removed', 'Exceptions', edited.row, 'id', `A${edited.row}`),
      at('rollout-workbook.site-removed', 'Exceptions', moved.row, 'location', moved.cell),
      ...DROPPED_OF_3,
    ])
    // Each leaves once, whatever its row says.
    expect(dryRun.tallies.exceptions).toEqual(tallied({ deleted: 3 }))
    expect(sitePlan(after, siteId(3))).toBeUndefined()
    expect(exceptionsOf(after, siteId(6))!.map((e) => e.id)).toEqual(['ex-006-modify'])
  })
})

describe('the Dependencies sheet (#214)', () => {
  it('exports one row per pair, by site and then by the site it depends on', () => {
    const sheet = sheetOf(exported(), 'Dependencies')
    expect(sheet.rows[0]).toEqual(['site', 'dependsOn', 'action'].map(textCell))
    // The fixture lists site 6's dependencies out of order: the sheet sorts them.
    expect(sheet.rows.slice(2).map((row) => row.slice(0, 2))).toEqual([
      [textCell(siteId(6)), textCell(siteId(2))],
      [textCell(siteId(6)), textCell(siteId(5))],
    ])
  })

  it('a new row adds a dependency, in sorted order', async () => {
    const workbook = await exportedFile()
    addRow(workbook, 'Dependencies', { site: textCell(siteId(6)), dependsOn: textCell(siteId(1)) })
    addRow(workbook, 'Dependencies', { site: textCell(siteId(9)), dependsOn: textCell(siteId(6)) })
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([])
    expect(dryRun.tallies.dependencies).toEqual(tallied({ created: 2, unchanged: 2 }))
    expect(dependsOnOf(after, siteId(6))).toEqual([siteId(1), siteId(2), siteId(5)])
    expect(dependsOnOf(after, siteId(9))).toEqual([siteId(6)])
  })

  it('remove deletes one, and a site left with none has no list', async () => {
    const workbook = await exportedFile()
    const sheet = sheetOf(workbook, 'Dependencies')
    const action = (row: number) => {
      const cells = sheet.rows[row]!
      while (cells.length < 3) cells.push(EMPTY)
      cells[2] = textCell('remove')
    }
    action(2)
    const one = commit(workspace(), workbook)
    expect(one.dryRun.problems).toEqual([])
    expect(one.dryRun.tallies.dependencies).toEqual(tallied({ deleted: 1, unchanged: 1 }))
    expect(dependsOnOf(one.after, siteId(6))).toEqual([siteId(5)])
    action(3)
    const both = commit(workspace(), workbook)
    expect(both.dryRun.tallies.dependencies).toEqual(tallied({ deleted: 2 }))
    expect(sitePlan(both.after, siteId(6))).not.toHaveProperty('dependsOn')
  })

  it.each([
    [
      'remove of one the site does not have',
      { site: siteId(7), dependsOn: siteId(2), action: 'remove' },
      'rollout-workbook.remove-not-found',
      'action',
    ],
    [
      'an action that is not remove',
      { site: siteId(7), dependsOn: siteId(2), action: 'drop' },
      'rollout-workbook.action-unknown',
      'action',
    ],
    [
      'a row with no site',
      { dependsOn: siteId(2) },
      'rollout-workbook.dependency-incomplete',
      'site',
    ],
    [
      'a row with nothing to depend on',
      { site: siteId(7) },
      'rollout-workbook.dependency-incomplete',
      'dependsOn',
    ],
    [
      'a site depending on itself',
      { site: siteId(7), dependsOn: siteId(7) },
      'rollout-workbook.dependency-self',
      'dependsOn',
    ],
    [
      'a site that is not in the rollout',
      { site: 'loc-emea', dependsOn: siteId(2) },
      'rollout-workbook.site-unknown',
      'site',
    ],
    [
      'a dependency on a site that is not in the rollout',
      { site: siteId(7), dependsOn: 'loc-emea' },
      'rollout-workbook.site-unknown',
      'dependsOn',
    ],
  ])('%s is said, and changes nothing', async (_, cells, code, key) => {
    const workbook = await exportedFile()
    const row = addRow(
      workbook,
      'Dependencies',
      Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, textCell(v)])),
    )
    const { dryRun, before, after } = commit(workspace(), workbook)
    const column = ({ site: 'A', dependsOn: 'B', action: 'C' } as Record<string, string>)[key]!
    expect(dryRun.problems).toEqual([at(code, 'Dependencies', row, key, `${column}${row}`)])
    expect(toCanonicalJson(after)).toBe(toCanonicalJson(before))
  })

  it('a repeated pair reads the first row only', async () => {
    const workbook = await exportedFile()
    addRow(workbook, 'Dependencies', { site: textCell(siteId(7)), dependsOn: textCell(siteId(2)) })
    const again = addRow(workbook, 'Dependencies', {
      site: textCell(siteId(7)),
      dependsOn: textCell(siteId(2)),
      action: textCell('remove'),
    })
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.duplicate-id', 'Dependencies', again, 'site', `A${again}`),
    ])
    expect(dependsOnOf(after, siteId(7))).toEqual([siteId(2)])
  })

  it('a sheet with no dependsOn column is not read', async () => {
    const workbook = await exportedFile()
    dropColumn(workbook, 'Dependencies', 'dependsOn')
    const dryRun = plan(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      expect.objectContaining({
        code: 'rollout-workbook.key-column-missing',
        sheet: 'Dependencies',
      }),
    ])
    expect(dryRun.tallies.dependencies).toEqual(tallied({}))
  })

  it('a removed site takes the dependencies of and on it, and only a new one is said', async () => {
    const workbook = await exportedFile()
    set(workbook, 'Sites', siteId(6), 'action', textCell('remove'))
    set(workbook, 'Sites', siteId(2), 'action', textCell('remove'))
    const added = addRow(workbook, 'Dependencies', {
      site: textCell(siteId(9)),
      dependsOn: textCell(siteId(2)),
    })
    addRow(workbook, 'Dependencies', { site: textCell(siteId(5)), dependsOn: textCell(siteId(4)) })
    const { dryRun, after } = commit(workspace(), workbook)
    // Site 6's own pairs leave with it, each said and counted (ADR 0017 point 11).
    const ownDropped = (id: string) => ({
      severity: 'info',
      code: 'rollout-workbook.dependency-dropped',
      file: FILE,
      sheet: 'Sites',
      subject: siteId(6),
      message: `Sheet “Sites”: the Sites sheet takes "${siteId(6)}" out of the rollout, and its dependency on "${id}" with it.`,
    })
    expect(dryRun.problems).toEqual([
      at('rollout-workbook.site-removed', 'Dependencies', added, 'dependsOn', `B${added}`),
      ...exceptionsDropped(6, 'ex-006-modify'),
      ownDropped(siteId(2)),
      ownDropped(siteId(5)),
    ])
    expect(dryRun.tallies.dependencies).toEqual(tallied({ created: 1, deleted: 2 }))
    expect(dependsOnOf(after, siteId(9))).toBeUndefined()
    expect(dependsOnOf(after, siteId(5))).toEqual([siteId(4)])
  })

  it('a dependency on a removed site is dropped and said, with no Dependencies sheet at all', async () => {
    const workbook = await exportedFile()
    workbook.sheets = workbook.sheets.filter((sheet) => sheet.name !== 'Dependencies')
    set(workbook, 'Sites', siteId(5), 'action', textCell('remove'))
    const { dryRun, after } = commit(workspace(), workbook)
    expect(dryRun.problems).toEqual([
      expect.objectContaining({ code: 'rollout-workbook.sheet-missing', sheet: 'Dependencies' }),
      DROPPED_5_FROM_6,
    ])
    expect(dryRun.tallies.dependencies).toEqual(tallied({ deleted: 1 }))
    expect(dependsOnOf(after, siteId(6))).toEqual([siteId(2)])
  })
})
