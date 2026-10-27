import type { Workspace } from '@/model'
import { fromCanonicalJson } from './canonical-json'
import { importArchimate, isArchiModel } from './archimate-native'
import { importArchimateArchive, isZipArchive } from './archimate-archive'
import { importExchangeXml } from './exchange-format'
import {
  downloadText,
  serialiseWorkspace,
  workspaceFileName,
  type ExportFormat,
} from './file-download'
import { failed, problem, type ImportResult } from './problems'
import { failure } from './shared-folder/folder'

/**
 * Files are the source of truth (concept §5.2). This module is how a model
 * leaves the browser and comes back.
 *
 * On Chromium the File System Access API gives us a **persistent handle**: save
 * once into a git working copy and every later save writes to that same file,
 * with no picker and no downloads folder. That is what makes "commit the JSON to
 * git" a workflow rather than a chore. Firefox and Safari have no such API, so
 * they get `<input type="file">` and `<a download>`, and the app says which mode
 * it is in rather than pretending.
 */

// The File System Access API is not in TypeScript's DOM lib on every version we
// build against; this is the slice of it we use.
interface FilePickerType {
  description: string
  accept: Record<string, string[]>
}

interface FileSystemWritable {
  write(data: string): Promise<void>
  close(): Promise<void>
}

export interface SaveFileHandle {
  readonly name: string
  createWritable(): Promise<FileSystemWritable>
  getFile(): Promise<File>
}

interface FileSystemWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: FilePickerType[]
  }) => Promise<SaveFileHandle>
  showOpenFilePicker?: (options: {
    multiple?: boolean
    types?: FilePickerType[]
  }) => Promise<SaveFileHandle[]>
}

const JSON_TYPE: FilePickerType = {
  description: 'Archipelago workspace (canonical JSON)',
  accept: { 'application/json': ['.json'] },
}

const XML_TYPE: FilePickerType = {
  description: 'ArchiMate Model Exchange Format',
  accept: { 'application/xml': ['.xml', '.archimate'] },
}

export function supportsFileSystemAccess(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as FileSystemWindow
  return typeof w.showSaveFilePicker === 'function' && typeof w.showOpenFilePicker === 'function'
}

export type SaveOutcome =
  | { kind: 'saved'; handle?: SaveFileHandle; fileName: string }
  | { kind: 'downloaded'; fileName: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string }

/**
 * Write the workspace to a file.
 *
 * Pass the handle from a previous save to write straight back to the same file.
 * A user who cancels the picker has not failed at anything, so cancellation is
 * its own outcome rather than an error.
 */
export async function saveWorkspaceToFile(
  workspace: Workspace,
  format: ExportFormat,
  existing?: SaveFileHandle,
): Promise<SaveOutcome> {
  const contents = serialiseWorkspace(workspace, format)
  const fileName = existing?.name ?? workspaceFileName(workspace, format)

  if (!supportsFileSystemAccess()) {
    downloadText(fileName, contents, format === 'json' ? 'application/json' : 'application/xml')
    return { kind: 'downloaded', fileName }
  }

  try {
    const handle =
      existing ??
      (await (window as unknown as FileSystemWindow).showSaveFilePicker!({
        suggestedName: fileName,
        types: [format === 'json' ? JSON_TYPE : XML_TYPE],
      }))
    const writable = await handle.createWritable()
    await writable.write(contents)
    await writable.close()
    return { kind: 'saved', handle, fileName: handle.name }
  } catch (error) {
    if (isAbort(error)) return { kind: 'cancelled' }
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}

export interface OpenedFile {
  result: ImportResult
  handle?: SaveFileHandle
  fileName: string
}

/** Open a file with the picker where it exists; returns undefined if cancelled. */
export async function openWorkspaceFile(): Promise<OpenedFile | undefined> {
  if (!supportsFileSystemAccess()) return undefined
  let handles: SaveFileHandle[]
  try {
    handles = await (window as unknown as FileSystemWindow).showOpenFilePicker!({
      multiple: false,
      types: [JSON_TYPE, XML_TYPE],
    })
  } catch (error) {
    if (isAbort(error)) return undefined
    return { result: pickerRefused(error), fileName: '' }
  }
  const [handle] = handles
  if (!handle) return undefined
  try {
    const file = await reading(() => handle.getFile())
    return { result: await readWorkspaceFile(file), handle, fileName: file.name }
  } catch (error) {
    return { result: importFailure(error), fileName: '' }
  }
}

/**
 * The picker can refuse before any file is picked: a site setting or policy
 * that blocks file access, the page embedded in another site's frame, no user
 * gesture, or a second picker while one is open ("Open and keep linked" pressed
 * twice). None of these is a file that could not be read, nor a fault in
 * Archipelago, so it gets its own problem.
 */
function pickerRefused(error: unknown): ImportResult {
  const why = failure(error)
  return failed([
    problem(
      'error',
      'file.picker-refused',
      why
        ? `The browser refused to open the file picker: ${why}`
        : 'The browser refused to open the file picker.',
    ),
  ])
}

/**
 * The file itself could not be read, as opposed to a reader failing on what it
 * read. A file the user picked can still go: a sync client may replace or remove
 * it between the pick and the read (#52).
 */
export class FileReadError extends Error {
  constructor(cause: unknown) {
    super(failure(cause), { cause })
    this.name = 'FileReadError'
  }
}

async function reading<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    throw new FileReadError(error)
  }
}

/**
 * What an import that threw reports. Only a `FileReadError` says the file could
 * not be read: anything else is a reader that failed on a file it did read, and
 * calling that file unreadable would send the user looking in the wrong place.
 */
export function importFailure(error: unknown): ImportResult {
  if (error instanceof FileReadError) {
    return failed([
      problem('error', 'file.unreadable', `The file could not be read: ${error.message}`),
    ])
  }
  return failed([
    problem(
      'error',
      'import.failed',
      `The import stopped on an unexpected error: ${withoutFullStop(failure(error))}. This is a fault in Archipelago; please report it, with the file if you can.`,
    ),
  ])
}

/** A message set inside a sentence of ours, which ends it with its own full stop. */
function withoutFullStop(message: string): string {
  return message.replace(/\.+$/, '')
}

/**
 * Parse a file the user handed us, choosing the reader by what the file holds:
 * Archi's own model file, the exchange format, or canonical JSON. The extension
 * only breaks a tie — Archi writes `.archimate`, but a `.xml` can be either kind
 * of XML, and a `.txt` that starts with `<` is still a model (#13).
 */
export async function readWorkspaceFile(file: File): Promise<ImportResult> {
  const bytes = new Uint8Array(await reading(() => file.arrayBuffer()))
  // An Archi model with images in it is saved as a zip archive, not as XML, and
  // is read as one (#97). So does every other zip, and a .docx or .xlsx is not
  // an Archi model (#99).
  if (isZipArchive(bytes) && !file.name.trim().toLowerCase().endsWith('.archimate')) {
    return {
      ok: false,
      problems: [
        problem(
          'error',
          'file.archive-unrecognised',
          `“${file.name}” is a compressed archive, not a model file. Archipelago opens canonical JSON, Archi models (.archimate) and ArchiMate exchange XML.`,
          { file: file.name },
        ),
      ],
    }
  }
  if (isZipArchive(bytes)) return importArchimateArchive(bytes, file.name)
  // What `File.text()` does: UTF-8, a byte-order mark dropped, bad bytes replaced.
  const text = new TextDecoder('utf-8').decode(bytes)

  const name = file.name.toLowerCase()
  const first = text.trimStart()[0]

  if (first === '<') {
    return isArchiModel(text)
      ? importArchimate(text, file.name)
      : importExchangeXml(text, file.name)
  }
  if (first === '{' || name.endsWith('.json')) return fromCanonicalJson(text, file.name)
  // An XML extension on something that is not XML gets the XML reader's diagnosis.
  if (name.endsWith('.archimate')) return importArchimate(text, file.name)
  if (name.endsWith('.xml')) return importExchangeXml(text, file.name)

  return {
    ok: false,
    problems: [
      problem(
        'error',
        'file.unrecognised',
        `“${file.name}” is neither canonical JSON, an Archi model, nor ArchiMate exchange XML.`,
        { file: file.name },
      ),
    ],
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
