/**
 * The site register's grid columns (#211, #213), for a writer and a reader.
 * Their fixed tracks, with `.table__row`'s gaps and padding, must leave the
 * Site and Region columns room under `.register`'s `min-width` in
 * `rollout.css`: #229 widened them past it, and both went 0px wide (#233).
 * `register-columns.test.ts` holds that sum.
 */

/** Select, code, site, wave, archetype, cutover, phase, RAG, region, dates. */
export const COLUMNS_WRITER =
  '28px 72px minmax(0,1.6fr) 100px 100px 150px 130px 72px minmax(0,1fr) 64px'

/** Code, site, wave, archetype, cutover, phase, RAG, region. */
export const COLUMNS_READER = '72px minmax(0,1.6fr) 100px 100px 150px 130px 72px minmax(0,1fr)'
