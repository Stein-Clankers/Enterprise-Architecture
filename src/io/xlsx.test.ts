import { describe, expect, it } from 'vitest'
import { fixtureBytes } from '@/test/fixture-bytes'
import { readZipDirectory, readZipEntry, writeZip } from './zip'
import { formatKind, readXlsx, type XlsxReadResult } from './xlsx-read'
import { MAX_CELL_TEXT, writeXlsx, XlsxWriteError } from './xlsx-write'
import {
  booleanCell,
  cellAt,
  cellReference,
  columnName,
  dateCell,
  EMPTY,
  MAX_COLUMNS,
  MAX_ROWS,
  numberCell,
  parseCellReference,
  tableRows,
  textCell,
  type Cell,
  type ReadCell,
  type Workbook,
} from './xlsx'

/**
 * The `.xlsx` reader and writer (#208). Our own workbooks round-trip; a file
 * openpyxl wrote reads as pinned; and every way a cell or a file can be
 * unreadable is fired on a package built here (`pkg`), which says only what
 * that test needs and claims to be no tool's output.
 */

const SITES = tableRows(
  [
    { key: 'id', label: 'Id' },
    { key: 'name', label: 'Name' },
    { key: 'go_live', label: 'Go-live' },
    { key: 'budget', label: 'Budget (EUR)' },
    { key: 'pilot', label: 'Pilot' },
  ],
  [
    [
      textCell('loc-001'),
      textCell('Vienna HQ'),
      dateCell('2027-05-12'),
      numberCell(125000.5),
      booleanCell(true),
    ],
    [textCell('loc-002'), textCell('Graz'), textCell('2027-Q2'), EMPTY, booleanCell(false)],
    [],
    [textCell('loc-004'), textCell('Linz'), textCell('2027-W19'), numberCell(-0.000001)],
    [textCell('loc-005'), EMPTY, textCell('2027-05'), EMPTY, EMPTY, textCell('beyond the header')],
  ],
)

const WORKBOOK: Workbook = {
  sheets: [
    { name: 'Sites', rows: SITES },
    {
      name: 'Waves & “dates”',
      rows: tableRows([{ key: 'id', label: 'Wave' }], [[textCell('w1')]]),
    },
    { name: 'Empty', rows: [] },
  ],
}

async function roundTrip(workbook: Workbook): Promise<XlsxReadResult> {
  return readXlsx(writeXlsx(workbook))
}

/** A part of a written workbook, as text. */
async function partOf(bytes: Uint8Array, name: string): Promise<string> {
  const entry = readZipDirectory(bytes).find((candidate) => candidate.name === name)
  if (!entry) throw new Error(`no ${name}`)
  return new TextDecoder().decode(await readZipEntry(bytes, entry))
}

describe('a workbook written by us re-reads identically', () => {
  it('several sheets, each with a header row and a label row, every cell kind, empty and ragged rows', async () => {
    const result = await roundTrip(WORKBOOK)
    expect(result.problems).toEqual([])
    expect(result.workbook).toEqual(WORKBOOK)
  })

  it('ends each row at its last cell and the sheet at its last row that hold something', async () => {
    const result = await roundTrip({
      sheets: [
        {
          name: 'S',
          rows: [[textCell('a'), EMPTY, EMPTY], [EMPTY], [], [EMPTY, numberCell(1)], [EMPTY], []],
        },
      ],
    })
    expect(result.workbook?.sheets[0]?.rows).toEqual([
      [textCell('a')],
      [],
      [],
      [EMPTY, numberCell(1)],
    ])
  })

  it('reads past the end of a row or a sheet as empty', async () => {
    const sheet = (await roundTrip(WORKBOOK)).workbook!.sheets[0]!
    expect(cellAt(sheet, 3, 1)).toEqual(textCell('Graz'))
    expect(cellAt(sheet, 5, 4)).toEqual(EMPTY)
    expect(cellAt(sheet, 500, 0)).toEqual(EMPTY)
    expect(cellAt(sheet, 6, 5)).toEqual(textCell('beyond the header'))
  })

  it('writes the same bytes for the same workbook', () => {
    expect(writeXlsx(WORKBOOK)).toEqual(writeXlsx(WORKBOOK))
  })

  it('writes -0 as 0, the number Excel holds', async () => {
    const result = await roundTrip({
      sheets: [{ name: 'S', rows: [[numberCell(-0), numberCell(1e21), numberCell(5e-324)]] }],
    })
    const [zero, big, tiny] = result.workbook!.sheets[0]!.rows[0]!
    expect(Object.is((zero as { value: number }).value, 0)).toBe(true)
    expect(big).toEqual(numberCell(1e21))
    expect(tiny).toEqual(numberCell(5e-324))
  })
})

describe('escaping (#208)', () => {
  /** Each holds a separator or a character some layer could take as markup, or looks like an escape. */
  const AWKWARD = [
    'Vienna, HQ',
    'a,b,,c',
    'say "hi"',
    '""',
    "it's",
    "'leading apostrophe",
    'line one\nline two',
    'windows\r\nline',
    'lone\rreturn',
    'tab\there',
    '  padded  ',
    '<b>&amp;</b>',
    '=SUM(A1:A3)',
    '=1+1',
    '+43 1 234',
    '-5',
    '@mention',
    '_x000D_',
    '_x005F_x000D_',
    '_x00_ and _xZZZZ_',
    'bell \u0007 and nul \u0000',
    'lone surrogate \ud800 here',
    'noncharacters \ufffe\uffff',
    'emoji 🗺️',
    '',
  ]

  it('values with commas, quotes, newlines, a leading = and text that looks escaped survive a round trip', async () => {
    const rows = AWKWARD.map((value) => [textCell(value)])
    const result = await roundTrip({ sheets: [{ name: 'Awkward', rows }] })
    expect(result.problems).toEqual([])
    expect(result.workbook?.sheets[0]?.rows).toEqual(rows)
  })

  it('writes formula-like text as a text cell, never a formula, and keeps it text on edit', async () => {
    const bytes = writeXlsx({
      sheets: [
        {
          name: 'S',
          rows: [
            [
              textCell('=SUM(A1)'),
              textCell('+1'),
              textCell('-1'),
              textCell('@x'),
              textCell('plain'),
              textCell('a=b'),
            ],
          ],
        },
      ],
    })
    const sheet = await partOf(bytes, 'xl/worksheets/sheet1.xml')
    expect(sheet).not.toContain('<f>')
    expect(sheet).not.toContain('<f ')
    const cells = [...sheet.matchAll(/<c r="([A-Z]+1)"([^>]*)>/g)].map(([, ref, attributes]) => [
      ref,
      attributes,
    ])
    expect(cells).toEqual([
      ['A1', ' s="2" t="s"'],
      ['B1', ' s="2" t="s"'],
      ['C1', ' s="2" t="s"'],
      ['D1', ' s="2" t="s"'],
      ['E1', ' t="s"'],
      ['F1', ' t="s"'],
    ])
    // Style 2 is the quote prefix, Excel's mark for "this is text, whatever it looks like".
    expect((await partOf(bytes, 'xl/styles.xml')).match(/<xf [^>]*\/>/g)?.[3]).toContain(
      'quotePrefix="1"',
    )
  })

  it('a sheet name with markup characters survives', async () => {
    const result = await roundTrip({ sheets: [{ name: `A & B <"c">`, rows: [[textCell('x')]] }] })
    expect(result.workbook?.sheets[0]?.name).toBe(`A & B <"c">`)
  })
})

describe('the writer refuses what Excel cannot open', () => {
  const write = (workbook: Workbook) => () => writeXlsx(workbook)
  const sheet = (name: string, rows: Cell[][] = []) => ({ name, rows })

  it('a workbook with no sheets', () => {
    expect(write({ sheets: [] })).toThrow(XlsxWriteError)
  })

  it.each([
    ['', 'is empty'],
    ['x'.repeat(32), 'longer than 31'],
    ['a/b', 'contains one of'],
    ['a\\b', 'contains one of'],
    ['a?b', 'contains one of'],
    ['a*b', 'contains one of'],
    ['a[b', 'contains one of'],
    ['a]b', 'contains one of'],
    ['a:b', 'contains one of'],
    ["'quoted", 'apostrophe'],
    ["quoted'", 'apostrophe'],
    ['tab\there', 'control character'],
    ['History', 'reserved'],
    ['history', 'reserved'],
  ])('a sheet named %j', (name, reason) => {
    expect(write({ sheets: [sheet(name)] })).toThrow(reason)
  })

  it('two sheets whose names differ only in case', () => {
    expect(write({ sheets: [sheet('Sites'), sheet('SITES')] })).toThrow('used twice')
    expect(write({ sheets: [sheet('x'.repeat(31)), sheet("it's")] })).not.toThrow()
  })

  it('more rows or columns than Excel has', () => {
    expect(write({ sheets: [sheet('S', new Array<Cell[]>(MAX_ROWS + 1))] })).toThrow(
      'more than Excel’s',
    )
    expect(write({ sheets: [sheet('S', [new Array<Cell>(MAX_COLUMNS + 1).fill(EMPTY)])] })).toThrow(
      'columns',
    )
  })

  it('a number that is not finite, naming the cell', () => {
    expect(write({ sheets: [sheet('S', [[EMPTY, numberCell(Number.NaN)]])] })).toThrow(
      'Sheet “S”, cell B1',
    )
    expect(write({ sheets: [sheet('S', [[numberCell(Infinity)]])] })).toThrow('not a number')
  })

  it('text longer than a cell holds', () => {
    expect(write({ sheets: [sheet('S', [[textCell('x'.repeat(MAX_CELL_TEXT))]])] })).not.toThrow()
    expect(write({ sheets: [sheet('S', [[textCell('x'.repeat(MAX_CELL_TEXT + 1))]])] })).toThrow(
      '32767',
    )
  })

  it.each(['2027-02-30', '2027-5-12', '2027-Q2', '1900-02-28', ''])(
    'a date cell holding %j',
    (value) => {
      expect(write({ sheets: [sheet('S', [[dateCell(value)]])] })).toThrow(
        'is not a YYYY-MM-DD day',
      )
    },
  )
})

// ---------------------------------------------------------------------------
// Packages built here, to fire each way a file can be unreadable.

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'

interface Spec {
  /** Each sheet's `<sheetData>` content; the type is the relationship's, `worksheet` unless given. */
  sheets?: { name: string; data?: string; type?: string }[]
  /** `<si>` elements; no shared strings part when absent. */
  strings?: string
  /** `<styleSheet>` content; no styles part when absent. */
  styles?: string
  workbookPr?: string
  /** Parts to replace, or with `null` to leave out. */
  parts?: Record<string, string | Uint8Array | null>
  namespace?: { main: string; rel: string }
}

function pkg(spec: Spec = {}): Uint8Array {
  const main = spec.namespace?.main ?? MAIN
  const rel = spec.namespace?.rel ?? REL
  const sheets = spec.sheets ?? [{ name: 'Sheet1' }]
  const parts: Record<string, string | Uint8Array | null> = {
    '_rels/.rels': `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':
      `<workbook xmlns="${main}" xmlns:r="${rel}">${spec.workbookPr ?? ''}<sheets>` +
      sheets
        .map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('') +
      `</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `<Relationships xmlns="${PKG}">` +
      sheets
        .map(
          (sheet, i) =>
            `<Relationship Id="rId${i + 1}" Type="${rel}/${sheet.type ?? 'worksheet'}" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      (spec.styles === undefined
        ? ''
        : `<Relationship Id="rS" Type="${rel}/styles" Target="styles.xml"/>`) +
      (spec.strings === undefined
        ? ''
        : `<Relationship Id="rT" Type="${rel}/sharedStrings" Target="/xl/sharedStrings.xml"/>`) +
      `</Relationships>`,
    ...Object.fromEntries(
      sheets.map((sheet, i) => [
        `xl/worksheets/sheet${i + 1}.xml`,
        `<worksheet xmlns="${main}"><sheetData>${sheet.data ?? ''}</sheetData></worksheet>`,
      ]),
    ),
    ...(spec.styles === undefined
      ? {}
      : { 'xl/styles.xml': `<styleSheet xmlns="${main}">${spec.styles}</styleSheet>` }),
    ...(spec.strings === undefined
      ? {}
      : { 'xl/sharedStrings.xml': `<sst xmlns="${main}">${spec.strings}</sst>` }),
    ...spec.parts,
  }
  const encoder = new TextEncoder()
  return writeZip(
    Object.entries(parts)
      .filter((entry): entry is [string, string | Uint8Array] => entry[1] !== null)
      .map(([name, data]) => ({
        name,
        data: typeof data === 'string' ? encoder.encode(data) : data,
      })),
  )
}

/** One row of cells as `<row>` content. */
const row = (cells: string, r = 1) => `<row r="${r}">${cells}</row>`

/** Styles with a `cellXfs` entry per number format id, in order, and the custom formats given. */
function styles(ids: number[], custom: Record<number, string> = {}): string {
  const numFmts = Object.entries(custom)
    .map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${code}"/>`)
    .join('')
  return `<numFmts>${numFmts}</numFmts><cellXfs>${ids.map((id) => `<xf numFmtId="${id}"/>`).join('')}</cellXfs>`
}

async function readOne(
  spec: Spec,
): Promise<{ rows: ReadCell[][]; problems: XlsxReadResult['problems'] }> {
  const result = await readXlsx(pkg(spec), 'test.xlsx')
  expect(result.workbook, JSON.stringify(result.problems)).toBeDefined()
  return { rows: result.workbook!.sheets[0]!.rows, problems: result.problems }
}

/** The one problem a read reported, which must name the sheet and the cell. */
function onlyProblem(problems: XlsxReadResult['problems']) {
  expect(problems).toHaveLength(1)
  return problems[0]!
}

describe('reading what other writers write', () => {
  it('shared strings, rich-text runs joined, phonetic guides left out', async () => {
    const { rows, problems } = await readOne({
      strings:
        '<si><t>plain</t></si><si><r><t>bold</t></r><r><rPr><b/></rPr><t xml:space="preserve"> and not</t></r></si>' +
        '<si><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></si><si><t/></si>',
      sheets: [
        {
          name: 'S',
          data: row(
            '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c>',
          ),
        },
      ],
    })
    expect(problems).toEqual([])
    expect(rows).toEqual([
      [textCell('plain'), textCell('bold and not'), textCell('東京'), textCell('')],
    ])
  })

  it('inline strings, with runs, and an empty one', async () => {
    const { rows } = await readOne({
      sheets: [
        {
          name: 'S',
          data: row(
            '<c r="A1" t="inlineStr"><is><t>inline</t></is></c><c r="B1" t="inlineStr"><is><r><t>a</t></r><r><t>b</t></r></is></c><c r="C1" t="inlineStr"><is/></c>',
          ),
        },
      ],
    })
    expect(rows).toEqual([[textCell('inline'), textCell('ab'), textCell('')]])
  })

  it('rows and cells that leave out their reference follow the one before', async () => {
    const { rows } = await readOne({
      sheets: [
        {
          name: 'S',
          data: '<row><c><v>1</v></c><c><v>2</v></c></row><row r="3"><c r="B3"><v>3</v></c><c><v>4</v></c></row><row><c><v>5</v></c></row>',
        },
      ],
    })
    expect(rows).toEqual([
      [numberCell(1), numberCell(2)],
      [],
      [EMPTY, numberCell(3), numberCell(4)],
      [numberCell(5)],
    ])
  })

  it('cells in any order, and styled cells that hold nothing', async () => {
    const { rows } = await readOne({
      sheets: [
        {
          name: 'S',
          data:
            row('<c r="C1"><v>3</v></c><c r="A1"><v>1</v></c><c r="D1" s="0"/>') +
            row('<c r="A2" s="0"/>', 2),
        },
      ],
    })
    expect(rows).toEqual([[numberCell(1), EMPTY, numberCell(3)]])
  })

  it('booleans and ISO dates (t="d")', async () => {
    const { rows, problems } = await readOne({
      sheets: [
        {
          name: 'S',
          data: row(
            '<c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c><c r="C1" t="b"><v>true</v></c><c r="D1" t="d"><v>2027-05-12</v></c><c r="E1" t="d"><v>2027-05-12T00:00:00Z</v></c>',
          ),
        },
      ],
    })
    expect(problems).toEqual([])
    expect(rows).toEqual([
      [
        booleanCell(true),
        booleanCell(false),
        booleanCell(true),
        dateCell('2027-05-12'),
        dateCell('2027-05-12'),
      ],
    ])
  })

  it('a date by its built-in or custom number format, in the 1900 system', async () => {
    const { rows, problems } = await readOne({
      styles: styles([0, 14, 164, 165, 4], { 164: 'dd/mm/yyyy', 165: '[$-409]mmmm\\ yyyy;@' }),
      sheets: [
        {
          name: 'S',
          data: row(
            '<c r="A1"><v>46519</v></c><c r="B1" s="1"><v>46519</v></c><c r="C1" s="2"><v>46519</v></c><c r="D1" s="3"><v>46519</v></c><c r="E1" s="4"><v>46519</v></c>',
          ),
        },
      ],
    })
    expect(problems).toEqual([])
    expect(rows).toEqual([
      [
        numberCell(46519),
        dateCell('2027-05-12'),
        dateCell('2027-05-12'),
        dateCell('2027-05-12'),
        numberCell(46519),
      ],
    ])
  })

  it('a date in the 1904 system', async () => {
    for (const flag of ['1', 'true']) {
      const { rows } = await readOne({
        workbookPr: `<workbookPr date1904="${flag}"/>`,
        styles: styles([14]),
        sheets: [{ name: 'S', data: row('<c r="A1" s="0"><v>45057</v></c>') }],
      })
      expect(rows).toEqual([[dateCell('2027-05-12')]])
    }
  })

  it('formula results, said once per sheet', async () => {
    const { rows, problems } = await readOne({
      sheets: [
        {
          name: 'Calc',
          data: row(
            '<c r="A1"><f>1+1</f><v>2</v></c><c r="B1" t="str"><f>"a"&amp;"b"</f><v>ab</v></c><c r="C1" t="str"><f>""</f><v></v></c>',
          ),
        },
      ],
    })
    expect(rows).toEqual([[numberCell(2), textCell('ab'), textCell('')]])
    expect(onlyProblem(problems)).toEqual(
      expect.objectContaining({
        severity: 'info',
        code: 'xlsx.formula-results-read',
        sheet: 'Calc',
        cell: 'A1',
        message: expect.stringContaining('3 cells'),
      }),
    )
  })

  it('strict OOXML, an absolute target, and part names in another case', async () => {
    const result = await readXlsx(
      pkg({
        namespace: {
          main: 'http://purl.oclc.org/ooxml/spreadsheetml/main',
          rel: 'http://purl.oclc.org/ooxml/officeDocument/relationships',
        },
        strings: '<si><t>strict</t></si>',
        sheets: [{ name: 'S' }],
        parts: {
          'xl/worksheets/sheet1.xml': null,
          'XL/Worksheets/Sheet1.XML': `<worksheet><sheetData>${row('<c r="A1" t="s"><v>0</v></c>')}</sheetData></worksheet>`,
        },
      }),
    )
    expect(result.problems).toEqual([])
    expect(result.workbook?.sheets[0]?.rows).toEqual([[textCell('strict')]])
  })

  /**
   * openpyxl 3.1.5's own output (`scripts/fixtures/xlsx-with-openpyxl.py`):
   * inline strings, its custom date formats, a built-in time format, an error
   * cell, and a formula it never calculated.
   */
  it('a workbook openpyxl wrote', async () => {
    const result = await readXlsx(fixtureBytes('openpyxl-sample.xlsx'), 'openpyxl-sample.xlsx')
    expect(result.workbook?.sheets.map((sheet) => sheet.name)).toEqual(['Sites', 'Waves'])
    expect(result.workbook?.sheets[0]?.rows).toEqual([
      ['id', 'name', 'go_live', 'cost', 'active'].map(textCell),
      ['Id', 'Name', 'Go-live', 'Cost', 'Active'].map(textCell),
      [
        textCell('s-1'),
        textCell('Vienna, HQ'),
        dateCell('2027-05-12'),
        numberCell(1500.25),
        booleanCell(true),
      ],
      [
        textCell('s-2'),
        textCell('say "hi"\nnext line'),
        textCell('2027-Q2'),
        EMPTY,
        booleanCell(false),
      ],
      [
        textCell('s-3'),
        EMPTY,
        dateCell('2027-05-12'),
        { kind: 'unreadable', text: '=SUM(D3:D4)' },
        { kind: 'unreadable', text: '#N/A' },
        { kind: 'unreadable', text: '0.5' },
      ],
    ])
    expect(result.workbook?.sheets[1]?.rows).toEqual([
      [textCell('wave')],
      [],
      [EMPTY, numberCell(42)],
    ])
    expect(result.problems.map(({ code, sheet, cell }) => [code, sheet, cell])).toEqual([
      ['xlsx.date-time-dropped', 'Sites', 'C5'],
      ['xlsx.formula-uncached', 'Sites', 'D5'],
      ['xlsx.cell-error', 'Sites', 'E5'],
      ['xlsx.time-cell', 'Sites', 'F5'],
    ])
  })
})

describe('a cell the reader cannot type is a problem naming its sheet and cell, never skipped or undefined', () => {
  /** Reads one cell's XML in sheet “Plan”, row 3, and returns the cell and the one problem. */
  async function cell(xml: string, spec: Omit<Spec, 'sheets'> = {}) {
    const { rows, problems } = await readOne({
      ...spec,
      sheets: [{ name: 'Plan', data: row(xml, 3) }],
    })
    const found = rows[2]?.[2]
    expect(found).toBeDefined()
    return { found: found!, problem: onlyProblem(problems) }
  }
  const named = (code: string, severity = 'warning') =>
    expect.objectContaining({
      code,
      severity,
      sheet: 'Plan',
      cell: 'C3',
      file: 'test.xlsx',
      message: expect.stringContaining('Sheet “Plan”, cell C3'),
    })

  it.each([
    ['an error', '<c r="C3" t="e"><v>#N/A</v></c>', 'xlsx.cell-error', '#N/A'],
    [
      'a formula error',
      '<c r="C3" t="e"><f>1/0</f><v>#DIV/0!</v></c>',
      'xlsx.cell-error',
      '#DIV/0!',
    ],
    ['an error with no name', '<c r="C3" t="e"/>', 'xlsx.cell-error', ''],
    ['an unknown cell type', '<c r="C3" t="x"><v>1</v></c>', 'xlsx.cell-type-unknown', '1'],
    ['an unknown cell type with no value', '<c r="C3" t="x"/>', 'xlsx.cell-type-unknown', ''],
    ['a number that is not one', '<c r="C3"><v>12abc</v></c>', 'xlsx.cell-malformed', '12abc'],
    ['an empty number', '<c r="C3"><v></v></c>', 'xlsx.cell-malformed', ''],
    ['a number in another notation', '<c r="C3"><v>0x1F</v></c>', 'xlsx.cell-malformed', '0x1F'],
    [
      'a shared string the file does not hold',
      '<c r="C3" t="s"><v>7</v></c>',
      'xlsx.cell-malformed',
      '7',
    ],
    [
      'a shared string index that is not one',
      '<c r="C3" t="s"><v>0.5</v></c>',
      'xlsx.cell-malformed',
      '0.5',
    ],
    ['a shared string with no index', '<c r="C3" t="s"/>', 'xlsx.cell-malformed', ''],
    ['inline text with no text', '<c r="C3" t="inlineStr"/>', 'xlsx.cell-malformed', ''],
    [
      'a formula text with no value and no formula',
      '<c r="C3" t="str"/>',
      'xlsx.cell-malformed',
      '',
    ],
    ['a boolean that is neither', '<c r="C3" t="b"><v>yes</v></c>', 'xlsx.cell-malformed', 'yes'],
    ['a boolean with no value', '<c r="C3" t="b"/>', 'xlsx.cell-malformed', ''],
    [
      'an ISO date that is not one',
      '<c r="C3" t="d"><v>12 May</v></c>',
      'xlsx.cell-malformed',
      '12 May',
    ],
    [
      'an ISO date that is no day',
      '<c r="C3" t="d"><v>2027-02-30</v></c>',
      'xlsx.cell-malformed',
      '2027-02-30',
    ],
    [
      'a formula never calculated',
      '<c r="C3"><f>SUM(A1:A2)</f></c>',
      'xlsx.formula-uncached',
      '=SUM(A1:A2)',
    ],
    [
      'a formula never calculated, as openpyxl writes it',
      '<c r="C3"><f>A1</f><v/></c>',
      'xlsx.formula-uncached',
      '=A1',
    ],
    [
      'a boolean formula never calculated',
      '<c r="C3" t="b"><f>TRUE()</f></c>',
      'xlsx.formula-uncached',
      '=TRUE()',
    ],
  ])('%s', async (_, xml, code, text) => {
    const { found, problem } = await cell(xml, { strings: '<si><t>only</t></si>' })
    expect(found).toEqual({ kind: 'unreadable', text })
    expect(problem).toEqual(named(code))
  })

  it('a shared string when the file has no shared strings', async () => {
    const { found, problem } = await cell('<c r="C3" t="s"><v>0</v></c>')
    expect(found).toEqual({ kind: 'unreadable', text: '0' })
    expect(problem).toEqual(named('xlsx.cell-malformed'))
  })

  it.each([
    ['1900-02-29, which never was', '60'],
    ['serial 0', '0'],
    ['a negative serial', '-3'],
    ['a serial past 9999-12-31', '2958466'],
  ])('a date cell at %s', async (_, serial) => {
    const { found, problem } = await cell(`<c r="C3" s="1"><v>${serial}</v></c>`, {
      styles: styles([0, 14]),
    })
    expect(found).toEqual({ kind: 'unreadable', text: serial })
    expect(problem).toEqual(named('xlsx.date-out-of-range'))
  })

  it.each([
    ['a built-in time format', 21, {}],
    ['a custom time format', 164, { 164: 'h:mm' }],
    ['elapsed hours', 164, { 164: '[h]:mm' }],
  ])('a time of day or duration, by %s', async (_, id, custom) => {
    const { found, problem } = await cell('<c r="C3" s="1"><v>0.5</v></c>', {
      styles: styles([0, id], custom),
    })
    expect(found).toEqual({ kind: 'unreadable', text: '0.5' })
    expect(problem).toEqual(named('xlsx.time-cell'))
  })

  it('a date with a time keeps its day and says the time was not read', async () => {
    const { found, problem } = await cell('<c r="C3" s="1"><v>46519.75</v></c>', {
      styles: styles([0, 22]),
    })
    expect(found).toEqual(dateCell('2027-05-12'))
    expect(problem).toEqual(named('xlsx.date-time-dropped'))
    const iso = await cell('<c r="C3" t="d"><v>2027-05-12T18:00:00</v></c>')
    expect(iso.found).toEqual(dateCell('2027-05-12'))
    expect(iso.problem).toEqual(named('xlsx.date-time-dropped'))
  })

  it('a style the file does not hold reads as a number, said', async () => {
    const missing = await cell('<c r="C3" s="5"><v>46519</v></c>', { styles: styles([0, 14]) })
    expect(missing.found).toEqual(numberCell(46519))
    expect(missing.problem).toEqual(named('xlsx.style-missing'))
    const none = await cell('<c r="C3" s="1"><v>46519</v></c>')
    expect(none.found).toEqual(numberCell(46519))
    expect(none.problem).toEqual(named('xlsx.style-missing'))
  })

  it('a built-in format whose meaning depends on Excel’s language reads as a number, said', async () => {
    const { found, problem } = await cell('<c r="C3" s="1"><v>46519</v></c>', {
      styles: styles([0, 30]),
    })
    expect(found).toEqual(numberCell(46519))
    expect(problem).toEqual(named('xlsx.number-format-unknown'))
  })
})

describe('cells and rows that cannot be placed', () => {
  async function problemsOf(data: string) {
    return readOne({ sheets: [{ name: 'Plan', data }] })
  }

  it('a row number that is not one', async () => {
    for (const r of ['0', 'x', '1048577']) {
      const { rows, problems } = await problemsOf(
        `<row r="${r}"><c><v>1</v></c><c><v>2</v></c></row>`,
      )
      expect(rows).toEqual([])
      expect(onlyProblem(problems)).toEqual(
        expect.objectContaining({
          code: 'xlsx.row-reference-malformed',
          sheet: 'Plan',
          message: expect.stringContaining('2 cells'),
        }),
      )
    }
  })

  it('a cell reference that is not one, or not in its row', async () => {
    for (const ref of ['1A', 'B2', '$A$1', 'A0', 'XFE1']) {
      const { rows, problems } = await problemsOf(
        row(`<c r="${ref}"><v>1</v></c><c r="B1"><v>2</v></c>`),
      )
      expect(rows).toEqual([[EMPTY, numberCell(2)]])
      expect(onlyProblem(problems)).toEqual(
        expect.objectContaining({
          code: 'xlsx.cell-reference-malformed',
          sheet: 'Plan',
          message: expect.stringContaining(JSON.stringify(ref)),
        }),
      )
    }
  })

  it('a cell the file holds twice keeps the first', async () => {
    const { rows, problems } = await problemsOf(row('<c r="A1"><v>1</v></c><c r="A1"><v>2</v></c>'))
    expect(rows).toEqual([[numberCell(1)]])
    expect(onlyProblem(problems)).toEqual(
      expect.objectContaining({ code: 'xlsx.cell-repeated', sheet: 'Plan', cell: 'A1' }),
    )
  })

  it('a chart sheet is named as not read', async () => {
    const result = await readXlsx(
      pkg({
        sheets: [
          { name: 'Chart', type: 'chartsheet' },
          { name: 'Data', data: row('<c r="A1"><v>1</v></c>') },
        ],
      }),
    )
    expect(result.workbook?.sheets.map((sheet) => sheet.name)).toEqual(['Data'])
    expect(onlyProblem(result.problems)).toEqual(
      expect.objectContaining({ code: 'xlsx.sheet-not-worksheet', sheet: 'Chart' }),
    )
  })
})

describe('a file that cannot be read yields no workbook, and says why', () => {
  async function fatal(bytes: Uint8Array) {
    const result = await readXlsx(bytes, 'bad.xlsx')
    expect(result.workbook).toBeUndefined()
    const found = onlyProblem(result.problems)
    expect(found).toEqual(expect.objectContaining({ severity: 'error', file: 'bad.xlsx' }))
    return found
  }
  const bytesOf = (text: string) => new TextEncoder().encode(text)

  it('not a zip at all', async () => {
    expect(await fatal(bytesOf('id,name\n1,Vienna\n'))).toEqual(
      expect.objectContaining({ code: 'xlsx.archive-truncated' }),
    )
  })

  it('a damaged part, naming its sheet', async () => {
    const bytes = pkg({ sheets: [{ name: 'Sites', data: row('<c r="A1"><v>12345</v></c>') }] })
    const at = new TextDecoder('latin1').decode(bytes).indexOf('12345')
    bytes[at] = '9'.charCodeAt(0)
    expect(await fatal(bytes)).toEqual(
      expect.objectContaining({
        code: 'xlsx.archive-corrupt',
        sheet: 'Sites',
        message: expect.stringContaining('Sheet “Sites”'),
      }),
    )
  })

  it('no package relationships, or none naming a workbook', async () => {
    expect(await fatal(pkg({ parts: { '_rels/.rels': null } }))).toEqual(
      expect.objectContaining({ code: 'xlsx.part-missing' }),
    )
    expect(
      await fatal(pkg({ parts: { '_rels/.rels': `<Relationships xmlns="${PKG}"/>` } })),
    ).toEqual(
      expect.objectContaining({
        code: 'xlsx.part-missing',
        message: expect.stringContaining('not a spreadsheet'),
      }),
    )
  })

  it('a workbook part that is missing, or not a workbook', async () => {
    expect(await fatal(pkg({ parts: { 'xl/workbook.xml': null } }))).toEqual(
      expect.objectContaining({ code: 'xlsx.part-missing' }),
    )
    expect(await fatal(pkg({ parts: { 'xl/workbook.xml': '<document/>' } }))).toEqual(
      expect.objectContaining({ code: 'xlsx.part-unreadable' }),
    )
  })

  it('a sheet the workbook lists and the file does not hold, naming it', async () => {
    expect(
      await fatal(
        pkg({ sheets: [{ name: 'Sites' }], parts: { 'xl/worksheets/sheet1.xml': null } }),
      ),
    ).toEqual(expect.objectContaining({ code: 'xlsx.part-missing', sheet: 'Sites' }))
    expect(
      await fatal(
        pkg({
          sheets: [{ name: 'Sites' }],
          parts: { 'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PKG}"/>` },
        }),
      ),
    ).toEqual(expect.objectContaining({ code: 'xlsx.part-missing', sheet: 'Sites' }))
  })

  it('a part that is not UTF-8, or not XML', async () => {
    expect(
      await fatal(
        pkg({ parts: { 'xl/worksheets/sheet1.xml': new Uint8Array([0x3c, 0xff, 0xfe, 0x3e]) } }),
      ),
    ).toEqual(
      expect.objectContaining({
        code: 'xlsx.part-unreadable',
        sheet: 'Sheet1',
        message: expect.stringContaining('UTF-8'),
      }),
    )
    expect(
      await fatal(
        pkg({ parts: { 'xl/worksheets/sheet1.xml': '<worksheet><sheetData></worksheet>' } }),
      ),
    ).toEqual(
      expect.objectContaining({
        code: 'xlsx.part-unreadable',
        sheet: 'Sheet1',
        message: expect.stringContaining('well-formed'),
      }),
    )
  })

  it('a styles or shared strings part that is not one', async () => {
    expect(await fatal(pkg({ styles: '', parts: { 'xl/styles.xml': '<sst/>' } }))).toEqual(
      expect.objectContaining({ code: 'xlsx.part-unreadable' }),
    )
    expect(await fatal(pkg({ strings: '', parts: { 'xl/sharedStrings.xml': null } }))).toEqual(
      expect.objectContaining({ code: 'xlsx.part-missing' }),
    )
  })

  it('a bug of its own is thrown, not reported as a damaged file', async () => {
    await expect(readXlsx(null as unknown as Uint8Array)).rejects.toThrow(TypeError)
  })
})

describe('number formats', () => {
  it.each([
    ['General', 'number'],
    ['0.00', 'number'],
    ['#,##0 "days"', 'number'],
    ['[Red]0;[Blue]-0', 'number'],
    ['0.00E+00', 'number'],
    ['\\d0', 'number'],
    ['yyyy-mm-dd', 'date'],
    ['dd/mm/yyyy', 'date'],
    ['mmm', 'date'],
    ['[$-409]mmmm yyyy', 'date'],
    ['d/m/yyyy h:mm', 'date'],
    ['yyyy-mm-dd h:mm:ss', 'date'],
    ['h:mm', 'time'],
    ['mm:ss', 'time'],
    ['[h]:mm', 'time'],
    ['[mm]', 'time'],
    ['h:mm AM/PM', 'time'],
    ['_(* #,##0_)', 'number'],
  ])('%j is a %s format', (code, kind) => {
    expect(formatKind(code)).toBe(kind)
  })
})

describe('cell references', () => {
  it('names columns and cells as Excel does, and reads them back', () => {
    expect([0, 25, 26, 701, 702, MAX_COLUMNS - 1].map(columnName)).toEqual([
      'A',
      'Z',
      'AA',
      'ZZ',
      'AAA',
      'XFD',
    ])
    expect(cellReference(4, 2)).toBe('C5')
    expect(parseCellReference('XFD1048576')).toEqual({ row: MAX_ROWS - 1, column: MAX_COLUMNS - 1 })
    for (const ref of ['', 'a1', 'A', '1', 'XFE1', 'A1048577', 'A01'])
      expect(parseCellReference(ref), ref).toBeUndefined()
  })
})
