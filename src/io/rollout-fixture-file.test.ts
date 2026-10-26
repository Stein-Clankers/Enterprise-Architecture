import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rolloutWorkspace } from '@/test/rollout-fixture'
import { fromCanonicalJson, toCanonicalJson } from './canonical-json'

/**
 * `fixtures/rollout-160.json` is the e2e rollout journey's model (#211). It
 * says it is `rolloutWorkspace(160)` written by `toCanonicalJson`, so it must
 * be exactly that: regenerate it with `scripts/fixtures/build-rollout-fixture.ts`,
 * never edit it by hand (CLAUDE.md, a fixture said to be a tool's output).
 */
const FILE = join(import.meta.dirname, 'fixtures/rollout-160.json')

describe('the checked-in 160-site rollout (#211)', () => {
  it('is byte for byte what the generator writes', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(toCanonicalJson(rolloutWorkspace(160)))
  })

  it('reads back with nothing to report', () => {
    const result = fromCanonicalJson(readFileSync(FILE, 'utf8'))
    expect(result.problems).toEqual([])
    expect(result.workspace?.elements.filter((e) => e.type === 'Location')).toHaveLength(161)
  })
})
