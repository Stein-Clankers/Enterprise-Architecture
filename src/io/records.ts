/**
 * Building a record whose keys came out of a file.
 *
 * `record[key] = value` looks total and is not: assigning `__proto__` invokes
 * the prototype setter rather than creating a property, and with a string value
 * the setter does nothing at all. So a property literally named `__proto__` —
 * legal in both our formats, and a name a real model can carry — was read,
 * assigned, and gone, with `problems: []`.
 *
 * That is the write-side twin of finding 2 of the #37 review, where an untrusted
 * `xsi:type` was *looked up* on a plain object literal and found
 * `Object.prototype`'s member. Both come from treating an object as a dictionary
 * when the key is somebody else's string. On the read side the answer is a `Map`;
 * here it is `Object.defineProperty`, which always makes an own property.
 */

/** `record[key] = value`, for a key this build did not choose. */
export function setKey<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

/**
 * `record[key]`, for a key this build did not choose: the record's own
 * property, never one it inherits from `Object.prototype`. `undefined` when
 * the record is absent or has no such own property.
 */
export function getKey<T>(
  record: Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined
}

/** The entries as a record, safe for keys this build did not choose. */
export function toRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [key, value] of entries) setKey(out, key, value)
  return out
}
