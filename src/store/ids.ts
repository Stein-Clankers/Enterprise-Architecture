/**
 * Identifier generation.
 *
 * Ids must survive a round-trip through the ArchiMate Model Exchange Format,
 * where they are `xs:ID` values: they have to start with a letter or underscore
 * and may not contain most punctuation. UUIDs qualify once prefixed, and they
 * keep canonical JSON diffs stable because nothing renumbers on save.
 */

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for environments without crypto.randomUUID (old Safari, some test runners).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** A new id with a readable prefix, e.g. `el-3f2c…`. */
export function newId(
  prefix: 'el' | 'rel' | 'ws' | 'view' | 'folder' | 'cmd' | 'conn' | 'node' | 'ex',
): string {
  return `${prefix}-${uuid()}`
}

/** Is this usable as an xs:ID in the exchange format? */
export function isExchangeSafeId(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id)
}
