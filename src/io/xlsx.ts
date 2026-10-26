import type { ImportProblem } from './problems'

/**
 * A workbook as data, independent of the `.xlsx` format (#208): a list of
 * sheets, each a list of rows of typed cells. `xlsx-write.ts` writes it and
 * `xlsx-read.ts` reads it; the rollout workbook (#210) and the inventory's
 * Excel round trip (#94) build on this shape, never on the file format.
 *
 * Rows are in sheet order: `rows[0]` is row 1. A row ends at its last cell that
 * holds something and a sheet at its last row that does, so rows are ragged,
 * and `cellAt` reads past the end of a row as empty. That is what makes #94's
 * rule expressible: an empty cell in a column the header names is a blank, and
 * a column the header does not name is missing.
 */

export type Cell =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  /** A day as `YYYY-MM-DD`: Excel's date cells hold no time zone, and neither does this. */
  | { kind: 'date'; value: string }
  | { kind: 'empty' }

/**
 * A cell the reader could not type: an error such as `#N/A`, an unknown cell
 * type, a malformed value. It is never read as empty, because to #94 an empty
 * cell deletes the value it stands for. Each one comes with a problem naming
 * its sheet and cell; `text` is what the file held, for a message to show.
 */
export interface UnreadableCell {
  kind: 'unreadable'
  text: string
}

export type ReadCell = Cell | UnreadableCell

export interface Sheet<C = Cell> {
  /** As Excel shows it on the tab. */
  name: string
  rows: C[][]
}

export interface Workbook<C = Cell> {
  sheets: Sheet<C>[]
}

/** An import problem that names its sheet, and its cell when there is one, as `C5`. */
export interface XlsxProblem extends ImportProblem {
  sheet?: string
  cell?: string
}

export const EMPTY: Cell = Object.freeze({ kind: 'empty' })
export const textCell = (value: string): Cell => ({ kind: 'string', value })
export const numberCell = (value: number): Cell => ({ kind: 'number', value })
export const booleanCell = (value: boolean): Cell => ({ kind: 'boolean', value })
/** A date cell. The writer refuses anything but a real `YYYY-MM-DD` day from 1900-03-01 on. */
export const dateCell = (value: string): Cell => ({ kind: 'date', value })

/** The cell at a 0-based row and column, empty past the end of the row or the sheet. */
export function cellAt<C>(sheet: Sheet<C>, row: number, column: number): C | Cell {
  return sheet.rows[row]?.[column] ?? EMPTY
}

/** A column of a table sheet: its technical key, written in row 1, and its label, in row 2. */
export interface Column {
  key: string
  label: string
}

/**
 * The rows of a table sheet as #94 and the rollout workbook (#210) lay one
 * out: row 1 holds each column's technical key, the file's contract, and row 2
 * its label, for people. Data starts in row 3.
 */
export function tableRows(
  columns: readonly Column[],
  data: readonly (readonly Cell[])[],
): Cell[][] {
  return [
    columns.map((column) => textCell(column.key)),
    columns.map((column) => textCell(column.label)),
    ...data.map((row) => [...row]),
  ]
}

/** Excel's maximum sheet size. */
export const MAX_ROWS = 1_048_576
export const MAX_COLUMNS = 16_384

/** The column letters of a 0-based column: 0 is `A`, 26 is `AA`. */
export function columnName(column: number): string {
  let name = ''
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  }
  return name
}

/** A cell's A1 reference from its 0-based row and column: (4, 2) is `C5`. */
export function cellReference(row: number, column: number): string {
  return `${columnName(column)}${row + 1}`
}

/**
 * The 0-based row and column of an A1 reference, or `undefined` when it is not
 * one or lies outside Excel's grid. Absolute markers (`$C$5`) are not part of a
 * cell's own reference, so they are refused too.
 */
export function parseCellReference(reference: string): { row: number; column: number } | undefined {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(reference)
  if (!match) return undefined
  let column = 0
  for (const letter of match[1]!) column = column * 26 + (letter.charCodeAt(0) - 64)
  const row = Number(match[2])
  if (column > MAX_COLUMNS || row > MAX_ROWS) return undefined
  return { row: row - 1, column: column - 1 }
}
