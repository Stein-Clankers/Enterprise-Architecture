import { downloadText } from '@/io'
import { BANDS, BAND_LABELS, BAND_TINTS, type Band } from './bands'
import { NODE_HEIGHT, NODE_WIDTH } from './layout'

/**
 * Export the current graph as a standalone SVG.
 *
 * React Flow renders nodes as HTML, so this is not a DOM snapshot — it redraws
 * the same view model as SVG. That is the better trade anyway: the exported file
 * has no framework markup in it, opens in any viewer, and carries the theme it
 * was exported under, because every token is resolved to a concrete colour first.
 */

export interface ExportNode {
  id: string
  x: number
  y: number
  name: string
  subLabel: string
  stroke: string
  fill: string
  opacity: number
  pastEol: boolean
}

/** Perpendicular offset of a same-band edge's control point (handoff). */
const SAME_BAND_BOW = 34

export interface ExportEdge {
  id: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  stroke: string
  width: number
  opacity: number
  dashed: boolean
  /** Same-band edges curve; cross-band edges run straight. */
  curved?: boolean
}

export interface ExportGraph {
  title: string
  stats: string
  nodes: ExportNode[]
  edges: ExportEdge[]
  bands: Partial<Record<Band, { y: number; height: number }>>
  width: number
  height: number
}

/**
 * Resolve `var(--x)` and `color-mix(...)` to a concrete colour by letting the
 * browser compute it. Without this the exported file would reference custom
 * properties that do not exist outside the app.
 */
export function resolveColour(value: string): string {
  if (typeof document === 'undefined') return value
  if (!value.includes('var(') && !value.includes('color-mix(')) return value
  const probe = document.createElement('span')
  probe.style.color = value
  probe.style.display = 'none'
  document.body.append(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || value
}

const PADDING = 40

export function buildSvg(graph: ExportGraph): string {
  const width = graph.width + PADDING * 2
  const height = graph.height + PADDING * 2 + 40
  const paper = resolveColour('var(--paper)')
  const ink = resolveColour('var(--ink)')
  const ink3 = resolveColour('var(--ink3)')
  const border = resolveColour('var(--bd)')

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Space Grotesk', system-ui, sans-serif">`,
  )
  parts.push(`<rect width="${width}" height="${height}" fill="${paper}"/>`)
  parts.push(
    `<text x="${PADDING}" y="26" font-size="15" font-weight="600" fill="${ink}">${escapeXml(graph.title)}</text>`,
  )
  parts.push(
    `<text x="${PADDING}" y="44" font-size="10" font-family="'JetBrains Mono', monospace" fill="${ink3}">${escapeXml(graph.stats)}</text>`,
  )
  parts.push(`<g transform="translate(${PADDING} ${PADDING + 40})">`)

  for (const band of BANDS) {
    const rect = graph.bands[band]
    if (!rect) continue
    const tint = resolveColour(`color-mix(in oklab, ${BAND_TINTS[band]} 4%, var(--paper))`)
    parts.push(
      `<rect x="-16" y="${rect.y}" width="${graph.width + 32}" height="${rect.height}" fill="${tint}" stroke="${border}" stroke-dasharray="4 3"/>`,
    )
    parts.push(
      `<text x="-6" y="${rect.y + 14}" font-size="9.5" letter-spacing="1.1" font-family="'JetBrains Mono', monospace" fill="${ink3}">${BAND_LABELS[band]}</text>`,
    )
  }

  // Edges first: they belong behind the opaque node bodies.
  // One marker per distinct stroke: an SVG marker cannot inherit the stroke of
  // the line that uses it, and the exported file has to stand alone.
  const markers = new Map<string, string>()
  for (const edge of graph.edges) {
    const colour = resolveColour(edge.stroke)
    if (!markers.has(colour)) markers.set(colour, `arrow-${markers.size}`)
  }
  parts.push('<defs>')
  for (const [colour, id] of markers) {
    parts.push(
      `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${colour}"/></marker>`,
    )
  }
  parts.push('</defs>')

  for (const edge of graph.edges) {
    const colour = resolveColour(edge.stroke)
    const marker = ` marker-end="url(#${markers.get(colour)!})"`
    const shared = `stroke="${colour}" stroke-width="${edge.width}" opacity="${edge.opacity}"${edge.dashed ? ' stroke-dasharray="4 3"' : ''} fill="none"${marker}`
    if (edge.curved) {
      // A quadratic bowed perpendicular to the run, so two same-band edges over
      // the same stretch of row do not lie on top of each other.
      const midX = (edge.from.x + edge.to.x) / 2
      const midY = (edge.from.y + edge.to.y) / 2
      const dx = edge.to.x - edge.from.x
      const dy = edge.to.y - edge.from.y
      const length = Math.hypot(dx, dy) || 1
      const cx = midX + (-dy / length) * SAME_BAND_BOW
      const cy = midY + (dx / length) * SAME_BAND_BOW
      parts.push(
        `<path d="M ${edge.from.x} ${edge.from.y} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${edge.to.x} ${edge.to.y}" ${shared}/>`,
      )
    } else {
      parts.push(
        `<line x1="${edge.from.x}" y1="${edge.from.y}" x2="${edge.to.x}" y2="${edge.to.y}" ${shared}/>`,
      )
    }
  }

  for (const node of graph.nodes) {
    const stroke = resolveColour(node.stroke)
    parts.push(`<g opacity="${node.opacity}">`)
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" fill="${resolveColour(node.fill)}" stroke="${stroke}"${node.pastEol ? ' stroke-dasharray="3 2"' : ''}/>`,
    )
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="3" height="${NODE_HEIGHT}" fill="${stroke}"/>`,
    )
    const [first, second] = wrap(node.name)
    parts.push(
      `<text x="${node.x + 11}" y="${node.y + 15}" font-size="10.5" font-weight="500" fill="${ink}">${escapeXml(first)}</text>`,
    )
    if (second) {
      parts.push(
        `<text x="${node.x + 11}" y="${node.y + 26}" font-size="10.5" font-weight="500" fill="${ink}">${escapeXml(second)}</text>`,
      )
    }
    parts.push(
      `<text x="${node.x + 11}" y="${node.y + 37}" font-size="8.5" font-family="'JetBrains Mono', monospace" fill="${ink3}">${escapeXml(node.subLabel)}</text>`,
    )
    parts.push('</g>')
  }

  parts.push('</g></svg>')
  return `${parts.join('\n')}\n`
}

/** Wrap a name to two lines at ~21 characters, per the handoff node spec. */
export function wrap(name: string, limit = 21): [string, string | undefined] {
  if (name.length <= limit) return [name, undefined]
  const words = name.split(' ')
  let first = ''
  let index = 0
  while (index < words.length && `${first} ${words[index]}`.trim().length <= limit) {
    first = `${first} ${words[index]}`.trim()
    index += 1
  }
  if (!first) {
    return [name.slice(0, limit), truncate(name.slice(limit), limit)]
  }
  return [first, truncate(words.slice(index).join(' '), limit)]
}

function truncate(text: string, limit: number): string | undefined {
  if (!text) return undefined
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/** Text for an SVG's character data or an attribute in double quotes. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function downloadGraphSvg(graph: ExportGraph, fileName = 'dependency-graph.svg'): void {
  downloadText(fileName, buildSvg(graph), 'image/svg+xml')
}
