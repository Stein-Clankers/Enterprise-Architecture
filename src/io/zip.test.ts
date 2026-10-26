import { deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixtureBytes } from '@/test/fixture-bytes'
import { crc32, readZipDirectory, readZipEntry, writeZip, ZipError, type ZipFault } from './zip'

/**
 * The zip reader is resilience code (#97): every branch but the first runs only
 * on a file something else already broke. So each fault is fired here, on an
 * archive made by `zipOf` (a writer for this test, independent of the reader)
 * and then damaged at a known byte, and the happy path runs on Archi's own save.
 */

const ARCHI = fixtureBytes('archi-images.archimate')

interface Spec {
  name: string
  data: Uint8Array
  method?: number
  flags?: number
}

/** A zip of `specs`, every size in the local header; each entry deflated unless it says otherwise. */
function zipOf(specs: Spec[], comment = new Uint8Array()): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const spec of specs) {
    const method = spec.method ?? 8
    const stored = method === 8 ? new Uint8Array(deflateRawSync(spec.data)) : spec.data
    const name = new TextEncoder().encode(spec.name)
    const local = new Uint8Array(30 + name.length + stored.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(4, 20, true)
    l.setUint16(6, spec.flags ?? 0x0800, true)
    l.setUint16(8, method, true)
    l.setUint32(14, crc32(spec.data), true)
    l.setUint32(18, stored.length, true)
    l.setUint32(22, spec.data.length, true)
    l.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(stored, 30 + name.length)
    const central = new Uint8Array(46 + name.length)
    const c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, spec.flags ?? 0x0800, true)
    c.setUint16(10, method, true)
    c.setUint32(16, crc32(spec.data), true)
    c.setUint32(20, stored.length, true)
    c.setUint32(24, spec.data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const directorySize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22 + comment.length)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, specs.length, true)
  e.setUint16(10, specs.length, true)
  e.setUint32(12, directorySize, true)
  e.setUint32(16, offset, true)
  e.setUint16(20, comment.length, true)
  end.set(comment, 22)
  const out = new Uint8Array(offset + directorySize + end.length)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const text = (s: string) => new TextEncoder().encode(s)
const MODEL = text('<?xml version="1.0"?><model/>'.repeat(20))
/** One entry, so the byte offsets below are fixed: local header at 0, then the directory, then the end record. */
const single = (spec: Partial<Spec> = {}) => zipOf([{ name: 'model.xml', data: MODEL, ...spec }])

/** Where each record of `bytes` starts, read from its end record. */
function layout(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  return { view, end, directory: view.getUint32(end + 16, true) }
}

function damaged(bytes: Uint8Array, change: (l: ReturnType<typeof layout>) => void): Uint8Array {
  const copy = bytes.slice()
  change(layout(copy))
  return copy
}

async function fault(bytes: Uint8Array): Promise<{ fault: ZipFault; detail: string }> {
  try {
    const entries = readZipDirectory(bytes)
    for (const entry of entries) await readZipEntry(bytes, entry)
  } catch (error) {
    if (error instanceof ZipError) return { fault: error.fault, detail: error.detail }
    throw error
  }
  throw new Error('no fault')
}

describe('reading Archi’s own archive (#97)', () => {
  it('lists the model and the images, as Archi wrote them', () => {
    expect(readZipDirectory(ARCHI).map((e) => [e.name, e.method])).toEqual([
      ['model.xml', 8],
      ['images/logo.png', 8],
      ['images/actor.png', 8],
    ])
    // Java's ZipOutputStream: sizes after the data (bit 3), UTF-8 names (bit 11).
    expect(readZipDirectory(ARCHI)[0]!.flags & 0x0808).toBe(0x0808)
  })

  it('inflates each entry to the size and checksum the directory gives', async () => {
    const [model, logo] = readZipDirectory(ARCHI)
    const xml = new TextDecoder().decode(await readZipEntry(ARCHI, model!))
    expect(xml).toMatch(/^<\?xml[^>]*>\s*<archimate:model /)
    expect(xml).toContain('imagePath="images/logo.png"')
    const png = await readZipEntry(ARCHI, logo!)
    expect([...png.subarray(1, 4)]).toEqual([...text('PNG')])
  })

  it('reads a stored entry, and an archive with a comment that holds an end signature', async () => {
    // The comment's own bytes pose as an end record whose length does not reach the end.
    const comment = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...Array<number>(18).fill(0), 1, 2])
    const bytes = zipOf([{ name: 'model.xml', data: MODEL, method: 0 }], comment)
    const [entry] = readZipDirectory(bytes)
    expect(entry).toMatchObject({ name: 'model.xml', method: 0 })
    expect([...(await readZipEntry(bytes, entry!))]).toEqual([...MODEL])
  })
})

describe('every way an archive can be outside what the reader reads (#97)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['cut short, so no end record', () => ARCHI.slice(0, ARCHI.length - 30)],
    ['shorter than an end record', () => text('PK\u0003\u0004rest')],
    [
      'a central directory past its end record',
      () => damaged(single(), ({ view, end }) => view.setUint32(end + 12, 10_000, true)),
    ],
    [
      'more entries than the directory holds',
      () =>
        damaged(single(), ({ view, end }) => {
          view.setUint16(end + 8, 2, true)
          view.setUint16(end + 10, 2, true)
        }),
    ],
    [
      'an entry name longer than the directory',
      () => damaged(single(), ({ view, directory }) => view.setUint16(directory + 28, 500, true)),
    ],
    [
      'an entry that starts past the end',
      () =>
        damaged(single(), ({ view, directory }) => view.setUint32(directory + 42, 1_000_000, true)),
    ],
    [
      'an entry that runs past the end',
      () =>
        damaged(single(), ({ view, directory }) => view.setUint32(directory + 20, 1_000_000, true)),
    ],
  ])('truncated: %s', async (_, bytes) => {
    expect((await fault(bytes())).fault).toBe('truncated')
  })

  it('bad signature: in the central directory, and on the local header', async () => {
    const central = damaged(single(), ({ view, directory }) => view.setUint32(directory, 0, true))
    expect(await fault(central)).toMatchObject({
      fault: 'signature',
      detail: expect.stringMatching(/entry 1/),
    })
    const local = damaged(single(), ({ view }) => view.setUint32(0, 0, true))
    expect(await fault(local)).toMatchObject({
      fault: 'signature',
      detail: expect.stringMatching(/local header/),
    })
  })

  it.each([
    [
      'a ZIP64 end locator',
      () => {
        const bytes = single()
        const out = new Uint8Array(bytes.length + 20)
        const { end } = layout(bytes)
        out.set(bytes.subarray(0, end))
        new DataView(out.buffer).setUint32(end, 0x07064b50, true)
        out.set(bytes.subarray(end), end + 20)
        return out
      },
    ],
    [
      'an entry count of 0xffff',
      () =>
        damaged(single(), ({ view, end }) => {
          view.setUint16(end + 8, 0xffff, true)
          view.setUint16(end + 10, 0xffff, true)
        }),
    ],
    [
      'an entry size of 0xffffffff',
      () =>
        damaged(single(), ({ view, directory }) =>
          view.setUint32(directory + 24, 0xffffffff, true),
        ),
    ],
  ])('zip64: %s', async (_, bytes) => {
    expect((await fault(bytes())).fault).toBe('zip64')
  })

  it('split: an end record on another disk, and an entry that starts on one', async () => {
    const disk = damaged(single(), ({ view, end }) => view.setUint16(end + 4, 1, true))
    expect(await fault(disk)).toMatchObject({
      fault: 'split',
      detail: expect.stringMatching(/disk 2 of a set/),
    })
    const entry = damaged(single(), ({ view, directory }) =>
      view.setUint16(directory + 34, 1, true),
    )
    expect(await fault(entry)).toMatchObject({
      fault: 'split',
      detail: expect.stringMatching(/starts on disk 2/),
    })
  })

  it('encrypted', async () => {
    expect((await fault(single({ flags: 0x0801 }))).fault).toBe('encrypted')
  })

  it('compressed by a method other than stored or deflate', async () => {
    expect(await fault(single({ method: 12 }))).toMatchObject({
      fault: 'method',
      detail: expect.stringMatching(/method 12/),
    })
  })

  it.each([
    [
      'data that does not inflate',
      () =>
        damaged(single(), ({ view }) => {
          for (let i = 0; i < 8; i++) view.setUint8(30 + 'model.xml'.length + i, 0xff)
        }),
      /does not inflate/,
    ],
    [
      'a checksum that does not match',
      () => damaged(single(), ({ view, directory }) => view.setUint32(directory + 16, 1, true)),
      /does not match its checksum/,
    ],
    [
      'a stored entry shorter than its size',
      () =>
        damaged(single({ method: 0 }), ({ view, directory }) =>
          view.setUint32(directory + 24, MODEL.length + 1, true),
        ),
      /holds 580 bytes where the archive says 581/,
    ],
  ])('corrupt: %s', async (_, bytes, detail) => {
    expect(await fault(bytes())).toMatchObject({
      fault: 'corrupt',
      detail: expect.stringMatching(detail),
    })
  })

  it('corrupt: inflating more than its size, and stops reading soon after', async () => {
    // 4 MB that inflate in many chunks; the directory says 10 bytes.
    const big = zipOf([{ name: 'model.xml', data: new Uint8Array(4 * 1024 * 1024).fill(65) }])
    const short = damaged(big, ({ view, directory }) => view.setUint32(directory + 24, 10, true))
    const { fault: kind, detail } = await fault(short)
    expect(kind).toBe('corrupt')
    const held = Number(/holds (\d+) bytes/.exec(detail)?.[1])
    expect(held).toBeGreaterThan(10)
    expect(held).toBeLessThan(4 * 1024 * 1024)
  })

  it('two entries with one name', async () => {
    const bytes = zipOf([
      { name: 'model.xml', data: MODEL },
      { name: 'model.xml', data: text('<other/>') },
    ])
    expect(await fault(bytes)).toMatchObject({
      fault: 'duplicate',
      detail: expect.stringMatching(/model\.xml/),
    })
  })

  it('a browser with no DecompressionStream, or one without deflate-raw', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    expect((await fault(single())).fault).toBe('inflate-unavailable')
    vi.stubGlobal(
      'DecompressionStream',
      class {
        constructor(format: string) {
          throw new TypeError(`Unsupported format ${format}`)
        }
      },
    )
    expect((await fault(single())).fault).toBe('inflate-unavailable')
    vi.unstubAllGlobals()
    // Present again: the same archive reads.
    await expect(fault(single())).rejects.toThrow('no fault')
  })
})

describe('writing an archive (#208)', () => {
  it('stores each entry so the reader reads it back, checksum and all, in the same bytes every time', async () => {
    const entries = [
      { name: '[Content_Types].xml', data: new TextEncoder().encode('<Types/>') },
      { name: 'xl/empty.xml', data: new Uint8Array() },
      { name: 'xl/bytes.bin', data: new Uint8Array([0, 255, 80, 75, 5, 6]) },
    ]
    const bytes = writeZip(entries)
    const directory = readZipDirectory(bytes)
    expect(
      directory.map(({ name, method, size, compressedSize }) => ({
        name,
        method,
        size,
        compressedSize,
      })),
    ).toEqual(
      entries.map(({ name, data }) => ({
        name,
        method: 0,
        size: data.length,
        compressedSize: data.length,
      })),
    )
    for (const [i, entry] of directory.entries()) {
      expect([...(await readZipEntry(bytes, entry))]).toEqual([...entries[i]!.data])
    }
    expect(writeZip(entries)).toEqual(bytes)
  })
})
