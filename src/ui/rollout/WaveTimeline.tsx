import { useMemo, useState } from 'react'
import { downloadText } from '@/io'
import { ReportChrome } from '@/ui/graph/ReportChrome'
import { waveHeading, type RolloutData } from './rollout-data'
import {
  AXIS_HEIGHT,
  BAR_HEIGHT,
  COLOUR_VIEWS,
  COLOUR_VIEW_LABELS,
  barFill,
  barStroke,
  barText,
  layoutTimeline,
  legendFor,
  timelineSvg,
  xOf,
  type TimelineColourView,
} from './timeline'

/**
 * The wave timeline (#211, proposal §6 item 5): waves as bars on a
 * quarter-to-month axis, under the shared report chrome (UI spec §3.4), with
 * the time point drawn as a line. Expanding a wave to its sites, milestone
 * ticks and blackout bands are #213's.
 */

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'rollout'
  )
}

export function WaveTimeline({ data }: { data: RolloutData }) {
  const thisYear = new Date().getUTCFullYear()
  const [view, setView] = useState<TimelineColourView>('load')
  const [year, setYear] = useState(thisYear)
  const layout = useMemo(() => layoutTimeline(data.waves), [data.waves])

  const fromYear = layout.bars.length ? new Date(layout.from).getUTCFullYear() : thisYear
  const toYear = layout.bars.length ? new Date(layout.to - 1).getUTCFullYear() : thisYear
  const min = Math.min(fromYear, thisYear)
  const max = Math.max(toYear, thisYear)
  const timePoint = Date.UTC(year, 0, 1)
  const marker = xOf(layout, timePoint)

  const stats = [
    `${data.waves.length} wave${data.waves.length === 1 ? '' : 's'}`,
    `${data.sites.length} site${data.sites.length === 1 ? '' : 's'}`,
    `${data.unassigned.length} unassigned`,
    `time point ${year}`,
  ].join(' · ')
  const title = `${data.rollout.name}: wave timeline`

  return (
    <div className="timeline">
      <ReportChrome
        title="Wave timeline"
        stats={stats}
        colourViews={COLOUR_VIEWS.map((key) => ({ key, label: COLOUR_VIEW_LABELS[key] }))}
        activeColourView={view}
        onColourViewChange={(key) => {
          const next = COLOUR_VIEWS.find((candidate) => candidate === key)
          if (next) setView(next)
        }}
        timePoint={{ value: year, min, max, today: thisYear }}
        onTimePointChange={setYear}
        legend={legendFor(view)}
        exportDisabledReason={layout.bars.length ? undefined : 'No wave has a window to draw'}
        onExport={() =>
          downloadText(
            `${slug(data.rollout.name)}-waves.svg`,
            timelineSvg(layout, view, { title, stats, timePoint }),
            'image/svg+xml',
          )
        }
      />
      <div className="timeline__canvas">
        {layout.bars.length === 0 ? (
          <p className="table__empty">
            {data.waves.length
              ? 'No wave has a window yet. Give one a start to place it here.'
              : 'This rollout has no waves yet.'}
          </p>
        ) : (
          <svg
            className="timeline__svg"
            width={layout.width}
            height={layout.height}
            role="img"
            aria-label={`Wave timeline: ${stats}`}
          >
            {layout.quarters.map((quarter) => (
              <g key={quarter.label}>
                <line
                  x1={quarter.x}
                  x2={quarter.x}
                  y1={0}
                  y2={layout.height}
                  className="timeline__quarter-line"
                />
                <text x={quarter.x + 4} y={14} className="timeline__axis-label">
                  {quarter.label}
                </text>
              </g>
            ))}
            {layout.months.map((month) => (
              <line
                key={month.x}
                x1={month.x}
                x2={month.x}
                y1={AXIS_HEIGHT - 12}
                y2={AXIS_HEIGHT}
                className="timeline__month-tick"
              />
            ))}
            <line
              x1={0}
              x2={layout.width}
              y1={AXIS_HEIGHT}
              y2={AXIS_HEIGHT}
              className="timeline__quarter-line"
            />
            {layout.bars.map((bar) => (
              <g key={bar.id} data-wave={bar.id}>
                <title>{`${bar.name} · ${bar.window} · ${barText(bar)}${bar.over ? ' · over capacity' : ''}`}</title>
                <text
                  x={0}
                  y={bar.y + 14}
                  className={`timeline__bar-label${bar.heading.code ? '' : ' timeline__bar-label--name'}`}
                >
                  {bar.heading.text}
                </text>
                <rect
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={BAR_HEIGHT}
                  fill={barFill(bar, view)}
                  stroke={barStroke(bar, view)}
                  strokeDasharray={bar.openEnd ? '4 3' : undefined}
                />
                <text x={bar.x + 6} y={bar.y + 14} className="timeline__bar-text">
                  {barText(bar)}
                </text>
              </g>
            ))}
            {marker !== undefined && (
              <line
                x1={marker}
                x2={marker}
                y1={0}
                y2={layout.height}
                className="timeline__time-point"
              />
            )}
          </svg>
        )}
        {layout.unscheduled.length > 0 && (
          <p className="timeline__unscheduled">
            No window yet:{' '}
            {layout.unscheduled.map((wave, index) => {
              const heading = waveHeading(wave)
              return (
                <span key={wave.element.id}>
                  {index > 0 && ', '}
                  <span className={heading.code ? 'mono' : undefined}>{heading.text}</span>
                </span>
              )
            })}
          </p>
        )}
      </div>
    </div>
  )
}
