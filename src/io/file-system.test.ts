import { afterEach, describe, expect, it } from 'vitest'
import { toCanonicalJson } from './canonical-json'
import { exportExchangeXml } from './exchange-format'
import {
  FileReadError,
  importFailure,
  openWorkspaceFile,
  readWorkspaceFile,
  supportsFileSystemAccess,
} from './file-system'
import { smallWorkspace, unreadableFile } from '@/test/fixtures'

function file(name: string, contents: string): File {
  return new File([contents], name, { type: 'text/plain' })
}

describe('reading a file the user handed us', () => {
  it('reads canonical JSON by extension', async () => {
    const result = await readWorkspaceFile(file('model.json', toCanonicalJson(smallWorkspace())))
    expect(result.ok).toBe(true)
    expect(result.workspace?.elements).toHaveLength(5)
  })

  it('reads exchange XML by extension', async () => {
    const result = await readWorkspaceFile(file('model.xml', exportExchangeXml(smallWorkspace())))
    expect(result.ok).toBe(true)
    expect(result.workspace?.relationships).toHaveLength(4)
  })

  it('reads an exchange file named .archimate with the exchange reader: the content decides', async () => {
    const result = await readWorkspaceFile(
      file('ArchiSurance.archimate', exportExchangeXml(smallWorkspace())),
    )
    expect(result.ok).toBe(true)
  })

  it('sniffs the content when the extension is unhelpful', async () => {
    // A .txt that starts with "<" is still an exchange file; refusing it would
    // be pedantry.
    const xml = await readWorkspaceFile(file('export.txt', exportExchangeXml(smallWorkspace())))
    expect(xml.ok).toBe(true)

    const json = await readWorkspaceFile(file('export.txt', toCanonicalJson(smallWorkspace())))
    expect(json.ok).toBe(true)
  })

  it('explains a file that is neither', async () => {
    const result = await readWorkspaceFile(file('notes.txt', 'just some notes'))
    expect(result.ok).toBe(false)
    expect(result.problems[0]).toMatchObject({
      code: 'file.unrecognised',
      file: 'notes.txt',
    })
  })

  it('surfaces the problems from a partly broken file rather than refusing it', async () => {
    const broken = exportExchangeXml(smallWorkspace()).replace(
      'xsi:type="Capability"',
      'xsi:type="Microservice"',
    )
    const result = await readWorkspaceFile(file('model.xml', broken))
    expect(result.ok).toBe(true)
    expect(result.workspace?.elements).toHaveLength(4)
    expect(result.problems.map((p) => p.code)).toContain('exchange.unknown-element-type')
  })
})

describe('an import that throws (#52)', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker
  })

  it('throws a FileReadError when the file cannot be read', async () => {
    const thrown = await readWorkspaceFile(unreadableFile('synced.json')).catch((error) => error)
    expect(thrown).toBeInstanceOf(FileReadError)
    expect(thrown.message).toBe('The file changed.')
  })

  it('says the file could not be read only when it could not', () => {
    expect(importFailure(new FileReadError(new Error('gone'))).problems).toEqual([
      { severity: 'error', code: 'file.unreadable', message: 'The file could not be read: gone' },
    ])
  })

  it('calls a reader that failed on a file it read a fault, not an unreadable file', () => {
    const result = importFailure(new TypeError('x is undefined'))
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      {
        severity: 'error',
        code: 'import.failed',
        message:
          'The import stopped on an unexpected error: x is undefined. This is a fault in Archipelago; please report it, with the file if you can.',
      },
    ])
    expect(importFailure('thrown as a string').problems[0]?.message).toContain(
      'error: thrown as a string.',
    )
    // A message that ends a sentence of its own does not end ours twice.
    expect(importFailure(new Error('The reader gave up.')).problems[0]?.message).toContain(
      'error: The reader gave up. This is a fault',
    )
  })

  const pickerThat = (pick: () => Promise<unknown>) =>
    Object.assign(window, { showSaveFilePicker: async () => ({}), showOpenFilePicker: pick })
  const pick = (getFile: () => Promise<File>) =>
    pickerThat(async () => [{ name: 'model.json', getFile }])

  it('says nothing when the user cancels the picker', async () => {
    pickerThat(() => Promise.reject(new DOMException('The user aborted a request.', 'AbortError')))
    expect(await openWorkspaceFile()).toBeUndefined()
  })

  it('says the browser refused the picker when it did, not that a file is at fault', async () => {
    // Chromium's answer to a second picker while one is open: "Open and keep
    // linked" pressed twice. A blocked site setting or policy, a cross-origin
    // frame and a missing user gesture are `NotAllowedError`s too.
    pickerThat(() =>
      Promise.reject(new DOMException('File picker already active.', 'NotAllowedError')),
    )
    expect(await openWorkspaceFile()).toEqual({
      fileName: '',
      result: {
        ok: false,
        problems: [
          {
            severity: 'error',
            code: 'file.picker-refused',
            message: 'The browser refused to open the file picker: File picker already active.',
          },
        ],
      },
    })

    // An opaque origin's `SecurityError` (the spec's), with no reason given.
    pickerThat(() => Promise.reject(new DOMException('', 'SecurityError')))
    expect((await openWorkspaceFile())?.result.problems).toEqual([
      expect.objectContaining({
        code: 'file.picker-refused',
        message: 'The browser refused to open the file picker.',
      }),
    ])
  })

  it('calls a reader that failed on a picked file a fault, not an unreadable file', async () => {
    // The file reads; what fails is the code that reads it, here on the name.
    const crashing = Object.defineProperty(file('model.json', '{}'), 'name', {
      get: () => {
        throw new TypeError('x is undefined')
      },
    })
    pick(async () => crashing)
    expect((await openWorkspaceFile())?.result.problems).toEqual([
      expect.objectContaining({
        code: 'import.failed',
        message: expect.stringContaining('unexpected error: x is undefined.'),
      }),
    ])
  })

  it('reports a picked file that cannot be read, through either read', async () => {
    pick(() => Promise.reject(new DOMException('It is gone.', 'NotFoundError')))
    expect((await openWorkspaceFile())?.result.problems).toEqual([
      expect.objectContaining({
        code: 'file.unreadable',
        message: 'The file could not be read: It is gone.',
      }),
    ])

    pick(async () => unreadableFile('model.json'))
    expect((await openWorkspaceFile())?.result.problems).toEqual([
      expect.objectContaining({
        code: 'file.unreadable',
        message: 'The file could not be read: The file changed.',
      }),
    ])
  })
})

describe('feature detection', () => {
  it('reports no File System Access API under jsdom', () => {
    // jsdom implements neither picker, so the app takes the download path —
    // which is exactly the Firefox and Safari behaviour this guards.
    expect(supportsFileSystemAccess()).toBe(false)
  })
})
