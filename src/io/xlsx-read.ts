import { XMLParser } from 'fast-xml-parser'
import { readZipDirectory, readZipEntry, ZipError, type ZipEntry } from './zip'
import { FIRST_WRITABLE_DAY, isoDayToSerial, parseIsoDay, serialToIsoDay } from './xlsx-dates'
import { problem, type ProblemSeverity } from './problems'
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
  // Numeric character references, so `&#13;` is a carriage return (we write
  // `_x000D_`, as Office does; other writers use the reference).
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
        ? problem<XlsxProblem>('error', code, message, where)
        : problem<XlsxProblem>('error', code, `Sheet “${sheet}”: ${message}`, { ...where, sheet }),
    )
  }

  let entries: Map<string, ZipEntry>
  try {
    // OPC part names compare ignoring case.
    entries = new Map(readZipDirectory(bytes).map((entry) => [partKey(entry.name), entry]))
  } catch (error) {
    const fault = zipFault(error)
    return fail(
      `xlsx.archive-${fault.fault}`,
      `The file is not a readable .xlsx archive (${fault.detail}).`,
    )
  }

  /** A part as parsed XML, or a fatal problem naming the part and, when it has one, its sheet. */
  const part = async (name: string, sheet?: string): Promise<Node> => {
    const entry = entries.get(partKey(name))
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
  const strings = stringsRel ? list((await root(target(stringsRel), 'sst')).si).map(richText) : []

  // A bare `<sheet/>` is still a sheet the workbook lists: `asNode`, not a
  // filter, so it is refused below rather than passed over.
  const listed = list(asNode(workbookXml.sheets).sheet).map(asNode)
  if (listed.length === 0) {
    return fail('xlsx.no-sheets', 'The workbook lists no sheets, so it holds nothing to read.')
  }
  const sheets: Sheet<ReadCell>[] = []
  for (const [index, entry] of listed.entries()) {
    const name = attribute(entry, 'name') ?? ''
    // Excel opens no sheet without a name, the writer would refuse it on the
    // way back out, and which sheet a table belongs to could not be told.
    if (name === '') {
      return fail(
        'xlsx.sheet-unnamed',
        `The workbook's sheet ${index + 1} has no name, which Excel does not open.`,
      )
    }
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
        problem<XlsxProblem>(
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
  /** Each shared string, or `undefined` for one whose text cannot be told. */
  strings: readonly (string | undefined)[]
  /** Each `cellXfs` entry's kind of number format; absent when the file has no styles part. */
  formats: readonly StyleFormat[] | undefined
  date1904: boolean
  where: { file?: string }
}

function readRows(worksheet: Node, sheet: SheetContext, problems: XlsxProblem[]): ReadCell[][] {
  const cells = new Map<number, Map<number, ReadCell>>()
  const report = (severity: ProblemSeverity, code: string, message: string, cell?: string) =>
    problems.push(
      problem<XlsxProblem>(
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
  /** Every cell position met, kept or not, so a second copy of one is never read. */
  const placed = new Map<number, Set<number>>()

  let rowIndex = -1
  // An element with nothing in it parses as '': a bare `<row/>` or `<c/>` is
  // still a row or a cell, and its position counts for the ones after it.
  for (const row of list(asNode(worksheet.sheetData).row).map(asNode)) {
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
    for (const c of list(row.c).map(asNode)) {
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
      // Before the cell is read: a copy that is not kept must add nothing to a
      // tally and report nothing about its value.
      let seen = placed.get(rowIndex)
      if (!seen) placed.set(rowIndex, (seen = new Set()))
      if (seen.has(columnIndex)) {
        report(
          'warning',
          'xlsx.cell-repeated',
          'the file holds this cell twice; the first was read and the second was not.',
          at,
        )
        continue
      }
      seen.add(columnIndex)
      const value = readCell(c, at, sheet, report)
      if ('f' in c && value.kind !== 'unreadable' && value.kind !== 'empty') formulas.push(at)
      if (value.kind === 'empty') continue
      let line = cells.get(rowIndex)
      if (!line) cells.set(rowIndex, (line = new Map()))
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
  const unreadable = (code: string, message: string, found: string): ReadCell => {
    report('warning', code, message, at)
    return { kind: 'unreadable', text: found }
  }
  // A cell holds one value. Two `<v>` parse as an array, which `textOf` would
  // read as no value at all: an empty cell, which to #94 deletes (#221).
  if (Array.isArray(c.v)) {
    return unreadable(
      'xlsx.cell-malformed',
      `the cell holds ${c.v.length} values where a cell holds one, so it was not read.`,
      JSON.stringify(c.v.map((value) => textOf(value) ?? '')),
    )
  }
  const v = textOf(c.v)
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
      if (index < 0 || index >= sheet.strings.length) {
        return unreadable(
          'xlsx.cell-malformed',
          `the cell points at shared string ${JSON.stringify(v)}, which the file does not hold.`,
          v!,
        )
      }
      const value = sheet.strings[index]
      if (value === undefined) {
        return unreadable(
          'xlsx.cell-malformed',
          `the cell points at shared string ${index}, whose text is written more than once where it is written once, so which text is meant cannot be told; it was not read.`,
          v!,
        )
      }
      return { kind: 'string', value }
    }
    case 'inlineStr': {
      if (!isNode(c.is) && c.is !== '' && !Array.isArray(c.is)) {
        return unreadable(
          'xlsx.cell-malformed',
          'the cell says it holds inline text but holds none.',
          v ?? '',
        )
      }
      const value = richText(c.is)
      if (value === undefined) {
        return unreadable(
          'xlsx.cell-malformed',
          'the cell’s inline text is written more than once where it is written once, so which text is meant cannot be told; it was not read.',
          v ?? '',
        )
      }
      return { kind: 'string', value }
    }
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
        /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))?)?$/.exec(
          v!,
        )
      if (!match || !parseIsoDay(match[1]!)) {
        return unreadable(
          'xlsx.cell-malformed',
          `the cell says it holds a date but holds ${JSON.stringify(v)}.`,
          v!,
        )
      }
      if (isoDayToSerial(match[1]!) === undefined) return beforeFirstDay(match[1]!, v!, unreadable)
      isoDateTime(match, at, report)
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
  const written = attribute(c, 's') ?? '0'
  // `Number('')` is 0 and `Number('abc')` is NaN: either would decide the cell's format in silence.
  if (!/^\d+$/.test(written)) {
    return unreadable(
      'xlsx.cell-malformed',
      `the cell's style ${JSON.stringify(written)} is not a style number, so whether it is a date cannot be told; it was not read.`,
      v,
    )
  }
  const style = Number(written)
  const format = sheet.formats ? sheet.formats[style] : style === 0 ? 'number' : undefined
  if (typeof format === 'object') {
    return unreadable(
      'xlsx.cell-malformed',
      `the cell's style ${style} ${format.malformed}, so whether it is a date cannot be told; it was not read.`,
      v,
    )
  }
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
  if (isoDayToSerial(iso) === undefined) return beforeFirstDay(iso, v, unreadable)
  if (whole !== value) timeNotRead(at, report)
  return { kind: 'date', value: iso }
}

/**
 * A date before the first day the writer writes (#221). Below serial 61 the
 * 1900 system's serials open as different days in Excel and in other programs,
 * which is why the writer refuses those days; a reader that took them would
 * hand back a workbook that cannot be written again.
 */
function beforeFirstDay(
  day: string,
  found: string,
  unreadable: (code: string, message: string, found: string) => ReadCell,
): ReadCell {
  return unreadable(
    'xlsx.date-out-of-range',
    `the cell is the date ${day}, before ${FIRST_WRITABLE_DAY}: before it Excel and other programs count days differently, so which day is meant cannot be told; it was not read.`,
    found,
  )
}

function timeNotRead(at: string, report: Report, more = ''): void {
  report(
    'warning',
    'xlsx.date-time-dropped',
    `the cell holds a date and a time of day; the day was read and the time was not.${more}`,
    at,
  )
}

/**
 * What a `t="d"` cell's time part says beyond its day. Only the time is
 * tested for a time of day, never the offset (`00:00:00+01:00` is midnight).
 * An offset is reported when it puts the moment on another day in UTC, since
 * then which day the writer meant is in doubt; the day as written is read.
 */
function isoDateTime(match: RegExpExecArray, at: string, report: Report): void {
  const [, day, hour = '0', minute = '0', second = '0', fraction = '', offset = ''] = match
  const hasTime = Number(hour) + Number(minute) + Number(second) > 0 || /[1-9]/.test(fraction)
  const sign = match[7] === '-' ? -1 : 1
  const offsetMinutes = sign * (Number(match[8] ?? 0) * 60 + Number(match[9] ?? 0))
  const utcMinutes = Number(hour) * 60 + Number(minute) - offsetMinutes
  const shift = utcMinutes < 0 ? 'the day before' : utcMinutes >= 24 * 60 ? 'the day after' : ''
  const shifted = shift
    ? ` With its offset ${offset}, that moment is on ${shift} in UTC; the day as written, ${day}, was read.`
    : ''
  if (hasTime) timeNotRead(at, report, shifted)
  else if (shifted) {
    report(
      'warning',
      'xlsx.date-offset-shifts-day',
      `the cell holds a date at midnight with an offset.${shifted}`,
      at,
    )
  }
}

type FormatKind = 'number' | 'date' | 'time' | 'unknown'
/** A style's kind of number format, or what is wrong with it, to end "the cell's style 3 …". */
type StyleFormat = FormatKind | { malformed: string }

/** Built-in number formats (ECMA-376 lists 0–49 and leaves some ids to each language). */
const BUILT_IN_DATES = new Set([14, 15, 16, 17, 22])
const BUILT_IN_TIMES = new Set([18, 19, 20, 21, 45, 46, 47])
/** Ids whose format Excel takes from its language: dates in some, times in others. */
const BUILT_IN_BY_LANGUAGE = new Set([
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58,
])

/** The first id of a custom number format; every id below it is Excel's own. */
const FIRST_CUSTOM_FORMAT = 164

/**
 * The kind of number format of each `cellXfs` entry, by its index. A style the
 * file writes wrongly is not guessed at (#221): a `numFmtId` that is no number
 * would read as format 0, and a custom format with no code as a plain number,
 * either of which decides in silence whether a cell is a date.
 */
function numberFormats(styleSheet: Node): StyleFormat[] {
  /** Each custom format's code by its id, `undefined` when its definition has none. */
  const custom = new Map<number, string | undefined>()
  for (const format of list(asNode(styleSheet.numFmts).numFmt).map(asNode)) {
    // A definition without a usable id defines nothing a style can name: a
    // style naming the format it was meant to be finds no definition, and the
    // cell says so below.
    const id = attribute(format, 'numFmtId')
    if (id !== undefined && /^\d+$/.test(id)) {
      custom.set(Number(id), attribute(format, 'formatCode'))
    }
  }
  // A bare `<xf/>` parses as '' and is still an entry: filtering it out would
  // shift every style after it onto its neighbour's format.
  return list(asNode(styleSheet.cellXfs).xf)
    .map(asNode)
    .map((xf): StyleFormat => {
      const written = attribute(xf, 'numFmtId') ?? '0'
      if (!/^\d+$/.test(written)) {
        return {
          malformed: `names the number format ${JSON.stringify(written)}, which is no format id`,
        }
      }
      const id = Number(written)
      if (custom.has(id)) {
        const code = custom.get(id)
        return code === undefined
          ? { malformed: `names the number format ${id}, whose definition has no format code` }
          : formatKind(code)
      }
      if (id >= FIRST_CUSTOM_FORMAT) {
        return { malformed: `names the number format ${id}, which the file does not define` }
      }
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

/**
 * A shared or inline string: its `<t>`, or its rich-text runs joined.
 * Phonetic guides (`<rPh>`) are not text. Each `<t>` is decoded on its own,
 * before the join: an `_xHHHH_` escape never spans two runs, so `_x00` in one
 * and `41_` in the next is the text `_x0041_`, not `A`.
 *
 * `undefined` when a `<t>`, or the inline string itself, is written twice where
 * the schema allows one (#221): it parses as an array, which `textOf` would
 * read as no text at all.
 */
function richText(node: unknown): string | undefined {
  if (Array.isArray(node)) return undefined
  if (!isNode(node)) return decodeEscapes(textOf(node) ?? '')
  const pieces = [node.t, ...list(node.r).map((run) => (isNode(run) ? run.t : undefined))]
  if (pieces.some((piece) => Array.isArray(piece))) return undefined
  return pieces.map((piece) => decodeEscapes(textOf(piece) ?? '')).join('')
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

/**
 * A part name as the reader compares it: percent-decoded, since a relationship
 * `Target` is a URI and `my%20sheet.xml` names the part `my sheet.xml` (#221),
 * and ignoring case, as OPC compares part names. The archive's names and the
 * targets both go through it, so a part is found whichever way it is stored.
 * A `%` that starts no escape is a character of the name, as written.
 */
function partKey(name: string): string {
  let decoded = name
  try {
    decoded = decodeURIComponent(name)
  } catch {
    // Not percent-encoded: compared as written.
  }
  return decoded.toLowerCase()
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
