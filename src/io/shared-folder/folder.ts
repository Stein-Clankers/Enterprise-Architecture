/**
 * A folder the user granted, as the shared-folder protocol sees it (ADR 0010).
 *
 * The browser's version wraps a `FileSystemDirectoryHandle`; tests use the sync
 * world in `src/test/sync-world.ts`, which delays what one machine writes before
 * another sees it. Everything in `src/io/shared-folder/` reaches the folder only
 * through this interface, so every decision can be driven without a browser.
 *
 * A read that fails is not a missing file. `read` returns `undefined` only when
 * there is no such file, and throws when there is one it cannot read (the sync
 * client holding it, a permission that lapsed). The protocol treats the two
 * differently at every step (spec §5).
 */
export interface Folder {
  /** The names of the files directly in the folder. Reads no file's contents. */
  list(): Promise<string[]>
  /**
   * Whether a file of that name exists, without reading it. With OneDrive's
   * Files On-Demand, reading a file downloads it (spec §4).
   */
  has(name: string): Promise<boolean>
  /** The file's bytes, or `undefined` when there is no such file. Throws when it cannot be read. */
  read(name: string): Promise<Uint8Array | undefined>
  /**
   * Replace the file's contents, creating it if needed. Resolves only once the
   * write has closed; a rejection means nothing can be assumed written.
   */
  write(name: string, bytes: Uint8Array): Promise<void>
  /** Delete the file. A file that is already gone is not an error. */
  remove(name: string): Promise<void>
}

export function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/**
 * The message of whatever a folder or file operation threw (`file-system.ts`
 * uses it too). The File System Access API and `File` reads throw
 * `DOMException`s, which are not an `Error` everywhere (jsdom's is not).
 */
export function failure(error: unknown): string {
  if (error instanceof Error || error instanceof DOMException) return error.message
  return String(error)
}
