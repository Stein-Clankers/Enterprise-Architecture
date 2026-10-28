/**
 * What the app needs to know about the generated rollout demo (#212) without
 * bundling its generator: the rollout it opens on, and the day it is planned
 * as of. `rollout-demo.ts` builds the demo from these, and `demo.ts` opens it
 * with them, so the two cannot disagree.
 */

/** The rollout the demo opens on. */
export const ROLLOUT_DEMO_ID = 'wp-rollout-site-data'

/**
 * The day the demo is planned as of: its actual dates run up to it, and the
 * rollout home opens at it, so the pilot shows as under way whatever today is.
 */
export const ROLLOUT_DEMO_AS_OF = '2026-10-23'
