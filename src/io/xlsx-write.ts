import { writeZip } from './zip'
import { isoDayToSerial, FIRST_WRITABLE_DAY } from './xlsx-dates'
import { cellReference, MAX_COLUMNS, MAX_ROWS, type Cell, type Workbook } from './xlsx'

/**
 * A workbook written as `.xlsx` (#208): Office Open XML parts in a zip, with
 * no dependency. Read `xlsx.ts` for the shape and `src/io/README.md` for why
 * this is ours rather than a library.
 *
 * What it writes, and why:
 *
 * - **Every string is a shared string.** No cell ever holds a formula, so text
 *   such as `=SUM(A1)` or `+1` is a text cell. Text starting with `=`, `+`,
 *   `-` or `@` also gets Excel’s quote prefix (`quotePrefix="1"`), which keeps
 *   it text when someone edits the cell and presses Enter.
 * - **A date is a serial with a `yyyy-mm-dd` format**, computed in whole days
 *   (`xlsx-dates.ts`), so the file holds the same day wherever it is written.
 * - **Text is escaped twice over:** for XML, and for OOXML's own `_xHHHH_`
 *   escape, which Excel uses for characters XML cannot hold. Text that already
 *   looks like such an escape has its underscore escaped, so it reads back as
 *   written, including when the escape of the character after it would
 *   supply the closing underscore (`_x0041` then NUL). A carriage return is
 *   escaped as `_x000D_`, as Office writes it ([MS-OI29500] §2.1.1747), since
 *   an XML parser turns a literal one into a line feed.
 * - **The same workbook makes the same bytes**: no timestamps, no generated ids.
 *
 * What it refuses, with an `XlsxWriteError`: a workbook with no sheets, a sheet
 * name Excel would not accept, a cell outside Excel’s grid, a non-finite
 * number, a string longer than Excel holds, and a date that is not a real day
 * from 1900-03-01 on. Each is a bug in the caller, not a property of the data
 * a user typed, so it is thrown rather than reported.
 */

export class XlsxWriteError extends Error {
  constructor(
    message: string,
    readonly sheet?: string,
    readonly cell?: string,
  ) {
    super(
      sheet === undefined ? message : `Sheet “${sheet}”${cell ? `, cell ${cell}` : ''}: ${message}`,
    )
    this.name = 'XlsxWriteError'
  }
}

/** Excel’s limit on the characters in one cell. */
export const MAX_CELL_TEXT = 32_767

/** Text Excel would read as a formula if typed into a cell. */
const FORMULA_LIKE = /^[=+\-@]/

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** The `cellXfs` index of each style the writer uses; `styles` below must list them in this order. */
const STYLE = { plain: 0, date: 1, quoted: 2 } as const

const STYLES = `${DECLARATION}<styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

export function writeXlsx(workbook: Workbook): Uint8Array {
  if (workbook.sheets.length === 0) {
    throw new XlsxWriteError('A workbook needs at least one sheet; Excel opens none without one.')
  }
  checkSheetNames(workbook.sheets.map((sheet) => sheet.name))

  const strings = new SharedStrings()
  const sheets = workbook.sheets.map((sheet) => sheetXml(sheet.name, sheet.rows, strings))
  const count = sheets.length
  const encoder = new TextEncoder()
  const part = (name: string, xml: string) => ({ name, data: encoder.encode(xml) })

  const sheetIds = sheets.map((_, i) => i + 1)
  const contentTypes =
    `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheetIds
      .map(
        (id) =>
          `<Override PartName="/xl/worksheets/sheet${id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    (strings.size
      ? `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`
      : '') +
    `</Types>`
  const rootRels = `${DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  const workbookXml =
    `${DECLARATION}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><sheets>` +
    workbook.sheets
      .map(
        (sheet, i) =>
          `<sheet name="${escapeAttribute(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join('') +
    `</sheets></workbook>`
  const workbookRels =
    `${DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">` +
    sheetIds
      .map(
        (id) =>
          `<Relationship Id="rId${id}" Type="${RELATIONSHIPS}/worksheet" Target="worksheets/sheet${id}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${count + 1}" Type="${RELATIONSHIPS}/styles" Target="styles.xml"/>` +
    (strings.size
      ? `<Relationship Id="rId${count + 2}" Type="${RELATIONSHIPS}/sharedStrings" Target="sharedStrings.xml"/>`
      : '') +
    `</Relationships>`

  return writeZip([
    part('[Content_Types].xml', contentTypes),
    part('_rels/.rels', rootRels),
    part('xl/workbook.xml', workbookXml),
    part('xl/_rels/workbook.xml.rels', workbookRels),
    part('xl/styles.xml', STYLES),
    ...sheets.map((xml, i) => part(`xl/worksheets/sheet${i + 1}.xml`, xml)),
    ...(strings.size ? [part('xl/sharedStrings.xml', strings.xml())] : []),
  ])
}

/** Excel’s rules for a sheet name, which it enforces on opening the file. */
function checkSheetNames(names: readonly string[]): void {
  const seen = new Set<string>()
  for (const name of names) {
    const reason =
      name.length === 0
        ? 'is empty'
        : name.length > 31
          ? 'is longer than 31 characters'
          : /[\\/?*[\]:]/.test(name)
            ? 'contains one of \\ / ? * [ ] :'
            : name.startsWith("'") || name.endsWith("'")
              ? 'starts or ends with an apostrophe'
              : CONTROL.test(name)
                ? 'contains a control character'
                : NOT_XML.test(name)
                  ? 'contains a character XML cannot hold (a lone surrogate, U+FFFE or U+FFFF)'
                  : name.toUpperCase() === 'HISTORY'
                    ? 'is reserved by Excel'
                    : seen.has(name.toUpperCase())
                      ? 'is used twice (Excel compares sheet names ignoring case)'
                      : undefined
    if (reason) throw new XlsxWriteError(`The sheet name ${JSON.stringify(name)} ${reason}.`)
    seen.add(name.toUpperCase())
  }
}

// Written as escapes: a raw control character in a source file is a hazard of its own.
// eslint-disable-next-line no-control-regex -- the class is the point
const CONTROL = /[\u0000-\u001f\u007f]/
/**
 * A character XML 1.0 cannot hold that is not a control character. An
 * attribute has no `_xHHHH_` escape, and `TextEncoder` would write a lone
 * surrogate as U+FFFD, so a sheet name holding one would not read back.
 */
const NOT_XML =
  /[\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

function sheetXml(
  name: string,
  rows: readonly (readonly Cell[])[],
  strings: SharedStrings,
): string {
  if (rows.length > MAX_ROWS) {
    throw new XlsxWriteError(`${rows.length} rows is more than Excel’s ${MAX_ROWS}.`, name)
  }
  const out: string[] = []
  rows.forEach((row, r) => {
    if (row.length > MAX_COLUMNS) {
      throw new XlsxWriteError(
        `Row ${r + 1} has ${row.length} cells, more than Excel’s ${MAX_COLUMNS} columns.`,
        name,
      )
    }
    const cells: string[] = []
    row.forEach((cell, c) => {
      const xml = cellXml(cell, cellReference(r, c), name, strings)
      if (xml) cells.push(xml)
    })
    if (cells.length) out.push(`<row r="${r + 1}">${cells.join('')}</row>`)
  })
  return `${DECLARATION}<worksheet xmlns="${MAIN}"><sheetData>${out.join('')}</sheetData></worksheet>`
}

function cellXml(
  cell: Cell,
  ref: string,
  sheet: string,
  strings: SharedStrings,
): string | undefined {
  switch (cell.kind) {
    case 'empty':
      return undefined
    case 'string': {
      if (cell.value.length > MAX_CELL_TEXT) {
        throw new XlsxWriteError(
          `${cell.value.length} characters is more than Excel’s ${MAX_CELL_TEXT} in one cell.`,
          sheet,
          ref,
        )
      }
      const style = FORMULA_LIKE.test(cell.value) ? ` s="${STYLE.quoted}"` : ''
      return `<c r="${ref}"${style} t="s"><v>${strings.index(cell.value)}</v></c>`
    }
    case 'number':
      if (!Number.isFinite(cell.value)) {
        throw new XlsxWriteError(`${cell.value} is not a number Excel can hold.`, sheet, ref)
      }
      // `String(-0)` is "0", and every finite double prints as an xsd:double.
      return `<c r="${ref}"><v>${String(cell.value)}</v></c>`
    case 'boolean':
      return `<c r="${ref}" t="b"><v>${cell.value ? 1 : 0}</v></c>`
    case 'date': {
      const serial = isoDayToSerial(cell.value)
      if (serial === undefined) {
        throw new XlsxWriteError(
          `${JSON.stringify(cell.value)} is not a YYYY-MM-DD day from ${FIRST_WRITABLE_DAY} to 9999-12-31.`,
          sheet,
          ref,
        )
      }
      return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`
    }
  }
}

class SharedStrings {
  private readonly indexes = new Map<string, number>()
  private readonly list: string[] = []
  private uses = 0

  get size(): number {
    return this.list.length
  }

  index(value: string): number {
    this.uses++
    let at = this.indexes.get(value)
    if (at === undefined) {
      at = this.list.length
      this.indexes.set(value, at)
      this.list.push(value)
    }
    return at
  }

  xml(): string {
    return (
      `${DECLARATION}<sst xmlns="${MAIN}" count="${this.uses}" uniqueCount="${this.list.length}">` +
      this.list
        .map((value) => `<si><t xml:space="preserve">${escapeText(value)}</t></si>`)
        .join('') +
      `</sst>`
    )
  }
}

/**
 * Each character the writer escapes as `_xHHHH_` (the `ST_Xstring` type of
 * ECMA-376): what XML 1.0 cannot hold, including an unpaired surrogate, and a
 * carriage return, which Office escapes too ([MS-OI29500] §2.1.1747) and which
 * an XML parser would otherwise read as a line feed.
 */
const ESCAPED_CHARACTER = String.raw`[\u0000-\u0008\u000b-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]`

/**
 * What the writer escapes: each `ESCAPED_CHARACTER`, and the underscore that
 * starts text which already looks like an escape. Text looks like one when
 * `_xHHHH` is followed by an underscore, **or by a character escaped here**,
 * whose own escape starts with the underscore that would close it: `_x0041`
 * then NUL would otherwise be written `_x0041_x0000_` and read back as `A`.
 */
const NEEDS_OOXML_ESCAPE = new RegExp(
  `_(?=x[0-9A-Fa-f]{4}(?:_|${ESCAPED_CHARACTER}))|${ESCAPED_CHARACTER}`,
  'g',
)

function escapeText(value: string): string {
  return value
    .replace(
      NEEDS_OOXML_ESCAPE,
      (ch) => `_x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`,
    )
    .replace(/[&<>]/g, (ch) => XML_ESCAPES[ch]!)
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => XML_ESCAPES[ch]!)
}
