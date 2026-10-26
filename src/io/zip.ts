/**
 * Just enough of the zip format to open an Archi model saved with images (#97)
 * and a spreadsheet, and to write one (`writeZip`, #208):
 * the central directory, and stored or deflated entries, inflated by the
 * browser's own `DecompressionStream('deflate-raw')`. No dependency, and
 * nothing is fetched.
 *
 * The reader trusts the central directory, not the local headers: Archi writes
 * with Java's `ZipOutputStream`, which puts the sizes of a deflated entry in a
 * data descriptor after its data (flag bit 3) and leaves them zero in the local
 * header. The central directory has them.
 *
 * Every way an archive can be outside what this reads is a `ZipError` with its
 * own `fault`, never a guess: a reader that skipped what it could not classify
 * would hand the caller a model with pieces missing.
 */

export type ZipFault =
  /** The end-of-archive record is missing, or a record runs past the end of the file. */
  | 'truncated'
  /** A header does not start with its signature. */
  | 'signature'
  /** ZIP64, which only an archive over 4 GB or 65,535 entries needs. */
  | 'zip64'
  /** Spread over several files (a split or spanned archive). */
  | 'split'
  /** The entry is encrypted. */
  | 'encrypted'
  /** Compressed by a method other than stored (0) or deflate (8). */
  | 'method'
  /** Does not inflate, or inflates to the wrong size or checksum. */
  | 'corrupt'
  /** Two entries share a name, so which one is meant cannot be told. */
  | 'duplicate'
  /** This browser has no `DecompressionStream` for `deflate-raw`. */
  | 'inflate-unavailable'

export class ZipError extends Error {
  constructor(
    readonly fault: ZipFault,
    readonly detail: string,
  ) {
    super(`${fault}: ${detail}`)
    this.name = 'ZipError'
  }
}

export interface ZipEntry {
  /** As the archive spells it, decoded as UTF-8 (what Java writes). */
  name: string
  /** General-purpose flags; bit 0 is encryption. */
  flags: number
  method: number
  crc32: number
  compressedSize: number
  size: number
  localOffset: number
}

const END_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const END_SIZE = 22
const CENTRAL_SIZE = 46
const LOCAL_SIZE = 30
const MAX_COMMENT = 0xffff

/** Every entry the central directory lists, in its order. */
export function readZipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = findEnd(view)
  if (end === undefined) {
    throw new ZipError('truncated', 'there is no end-of-archive record')
  }
  const disk = view.getUint16(end + 4, true)
  const directoryDisk = view.getUint16(end + 6, true)
  const onThisDisk = view.getUint16(end + 8, true)
  const count = view.getUint16(end + 10, true)
  const directorySize = view.getUint32(end + 12, true)
  const directoryOffset = view.getUint32(end + 16, true)
  const zip64Locator = end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR_SIGNATURE
  if (
    zip64Locator ||
    count === 0xffff ||
    onThisDisk === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    throw new ZipError('zip64', 'the archive uses ZIP64 records')
  }
  if (disk !== 0 || directoryDisk !== 0 || onThisDisk !== count) {
    throw new ZipError('split', `the archive says it is disk ${disk + 1} of a set`)
  }
  if (directoryOffset + directorySize > end) {
    throw new ZipError('truncated', 'the central directory runs past the end of the file')
  }

  const entries: ZipEntry[] = []
  const names = new Set<string>()
  const directoryEnd = directoryOffset + directorySize
  let at = directoryOffset
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_SIZE > directoryEnd) {
      throw new ZipError('truncated', `the central directory ends after ${i} of ${count} entries`)
    }
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new ZipError('signature', `central directory entry ${i + 1} has no signature`)
    }
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const next = at + CENTRAL_SIZE + nameLength + extraLength + commentLength
    if (next > directoryEnd) {
      throw new ZipError('truncated', `central directory entry ${i + 1} runs past the directory`)
    }
    const name = new TextDecoder('utf-8').decode(
      bytes.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength),
    )
    const entry: ZipEntry = {
      name,
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      crc32: view.getUint32(at + 16, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      localOffset: view.getUint32(at + 42, true),
    }
    const startDisk = view.getUint16(at + 34, true)
    if (
      entry.compressedSize === 0xffffffff ||
      entry.size === 0xffffffff ||
      entry.localOffset === 0xffffffff ||
      startDisk === 0xffff
    ) {
      throw new ZipError('zip64', `“${name}” is stored with ZIP64 sizes`)
    }
    if (startDisk !== 0) {
      throw new ZipError('split', `“${name}” starts on disk ${startDisk + 1}`)
    }
    if (names.has(name)) {
      throw new ZipError('duplicate', `two entries are named “${name}”`)
    }
    names.add(name)
    entries.push(entry)
    at = next
  }
  return entries
}

/**
 * The end-of-archive record, searched from the end, past a comment of up to
 * 64 KB. A signature counts only where the comment length it states reaches
 * exactly to the end of the file, so the bytes of a comment cannot pose as one.
 */
function findEnd(view: DataView): number | undefined {
  const last = view.byteLength - END_SIZE
  const first = Math.max(0, last - MAX_COMMENT)
  for (let at = last; at >= first; at--) {
    if (view.getUint32(at, true) !== END_SIGNATURE) continue
    if (at + END_SIZE + view.getUint16(at + 20, true) === view.byteLength) return at
  }
  return undefined
}

/** One entry's contents, checked against the size and CRC-32 the directory gives. */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const { name, localOffset } = entry
  if (entry.flags & 1) throw new ZipError('encrypted', `“${name}” is encrypted`)
  if (localOffset + LOCAL_SIZE > bytes.byteLength) {
    throw new ZipError('truncated', `“${name}” starts past the end of the file`)
  }
  if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
    throw new ZipError('signature', `“${name}” has no local header signature`)
  }
  const start =
    localOffset +
    LOCAL_SIZE +
    view.getUint16(localOffset + 26, true) +
    view.getUint16(localOffset + 28, true)
  const stop = start + entry.compressedSize
  if (stop > bytes.byteLength) {
    throw new ZipError('truncated', `“${name}” runs past the end of the file`)
  }
  const data = bytes.subarray(start, stop)
  let contents: Uint8Array
  if (entry.method === 0) contents = data
  else if (entry.method === 8) contents = await inflateRaw(data, entry)
  else {
    throw new ZipError('method', `“${name}” is compressed with method ${entry.method}`)
  }
  if (contents.byteLength !== entry.size) {
    throw new ZipError(
      'corrupt',
      `“${name}” holds ${contents.byteLength} bytes where the archive says ${entry.size}`,
    )
  }
  if (crc32(contents) !== entry.crc32) {
    throw new ZipError('corrupt', `“${name}” does not match its checksum`)
  }
  return contents
}

/**
 * Inflate with the platform's `DecompressionStream`. Reading stops past the
 * size the directory gives, so a damaged length cannot make it inflate without
 * end; the size check after reports it.
 */
async function inflateRaw(data: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  let stream: DecompressionStream
  try {
    if (typeof DecompressionStream === 'undefined') throw new TypeError('no DecompressionStream')
    stream = new DecompressionStream('deflate-raw')
  } catch {
    throw new ZipError('inflate-unavailable', 'this browser cannot inflate deflate-raw data')
  }
  const writer = stream.writable.getWriter()
  // Its rejection is the reader's error too, which is handled below.
  const written = writer
    .write(data)
    .then(() => writer.close())
    .catch(() => undefined)
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      length += value.byteLength
      if (length > entry.size) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
  } catch (error) {
    throw new ZipError(
      'corrupt',
      `“${entry.name}” does not inflate (${error instanceof Error ? error.message : String(error)})`,
    )
  } finally {
    await written
  }
  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipInput {
  /** ASCII, as every part name in a workbook is. */
  name: string
  data: Uint8Array
}

/**
 * An archive of `entries`, each stored uncompressed (#208). Storing keeps the
 * writer synchronous and dependency-free; every spreadsheet tool reads stored
 * entries, and a workbook of a few hundred rows stays small. Every timestamp is
 * the zip epoch (1980-01-01 00:00), so the same entries always make the same
 * bytes.
 */
export function writeZip(entries: readonly ZipInput[]): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const local = new Uint8Array(LOCAL_SIZE + name.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, LOCAL_SIGNATURE, true)
    l.setUint16(4, 20, true) // version needed: 2.0
    l.setUint16(6, 0x0800, true) // names are UTF-8
    l.setUint16(8, 0, true) // stored
    l.setUint16(10, 0, true) // time 00:00
    l.setUint16(12, DOS_EPOCH_DATE, true)
    l.setUint32(14, crc, true)
    l.setUint32(18, entry.data.length, true)
    l.setUint32(22, entry.data.length, true)
    l.setUint16(26, name.length, true)
    local.set(name, LOCAL_SIZE)
    const central = new Uint8Array(CENTRAL_SIZE + name.length)
    const c = new DataView(central.buffer)
    c.setUint32(0, CENTRAL_SIGNATURE, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, 0, true)
    c.setUint16(14, DOS_EPOCH_DATE, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, entry.data.length, true)
    c.setUint32(24, entry.data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.set(name, CENTRAL_SIZE)
    parts.push(local, entry.data)
    centrals.push(central)
    offset += local.length + entry.data.length
  }
  const directorySize = centrals.reduce((n, central) => n + central.length, 0)
  const end = new Uint8Array(END_SIZE)
  const e = new DataView(end.buffer)
  e.setUint32(0, END_SIGNATURE, true)
  e.setUint16(8, entries.length, true)
  e.setUint16(10, entries.length, true)
  e.setUint32(12, directorySize, true)
  e.setUint32(16, offset, true)
  const out = new Uint8Array(offset + directorySize + END_SIZE)
  let at = 0
  for (const part of [...parts, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  // No ZIP64: a workbook has a handful of entries, and one over 4 GB could not
  // be built in a browser tab to begin with.
  return out
}

/** 1980-01-01 in MS-DOS date format: day 1, month 1, year 0. */
const DOS_EPOCH_DATE = (0 << 9) | (1 << 5) | 1
