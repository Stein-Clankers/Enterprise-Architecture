import { formatPlanDate, type PlanDate, type SiteRag } from '@/model'
import { resolveColour } from '@/ui/graph/export-svg'
import type { LegendEntry } from '@/ui/graph/colouring'
import type { WaveColumn } from './rollout-data'

/**
 * The wave timeline's geometry (#211): waves as bars on a quarter-to-month
 * axis. One layout feeds both the screen and the exported SVG, so the file is
 * the picture on screen and not a second drawing of it.
 *
 * A window's end is a period, so a bar runs to the **end** of that period: a
 * wave ending "2027-03" runs to the last day of March. A wave with a start and
 * no end runs to the end of its start's period and is drawn open. A wave with
 * no start cannot be placed, and is listed instead (`unscheduled`).
 */

const DAY_MS = 86_400_000
/** Two pixels a day: a quarter is about 180px, a month about 60px. */
export const PX_PER_DAY = 2
export const LABEL_WIDTH = 168
export const AXIS_HEIGHT = 40
export const ROW_HEIGHT = 34
export const BAR_HEIGHT = 20

export const COLOUR_VIEWS = ['load', 'rag'] as const
export type TimelineColourView = (typeof COLOUR_VIEWS)[number]
export const COLOUR_VIEW_LABELS: Record<TimelineColourView, string> = { load: 'Load', rag: 'RAG' }

export interface TimelineBar {
  id: string
  label: string
  name: string
  x: number
  y: number
  width: number
  /** No end date yet: the bar stops at the end of its start's period. */
  openEnd: boolean
  window: string
  sites: number
  capacity: number | undefined
  over: boolean
  worstRag: SiteRag | undefined
}

export interface TimelineLayout {
  /** UTC ms at the axis's left edge (x = LABEL_WIDTH). */
  from: number
  to: number
  width: number
  height: number
  quarters: { label: string; x: number; width: number }[]
  months: { x: number }[]
  bars: TimelineBar[]
  unscheduled: WaveColumn[]
}

function utc(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const value = new Date(0)
  value.setUTCFullYear(year, month - 1, date)
  return value.getTime()
}

/** The first day after the period `value` names, in UTC ms. */
export function periodEnd(value: PlanDate): number {
  const start = new Date(utc(value.date))
  switch (value.precision) {
    case 'quarter':
      start.setUTCMonth(start.getUTCMonth() + 3)
      return start.getTime()
    case 'month':
      start.setUTCMonth(start.getUTCMonth() + 1)
      return start.getTime()
    case 'week':
      return start.getTime() + 7 * DAY_MS
    case 'day':
      return start.getTime() + DAY_MS
  }
}

function quarterStart(ms: number): Date {
  const date = new Date(ms)
  const value = new Date(0)
  value.setUTCFullYear(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1)
  return value
}

const RAG_ORDER: SiteRag[] = ['red', 'amber', 'green']

export function layoutTimeline(waves: WaveColumn[]): TimelineLayout {
  const placed: { column: WaveColumn; start: number; end: number; openEnd: boolean }[] = []
  const unscheduled: WaveColumn[] = []
  for (const column of waves) {
    const start = column.plan.window?.start
    if (!start) {
      unscheduled.push(column)
      continue
    }
    const end = column.plan.window?.end
    placed.push({
      column,
      start: utc(start.date),
      end: end ? periodEnd(end) : periodEnd(start),
      openEnd: !end,
    })
  }
  if (!placed.length) {
    return {
      from: 0,
      to: 0,
      width: LABEL_WIDTH,
      height: AXIS_HEIGHT,
      quarters: [],
      months: [],
      bars: [],
      unscheduled,
    }
  }

  const from = quarterStart(Math.min(...placed.map((bar) => bar.start))).getTime()
  const last = Math.max(...placed.map((bar) => bar.end))
  // The axis ends on a quarter boundary at or after the last bar.
  const quarters: TimelineLayout['quarters'] = []
  const months: TimelineLayout['months'] = []
  const x = (ms: number) => LABEL_WIDTH + ((ms - from) / DAY_MS) * PX_PER_DAY
  const cursor = new Date(from)
  while (cursor.getTime() < last) {
    const start = cursor.getTime()
    const label = formatPlanDate({
      date: cursor.toISOString().slice(0, 10),
      precision: 'quarter',
    })
    for (let m = 0; m < 3; m += 1) {
      const month = new Date(start)
      month.setUTCMonth(month.getUTCMonth() + m)
      if (m > 0) months.push({ x: x(month.getTime()) })
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 3)
    quarters.push({ label, x: x(start), width: x(cursor.getTime()) - x(start) })
  }
  const to = cursor.getTime()

  const bars = placed.map(({ column, start, end, openEnd }, index): TimelineBar => {
    const window = column.plan.window
    const worstRag = RAG_ORDER.find((rag) => column.sites.some((site) => site.rag === rag))
    return {
      id: column.element.id,
      label: column.plan.label,
      name: column.element.name,
      x: x(start),
      y: AXIS_HEIGHT + index * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
      width: Math.max(x(end) - x(start), 2),
      openEnd,
      window: [window?.start, window?.end]
        .map((value) => (value ? formatPlanDate(value) : '…'))
        .join(' → '),
      sites: column.sites.length,
      capacity: column.capacity,
      over: column.over,
      worstRag,
    }
  })

  return {
    from,
    to,
    width: x(to) + 16,
    height: AXIS_HEIGHT + bars.length * ROW_HEIGHT + 8,
    quarters,
    months,
    bars,
    unscheduled,
  }
}

/** The x of a UTC instant, or `undefined` when it is off the axis. */
export function xOf(layout: TimelineLayout, ms: number): number | undefined {
  if (!layout.bars.length || ms < layout.from || ms > layout.to) return undefined
  return LABEL_WIDTH + ((ms - layout.from) / DAY_MS) * PX_PER_DAY
}

// ── Colour ───────────────────────────────────────────────────────────────────

/** Fill is the stroke mixed into the surface, as the graph's band tints are. */
function tint(token: string): string {
  return `color-mix(in oklab, ${token} 22%, var(--surface))`
}

const RAG_TOKENS: Record<SiteRag, string> = {
  green: 'var(--lc-act)',
  amber: 'var(--lc-out)',
  red: 'var(--lc-eol)',
}

export function barStroke(bar: TimelineBar, view: TimelineColourView): string {
  if (view === 'rag') return bar.worstRag ? RAG_TOKENS[bar.worstRag] : 'var(--lc-plan)'
  if (bar.over) return 'var(--lc-eol)'
  return bar.capacity === undefined ? 'var(--lc-plan)' : 'var(--lc-in)'
}

export function barFill(bar: TimelineBar, view: TimelineColourView): string {
  return tint(barStroke(bar, view))
}

export function legendFor(view: TimelineColourView): LegendEntry[] {
  const entry = (key: string, label: string, stroke: string): LegendEntry => ({
    key,
    label,
    stroke,
    fill: tint(stroke),
  })
  return view === 'rag'
    ? [
        entry('red', 'Worst site red', RAG_TOKENS.red),
        entry('amber', 'Worst site amber', RAG_TOKENS.amber),
        entry('green', 'All rated green', RAG_TOKENS.green),
        entry('none', 'Not rated', 'var(--lc-plan)'),
      ]
    : [
        entry('within', 'Within capacity', 'var(--lc-in)'),
        entry('over', 'Over capacity', 'var(--lc-eol)'),
        entry('none', 'No capacity set', 'var(--lc-plan)'),
      ]
}

// ── Export ───────────────────────────────────────────────────────────────────

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The timeline as a standalone SVG, every token resolved to the theme's colour. */
export function timelineSvg(
  layout: TimelineLayout,
  view: TimelineColourView,
  { title, stats, timePoint }: { title: string; stats: string; timePoint: number },
): string {
  const head = 48
  const width = layout.width + 32
  const height = layout.height + head + 16
  const ink = resolveColour('var(--ink)')
  const ink3 = resolveColour('var(--ink3)')
  const border = resolveColour('var(--bd)')
  const accent = resolveColour('var(--accent)')
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Space Grotesk', system-ui, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="${resolveColour('var(--paper)')}"/>`,
    `<text x="16" y="24" font-size="15" font-weight="600" fill="${ink}">${escapeXml(title)}</text>`,
    `<text x="16" y="40" font-size="10" font-family="'JetBrains Mono', monospace" fill="${ink3}">${escapeXml(stats)}</text>`,
    `<g transform="translate(16 ${head})">`,
  ]
  for (const quarter of layout.quarters) {
    parts.push(
      `<line x1="${quarter.x}" y1="0" x2="${quarter.x}" y2="${layout.height}" stroke="${border}"/>`,
      `<text x="${quarter.x + 4}" y="14" font-size="10" font-family="'JetBrains Mono', monospace" fill="${ink3}">${escapeXml(quarter.label)}</text>`,
    )
  }
  for (const month of layout.months) {
    parts.push(
      `<line x1="${month.x}" y1="${AXIS_HEIGHT - 12}" x2="${month.x}" y2="${AXIS_HEIGHT}" stroke="${border}"/>`,
    )
  }
  for (const bar of layout.bars) {
    const stroke = resolveColour(barStroke(bar, view))
    const fill = resolveColour(barFill(bar, view))
    const dash = bar.openEnd ? ' stroke-dasharray="4 3"' : ''
    parts.push(
      `<text x="0" y="${bar.y + 14}" font-size="11" font-family="'JetBrains Mono', monospace" fill="${ink}">${escapeXml(bar.label)}</text>`,
      `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${BAR_HEIGHT}" fill="${fill}" stroke="${stroke}"${dash}/>`,
      `<text x="${bar.x + 6}" y="${bar.y + 14}" font-size="10" font-family="'JetBrains Mono', monospace" fill="${ink}">${escapeXml(barText(bar))}</text>`,
    )
  }
  const marker = xOf(layout, timePoint)
  if (marker !== undefined) {
    parts.push(
      `<line x1="${marker}" y1="0" x2="${marker}" y2="${layout.height}" stroke="${accent}"/>`,
    )
  }
  parts.push('</g>', '</svg>')
  return `${parts.join('\n')}\n`
}

/** "12 / 40 sites", or "12 sites" when the wave has no capacity. */
export function barText(bar: TimelineBar): string {
  return bar.capacity === undefined
    ? `${bar.sites} site${bar.sites === 1 ? '' : 's'}`
    : `${bar.sites} / ${bar.capacity} sites`
}
