import {
  SITE_PHASE_LABELS,
  dayAfterPeriod,
  dayStart,
  deriveSitePhase,
  formatPlanDate,
  overdueMilestones,
  phaseInputs,
  type DateSource,
  type MilestonePhase,
  type PlanDate,
  type PlanDatePrecision,
  type SitePhase,
  type SiteRag,
} from '@/model'
import { escapeXml, resolveColour } from '@/ui/graph/export-svg'
import type { LegendEntry } from '@/ui/graph/colouring'
import {
  RAG_TOKENS,
  SITE_PHASE_TOKENS,
  sourceText,
  waveHeading,
  type SiteRow,
  type WaveColumn,
} from './rollout-data'

/**
 * The wave timeline's geometry (#211): waves as bars on a quarter-to-month
 * axis. One layout feeds both the screen and the exported SVG, so the file is
 * the picture on screen and not a second drawing of it.
 *
 * A window's end is a period, so a bar runs to the **end** of that period: a
 * wave ending "2027-03" runs to the last day of March. A wave with a start and
 * no end runs to the end of its start's period and is drawn open. A wave with
 * no start cannot be placed, and is listed instead (`unscheduled`).
 *
 * **An expanded wave** (#213) is followed by one row per site, with a tick per
 * milestone the site has a date for. A tick spans the period its date names,
 * so a day is a sliver and a quarter a block: the precision of the plan is
 * what the picture shows. A tick is filled when the site sets the date and
 * drawn as an outline when it inherits it, and is coloured by the phase its
 * milestone starts. Each site row carries its phase at the time point.
 */

const DAY_MS = 86_400_000
/** Two pixels a day: a quarter is about 180px, a month about 60px. */
export const PX_PER_DAY = 2
export const LABEL_WIDTH = 168
export const AXIS_HEIGHT = 40
export const ROW_HEIGHT = 34
export const BAR_HEIGHT = 20
/** A site row under an expanded wave, and its ticks. */
export const SITE_ROW_HEIGHT = 20
export const TICK_HEIGHT = 10
/** The narrowest tick, so a day can be seen and pointed at. */
const MIN_TICK = 3

export const COLOUR_VIEWS = ['load', 'rag'] as const
export type TimelineColourView = (typeof COLOUR_VIEWS)[number]
export const COLOUR_VIEW_LABELS: Record<TimelineColourView, string> = { load: 'Load', rag: 'RAG' }

export interface TimelineBar {
  id: string
  /** The label, or the name when the label is empty: the screen and the file show this. */
  heading: { text: string; code: boolean }
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

export interface TimelineTick {
  milestone: string
  x: number
  width: number
  /** The date in the form people write it: `2027-Q3`, `2027-05-17`. */
  text: string
  precision: PlanDatePrecision
  source: DateSource
  startsPhase: MilestonePhase
  /** Milestone, date, and whether it is set or where it is inherited from. */
  title: string
}

export interface TimelineSiteRow {
  location: string
  wave: string
  label: { text: string; code: boolean }
  y: number
  phase: SitePhase
  overdue: boolean
  ticks: TimelineTick[]
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
  sites: TimelineSiteRow[]
  unscheduled: WaveColumn[]
}

/** The first day after the period `value` names, in UTC ms. */
export function periodEnd(value: PlanDate): number {
  return dayStart(dayAfterPeriod(value))
}

function quarterStart(ms: number): Date {
  const date = new Date(ms)
  const value = new Date(0)
  value.setUTCFullYear(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1)
  return value
}

const RAG_ORDER: SiteRag[] = ['red', 'amber', 'green']

export interface TimelineOptions {
  /** Waves whose sites are drawn under them. */
  expanded?: ReadonlySet<string>
  /** The time point site phases are derived at, in UTC ms. */
  at?: number
}

export function layoutTimeline(
  waves: WaveColumn[],
  { expanded = new Set(), at = Date.now() }: TimelineOptions = {},
): TimelineLayout {
  const placed: {
    column: WaveColumn
    start: number
    end: number
    openEnd: boolean
    sites: SiteRow[]
  }[] = []
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
      start: dayStart(start.date),
      end: end ? periodEnd(end) : periodEnd(start),
      openEnd: !end,
      sites: expanded.has(column.element.id) ? column.sites : [],
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
      sites: [],
      unscheduled,
    }
  }

  // The axis runs from the quarter of the earliest bar or tick to a quarter
  // boundary at or after the last of them.
  const starts = placed.map((bar) => bar.start)
  const ends = placed.map((bar) => bar.end)
  for (const { sites } of placed) {
    for (const site of sites) {
      for (const resolved of site.milestones) {
        if (!resolved.planned) continue
        starts.push(dayStart(resolved.planned.date))
        ends.push(periodEnd(resolved.planned))
      }
    }
  }
  const from = quarterStart(Math.min(...starts)).getTime()
  const last = Math.max(...ends)
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

  const bars: TimelineBar[] = []
  const siteRows: TimelineSiteRow[] = []
  let y = AXIS_HEIGHT
  for (const { column, start, end, openEnd, sites } of placed) {
    const window = column.plan.window
    const heading = waveHeading(column)
    bars.push({
      id: column.element.id,
      heading,
      name: column.element.name,
      x: x(start),
      y: y + (ROW_HEIGHT - BAR_HEIGHT) / 2,
      width: Math.max(x(end) - x(start), 2),
      openEnd,
      window: [window?.start, window?.end]
        .map((value) => (value ? formatPlanDate(value) : '…'))
        .join(' → '),
      sites: column.sites.length,
      capacity: column.capacity,
      over: column.over,
      worstRag: RAG_ORDER.find((rag) => column.sites.some((site) => site.rag === rag)),
    })
    y += ROW_HEIGHT
    for (const site of sites) {
      siteRows.push(siteRow(site, column, heading.text, y, x, at))
      y += SITE_ROW_HEIGHT
    }
  }

  return {
    from,
    to,
    width: x(to) + 16,
    height: y + 8,
    quarters,
    months,
    bars,
    sites: siteRows,
    unscheduled,
  }
}

function siteRow(
  site: SiteRow,
  column: WaveColumn,
  waveLabel: string,
  y: number,
  x: (ms: number) => number,
  at: number,
): TimelineSiteRow {
  // The timeline has its own time point, so it derives the phase again, from
  // the inputs the register's `siteStatus` derives it from.
  const inputs = phaseInputs(site.milestones)
  const milestones = site.milestones.map((resolved) => resolved.milestone)
  const ticks: TimelineTick[] = []
  for (const resolved of site.milestones) {
    if (!resolved.planned || !resolved.source) continue
    const start = x(dayStart(resolved.planned.date))
    const text = formatPlanDate(resolved.planned)
    ticks.push({
      milestone: resolved.milestone.id,
      x: start,
      width: Math.max(x(periodEnd(resolved.planned)) - start, MIN_TICK),
      text,
      precision: resolved.planned.precision,
      source: resolved.source,
      startsPhase: resolved.milestone.startsPhase,
      title: `${resolved.milestone.label} · ${text} · ${sourceText(resolved, waveLabel, milestones)}`,
    })
  }
  return {
    location: site.location,
    wave: column.element.id,
    label:
      site.code === undefined ? { text: site.name, code: false } : { text: site.code, code: true },
    y,
    phase: deriveSitePhase(inputs, true, at),
    overdue: overdueMilestones(inputs, at).length > 0,
    ticks,
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

export function barStroke(bar: TimelineBar, view: TimelineColourView): string {
  if (view === 'rag') return bar.worstRag ? RAG_TOKENS[bar.worstRag] : 'var(--lc-plan)'
  if (bar.over) return 'var(--lc-eol)'
  return bar.capacity === undefined ? 'var(--lc-plan)' : 'var(--lc-in)'
}

export function barFill(bar: TimelineBar, view: TimelineColourView): string {
  return tint(barStroke(bar, view))
}

/** A tick in the colour of the phase its milestone starts: filled when set, an outline when inherited. */
export function tickStroke(tick: TimelineTick): string {
  return SITE_PHASE_TOKENS[tick.startsPhase]
}

export function tickFill(tick: TimelineTick): string {
  return tick.source === 'site' ? SITE_PHASE_TOKENS[tick.startsPhase] : 'var(--surface)'
}

export function legendFor(view: TimelineColourView, withPhases = false): LegendEntry[] {
  const entry = (key: string, label: string, stroke: string): LegendEntry => ({
    key,
    label,
    stroke,
    fill: tint(stroke),
  })
  const bars =
    view === 'rag'
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
  if (!withPhases) return bars
  // One entry per colour of the site phases, as ADR 0013 point 9 groups them.
  return [
    ...bars,
    entry('phase-unplanned', 'Unplanned', SITE_PHASE_TOKENS.unplanned),
    entry('phase-planned', 'Planned', SITE_PHASE_TOKENS.planned),
    entry('phase-moving', 'Preparing, cutover, hypercare', SITE_PHASE_TOKENS.preparing),
    entry('phase-migrated', 'Migrated, done', SITE_PHASE_TOKENS.migrated),
    // A tick is filled when the site sets its date, an outline when it
    // inherits it (ADR 0013 point 5: the UI shows which it is).
    {
      key: 'tick-set',
      label: 'Filled tick: set at the site',
      stroke: 'var(--ink)',
      fill: 'var(--ink)',
    },
    {
      key: 'tick-inherited',
      label: 'Outlined tick: inherited',
      stroke: 'var(--ink)',
      fill: 'var(--surface)',
    },
  ]
}

// ── Export ───────────────────────────────────────────────────────────────────

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
  const ink2 = resolveColour('var(--ink2)')
  const ink3 = resolveColour('var(--ink3)')
  const border = resolveColour('var(--bd)')
  const border2 = resolveColour('var(--bd2)')
  const accent = resolveColour('var(--accent)')
  const mono = ` font-family="'JetBrains Mono', monospace"`
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Space Grotesk', system-ui, sans-serif">`,
    `<rect width="${width}" height="${height}" fill="${resolveColour('var(--paper)')}"/>`,
    `<text x="16" y="24" font-size="15" font-weight="600" fill="${ink}">${escapeXml(title)}</text>`,
    `<text x="16" y="40" font-size="10"${mono} fill="${ink3}">${escapeXml(stats)}</text>`,
    `<g transform="translate(16 ${head})">`,
  ]
  for (const quarter of layout.quarters) {
    parts.push(
      `<line x1="${quarter.x}" y1="0" x2="${quarter.x}" y2="${layout.height}" stroke="${border}"/>`,
      `<text x="${quarter.x + 4}" y="14" font-size="10"${mono} fill="${ink3}">${escapeXml(quarter.label)}</text>`,
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
    // A label is a code, in mono; a name stands in for an empty one, in the
    // document's own face, as on screen (#223).
    const face = bar.heading.code ? mono : ''
    parts.push(
      `<text x="0" y="${bar.y + 14}" font-size="11"${face} fill="${ink}">${escapeXml(bar.heading.text)}</text>`,
      `<rect x="${bar.x}" y="${bar.y}" width="${bar.width}" height="${BAR_HEIGHT}" fill="${fill}" stroke="${stroke}"${dash}/>`,
      `<text x="${bar.x + 6}" y="${bar.y + 14}" font-size="10"${mono} fill="${ink}">${escapeXml(barText(bar))}</text>`,
    )
  }
  for (const site of layout.sites) {
    const middle = site.y + SITE_ROW_HEIGHT / 2
    const face = site.label.code ? mono : ''
    parts.push(
      `<rect x="12" y="${middle - 4}" width="8" height="8" fill="${resolveColour(SITE_PHASE_TOKENS[site.phase])}"/>`,
      `<text x="26" y="${middle + 4}" font-size="10" fill="${ink2}"><tspan${face}>${escapeXml(site.label.text)}</tspan>${escapeXml(siteStatusText(site))}</text>`,
      `<line x1="${LABEL_WIDTH}" y1="${middle}" x2="${layout.width - 16}" y2="${middle}" stroke="${border2}" stroke-dasharray="1 3"/>`,
    )
    for (const tick of site.ticks) {
      parts.push(
        `<rect x="${tick.x}" y="${middle - TICK_HEIGHT / 2}" width="${tick.width}" height="${TICK_HEIGHT}" fill="${resolveColour(tickFill(tick))}" stroke="${resolveColour(tickStroke(tick))}"><title>${escapeXml(tick.title)}</title></rect>`,
      )
    }
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

/** What follows a site row's code or name: its phase, and overdue when it is. */
export function siteStatusText(site: TimelineSiteRow): string {
  return ` · ${SITE_PHASE_LABELS[site.phase]}${site.overdue ? ' · overdue' : ''}`
}
