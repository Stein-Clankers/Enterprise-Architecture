import { describe, expect, it } from 'vitest'
import { getKey, setKey, toRecord } from './records'

/**
 * Records keyed by a string somebody else chose (#37, #229 review): a
 * milestone id is made from a user's label, and `Object.prototype` has members
 * a label can name.
 */
const PROTOTYPE_NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']

describe('getKey (#229 review)', () => {
  it.each(PROTOTYPE_NAMES)('finds nothing for %s in a record that does not hold it', (key) => {
    const record: Record<string, number> = { other: 1 }
    // The plain lookup is the bug: it finds the prototype's member.
    expect(record[key]).toBeDefined()
    expect(getKey(record, key)).toBeUndefined()
  })

  it.each(PROTOTYPE_NAMES)('finds the record’s own value for %s', (key) => {
    const record: Record<string, number> = {}
    setKey(record, key, 7)
    expect(getKey(record, key)).toBe(7)
    expect(getKey(toRecord([[key, 8]]), key)).toBe(8)
  })

  it('finds nothing in an absent record', () => {
    expect(getKey(undefined, 'constructor')).toBeUndefined()
  })
})
