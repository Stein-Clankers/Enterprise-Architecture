import { XMLParser } from 'fast-xml-parser'
import { readZipDirectory, readZipEntry, ZipError, type ZipEntry } from './zip'
import { serialToIsoDay, parseIsoDay } from './xlsx-dates'
import type { ProblemSeverity } from './problems'
import {
  cellReference,
  MAX_ROWS,
  parseCellReference,
  type ReadCell,
  type Sheet,
  type Workbook,
  type XlsxProblem,
} from './xlsx'

/**
 * An `.xlsx` read into the format-neutral `Workbook` (#208).
 *
 * **Cells.** Shared strings (with rich-text runs joined) and inline strings,
 * numbers, booleans, ISO dates (`t="d"`), and formula results (`t="str"`, or
 * any type with a cached value). A number is a date when its number format is
 * one, by Excel's built-in format ids or by the tokens of a custom format, and
 * becomes an ISO day in whole days (`xlsx-dates.ts`), in the 1900 or the 1904
 * date system as the workbook says.
 *
 * **Nothing is skipped in silence.** A cell the reader cannot type becomes an
 * `UnreadableCell`, never an empty one, with a problem naming its sheet and
 * cell: an error such as `#N/A`, an unknown cell type, a malformed value, a
 * formula with no stored result, a serial that is no day, a time of day. A
 * date cell with a time keeps its day and says the time was not read. Formula
 * cells read as their stored result, and each sheet that has some says so once.
 *
 * **A file that cannot be read is not read in part.** A damaged archive, a part
 * the package names but does not hold, or a part that is not XML, yields no
 * workbook at all and an error problem: a workbook with a sheet missing would
 * read, to #94, as columns to leave untouched.
 *
 * Deliberately not read, because they are presentation: styles beyond the
 * number format, column widths, merged ranges (only their first cell holds a
 * value), phonetic guides on East Asian text (`<rPh>`), comments, hidden state.
 */

export interface XlsxReadResult {
  /** Absent when an error problem made the file unreadable. */
  workbook?: Workbook<ReadCell>
  problems: XlsxProblem[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Strict OOXML and transitional differ in namespaces, not in local names.
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  // Cell text is data: leading and trailing spaces are kept as written.
  trimValues: false,
  // Numeric character references, so `&#13;` is a carriage return.
  htmlEntities: true,
  isArray: (name, _path, _leaf, isAttribute) => !isAttribute && LISTS.has(name),
})
const LISTS = new Set(['sheet', 'Relationship', 'row', 'c', 'si', 'r', 'numFmt', 'xf'])

type Node = Record<string, unknown>

/** A zip reader's own fault, to report; anything else is a bug here, and is thrown on. */
function zipFault(error: unknown): ZipError {
  if (error instanceof ZipError) return error
  throw error
}

/** A problem that ends the read: thrown to `readXlsx`, which returns it without a workbook. */
class FatalProblem extends Error {
  constructor(readonly found: XlsxProblem) {
    super(found.message)
  }
}

function xlsxProblem(
  severity: ProblemSeverity,
  code: string,
  message: string,
  where: { file?: string; sheet?: string; cell?: string },
): XlsxProblem {
  return { severity, code, message, ...where }
}

export async function readXlsx(bytes: Uint8Array, file?: string): Promise<XlsxReadResult> {
  const problems: XlsxProblem[] = []
  try {
    const workbook = await readPackage(bytes, file, problems)
    return { workbook, problems }
  } catch (error) {
    if (error instanceof FatalProblem) return { problems: [...problems, error.found] }
    throw error
  }
}

async function readPackage(
  bytes: Uint8Array,
  file: string | undefined,
  problems: XlsxProblem[],
): Promise<Workbook<ReadCell>> {
  const where = file === undefined ? {} : { file }
  const fail = (code: string, message: string, sheet?: string): never => {
    throw new FatalProblem(
      sheet === undefined
        ? xlsxProblem('error', code, message, where)
        : xlsxProblem('error', code, `Sheet “${sheet}”: ${message}`, { ...where, sheet }),
    )
  }

  let entries: Map<string, ZipEntry>
  try {
    // OPC part names compare ignoring case.
    entries = new Map(readZipDirectory(bytes).map((entry) => [entry.name.toLowerCase(), entry]))
  } catch (error) {
    const fault = zipFault(error)
    return fail(
      `xlsx.archive-${fault.fault}`,
      `The file is not a readable .xlsx archive (${fault.detail}).`,
    )
  }

  /** A part as parsed XML, or a fatal problem naming the part and, when it has one, its sheet. */
  const part = async (name: string, sheet?: string): Promise<Node> => {
    const entry = entries.get(name.toLowerCase())
    if (!entry)
      return fail(
        'xlsx.part-missing',
        `The workbook names the part “${name}”, which the file does not hold.`,
        sheet,
      )
    let data: Uint8Array
    try {
      data = await readZipEntry(bytes, entry)
    } catch (error) {
      const fault = zipFault(error)
      return fail(
        `xlsx.archive-${fault.fault}`,
        `The part “${name}” cannot be read (${fault.detail}).`,
        sheet,
      )
    }
    let xml: string
    try {
      xml = new TextDecoder('utf-8', { fatal: true }).decode(data)
    } catch {
      return fail('xlsx.part-unreadable', `The part “${name}” is not UTF-8 text.`, sheet)
    }
    try {
      return parser.parse(xml, true) as Node
    } catch (error) {
      return fail(
        'xlsx.part-unreadable',
        `The part “${name}” is not well-formed XML (${error instanceof Error ? error.message : String(error)}).`,
        sheet,
      )
    }
  }
  /** The element a part must have at its root, or a fatal problem. */
  const root = async (name: string, element: string, sheet?: string): Promise<Node> => {
    const found = (await part(name, sheet))[element]
    // An element with nothing in it parses as '': an empty `<Relationships/>` is still one.
    if (found === '') return {}
    if (!isNode(found)) {
      return fail(
        'xlsx.part-unreadable',
        `The part “${name}” has no <${element}> at its root.`,
        sheet,
      )
    }
    return found
  }
  const relationships = async (owner: string): Promise<Node[]> => {
    const slash = owner.lastIndexOf('/')
    const relsName = `${owner.slice(0, slash + 1)}_rels/${owner.slice(slash + 1)}.rels`
    return list((await root(relsName, 'Relationships')).Relationship).filter(isNode)
  }

  const officeDocument = (await relationships('')).find((rel) => typeOf(rel) === 'officeDocument')
  if (!officeDocument) {
    return fail(
      'xlsx.part-missing',
      'The package does not say where its workbook is, so it is not a spreadsheet.',
    )
  }
  const workbookName = resolve('', attribute(officeDocument, 'Target') ?? '')
  const workbookXml = await root(workbookName, 'workbook')
  const workbookRels = await relationships(workbookName)
  const target = (rel: Node) => resolve(workbookName, attribute(rel, 'Target') ?? '')

  const date1904 = ['1', 'true'].includes(
    attribute(asNode(workbookXml.workbookPr), 'date1904') ?? '',
  )
  const stylesRel = workbookRels.find((rel) => typeOf(rel) === 'styles')
  const formats = stylesRel ? numberFormats(await root(target(stylesRel), 'styleSheet')) : undefined
  const stringsRel = workbookRels.find((rel) => typeOf(rel) === 'sharedStrings')
  const strings = stringsRel
    ? list((await root(target(stringsRel), 'sst')).si).map((si) => decodeEscapes(richText(si)))
    : []

  const sheets: Sheet<ReadCell>[] = []
  for (const entry of list(asNode(workbookXml.sheets).sheet).filter(isNode)) {
    const name = attribute(entry, 'name') ?? ''
    const id = attribute(entry, 'id')
    const rel = workbookRels.find((candidate) => attribute(candidate, 'Id') === id)
    if (!rel) {
      return fail(
        'xlsx.part-missing',
        'the workbook lists it, but no part of the file holds it.',
        name,
      )
    }
    const type = typeOf(rel)
    if (type !== 'worksheet') {
      problems.push(
        xlsxProblem(
          'warning',
          'xlsx.sheet-not-worksheet',
          `Sheet “${name}”: it is a ${type}, not a worksheet of cells, so it was not read.`,
          {
            ...where,
            sheet: name,
          },
        ),
      )
      continue
    }
    const worksheet = await root(target(rel), 'worksheet', name)
    sheets.push({
      name,
      rows: readRows(worksheet, { name, strings, formats, date1904, where }, problems),
    })
  }
  return { sheets }
}

interface SheetContext {
  name: string
  strings: readonly string[]
  /** Each `cellXfs` entry's kind of number format; absent when the file has no styles part. */
  formats: readonly FormatKind[] | undefined
  date1904: boolean
  where: { file?: string }
}

function readRows(worksheet: Node, sheet: SheetContext, problems: XlsxProblem[]): ReadCell[][] {
  const cells = new Map<number, Map<number, ReadCell>>()
  const report = (severity: ProblemSeverity, code: string, message: string, cell?: string) =>
    problems.push(
      xlsxProblem(
        severity,
        code,
        `Sheet “${sheet.name}”${cell ? `, cell ${cell}` : ''}: ${message}`,
        {
          ...sheet.where,
          sheet: sheet.name,
          ...(cell === undefined ? {} : { cell }),
        },
      ),
    )
  const formulas: string[] = []

  let rowIndex = -1
  for (const row of list(asNode(worksheet.sheetData).row).filter(isNode)) {
    const written = attribute(row, 'r')
    if (written === undefined) rowIndex++
    else if (/^[1-9]\d*$/.test(written) && Number(written) <= MAX_ROWS)
      rowIndex = Number(written) - 1
    else {
      const count = list(row.c).length
      report(
        'warning',
        'xlsx.row-reference-malformed',
        `a row is numbered ${JSON.stringify(written)}, which is not a row of a sheet, so its ${count} cell${count === 1 ? '' : 's'} could not be placed and were not read.`,
      )
      continue
    }
    let columnIndex = -1
    for (const c of list(row.c).filter(isNode)) {
      const ref = attribute(c, 'r')
      if (ref === undefined) columnIndex++
      else {
        const parsed = parseCellReference(ref)
        if (!parsed || parsed.row !== rowIndex) {
          report(
            'warning',
            'xlsx.cell-reference-malformed',
            `a cell in row ${rowIndex + 1} is labelled ${JSON.stringify(ref)}, which is not a cell of that row, so it could not be placed and was not read.`,
          )
          continue
        }
        columnIndex = parsed.column
      }
      const at = cellReference(rowIndex, columnIndex)
      const value = readCell(c, at, sheet, report)
      if ('f' in c && value.kind !== 'unreadable' && value.kind !== 'empty') formulas.push(at)
      if (value.kind === 'empty') continue
      let line = cells.get(rowIndex)
      if (!line) cells.set(rowIndex, (line = new Map()))
      if (line.has(columnIndex)) {
        report(
          'warning',
          'xlsx.cell-repeated',
          'the file holds this cell twice; the first was read and the second was not.',
          at,
        )
        continue
      }
      line.set(columnIndex, value)
    }
  }
  if (formulas.length) {
    report(
      'info',
      'xlsx.formula-results-read',
      `${formulas.length} cell${formulas.length === 1 ? ' holds a formula' : 's hold formulas'}; the result Excel last stored was read, not the formula.`,
      formulas[0],
    )
  }

  // Ragged and trimmed: each row ends at its last cell holding something, and
  // the sheet at its last row that does. A loop, not `Math.max(...keys)`: a
  // sheet can have a million rows, more arguments than a call takes.
  let last = -1
  for (const r of cells.keys()) last = Math.max(last, r)
  const rows: ReadCell[][] = []
  for (let r = 0; r <= last; r++) {
    const line = cells.get(r)
    let width = 0
    for (const c of line?.keys() ?? []) width = Math.max(width, c + 1)
    rows.push(Array.from({ length: width }, (_, c) => line?.get(c) ?? { kind: 'empty' }))
  }
  return rows
}

type Report = (severity: ProblemSeverity, code: string, message: string, cell?: string) => void

function readCell(c: Node, at: string, sheet: SheetContext, report: Report): ReadCell {
  const type = attribute(c, 't') ?? 'n'
  const v = textOf(c.v)
  const unreadable = (code: string, message: string, found: string): ReadCell => {
    report('warning', code, message, at)
    return { kind: 'unreadable', text: found }
  }
  if (!isCellType(type)) {
    return unreadable(
      'xlsx.cell-type-unknown',
      `the cell's type ${JSON.stringify(type)} is not one a spreadsheet writes, so it was not read.`,
      v ?? '',
    )
  }
  // openpyxl writes a formula it never calculated with an empty `<v/>`; for a
  // formula's text result (`str`), an empty `<v/>` is the empty string.
  const uncached = v === undefined || (v === '' && type !== 'str')
  if ('f' in c && uncached && type !== 'inlineStr' && type !== 'e') {
    return unreadable(
      'xlsx.formula-uncached',
      'the cell holds a formula with no stored result (the file was never calculated), so it has no value to read.',
      `=${textOf(c.f) ?? ''}`,
    )
  }
  if (v === undefined && type !== 'inlineStr' && type !== 'e') {
    if (type === 'n') return { kind: 'empty' }
    return unreadable(
      'xlsx.cell-malformed',
      `the cell says it holds ${TYPE_NAMES[type]} but holds no value.`,
      '',
    )
  }
  switch (type) {
    case 'n':
      return readNumber(c, v!, at, sheet, report, unreadable)
    case 's': {
      const index = /^\d+$/.test(v!) ? Number(v) : -1
      const value = sheet.strings[index]
      if (value === undefined) {
        return unreadable(
          'xlsx.cell-malformed',
          `the cell points at shared string ${JSON.stringify(v)}, which the file does not hold.`,
          v!,
        )
      }
      return { kind: 'string', value }
    }
    case 'inlineStr':
      if (!isNode(c.is) && c.is !== '') {
        return unreadable(
          'xlsx.cell-malformed',
          'the cell says it holds inline text but holds none.',
          v ?? '',
        )
      }
      return { kind: 'string', value: decodeEscapes(richText(c.is)) }
    case 'str':
      return { kind: 'string', value: decodeEscapes(v!) }
    case 'b':
      if (v === '1' || v === 'true') return { kind: 'boolean', value: true }
      if (v === '0' || v === 'false') return { kind: 'boolean', value: false }
      return unreadable(
        'xlsx.cell-malformed',
        `the cell says it holds TRUE or FALSE but holds ${JSON.stringify(v)}.`,
        v!,
      )
    case 'e':
      return unreadable(
        'xlsx.cell-error',
        `the cell holds the error ${v ?? '(unnamed)'}, which is not a value, so it was not read.`,
        v ?? '',
      )
    case 'd': {
      const match =
        /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(
          v!,
        )
      if (!match || !parseIsoDay(match[1]!)) {
        return unreadable(
          'xlsx.cell-malformed',
          `the cell says it holds a date but holds ${JSON.stringify(v)}.`,
          v!,
        )
      }
      if (/[1-9]/.test(v!.slice(10))) timeNotRead(at, report)
      return { kind: 'date', value: match[1]! }
    }
  }
}

/** ECMA-376's cell types (`ST_CellType`). */
const CELL_TYPES = ['n', 's', 'inlineStr', 'str', 'b', 'e', 'd'] as const
type CellType = (typeof CELL_TYPES)[number]
const isCellType = (type: string): type is CellType =>
  (CELL_TYPES as readonly string[]).includes(type)

const TYPE_NAMES: Record<CellType, string> = {
  n: 'a number',
  s: 'a shared string',
  inlineStr: 'inline text',
  str: 'a formula’s text',
  b: 'TRUE or FALSE',
  e: 'an error',
  d: 'a date',
}

/** An xsd:double as a spreadsheet writes one. `Number` alone would also take `''`, `0x1F` and `Infinity`. */
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/

function readNumber(
  c: Node,
  v: string,
  at: string,
  sheet: SheetContext,
  report: Report,
  unreadable: (code: string, message: string, found: string) => ReadCell,
): ReadCell {
  if (!NUMBER.test(v)) {
    return unreadable(
      'xlsx.cell-malformed',
      `the cell says it holds a number but holds ${JSON.stringify(v)}.`,
      v,
    )
  }
  const value = Number(v)
  const style = Number(attribute(c, 's') ?? '0')
  const format = sheet.formats ? sheet.formats[style] : style === 0 ? 'number' : undefined
  if (format === undefined) {
    report(
      'warning',
      'xlsx.style-missing',
      `the cell's style ${style} is not in the file, so whether it is a date cannot be told; it was read as the number ${v}.`,
      at,
    )
    return { kind: 'number', value }
  }
  if (format === 'unknown') {
    report(
      'warning',
      'xlsx.number-format-unknown',
      `the cell's number format is a built-in one whose meaning depends on the language Excel ran in, so whether it is a date cannot be told; it was read as the number ${v}.`,
      at,
    )
    return { kind: 'number', value }
  }
  if (format === 'time') {
    return unreadable(
      'xlsx.time-cell',
      `the cell holds a time of day or a duration (${v} of a day), which has no place here, so it was not read.`,
      v,
    )
  }
  if (format === 'number') return { kind: 'number', value }
  const whole = Math.floor(value)
  const iso = serialToIsoDay(whole, sheet.date1904)
  if (iso === undefined) {
    return unreadable(
      'xlsx.date-out-of-range',
      `the cell is a date, but its serial ${v} is no day in Excel's calendar.`,
      v,
    )
  }
  if (whole !== value) timeNotRead(at, report)
  return { kind: 'date', value: iso }
}

function timeNotRead(at: string, report: Report): void {
  report(
    'warning',
    'xlsx.date-time-dropped',
    'the cell holds a date and a time of day; the day was read and the time was not.',
    at,
  )
}

type FormatKind = 'number' | 'date' | 'time' | 'unknown'

/** Built-in number formats (ECMA-376 lists 0–49 and leaves some ids to each language). */
const BUILT_IN_DATES = new Set([14, 15, 16, 17, 22])
const BUILT_IN_TIMES = new Set([18, 19, 20, 21, 45, 46, 47])
/** Ids whose format Excel takes from its language: dates in some, times in others. */
const BUILT_IN_BY_LANGUAGE = new Set([
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58,
])

/** The kind of number format of each `cellXfs` entry, by its index. */
function numberFormats(styleSheet: Node): FormatKind[] {
  const custom = new Map<number, string>()
  for (const format of list(asNode(styleSheet.numFmts).numFmt).filter(isNode)) {
    custom.set(Number(attribute(format, 'numFmtId')), attribute(format, 'formatCode') ?? '')
  }
  return list(asNode(styleSheet.cellXfs).xf)
    .filter(isNode)
    .map((xf) => {
      const id = Number(attribute(xf, 'numFmtId') ?? '0')
      const code = custom.get(id)
      if (code !== undefined) return formatKind(code)
      if (BUILT_IN_DATES.has(id)) return 'date'
      if (BUILT_IN_TIMES.has(id)) return 'time'
      if (BUILT_IN_BY_LANGUAGE.has(id)) return 'unknown'
      return 'number'
    })
}

/**
 * Whether a custom format code shows a date, a time, or a number. Quoted text,
 * escaped characters, colours and locale tags (`[Red]`, `[$-409]`) are not
 * tokens; `[h]`, `[m]` and `[s]` are elapsed time; `AM/PM` is not a minute.
 * An `m` is a month unless the format also shows hours or seconds, the rule
 * Excel applies to `m` beside `h` or `s`.
 */
export function formatKind(code: string): FormatKind {
  const tokens = code
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
    .replace(/\[(?:h+|m+|s+)\]/gi, 'h')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/AM\/PM|A\/P/gi, '')
    .toLowerCase()
  const hasTime = /[hs]/.test(tokens)
  if (/[yd]/.test(tokens) || (tokens.includes('m') && !hasTime)) return 'date'
  return hasTime ? 'time' : 'number'
}

/** A shared or inline string: its `<t>`, or its rich-text runs joined. Phonetic guides (`<rPh>`) are not text. */
function richText(node: unknown): string {
  if (!isNode(node)) return textOf(node) ?? ''
  return (
    (textOf(node.t) ?? '') +
    list(node.r)
      .map((run) => (isNode(run) ? (textOf(run.t) ?? '') : ''))
      .join('')
  )
}

/** Undo OOXML's `_xHHHH_` escape; `_x005F_` is an underscore, so an escaped escape reads as written. */
function decodeEscapes(value: string): string {
  return value.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  )
}

/** The relationship type's last segment, the same in transitional and strict OOXML. */
function typeOf(rel: Node): string {
  const type = attribute(rel, 'Type') ?? ''
  return type.slice(type.lastIndexOf('/') + 1)
}

/** A relationship target as a part name: absolute from the package root, or relative to its owner's folder. */
function resolve(owner: string, target: string): string {
  const segments = target.startsWith('/') ? [] : owner.split('/').slice(0, -1)
  for (const segment of target.split('/')) {
    if (segment === '..') segments.pop()
    else if (segment !== '.' && segment !== '') segments.push(segment)
  }
  return segments.join('/')
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNode(value: unknown): Node {
  return isNode(value) ? value : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

function attribute(node: Node, name: string): string | undefined {
  const value = node[`@${name}`]
  return typeof value === 'string' ? value : undefined
}

/** An element's text: a bare string, or the `#text` of an element that has attributes. */
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (isNode(value)) return typeof value['#text'] === 'string' ? value['#text'] : ''
  return undefined
}
