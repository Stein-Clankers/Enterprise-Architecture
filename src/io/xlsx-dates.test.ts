import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isoDayToSerial, parseIsoDay, serialToIsoDay } from './xlsx-dates'
import { readXlsx } from './xlsx-read'
import { writeXlsx } from './xlsx-write'
import { dateCell } from './xlsx'

/** Serials and the days Excel shows for them, 1900 system; each checked against Excel's documented anchors. */
const ANCHORS: readonly [number, string][] = [
  [1, '1900-01-01'],
  [59, '1900-02-28'],
  [61, '1900-03-01'],
  [367, '1901-01-01'],
  [25569, '1970-01-01'],
  [36526, '2000-01-01'],
  [46519, '2027-05-12'],
  [46752, '2027-12-31'],
  [2958465, '9999-12-31'],
]

describe('Excel date serials (#208)', () => {
  it('reads the 1900 system, Lotus’s leap-year bug included', () => {
    for (const [serial, day] of ANCHORS)
      expect(serialToIsoDay(serial, false), String(serial)).toBe(day)
  })

  it('reads the 1904 system, which starts at serial 0', () => {
    expect(serialToIsoDay(0, true)).toBe('1904-01-01')
    // The two systems are 1,462 days apart from 1900-03-01 on.
    expect(serialToIsoDay(46519 - 1462, true)).toBe('2027-05-12')
    expect(serialToIsoDay(2957003, true)).toBe('9999-12-31')
  })

  it('names no day for a serial that is none', () => {
    // 1900-02-29 never was; 0 is Excel’s "1900-01-00"; past 9999-12-31 Excel shows ####.
    for (const serial of [60, 0, -1, 2958466, 1.5])
      expect(serialToIsoDay(serial, false), String(serial)).toBeUndefined()
    for (const serial of [-1, 2957004])
      expect(serialToIsoDay(serial, true), String(serial)).toBeUndefined()
  })

  it('writes the serial back for every day from 1900-03-01, and refuses the days before', () => {
    for (const [serial, day] of ANCHORS.filter(([s]) => s >= 61))
      expect(isoDayToSerial(day), day).toBe(serial)
    expect(isoDayToSerial('1900-02-28')).toBeUndefined()
    expect(isoDayToSerial('0000-01-01')).toBeUndefined()
  })

  it('takes only a real YYYY-MM-DD day', () => {
    expect(parseIsoDay('2028-02-29')).toEqual([2028, 2, 29])
    for (const text of [
      '2027-02-29',
      '2027-02-30',
      '2027-13-01',
      '2027-00-10',
      '2027-05-00',
      '2027-5-1',
      '2027-05-12T00:00',
      ' 2027-05-12',
      '2027-Q2',
    ]) {
      expect(parseIsoDay(text), text).toBeUndefined()
    }
  })

  it('round-trips every day of a span through its serial', () => {
    for (let serial = 61; serial < 61 + 366 * 4; serial++) {
      const day = serialToIsoDay(serial, false)!
      expect(isoDayToSerial(day)).toBe(serial)
    }
  })
})

/**
 * The time-zone criterion of #208, run for real: this file's conversions in
 * fresh Node processes started under each `TZ`, so the zone is the machine's
 * from the first instruction, as on a planner's laptop. Auckland is UTC+13 in
 * January, where a conversion through a local `Date` lands on the previous
 * day; the child reports its own offset, so a `TZ` that did not take cannot
 * pass as one that did.
 */
describe('a date serial is the same day in every time zone', () => {
  const module = pathToFileURL(join(process.cwd(), 'src', 'io', 'xlsx-dates.ts')).href
  const script = `
    const m = await import(${JSON.stringify(module)})
    const serials = ${JSON.stringify(ANCHORS.map(([serial]) => serial))}
    console.log(JSON.stringify({
      offset: new Date(2027, 0, 15).getTimezoneOffset(),
      days: serials.map((s) => m.serialToIsoDay(s, false)),
      days1904: serials.map((s) => m.serialToIsoDay(s - 1462, true)),
      serials: ${JSON.stringify(ANCHORS.map(([, day]) => day))}.map((d) => m.isoDayToSerial(d)),
    }))`
  const runUnder = (tz: string) =>
    JSON.parse(
      execFileSync(process.execPath, ['--input-type=module', '--no-warnings', '-e', script], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
      }),
    ) as {
      offset: number
      days: string[]
      days1904: (string | undefined)[]
      serials: (number | undefined)[]
    }

  it('under TZ=UTC and TZ=Pacific/Auckland', () => {
    const utc = runUnder('UTC')
    const auckland = runUnder('Pacific/Auckland')
    expect(utc.offset).toBe(0)
    expect(auckland.offset).toBe(-13 * 60)
    for (const run of [utc, auckland]) {
      expect(run.days).toEqual(ANCHORS.map(([, day]) => day))
      expect(run.serials).toEqual(
        ANCHORS.map(([serial, day]) => (day < '1900-03-01' ? null : serial)),
      )
      // The 1904 system's serials for days from 1904-01-01 on, the rest none.
      expect(run.days1904).toEqual(
        ANCHORS.map(([serial, day]) => (serial - 1462 >= 0 ? day : null)),
      )
    }
  })

  /**
   * The whole reader too, not only the arithmetic: Node takes a new `TZ` at
   * run time, so a workbook is written and read under each zone in turn,
   * with the offset checked so a zone that did not take fails here.
   */
  it('through the reader and the writer, under each zone in turn', async () => {
    const saved = process.env.TZ
    try {
      for (const [tz, offset] of [
        ['UTC', 0],
        ['Pacific/Auckland', -13 * 60],
      ] as const) {
        process.env.TZ = tz
        expect(new Date(2027, 0, 15).getTimezoneOffset(), tz).toBe(offset)
        const days = ['2027-01-01', '2027-05-12', '2027-12-31']
        const { workbook } = await readXlsx(
          writeXlsx({ sheets: [{ name: 'Dates', rows: [days.map(dateCell)] }] }),
        )
        expect(workbook?.sheets[0]?.rows, tz).toEqual([days.map(dateCell)])
      }
    } finally {
      if (saved === undefined) delete process.env.TZ
      else process.env.TZ = saved
    }
  })
})
