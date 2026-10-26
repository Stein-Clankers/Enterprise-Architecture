/**
 * Excel's date serials and ISO days, converted in whole days with integer
 * arithmetic (#208). No `Date` is involved, so nothing here can read the
 * machine's time zone: a serial typed in Auckland reads as the same day in
 * London. `xlsx-dates.test.ts` runs this file in child processes under
 * `TZ=UTC` and `TZ=Pacific/Auckland` to hold it to that.
 *
 * This module imports nothing, so that test can load it with plain Node.
 *
 * A serial counts days from an epoch that depends on the workbook's date
 * system:
 *
 * - **1900** (the default): serial 1 is 1900-01-01, but Excel keeps Lotus
 *   1-2-3's leap-year bug, so serial 60 is 1900-02-29, a day that never was,
 *   and from serial 61 on the count is one ahead. Serial 61 is 1900-03-01, so
 *   from there on the epoch is in effect 1899-12-30.
 * - **1904** (`<workbookPr date1904="1"/>`, older Mac workbooks): serial 0 is
 *   1904-01-01.
 *
 * The last day Excel holds is 9999-12-31 in both systems.
 */

/** Days from 1970-01-01 to a civil date (proleptic Gregorian), Howard Hinnant's `days_from_civil`. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const mp = (month + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** The civil date of a day count from 1970-01-01, Hinnant's `civil_from_days`. */
function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  )
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  return [month <= 2 ? yoe + era * 400 + 1 : yoe + era * 400, month, day]
}

const EPOCH_1900 = daysFromCivil(1899, 12, 30)
const EPOCH_1904 = daysFromCivil(1904, 1, 1)
const LAST_DAY = daysFromCivil(9999, 12, 31)
/** Serial 60 in the 1900 system: Lotus's 1900-02-29. */
const PHANTOM_LEAP_DAY = 60

const pad = (n: number, width: number): string => String(n).padStart(width, '0')

/** `YYYY-MM-DD` when it names a real calendar day, otherwise `undefined`. */
export function parseIsoDay(text: string): [number, number, number] | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return undefined
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1) return undefined
  // Round-trip through the day count: 2027-02-30 comes back as 2027-03-02.
  const [y, m, d] = civilFromDays(daysFromCivil(year, month, day))
  return y === year && m === month && d === day ? [year, month, day] : undefined
}

/**
 * The ISO day of a whole serial, or `undefined` for a serial that is no day:
 * below the system's first day, 1900-02-29 (serial 60 in the 1900 system), or
 * past 9999-12-31. The caller strips any fraction (the time of day) first.
 */
export function serialToIsoDay(serial: number, date1904: boolean): string | undefined {
  if (!Number.isInteger(serial)) return undefined
  let days: number
  if (date1904) {
    if (serial < 0) return undefined
    days = EPOCH_1904 + serial
  } else {
    if (serial < 1 || serial === PHANTOM_LEAP_DAY) return undefined
    // Before the phantom day the count is not yet one ahead.
    days = EPOCH_1900 + (serial < PHANTOM_LEAP_DAY ? serial + 1 : serial)
  }
  if (days > LAST_DAY) return undefined
  const [y, m, d] = civilFromDays(days)
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`
}

/** The first day the writer accepts: before it, the 1900 system's serials disagree between tools. */
export const FIRST_WRITABLE_DAY = '1900-03-01'

/**
 * The 1900-system serial of an ISO day from 1900-03-01 to 9999-12-31, or
 * `undefined`. The writer stops at 1900-03-01 because below it Excel's count
 * includes the phantom leap day and other tools' counts do not, so the same
 * serial would open as different days.
 */
export function isoDayToSerial(text: string): number | undefined {
  const parsed = parseIsoDay(text)
  if (!parsed || text < FIRST_WRITABLE_DAY) return undefined
  // Four digits of year cannot pass 9999-12-31, so there is no upper check.
  return daysFromCivil(...parsed) - EPOCH_1900
}
