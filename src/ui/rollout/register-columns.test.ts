import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COLUMNS_READER, COLUMNS_WRITER } from './register-columns'

/**
 * #233: the site register's grid fits inside its minimum width.
 *
 * jsdom lays out no grid, so a column squeezed to 0px passes every DOM test:
 * the row still carries its `data-location`, and the name is still in the
 * document. #229 widened the writer's fixed tracks to 716px, which with nine
 * 12px gaps and 40px of padding is 864px, against a `min-width` of 860px, so
 * the two `minmax(0, …fr)` tracks, Site and Region, were 0px wide at any
 * viewport that showed the register at its minimum.
 *
 * So the arithmetic is held here, read off the files the browser reads: each
 * column set's fixed tracks, plus its gaps and padding from `.table__row`,
 * must leave every `fr` track at least `MIN_FR_TRACK` under the register's
 * `min-width`.
 */

/** The least a flexible column (a site's name, its region) may get, in px. */
const MIN_FR_TRACK = 96

const css = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(source: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')
  const match = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source)
  expect(match, `no ${selector} rule`).not.toBeNull()
  const out: Record<string, string> = {}
  for (const [, name, value] of match![1]!.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
    out[name!] = value!.trim()
  }
  return out
}

const px = (value: string | undefined): number => {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value ?? '')
  expect(match, `${value} is not a px length`).not.toBeNull()
  return Number(match![1])
}

/** The tracks of a `grid-template-columns` value: a px width, or an fr weight. */
function tracks(template: string): ({ px: number } | { fr: number })[] {
  return (template.match(/minmax\([^)]*\)|\S+/g) ?? []).map((track) => {
    const fr = /^minmax\(0,\s*(\d+(?:\.\d+)?)fr\)$/.exec(track)
    if (fr) return { fr: Number(fr[1]) }
    return { px: px(track) }
  })
}

const inventory = css('src/ui/inventory/inventory.css')
const rollout = css('src/ui/rollout/rollout.css')
const row = rule(inventory, '.table__row')
const gap = px(row.gap)
const padding = px(row.padding?.split(/\s+/)[1])
const minWidth = px(
  rule(rollout, '.register .table__header,\n.register .table__scroll')['min-width'],
)

describe('the site register’s columns fit its minimum width (#233)', () => {
  it('reads a gap, a padding and a minimum width that are lengths', () => {
    expect([gap, padding, minWidth].every((value) => value > 0)).toBe(true)
  })

  it.each([
    ['writer', COLUMNS_WRITER],
    ['reader', COLUMNS_READER],
  ])('leaves the %s’s flexible columns room', (_, template) => {
    const all = tracks(template)
    const fixed = all.reduce((sum, track) => sum + ('px' in track ? track.px : 0), 0)
    const weights = all.flatMap((track) => ('fr' in track ? [track.fr] : []))
    expect(weights.length).toBeGreaterThan(0)
    const free = minWidth - fixed - gap * (all.length - 1) - padding * 2
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    const narrowest = Math.min(...weights.map((weight) => (free * weight) / total))
    expect(narrowest, `${template} in ${minWidth}px`).toBeGreaterThanOrEqual(MIN_FR_TRACK)
  })
})
