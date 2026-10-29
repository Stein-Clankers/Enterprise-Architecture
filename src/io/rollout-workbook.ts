import {
  archetypeIdOf,
  byLocation,
  formatPlanDate,
  isGoNoGo,
  isIsoDay,
  isPositiveInteger,
  isSiteRag,
  parsePlanDate,
  rolloutPlanOf,
  waveIdOf,
  wavePlanOf,
  wavesOf,
  type Element,
  type PlanDate,
  type PropertyValue,
  type Relationship,
  type RolloutPlan,
  type SitePlan,
  type TemplateChange,
  type WavePlan,
} from '@/model'
import { problem, type ProblemSeverity } from './problems'
import { getKey, setKey } from './records'
import {
  booleanCell,
  cellAt,
  cellReference,
  columnName,
  EMPTY,
  numberCell,
  tableRows,
  textCell,
  type Cell,
  type Column,
  type ReadCell,
  type Sheet,
  type Workbook,
  type XlsxProblem,
} from './xlsx'

/**
 * The rollout workbook (#210): one `.xlsx` per rollout, both its export and
 * its import template, by #94's conventions. Pure: it turns a model into a
 * `Workbook` and a read `Workbook` into a dry run, and the store's
 * `applyRolloutImport` (`src/store/rollout-workbook.ts`) commits that dry run
 * as one command. The file format is `xlsx-read.ts` and `xlsx-write.ts`.
 *
 * **Sheets.** `Sites` (one row per site's Location), `Waves` (with one column
 * per milestone for the date its sites inherit), `SitePlan` (wave, archetype,
 * RAG, go/no-go, and two columns per milestone of the rollout's set: the
 * site's own planned date, a blank cell making it inherit again, ADR 0016, and
 * the day it was actually reached, #215), and `Template` and `Milestones`,
 * written for reference and never read back (R1). Row 1 holds each column's
 * technical key, the file's contract, and row 2 its label.
 *
 * **Reading a cell.** A blank cell deletes the value it stands for; a column
 * the header does not name leaves every value of it untouched; a cell the
 * reader could not read leaves its value untouched, and the reader has said
 * so. A plan date is read by its form (`2027-Q2`, `2027-05`, `2027-W19`,
 * `2027-05-12`, ADR 0015), and a date cell as a day. An actual is a day: a
 * date cell, or text `2027-05-12`; anything else is reported and not stored.
 *
 * **Actuals change nothing else.** The PMO returns actual days, RAG and
 * go/no-go in the SitePlan sheet (proposal §5, L3). Those columns write only
 * those fields of a site plan, and the phase is derived from them, never
 * stored (#215).
 *
 * **Nothing is skipped in silence.** Every value or row that is not applied is
 * a problem naming its sheet, row and column: an unknown site, wave, archetype
 * or parent, a duplicate id, an unparseable date, a column or sheet that is
 * not read. Rows are tallied only once they are kept, and a row that changes
 * nothing is tallied as unchanged, so the preview's counts are the commit's.
 */

export const SHEET_NAMES = {
  sites: 'Sites',
  waves: 'Waves',
  sitePlan: 'SitePlan',
  milestones: 'Milestones',
  template: 'Template',
} as const

/** Interim site fields live under this prefix until #70's custom fields (ADR 0013 point 8). */
export const SITE_FIELD_PREFIX = 'archipelago.site.'
/** A site's code, a site field the `Sites` sheet always carries. */
export const SITE_CODE_KEY = `${SITE_FIELD_PREFIX}code`
/**
 * The `SitePlan` column of a milestone is this prefix and its id. The id is
 * taken as everything after the prefix, so it may hold any character,
 * including a dot or the prefix itself, and still be read back as written.
 */
export const MILESTONE_COLUMN_PREFIX = 'milestone.'
/**
 * The `SitePlan` column of a milestone's actual day is this prefix and its id,
 * read as the milestone column is (#215).
 */
export const ACTUAL_COLUMN_PREFIX = 'actual.'

/** The model the workbook is made from: a snapshot's elements and relationships. */
export interface RolloutModel {
  elements: readonly Element[]
  relationships: readonly Relationship[]
}

/** A problem of the rollout workbook: its sheet and cell, and the row and column key. */
export interface RolloutWorkbookProblem extends XlsxProblem {
  /** 1-based, as Excel numbers rows. */
  row?: number
  /** The column's technical key, from row 1. */
  column?: string
}

// ── Export ───────────────────────────────────────────────────────────────────

export interface RolloutWorkbookExport {
  workbook: Workbook
  /** What the workbook cannot carry. */
  problems: RolloutWorkbookProblem[]
}

/** The workbook of `rolloutId`, or `undefined` when it is no rollout of the model. */
export function exportRolloutWorkbook(
  model: RolloutModel,
  rolloutId: string,
): RolloutWorkbookExport | undefined {
  const index = indexModel(model)
  const rollout = index.elements.get(rolloutId)
  const plan = rolloutPlanOf(rollout)
  if (!plan) return undefined
  const problems: RolloutWorkbookProblem[] = []
  const report = (code: string, message: string, subject?: string) =>
    problems.push(
      problem<RolloutWorkbookProblem>('info', code, message, subject ? { subject } : {}),
    )

  const locations = plan.sites
    .map((site) => index.elements.get(site.location))
    .filter((element): element is Element => element?.type === 'Location')
  const siteRows = locations.map((location) => {
    const parents = parentsOf(index, location.id)
    if (parents.length > 1) {
      report(
        'rollout-workbook.parents-not-carried',
        `Site “${location.name}” (${location.id}) is aggregated by ${parents.length} Locations; the workbook shows ${parents[0]!.source}, and an import that leaves that cell as it is keeps all of them.`,
        location.id,
      )
    }
    return { location, parent: parents[0]?.source }
  })
  const fields = siteFieldKeys(locations)
  const sites = siteColumns(fields)
  const sitesSheet: Sheet = {
    name: SHEET_NAMES.sites,
    rows: tableRows(
      sites,
      siteRows.map(({ location, parent }) =>
        sites.map((column): Cell => {
          switch (column.key) {
            case 'id':
              return textCell(location.id)
            case 'name':
              return textCell(location.name)
            case 'parent':
              return parent === undefined ? EMPTY : textCell(parent)
            case 'action':
              return EMPTY
            default:
              return propertyCell(location.properties[column.key])
          }
        }),
      ),
    ),
  }

  const waves = wavesOf(model.elements, rolloutId)
  const wavesSheet: Sheet = {
    name: SHEET_NAMES.waves,
    rows: tableRows(
      waveColumns(plan),
      waves.map((wave) => {
        const p = wavePlanOf(wave)!
        return [
          textCell(wave.id),
          textCell(p.label),
          numberCell(p.order),
          planDateCell(p.window?.start),
          planDateCell(p.window?.end),
          p.capacity === undefined ? EMPTY : numberCell(p.capacity),
          numberCell(p.templateVersion),
          ...plan.milestones.map((milestone) => planDateCell(getKey(p.milestones, milestone.id))),
        ]
      }),
    ),
  }

  const planColumns = sitePlanColumns(plan)
  const notCarried = plan.sites.filter((site) => site.notes !== undefined).length
  if (notCarried) {
    report(
      'rollout-workbook.not-carried',
      `${notCarried} site${notCarried === 1 ? ' has' : 's have'} notes, which this workbook does not carry yet; an import of it leaves them as they are.`,
    )
  }
  // A date for a milestone the set no longer has (validate() reports it) has
  // no column to go in. The import starts from the plan as it is, so it keeps
  // the date; the export says so, rather than leave it out unseen.
  const known = new Set(plan.milestones.map((milestone) => milestone.id))
  const strays = plan.sites.filter((site) =>
    [...Object.keys(site.milestones ?? {}), ...Object.keys(site.actuals ?? {})].some(
      (id) => !known.has(id),
    ),
  ).length
  if (strays) {
    report(
      'rollout-workbook.dates-not-carried',
      `${strays} site${strays === 1 ? ' has' : 's have'} planned or actual dates for milestones the rollout's set does not have, which have no column in this workbook; an import of it leaves them as they are.`,
    )
  }
  const sitePlanSheet: Sheet = {
    name: SHEET_NAMES.sitePlan,
    rows: tableRows(
      planColumns,
      plan.sites.map((site) => [
        textCell(site.location),
        textCell(index.elements.get(site.location)?.name ?? ''),
        site.wave === undefined ? EMPTY : textCell(site.wave),
        site.archetype === undefined ? EMPTY : textCell(site.archetype),
        site.rag === undefined ? EMPTY : textCell(site.rag),
        site.goNoGo === undefined ? EMPTY : textCell(site.goNoGo),
        ...plan.milestones.flatMap((milestone) => {
          const actual = getKey(site.actuals, milestone.id)
          return [
            planDateCell(getKey(site.milestones, milestone.id)),
            actual === undefined ? EMPTY : textCell(actual),
          ]
        }),
      ]),
    ),
  }

  return {
    workbook: {
      sheets: [sitesSheet, wavesSheet, sitePlanSheet, milestonesSheet(plan), templateSheet(plan)],
    },
    problems,
  }
}

/** A file name for the workbook: the rollout's name, made safe. */
export function rolloutWorkbookFileName(rolloutName: string): string {
  const slug = rolloutName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'rollout'}-workbook.xlsx`
}

const SITE_COLUMNS_BEFORE: readonly Column[] = [
  { key: 'id', label: 'Id (blank: a new Location)' },
  { key: 'name', label: 'Name' },
  { key: 'parent', label: 'Parent region (Location id)' },
]
const ACTION_COLUMN: Column = {
  key: 'action',
  label: 'Action (remove: take the site out of the rollout)',
}

function siteColumns(fields: readonly string[]): Column[] {
  return [
    ...SITE_COLUMNS_BEFORE,
    ...fields.map((key) => ({
      key,
      label: key === SITE_CODE_KEY ? 'Code' : key.slice(SITE_FIELD_PREFIX.length),
    })),
    ACTION_COLUMN,
  ]
}

/** The site fields any of the sites has, the code first and always; then by code unit (ADR 0004). */
function siteFieldKeys(locations: readonly Element[]): string[] {
  const keys = new Set<string>()
  for (const location of locations) {
    for (const key of Object.keys(location.properties)) {
      if (key.startsWith(SITE_FIELD_PREFIX) && key !== SITE_CODE_KEY) keys.add(key)
    }
  }
  return [SITE_CODE_KEY, ...[...keys].sort(byCodeUnit)]
}

const WAVE_COLUMNS: readonly Column[] = [
  { key: 'id', label: 'Id' },
  { key: 'label', label: 'Label' },
  { key: 'order', label: 'Order' },
  { key: 'windowStart', label: 'Window start' },
  { key: 'windowEnd', label: 'Window end' },
  { key: 'capacity', label: 'Capacity (sites)' },
  { key: 'templateVersion', label: 'Template version' },
]

/** The wave's own columns, then one per milestone: the dates its sites inherit (#213). */
function waveColumns(plan: RolloutPlan): Column[] {
  return [
    ...WAVE_COLUMNS,
    ...plan.milestones.map((milestone) => ({
      key: `${MILESTONE_COLUMN_PREFIX}${milestone.id}`,
      label: `${milestone.label} (its sites inherit this)`,
    })),
  ]
}

function sitePlanColumns(plan: RolloutPlan): Column[] {
  return [
    { key: 'location', label: 'Site (Location id)' },
    { key: 'name', label: 'Name (read-only: change it in Sites)' },
    { key: 'wave', label: 'Wave (id)' },
    { key: 'archetype', label: 'Archetype (id)' },
    { key: 'rag', label: 'RAG (green, amber, red)' },
    { key: 'goNoGo', label: 'Go/no-go (go, no-go; blank: not decided)' },
    ...plan.milestones.flatMap((milestone) => [
      {
        key: `${MILESTONE_COLUMN_PREFIX}${milestone.id}`,
        label: `${milestone.label} (set at the site; blank: inherit)`,
      },
      {
        key: `${ACTUAL_COLUMN_PREFIX}${milestone.id}`,
        label: `${milestone.label}: actual day (2027-05-12; blank: not reached)`,
      },
    ]),
  ]
}

const MILESTONE_COLUMNS: readonly Column[] = [
  { key: 'id', label: 'Id (read-only sheet)' },
  { key: 'label', label: 'Label' },
  { key: 'startsPhase', label: 'Starts phase' },
  { key: 'date', label: 'Rollout date (sites inherit it last)' },
]

/**
 * The milestone set, in order, with the rollout's own dates (#213): written
 * for reference and never read back, as the template is. The set is edited
 * in the app.
 */
function milestonesSheet(plan: RolloutPlan): Sheet {
  return {
    name: SHEET_NAMES.milestones,
    rows: tableRows(
      MILESTONE_COLUMNS,
      plan.milestones.map((milestone) => [
        textCell(milestone.id),
        textCell(milestone.label),
        textCell(milestone.startsPhase),
        planDateCell(milestone.date),
      ]),
    ),
  }
}

const TEMPLATE_COLUMNS: readonly Column[] = [
  { key: 'id', label: 'Id (read-only sheet)' },
  { key: 'kind', label: 'Kind' },
  { key: 'subject', label: 'Subject' },
  { key: 'successor', label: 'Successor' },
  { key: 'field', label: 'Field' },
  { key: 'value', label: 'Value' },
  { key: 'date', label: 'Date' },
  { key: 'anchor', label: 'Anchor milestone' },
  { key: 'offsetDays', label: 'Offset (days)' },
  { key: 'applicability', label: 'Applies to' },
  { key: 'element', label: 'Aggregating element' },
  { key: 'archetypes', label: 'Archetypes (JSON)' },
]

/** The template, written for reference; R1 never reads it back. */
function templateSheet(plan: RolloutPlan): Sheet {
  return {
    name: SHEET_NAMES.template,
    rows: tableRows(TEMPLATE_COLUMNS, plan.template.map(templateRow)),
  }
}

function templateRow(change: TemplateChange): Cell[] {
  const text = (value: string | undefined) => (value === undefined ? EMPTY : textCell(value))
  const date = change.date
  const applicability = change.applicability
  return [
    textCell(change.id),
    textCell(change.kind),
    textCell(change.subject),
    text(change.kind === 'replace' ? change.successor : undefined),
    text(change.kind === 'modify' ? change.field : undefined),
    change.kind !== 'modify'
      ? EMPTY
      : typeof change.value === 'number'
        ? numberCell(change.value)
        : textCell(change.value),
    'precision' in date ? textCell(formatPlanDate(date)) : EMPTY,
    'anchor' in date ? textCell(date.anchor) : EMPTY,
    'anchor' in date ? numberCell(date.offsetDays) : EMPTY,
    textCell(applicability.kind),
    text(applicability.kind === 'aggregating' ? applicability.element : undefined),
    // A list in one cell is JSON, never ids joined by a separator (CLAUDE.md).
    applicability.kind === 'archetypes'
      ? textCell(JSON.stringify(applicability.archetypes))
      : EMPTY,
  ]
}

function propertyCell(value: PropertyValue | undefined): Cell {
  if (value === undefined) return EMPTY
  if (typeof value === 'number') return numberCell(value)
  if (typeof value === 'boolean') return booleanCell(value)
  return textCell(value)
}

function planDateCell(value: PlanDate | undefined): Cell {
  return value === undefined ? EMPTY : textCell(formatPlanDate(value))
}

// ── Import ───────────────────────────────────────────────────────────────────

/** Rows of one sheet, by what applying them does. Only rows that are kept are counted. */
export interface Tally {
  created: number
  updated: number
  deleted: number
  unchanged: number
}

/** The model changes an import makes, against the snapshot it was planned on. */
export interface RolloutChanges {
  /** New Locations. */
  addElements: Element[]
  /** Locations, waves and the rollout, each as it was in the snapshot and as it becomes. */
  updateElements: { before: Element; after: Element }[]
  /** Aggregations from a site's new parent region. */
  addRelationships: Relationship[]
  /** Aggregations from a site's former parent regions, as they are in the snapshot. */
  removeRelationships: Relationship[]
}

/** The dry run of an import: what it would change, counted, and what it cannot apply. */
export interface RolloutImportPlan {
  rolloutId: string
  tallies: { sites: Tally; waves: Tally; sitePlans: Tally }
  problems: RolloutWorkbookProblem[]
  changes: RolloutChanges
}

/** Mints the id of a new Location or Aggregation; the store passes its own. */
export type NewId = (prefix: 'el' | 'rel') => string

/**
 * The dry run of importing `workbook` into `rolloutId`. Nothing in `model` is
 * changed; `applyRolloutImport` commits exactly `changes`, so the tallies are
 * what the commit applies.
 */
export function planRolloutImport(
  model: RolloutModel,
  rolloutId: string,
  workbook: Workbook<ReadCell>,
  newId: NewId,
  file?: string,
): RolloutImportPlan {
  const index = indexModel(model)
  const rollout = index.elements.get(rolloutId)
  const plan = rolloutPlanOf(rollout)
  const result: RolloutImportPlan = {
    rolloutId,
    tallies: { sites: tally(), waves: tally(), sitePlans: tally() },
    problems: [],
    changes: { addElements: [], updateElements: [], addRelationships: [], removeRelationships: [] },
  }
  const where = file === undefined ? {} : { file }
  if (!rollout || !plan) {
    result.problems.push(
      problem<RolloutWorkbookProblem>(
        'error',
        'rollout-workbook.rollout-unknown',
        `The model has no rollout ${JSON.stringify(rolloutId)} to import into.`,
        where,
      ),
    )
    return result
  }
  const context: ImportContext = {
    index,
    rolloutId,
    plan,
    newId,
    result,
    report: (severity, code, message, at) =>
      result.problems.push(problemAt(severity, code, message, at, where)),
    sites: new Map(plan.sites.map((site) => [site.location, site])),
    removed: new Set(),
    sitesChanged: false,
  }

  const sheets = new Map<string, Sheet<ReadCell>>()
  for (const sheet of workbook.sheets) {
    if (!(Object.values(SHEET_NAMES) as string[]).includes(sheet.name)) {
      context.report(
        'warning',
        'rollout-workbook.sheet-unknown',
        'it is not a sheet of the rollout workbook, so nothing in it was read.',
        { sheet: sheet.name },
      )
      continue
    }
    sheets.set(sheet.name, sheet)
  }
  for (const name of [SHEET_NAMES.sites, SHEET_NAMES.waves, SHEET_NAMES.sitePlan]) {
    if (!sheets.has(name)) {
      context.report(
        'info',
        'rollout-workbook.sheet-missing',
        'the workbook has no such sheet, so what it would hold was left as it is.',
        { sheet: name },
      )
    }
  }

  // Sites first: a site the Sites sheet adds or removes is or is not one the
  // SitePlan sheet may plan.
  const sitesSheet = sheets.get(SHEET_NAMES.sites)
  if (sitesSheet) importSites(context, sitesSheet)
  const wavesSheet = sheets.get(SHEET_NAMES.waves)
  if (wavesSheet) importWaves(context, wavesSheet)
  const sitePlanSheet = sheets.get(SHEET_NAMES.sitePlan)
  if (sitePlanSheet) importSitePlans(context, sitePlanSheet)
  const milestones = sheets.get(SHEET_NAMES.milestones)
  if (milestones) checkReadOnly(context, milestones, milestonesSheet(plan), 'milestone set')
  const template = sheets.get(SHEET_NAMES.template)
  if (template) checkReadOnly(context, template, templateSheet(plan), 'template')

  if (context.sitesChanged) {
    const after: Element = {
      ...rollout,
      plan: { ...plan, sites: [...context.sites.values()].sort(byLocation) },
    }
    result.changes.updateElements.push({ before: rollout, after })
  }
  return result
}

// ── Import: the parts ────────────────────────────────────────────────────────

interface ModelIndex {
  elements: Map<string, Element>
  relationships: readonly Relationship[]
}

function indexModel(model: RolloutModel): ModelIndex {
  return {
    elements: new Map(model.elements.map((element) => [element.id, element])),
    relationships: model.relationships,
  }
}

/** The Aggregations that make Locations a site's parent regions, by source id. */
function parentsOf(index: ModelIndex, locationId: string): Relationship[] {
  return index.relationships
    .filter(
      (relationship) =>
        relationship.type === 'Aggregation' &&
        relationship.target === locationId &&
        index.elements.get(relationship.source)?.type === 'Location',
    )
    .sort((a, b) => byCodeUnit(a.source, b.source) || byCodeUnit(a.id, b.id))
}

interface At {
  sheet: string
  /** 0-based row of the sheet. */
  row?: number
  /** 0-based column of the sheet. */
  column?: number
  key?: string
  subject?: string
}

type Report = (severity: ProblemSeverity, code: string, message: string, at: At) => void

function problemAt(
  severity: ProblemSeverity,
  code: string,
  message: string,
  at: At,
  where: { file?: string },
): RolloutWorkbookProblem {
  const cell =
    at.row !== undefined && at.column !== undefined ? cellReference(at.row, at.column) : undefined
  const place = [
    `Sheet “${at.sheet}”`,
    ...(at.row === undefined ? [] : [`row ${at.row + 1}`]),
    ...(at.key === undefined ? [] : [`column ${at.key}${cell ? ` (${cell})` : ''}`]),
  ].join(', ')
  return problem<RolloutWorkbookProblem>(severity, code, `${place}: ${message}`, {
    ...where,
    sheet: at.sheet,
    ...(at.row === undefined ? {} : { row: at.row + 1 }),
    ...(at.key === undefined ? {} : { column: at.key }),
    ...(cell === undefined ? {} : { cell }),
    ...(at.subject === undefined ? {} : { subject: at.subject }),
  })
}

interface ImportContext {
  index: ModelIndex
  rolloutId: string
  plan: RolloutPlan
  newId: NewId
  result: RolloutImportPlan
  report: Report
  /** The rollout's site plans as the import leaves them, by Location id. */
  sites: Map<string, SitePlan>
  /** Sites a `Sites` row takes out of the rollout. */
  removed: Set<string>
  sitesChanged: boolean
}

function tally(): Tally {
  return { created: 0, updated: 0, deleted: 0, unchanged: 0 }
}

/**
 * A table sheet's columns, as row 1 names them. `known` says whether a key is
 * one this sheet reads. A column it does not know, a second column with a key
 * already read, and a column with values and no key are each reported and
 * not read.
 */
interface Table {
  sheet: Sheet<ReadCell>
  columns: Map<string, number>
  /** 0-based indexes of the data rows that hold something in a column that is read. */
  rows: number[]
}

function readTable(
  context: ImportContext,
  sheet: Sheet<ReadCell>,
  known: (key: string) => boolean,
  idKey: string,
): Table | undefined {
  // A loop, not `Math.max(...)`: a sheet can have more rows than a call takes arguments.
  let width = 0
  for (const row of sheet.rows) width = Math.max(width, row.length)
  const columns = new Map<string, number>()
  for (let column = 0; column < width; column++) {
    const cell = cellAt(sheet, 0, column)
    const at = { sheet: sheet.name, row: 0, column }
    if (cell.kind === 'empty' || (cell.kind === 'string' && cell.value === '')) {
      const values = sheet.rows.slice(2).filter((row) => (row[column]?.kind ?? 'empty') !== 'empty')
      if (values.length) {
        context.report(
          'warning',
          'rollout-workbook.column-unnamed',
          `column ${columnName(column)} holds ${values.length} value${values.length === 1 ? '' : 's'} and no key in row 1, so none of them was read.`,
          at,
        )
      }
      continue
    }
    const key = cell.kind === 'string' ? cell.value : undefined
    if (key === undefined || !known(key)) {
      context.report(
        'warning',
        'rollout-workbook.column-unknown',
        `${key !== undefined ? `${JSON.stringify(key)} is not a column of this sheet` : cell.kind === 'unreadable' ? 'its key could not be read' : `row 1 holds ${describeCell(cell)}, which is no key`}, so the column was not read.`,
        { ...at, ...(key === undefined ? {} : { key }) },
      )
      continue
    }
    if (columns.has(key)) {
      context.report(
        'warning',
        'rollout-workbook.column-repeated',
        `the key is in row 1 twice; the first column was read and this one was not.`,
        { ...at, key },
      )
      continue
    }
    columns.set(key, column)
  }
  if (!columns.has(idKey)) {
    context.report(
      'error',
      'rollout-workbook.key-column-missing',
      `row 1 names no ${idKey} column, which says which row is which, so the sheet was not read.`,
      { sheet: sheet.name, key: idKey },
    )
    return undefined
  }
  const read = [...columns.values()]
  const rows: number[] = []
  for (let row = 2; row < sheet.rows.length; row++) {
    if (read.some((column) => cellAt(sheet, row, column).kind !== 'empty')) rows.push(row)
  }
  return { sheet, columns, rows }
}

/**
 * A cell read for a field: `undefined` leaves the value untouched (the column
 * is missing, the cell unreadable, or its value refused and reported);
 * `{ value: undefined }` is a blank, which deletes it; `{ value }` sets it.
 */
type Field<T> = { value: T | undefined } | undefined

const BLANK = Object.freeze({ value: undefined })

class Row {
  constructor(
    private readonly context: ImportContext,
    private readonly table: Table,
    readonly index: number,
  ) {}

  get sheet(): string {
    return this.table.sheet.name
  }

  at(key: string, subject?: string): At {
    return {
      sheet: this.sheet,
      row: this.index,
      key,
      ...(this.table.columns.has(key) ? { column: this.table.columns.get(key)! } : {}),
      ...(subject === undefined ? {} : { subject }),
    }
  }

  report(severity: ProblemSeverity, code: string, message: string, key: string, subject?: string) {
    this.context.report(severity, code, message, this.at(key, subject))
  }

  cell(key: string): ReadCell | undefined {
    const column = this.table.columns.get(key)
    return column === undefined ? undefined : cellAt(this.table.sheet, this.index, column)
  }

  /** Text, as an id, a label or a name holds it. */
  text(key: string): Field<string> {
    const cell = this.cell(key)
    if (cell === undefined || cell.kind === 'unreadable') return undefined
    if (cell.kind === 'empty') return BLANK
    if (cell.kind === 'string') return { value: cell.value }
    this.report(
      'error',
      'rollout-workbook.not-text',
      `the cell holds ${describeCell(cell)} where text is expected, so it was not applied.`,
      key,
    )
    return undefined
  }

  /**
   * Text that is one of a few words, such as a RAG: empty text is a blank, as
   * an empty cell is, since nothing tells the two apart on screen (#226).
   */
  word(key: string): Field<string> {
    const field = this.text(key)
    return field?.value === '' ? BLANK : field
  }

  /**
   * The day a milestone was actually reached (#215): a date cell, or text
   * written as an ISO day. Empty text is a blank, as for `word`. Anything else,
   * `2027-Q2` or `31/02/2027` among it, is reported and not applied, so a
   * malformed day is never stored and never dropped unseen.
   */
  actualDay(key: string): Field<string> {
    const cell = this.cell(key)
    if (cell === undefined || cell.kind === 'unreadable') return undefined
    if (cell.kind === 'empty' || (cell.kind === 'string' && cell.value === '')) return BLANK
    const day = cell.kind === 'date' || cell.kind === 'string' ? cell.value : undefined
    if (isIsoDay(day)) return { value: day }
    this.report(
      'error',
      'rollout-workbook.actual-unreadable',
      `the cell holds ${describeCell(cell)}, which is no day: an actual is the day the milestone was reached, written 2027-05-12 or as a date. It was not applied.`,
      key,
    )
    return undefined
  }

  /** A site field keeps the kind of value Excel holds: text, a number or TRUE/FALSE; a date is its ISO day. */
  property(key: string): Field<PropertyValue> {
    const cell = this.cell(key)
    if (cell === undefined || cell.kind === 'unreadable') return undefined
    return cell.kind === 'empty' ? BLANK : { value: cell.value }
  }

  /** A whole number that `guard` accepts. */
  integer(key: string, guard: (value: number) => boolean, what: string): Field<number> {
    const cell = this.cell(key)
    if (cell === undefined || cell.kind === 'unreadable') return undefined
    if (cell.kind === 'empty') return BLANK
    if (cell.kind === 'number' && guard(cell.value)) return { value: cell.value }
    this.report(
      'error',
      'rollout-workbook.number-refused',
      `the cell holds ${describeCell(cell)}, where ${what} is expected, so it was not applied.`,
      key,
    )
    return undefined
  }

  /** A plan date: a text cell by its form (ADR 0015), a date cell as a day. */
  planDate(key: string): Field<PlanDate> {
    const cell = this.cell(key)
    if (cell === undefined || cell.kind === 'unreadable') return undefined
    if (cell.kind === 'empty') return BLANK
    const parsed =
      cell.kind === 'string'
        ? parsePlanDate(cell.value)
        : cell.kind === 'date'
          ? { date: cell.value, precision: 'day' as const }
          : undefined
    if (parsed) return { value: parsed }
    this.report(
      'error',
      'rollout-workbook.date-unreadable',
      `the cell holds ${describeCell(cell)}, which is no plan date: write a quarter (2027-Q2), a month (2027-05), an ISO week (2027-W19) or a day (2027-05-12). It was not applied.`,
      key,
    )
    return undefined
  }
}

function describeCell(cell: Cell): string {
  switch (cell.kind) {
    case 'string':
      return `the text ${JSON.stringify(cell.value)}`
    case 'number':
      return `the number ${cell.value}`
    case 'boolean':
      return cell.value ? 'TRUE' : 'FALSE'
    case 'date':
      return `the date ${cell.value}`
    case 'empty':
      return 'nothing'
  }
}

/**
 * The key cell of each row, or `undefined` for a row that is not read: its key
 * is unreadable, or repeats one an earlier row holds (the first is read, the
 * later ones are not). Blank keys are returned as `''` for the caller.
 */
function rowKeys(context: ImportContext, table: Table, key: string): Map<number, string> {
  const keys = new Map<number, string>()
  const seen = new Map<string, number>()
  for (const index of table.rows) {
    const row = new Row(context, table, index)
    const cell = row.cell(key)!
    if (cell.kind !== 'empty' && cell.kind !== 'string') {
      row.report(
        'error',
        'rollout-workbook.row-key-unreadable',
        `${cell.kind === 'unreadable' ? 'the cell could not be read' : `the cell holds ${describeCell(cell)}, where an id is expected`}, so which row this is cannot be told and the row was not read.`,
        key,
      )
      continue
    }
    const value = cell.kind === 'string' ? cell.value : ''
    if (value !== '') {
      const first = seen.get(value)
      if (first !== undefined) {
        row.report(
          'error',
          'rollout-workbook.duplicate-id',
          `${JSON.stringify(value)} is also the id of row ${first + 1}; that row was read and this one was not.`,
          key,
          value,
        )
        continue
      }
      seen.set(value, index)
    }
    keys.set(index, value)
  }
  return keys
}

const SITE_KEYS = new Set(['id', 'name', 'parent', 'action'])

function importSites(context: ImportContext, sheet: Sheet<ReadCell>): void {
  const table = readTable(
    context,
    sheet,
    (key) => SITE_KEYS.has(key) || (key.startsWith(SITE_FIELD_PREFIX) && key !== SITE_FIELD_PREFIX),
    'id',
  )
  if (!table) return
  const fields = [...table.columns.keys()].filter((key) => key.startsWith(SITE_FIELD_PREFIX))
  const { index, result } = context
  for (const [rowIndex, id] of rowKeys(context, table, 'id')) {
    const row = new Row(context, table, rowIndex)
    // Read here, not through `text`: a row whose action cannot be told is not
    // read at all, since applying it might be the opposite of what it says.
    const action = row.cell('action') ?? EMPTY
    const removing = action.kind === 'string' && action.value === 'remove'
    if (action.kind !== 'empty' && !removing) {
      row.report(
        'error',
        'rollout-workbook.action-unknown',
        `${action.kind === 'unreadable' ? 'the cell could not be read' : `${describeCell(action)} is not an action`}; leave it blank, or write remove to take the site out of the rollout. The row was not read.`,
        'action',
        id || undefined,
      )
      continue
    }

    if (id === '') {
      if (removing) {
        row.report(
          'error',
          'rollout-workbook.remove-without-id',
          'a row with no id is a new Location, so there is nothing to remove; the row was not read.',
          'id',
        )
        continue
      }
      createSite(context, row, fields)
      continue
    }

    const location = index.elements.get(id)
    if (!location) {
      row.report(
        'error',
        'rollout-workbook.site-unknown',
        `the model has no element ${JSON.stringify(id)}, so the row was not read. Leave the id blank to create a Location.`,
        'id',
        id,
      )
      continue
    }
    if (location.type !== 'Location') {
      row.report(
        'error',
        'rollout-workbook.site-not-location',
        `${JSON.stringify(id)} is a ${location.type}, not a Location, so the row was not read.`,
        'id',
        id,
      )
      continue
    }

    const after = locationAfter(row, location, fields)
    const parent = parentChange(context, row, location.id)
    const inRollout = context.sites.has(id)
    if (removing) {
      if (!inRollout) {
        row.report(
          'warning',
          'rollout-workbook.remove-not-in-rollout',
          `${JSON.stringify(id)} is not a site of this rollout, so there is nothing to remove.`,
          'action',
          id,
        )
        result.tallies.sites.unchanged++
        continue
      }
      if (after !== location || parent) {
        row.report(
          'warning',
          'rollout-workbook.remove-ignores-changes',
          'the row takes the site out of the rollout, so the other changes in it were not applied.',
          'action',
          id,
        )
      }
      context.sites.delete(id)
      context.removed.add(id)
      context.sitesChanged = true
      result.tallies.sites.deleted++
      continue
    }

    let changed = false
    if (after !== location) {
      result.changes.updateElements.push({ before: location, after })
      changed = true
    }
    if (parent) {
      result.changes.removeRelationships.push(...parent.remove)
      if (parent.add) result.changes.addRelationships.push(parent.add)
      changed = true
    }
    if (!inRollout) {
      context.sites.set(id, { location: id })
      context.sitesChanged = true
      changed = true
    }
    result.tallies.sites[changed ? 'updated' : 'unchanged']++
  }
}

/** A new Location from a row with no id, with a site plan in the rollout. */
function createSite(context: ImportContext, row: Row, fields: readonly string[]): void {
  const id = context.newId('el')
  const blank: Element = { id, type: 'Location', name: '', properties: {} }
  const location = locationAfter(row, blank, fields)
  const parent = parentChange(context, row, id)
  context.result.changes.addElements.push(location)
  if (parent?.add) context.result.changes.addRelationships.push(parent.add)
  context.sites.set(id, { location: id })
  context.sitesChanged = true
  context.result.tallies.sites.created++
}

/** The Location with the row's name and site fields applied: the same object when nothing changes. */
function locationAfter(row: Row, location: Element, fields: readonly string[]): Element {
  let after = location
  const name = row.text('name')
  if (name !== undefined && (name.value ?? '') !== location.name) {
    after = { ...after, name: name.value ?? '' }
  }
  for (const key of fields) {
    const field = row.property(key)
    if (field === undefined || field.value === after.properties[key]) continue
    const properties = { ...after.properties }
    if (field.value === undefined) delete properties[key]
    else properties[key] = field.value
    after = { ...after, properties }
  }
  return after
}

/**
 * What the row's `parent` cell does to the site's parent regions, or
 * `undefined` for nothing. A blank takes every Location aggregation of the
 * site away. A Location already among its parents changes nothing, so a site
 * with two parents keeps both when the cell is left as exported; any other
 * Location replaces them all.
 */
function parentChange(
  context: ImportContext,
  row: Row,
  locationId: string,
): { remove: Relationship[]; add?: Relationship } | undefined {
  const field = row.text('parent')
  if (field === undefined) return undefined
  const current = parentsOf(context.index, locationId)
  if (field.value === undefined) return current.length ? { remove: current } : undefined
  const parent = context.index.elements.get(field.value)
  if (parent?.type !== 'Location') {
    row.report(
      'error',
      'rollout-workbook.parent-unknown',
      `${JSON.stringify(field.value)} is ${parent ? `a ${parent.type}, not a Location` : 'no element of the model'}, so the parent region was not changed.`,
      'parent',
      locationId,
    )
    return undefined
  }
  if (parent.id === locationId) {
    row.report(
      'error',
      'rollout-workbook.parent-self',
      'a site cannot be its own parent region, so the parent region was not changed.',
      'parent',
      locationId,
    )
    return undefined
  }
  if (current.some((relationship) => relationship.source === parent.id)) return undefined
  return {
    remove: current,
    add: {
      id: context.newId('rel'),
      type: 'Aggregation',
      source: parent.id,
      target: locationId,
      properties: {},
    },
  }
}

const WAVE_KEYS = new Set(WAVE_COLUMNS.map((column) => column.key))

/** Is `key` the column, under `prefix`, of a milestone of the rollout? */
function isMilestoneColumn(
  context: ImportContext,
  key: string,
  prefix: string = MILESTONE_COLUMN_PREFIX,
): boolean {
  return (
    key.startsWith(prefix) &&
    context.plan.milestones.some((milestone) => milestone.id === key.slice(prefix.length))
  )
}

/**
 * Each milestone column of `row` into `dates`, which it changes: a date sets
 * it, a blank deletes it (so the site or the wave inherits again, ADR 0016), a
 * cell that could not be read leaves it, and has been reported.
 */
function readMilestoneDates(
  row: Row,
  keys: readonly string[],
  dates: Record<string, PlanDate> | undefined,
): Record<string, PlanDate> | undefined {
  const out: Record<string, PlanDate> = { ...dates }
  for (const key of keys) {
    const field = row.planDate(key)
    if (field === undefined) continue
    const milestone = key.slice(MILESTONE_COLUMN_PREFIX.length)
    if (field.value === undefined) delete out[milestone]
    else setKey(out, milestone, field.value)
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Each actual column of `row` into `actuals`, which it changes: a day sets
 * it, a blank deletes it, and a cell that is no day leaves it, reported (#215).
 */
function readActualDays(
  row: Row,
  keys: readonly string[],
  actuals: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const out: Record<string, string> = { ...actuals }
  for (const key of keys) {
    const field = row.actualDay(key)
    if (field === undefined) continue
    const milestone = key.slice(ACTUAL_COLUMN_PREFIX.length)
    if (field.value === undefined) delete out[milestone]
    else setKey(out, milestone, field.value)
  }
  return Object.keys(out).length ? out : undefined
}

function importWaves(context: ImportContext, sheet: Sheet<ReadCell>): void {
  const table = readTable(
    context,
    sheet,
    (key) => WAVE_KEYS.has(key) || isMilestoneColumn(context, key),
    'id',
  )
  if (!table) return
  const milestoneKeys = [...table.columns.keys()].filter((key) => !WAVE_KEYS.has(key))
  for (const [rowIndex, id] of rowKeys(context, table, 'id')) {
    const row = new Row(context, table, rowIndex)
    if (id === '') {
      row.report(
        'error',
        'rollout-workbook.wave-id-missing',
        'a wave is created in the app, not in the workbook, so this row with no id was not read.',
        'id',
      )
      continue
    }
    const wave = context.index.elements.get(id)!
    const before = wavePlanOf(wave)
    // `wavePlanOf` of no element is `undefined`, so an unknown id fails here too.
    if (before?.rollout !== context.rolloutId) {
      row.report(
        'error',
        'rollout-workbook.wave-unknown',
        `${JSON.stringify(id)} is not a wave of this rollout, so the row was not read.`,
        'id',
        id,
      )
      continue
    }
    const plan: WavePlan = structuredClone(before)
    const label = row.text('label')
    if (label !== undefined) plan.label = label.value ?? ''
    const order = required(
      row,
      'order',
      row.integer('order', Number.isSafeInteger, 'a whole number'),
    )
    if (order !== undefined) plan.order = order
    const version = required(
      row,
      'templateVersion',
      row.integer('templateVersion', isPositiveInteger, 'a whole number from 1'),
    )
    if (version !== undefined) plan.templateVersion = version
    const capacity = row.integer('capacity', isPositiveInteger, 'a whole number from 1')
    if (capacity !== undefined) {
      if (capacity.value === undefined) delete plan.capacity
      else plan.capacity = capacity.value
    }
    const window = { ...plan.window }
    for (const [key, end] of [
      ['windowStart', 'start'],
      ['windowEnd', 'end'],
    ] as const) {
      const field = row.planDate(key)
      if (field === undefined) continue
      if (field.value === undefined) delete window[end]
      else window[end] = field.value
    }
    if (window.start || window.end) plan.window = window
    else delete plan.window
    const milestones = readMilestoneDates(row, milestoneKeys, plan.milestones)
    if (milestones) plan.milestones = milestones
    else delete plan.milestones

    if (sameJson(plan, before)) {
      context.result.tallies.waves.unchanged++
      continue
    }
    context.result.changes.updateElements.push({ before: wave, after: { ...wave, plan } })
    context.result.tallies.waves.updated++
  }
}

/** A field that has no blank: a blank cell is reported and leaves the value as it is. */
function required(row: Row, key: string, field: Field<number>): number | undefined {
  if (field && field.value === undefined) {
    row.report(
      'error',
      'rollout-workbook.value-required',
      'every wave has one, so a blank cannot delete it; it was left as it is.',
      key,
    )
  }
  return field?.value
}

const SITE_PLAN_KEYS = new Set(['location', 'name', 'wave', 'archetype', 'rag', 'goNoGo'])

function importSitePlans(context: ImportContext, sheet: Sheet<ReadCell>): void {
  const table = readTable(
    context,
    sheet,
    (key) =>
      SITE_PLAN_KEYS.has(key) ||
      isMilestoneColumn(context, key) ||
      isMilestoneColumn(context, key, ACTUAL_COLUMN_PREFIX),
    'location',
  )
  if (!table) return
  const keys = [...table.columns.keys()]
  const milestoneKeys = keys.filter((key) => key.startsWith(MILESTONE_COLUMN_PREFIX))
  const actualKeys = keys.filter((key) => key.startsWith(ACTUAL_COLUMN_PREFIX))
  const original = new Map(context.plan.sites.map((site) => [site.location, site]))
  for (const [rowIndex, location] of rowKeys(context, table, 'location')) {
    const row = new Row(context, table, rowIndex)
    if (location === '') {
      row.report(
        'error',
        'rollout-workbook.site-id-missing',
        'a row of the site plan needs the id of its site, so this one was not read. A new site is added in the Sites sheet.',
        'location',
      )
      continue
    }
    const removed = context.removed.has(location)
    const before = removed ? original.get(location) : context.sites.get(location)
    if (!before) {
      row.report(
        'error',
        'rollout-workbook.site-unknown',
        `${JSON.stringify(location)} is not a site of this rollout, so the row was not read. A site is added in the Sites sheet.`,
        'location',
        location,
      )
      continue
    }

    const name = row.text('name')
    const modelName = context.index.elements.get(location)?.name ?? ''
    if (name !== undefined && (name.value ?? '') !== modelName) {
      row.report(
        'warning',
        'rollout-workbook.read-only-changed',
        'the name is changed in the Sites sheet; this sheet shows it and does not read it, so the change was not applied.',
        'name',
        location,
      )
    }

    const after: SitePlan = structuredClone(before)
    const wave = row.text('wave')
    if (wave?.value === undefined) {
      if (wave) delete after.wave
    } else {
      const id = waveIdOf(wave.value, context.rolloutId, (id) => context.index.elements.get(id))
      if (id === undefined) {
        row.report(
          'error',
          'rollout-workbook.wave-unknown',
          `${JSON.stringify(wave.value)} is not a wave of this rollout, so the site's wave was not changed.`,
          'wave',
          location,
        )
      } else after.wave = id
    }
    const archetype = row.text('archetype')
    if (archetype?.value === undefined) {
      if (archetype) delete after.archetype
    } else {
      const id = archetypeIdOf(archetype.value, context.plan)
      if (id === undefined) {
        row.report(
          'error',
          'rollout-workbook.archetype-unknown',
          `${JSON.stringify(archetype.value)} is not an archetype of this rollout, so the site's archetype was not changed.`,
          'archetype',
          location,
        )
      } else after.archetype = id
    }
    const rag = row.word('rag')
    if (rag?.value === undefined) {
      if (rag) delete after.rag
    } else if (isSiteRag(rag.value)) after.rag = rag.value
    else {
      row.report(
        'error',
        'rollout-workbook.rag-unknown',
        `${JSON.stringify(rag.value)} is not a RAG; write green, amber or red, or leave it blank. It was not applied.`,
        'rag',
        location,
      )
    }
    const goNoGo = row.word('goNoGo')
    if (goNoGo?.value === undefined) {
      if (goNoGo) delete after.goNoGo
    } else if (isGoNoGo(goNoGo.value)) after.goNoGo = goNoGo.value
    else {
      row.report(
        'error',
        'rollout-workbook.go-no-go-unknown',
        `${JSON.stringify(goNoGo.value)} is not a go/no-go decision; write go or no-go, or leave it blank while it is not taken. It was not applied.`,
        'goNoGo',
        location,
      )
    }
    const dates = readMilestoneDates(row, milestoneKeys, after.milestones)
    if (dates) after.milestones = dates
    else delete after.milestones
    const actuals = readActualDays(row, actualKeys, after.actuals)
    if (actuals) after.actuals = actuals
    else delete after.actuals

    // A site the Sites sheet removes still has its row here, as exported; only
    // a row that would change its plan has something to say.
    if (removed) {
      if (!sameJson(after, before)) {
        row.report(
          'warning',
          'rollout-workbook.site-removed',
          `the Sites sheet takes ${JSON.stringify(location)} out of the rollout, so the changes to its plan here were not applied.`,
          'location',
          location,
        )
      }
      continue
    }
    if (sameJson(after, before)) {
      context.result.tallies.sitePlans.unchanged++
      continue
    }
    context.sites.set(location, after)
    context.sitesChanged = true
    context.result.tallies.sitePlans.updated++
  }
}

/**
 * The `Template` and `Milestones` sheets are written for reference and not
 * read. A copy that differs from what the rollout holds says so, so an edit
 * to it is never lost in silence.
 */
function checkReadOnly(
  context: ImportContext,
  sheet: Sheet<ReadCell>,
  expected: Sheet,
  what: 'template' | 'milestone set',
): void {
  const height = Math.max(sheet.rows.length, expected.rows.length)
  for (let row = 0; row < height; row++) {
    const width = Math.max(sheet.rows[row]?.length ?? 0, expected.rows[row]?.length ?? 0)
    for (let column = 0; column < width; column++) {
      if (!sameJson(cellAt(sheet, row, column), cellAt(expected, row, column))) {
        context.report(
          'warning',
          what === 'template'
            ? 'rollout-workbook.template-read-only'
            : 'rollout-workbook.milestones-read-only',
          `the sheet differs from the rollout's ${what}, first at cell ${cellReference(row, column)}. The ${what} is changed in the app, not in the workbook, so the sheet was not read.`,
          { sheet: sheet.name, row, column },
        )
        return
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Code-unit order: collation depends on the machine's locale (ADR 0004). */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Equal as JSON with sorted keys, so two objects built in another key order compare equal. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort(byCodeUnit)
      .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
  )
}
