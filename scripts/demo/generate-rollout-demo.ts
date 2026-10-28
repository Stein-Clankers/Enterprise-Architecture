/**
 * Writes `src/io/demo/rollout-demo.json`: the generated 160-site
 * data-migration rollout demo (#212), from `ROLLOUT_DEMO_SEED`, through the
 * app's own canonical writer.
 *
 *   npm run demo:generate
 *
 * `rollout-demo.test.ts` fails when the file is not what this writes, so it is
 * regenerated, never edited by hand.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toCanonicalJson } from '@/io/canonical-json'
import { ROLLOUT_DEMO_SEED, rolloutDemoWorkspace } from '@/io/demo/rollout-demo'

const target = join(import.meta.dirname, '../../src/io/demo/rollout-demo.json')
writeFileSync(target, toCanonicalJson(rolloutDemoWorkspace(ROLLOUT_DEMO_SEED)))
console.log(`demo:generate: wrote ${target} (seed ${ROLLOUT_DEMO_SEED})`)
