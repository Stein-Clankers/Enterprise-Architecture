import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Issue #6, acceptance criterion 4: "No layout shift when switching themes."
 *
 * The theme toggle only sets `data-theme` on `<html>`, so the only thing that
 * could move a pixel is a token the dark block redefines that feeds a size, a
 * weight, a spacing or a border width. That makes the criterion mechanical
 * rather than visual: whatever dark redefines has to be a colour.
 *
 * Asserting `document.documentElement.dataset.theme` — which is what the shell
 * test does — cannot see this. It passes just as happily with `--rowh: 30px` in
 * the dark block, which is precisely the failure the criterion names.
 *
 * `[data-density='compact']` redefines `--rowh` and is deliberately not checked:
 * density is a size switch and is supposed to resize. Only the theme is bound by
 * this rule.
 */

const TOKENS_PATH = join(process.cwd(), 'src', 'styles', 'tokens.css')

/** Comments can contain both braces and semicolons, so they go first. */
const css = readFileSync(TOKENS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function blockFor(selector: string): string {
  const start = css.indexOf(selector)
  expect(start, `no ${selector} block in tokens.css`).toBeGreaterThan(-1)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

function declarationsIn(selector: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = []
  for (const match of blockFor(selector).matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) {
    const [, name, value] = match
    if (name && value) out.push({ name, value: value.trim() })
  }
  return out
}

/**
 * A value that can only paint. `color-mix` and `currentcolor` are here because
 * the handoff may yet use them; a length, a number or a keyword like `bold` is
 * not matched and fails the test, which is the whole point.
 */
const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|color-mix\(|transparent$|currentcolor$)/i

describe('theme tokens (issue #6 AC4)', () => {
  it('the dark theme redefines only colour-valued tokens, so a theme switch cannot shift layout', () => {
    const offenders = declarationsIn("[data-theme='dark']")
      .filter(({ value }) => !COLOUR.test(value))
      .map(({ name, value }) => `${name}: ${value}`)

    expect(offenders, 'a non-colour token in the dark block can move the layout').toEqual([])
  })

  it('every token the dark theme redefines already exists in :root', () => {
    const root = new Set(declarationsIn(':root').map(({ name }) => name))
    const orphans = declarationsIn("[data-theme='dark']")
      .map(({ name }) => name)
      .filter((name) => !root.has(name))

    expect(orphans, 'a dark-only token has no light value, so light renders unstyled').toEqual([])
  })
})

/**
 * #213, ADR 0016 point 6: Unplanned is drawn in `--ink2`, Planned in
 * `--lc-plan`, and the two must differ in both themes. `--ink3` was the
 * obvious neutral and is rejected because it *is* `--lc-plan` in the light
 * theme; that reason is asserted too, so the choice is looked at again if it
 * stops being true (#229 review, finding 5).
 */
describe('the Unplanned ink (#213, ADR 0016 point 6)', () => {
  const value = (selector: string, name: string) =>
    declarationsIn(selector)
      .find((declaration) => declaration.name === name)
      ?.value.toLowerCase()

  it.each([':root', "[data-theme='dark']"])('--ink2 differs from --lc-plan in %s', (selector) => {
    const ink2 = value(selector, '--ink2')
    const plan = value(selector, '--lc-plan')
    expect(ink2).toMatch(/^#[0-9a-f]{6}$/)
    expect(plan).toMatch(/^#[0-9a-f]{6}$/)
    expect(ink2).not.toBe(plan)
  })

  it('--ink3 is --lc-plan in the light theme, which is why Unplanned is not --ink3', () => {
    expect(value(':root', '--ink3')).toMatch(/^#[0-9a-f]{6}$/)
    expect(value(':root', '--ink3')).toBe(value(':root', '--lc-plan'))
  })
})
