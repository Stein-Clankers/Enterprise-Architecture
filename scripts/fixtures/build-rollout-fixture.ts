/**
 * Writes `src/io/fixtures/rollout-160.json`: the 160-site rollout from
 * `src/test/rollout-fixture.ts`, as canonical JSON, for the rollout journey in
 * `tests/e2e/rollout.spec.ts` (#211) to import through the app's own importer.
 * #212's generated demo replaces it once that lands.
 *
 *   npx vite-node scripts/fixtures/build-rollout-fixture.ts
 *
 * `rollout-fixture-file.test.ts` fails when the file and the generator differ,
 * so the file cannot drift from what this script writes.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toCanonicalJson } from '@/io/canonical-json'
import { rolloutWorkspace } from '@/test/rollout-fixture'

writeFileSync(
  join(import.meta.dirname, '../../src/io/fixtures/rollout-160.json'),
  toCanonicalJson(rolloutWorkspace(160)),
)
