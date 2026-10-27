/**
 * Writes `src/io/fixtures/rollout-workspace.json`: the rollout test fixture
 * (`src/test/rollout-fixture.ts`) at eight sites, through the app's own
 * canonical writer. The rollout workbook's e2e journey (#210) opens it through
 * the header's Import dialog, because the demo has no rollout yet (#212).
 *
 *   npx vite-node scripts/fixtures/build-rollout-workspace.ts
 *
 * `rollout-workbook.test.ts` fails when the file is not what this writes, so
 * it is regenerated, never edited by hand.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toCanonicalJson } from '@/io/canonical-json'
import { rolloutWorkspace } from '@/test/rollout-fixture'

const target = join(process.cwd(), 'src', 'io', 'fixtures', 'rollout-workspace.json')
// Eight sites, as the e2e journey and `rollout-workbook.test.ts` expect.
writeFileSync(target, toCanonicalJson(rolloutWorkspace(8)))
console.log(`build-rollout-workspace: wrote ${target}`)
