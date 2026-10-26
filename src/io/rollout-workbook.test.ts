import { describe, expect, it } from 'vitest'
import { rolloutPlanOf, wavePlanOf, type Element, type View, type Workspace } from '@/model'
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
  it('holds Sites, Waves, SitePlan and Template, technical keys in row 1 and labels in row 2', () => {
    const workbook = exported()
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
      'Sites',
      'Waves',
      'SitePlan',
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
    ])
    expect(keys('SitePlan')).toEqual([
      'location',
      'name',
      'wave',
      'archetype',
      'rag',
      'milestone.mappingSignedOff',
      'milestone.freezeStart',
      'milestone.reconciliationSignedOff',
      'milestone.hypercareEnd',
      'milestone.legacyDecommissioned',
    ])
    expect(sheetOf(workbook, 'SitePlan').rows[1]![6]).toEqual(textCell('Freeze starts (planned)'))
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
      ],
      [
        textCell(waveId(1)),
        textCell('W1'),
        numberCell(1),
        textCell('2027-04'),
        textCell('2027-06'),
        EMPTY,
        numberCell(2),
      ],
    ])
    // Site 12: a wave, no archetype, no RAG, a month, a week and a day override.
    expect(sheetOf(workbook, 'SitePlan').rows[2 + 11]).toEqual([
      textCell(siteId(12)),
      textCell('Site 012'),
      textCell(waveId(1)),
      EMPTY,
      EMPTY,
      textCell('2027-03'),
      textCell('2027-W19'),
      EMPTY,
      textCell('2027-07-13'),
      EMPTY,
    ])
    expect(sheetOf(workbook, 'SitePlan').rows[2 + 9]!.slice(3, 5)).toEqual([
      textCell('plant'),
      textCell('amber'),
    ])
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

  it('says what it cannot carry: a second parent region, actual dates and notes', () => {
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
        message: expect.stringContaining('4 sites have actual dates or notes'),
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
    expect(dryRun.problems).toEqual([])
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
      { freezeStart: { date: '2027-05-10', precision: 'week' } },
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
    const { dryRun, after } = commit(workspace(), workbook)
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
      { id: 'a.b', label: 'Dotted', startsPhase: 'done' },
    )
    rollout.sites[0]!.milestones = {
      'milestone.go': { date: '2027-04-01', precision: 'quarter' },
      'a.b': { date: '2027-05-01', precision: 'month' },
    }
    const workbook = await exportedFile(model)
    const keys = sheetOf(workbook, 'SitePlan').rows[0]!.slice(-2)
    expect(keys).toEqual([textCell('milestone.milestone.go'), textCell('milestone.a.b')])
    const { dryRun, result } = commit(model, workbook)
    expect(dryRun.problems).toEqual([])
    expect(result).toBe('unchanged')
    set(workbook, 'SitePlan', siteId(1), 'milestone.a.b', textCell('2027-06'))
    const edited = commit(model, workbook)
    expect(sitePlan(edited.after, siteId(1))!.milestones).toEqual({
      'milestone.go': { date: '2027-04-01', precision: 'quarter' },
      'a.b': { date: '2027-06-01', precision: 'month' },
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
