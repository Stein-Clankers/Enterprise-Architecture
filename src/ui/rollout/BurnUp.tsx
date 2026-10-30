import { useMemo, useState } from 'react'
import { WaveHeading } from './WaveHeading'
import {
  BURN_UP_GRAINS,
  BURN_UP_GRAIN_LABELS,
  BURN_UP_TOKENS,
  CHART,
  CHECKPOINT_STATUS_LABELS,
  CHECKPOINT_TOKENS,
  burnUp,
  burnUpChart,
  type BurnUpGrain,
} from './burn-up'
import type { RolloutData } from './rollout-data'

/**
 * The rollout's Progress tab (#215, proposal §6 item 6): sites reaching
 * Migrated, planned against actual, by week or by month, at the screen's time
 * point (`?at=` or today), and the current wave's 25%, 50% and 75%
 * checkpoints. The counts are `burn-up.ts`'s, derived from the site phase and
 * never stored.
 */
export function BurnUp({ data, asOf }: { data: RolloutData; asOf?: string }) {
  const [grain, setGrain] = useState<BurnUpGrain>('week')
  const progress = useMemo(() => burnUp(data, grain), [data, grain])
  const chart = useMemo(() => burnUpChart(progress), [progress])
  const timePoint = asOf ?? 'today'
  const stats = [
    `${progress.migrated} of ${progress.scope} site${progress.scope === 1 ? '' : 's'} migrated`,
    `${progress.notMigrated} not migrated`,
    `${progress.plannedMigrated} by the plan`,
    `time point ${timePoint}`,
  ].join(' · ')
  const current = progress.current

  return (
    <div className="burn-up">
      <div className="chrome">
        <div className="chrome__row">
          <div>
            <h2 className="chrome__title">Progress</h2>
            <p className="chrome__stats">{stats}</p>
          </div>
          <div className="chrome__controls">
            <span className="section-label">By</span>
            <div className="segmented" role="group" aria-label="Burn-up by">
              {BURN_UP_GRAINS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className={`segmented__option${candidate === grain ? ' segmented__option--active' : ''}`}
                  aria-pressed={candidate === grain}
                  onClick={() => setGrain(candidate)}
                >
                  {BURN_UP_GRAIN_LABELS[candidate].toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="chrome__row chrome__row--second">
          <div className="chrome__legend">
            <LegendLine label="Planned" token={BURN_UP_TOKENS.planned} dashed />
            <LegendLine label="Actual" token={BURN_UP_TOKENS.actual} />
            <LegendLine label={`Time point (${timePoint})`} token={BURN_UP_TOKENS.timePoint} />
            {(['due', 'met', 'late'] as const).map((status) => (
              <LegendLine
                key={status}
                label={`Checkpoint ${CHECKPOINT_STATUS_LABELS[status].toLowerCase()}`}
                token={CHECKPOINT_TOKENS[status]}
                dashed
              />
            ))}
          </div>
        </div>
      </div>

      <div className="burn-up__body">
        <dl className="burn-up__counts" aria-label="Sites at the time point">
          <div className="burn-up__count">
            <dt className="section-label">Migrated</dt>
            <dd className="kpi__value mono" data-count="migrated">
              {progress.migrated}
            </dd>
          </div>
          <div className="burn-up__count">
            <dt className="section-label">Not migrated</dt>
            <dd className="kpi__value mono" data-count="not-migrated">
              {progress.notMigrated}
            </dd>
          </div>
          <div className="burn-up__count">
            <dt className="section-label">Sites in scope</dt>
            <dd className="kpi__value mono" data-count="scope">
              {progress.scope}
            </dd>
          </div>
          <div className="burn-up__count">
            <dt className="section-label">Migrated by the plan</dt>
            <dd className="kpi__value mono" data-count="planned">
              {progress.plannedMigrated}
            </dd>
          </div>
        </dl>

        {!progress.migrates ? (
          <p className="table__empty">
            No milestone of this rollout starts Migrated or Done, so no site can reach Migrated. Set
            one in Milestones.
          </p>
        ) : !chart ? (
          <p className="table__empty">No site is planned to reach Migrated yet.</p>
        ) : (
          <svg
            className="burn-up__svg"
            viewBox={`0 0 ${CHART.width} ${CHART.height}`}
            role="img"
            aria-label={`Burn-up of sites migrated, by ${grain}: ${stats}`}
          >
            {chart.yTicks.map((tick) => (
              <g key={tick.label}>
                <line
                  x1={CHART.left}
                  x2={CHART.width - CHART.right}
                  y1={tick.y}
                  y2={tick.y}
                  className="burn-up__grid"
                />
                <text
                  x={CHART.left - 6}
                  y={tick.y + 3}
                  className="burn-up__axis-label"
                  textAnchor="end"
                >
                  {tick.label}
                </text>
              </g>
            ))}
            {chart.xTicks.map((tick) => (
              <g key={tick.label}>
                <line
                  x1={tick.x}
                  x2={tick.x}
                  y1={CHART.top}
                  y2={CHART.height - CHART.bottom}
                  className="burn-up__grid"
                />
                <text
                  x={tick.x + 4}
                  y={CHART.height - CHART.bottom + 14}
                  className="burn-up__axis-label"
                >
                  {tick.label}
                </text>
              </g>
            ))}
            {chart.checkpoints.map((checkpoint) => (
              <g key={checkpoint.percent} data-checkpoint={checkpoint.percent}>
                <line
                  x1={checkpoint.x}
                  x2={checkpoint.x}
                  y1={CHART.top}
                  y2={CHART.height - CHART.bottom}
                  style={{ stroke: CHECKPOINT_TOKENS[checkpoint.status] }}
                  strokeDasharray="2 3"
                />
                <text x={checkpoint.x + 3} y={CHART.top + 10} className="burn-up__axis-label">
                  {`${checkpoint.percent}%`}
                </text>
              </g>
            ))}
            <path
              d={chart.planned}
              className="burn-up__line"
              data-line="planned"
              style={{ stroke: BURN_UP_TOKENS.planned }}
              strokeDasharray="5 3"
            />
            {chart.actual && (
              <path
                d={chart.actual}
                className="burn-up__line burn-up__line--actual"
                data-line="actual"
                style={{ stroke: BURN_UP_TOKENS.actual }}
              />
            )}
            <line
              x1={chart.timePoint}
              x2={chart.timePoint}
              y1={CHART.top}
              y2={CHART.height - CHART.bottom}
              data-line="time-point"
              style={{ stroke: BURN_UP_TOKENS.timePoint }}
            />
          </svg>
        )}

        <section className="burn-up__wave" aria-label="Current wave">
          <h3 className="section-label">Current wave</h3>
          {current ? (
            <>
              <p className="burn-up__wave-line">
                <WaveHeading wave={current.wave} className="burn-up__wave-name" />
                <span className="mono" data-count="wave">
                  {`${current.migrated} of ${current.sites} migrated`}
                </span>
              </p>
              <table className="burn-up__checkpoints">
                <thead>
                  <tr>
                    <th>Checkpoint</th>
                    <th>Sites</th>
                    <th>Planned by</th>
                    <th>Reached</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {current.checkpoints.map((checkpoint) => (
                    <tr key={checkpoint.percent} data-checkpoint={checkpoint.percent}>
                      <td className="mono">{`${checkpoint.percent}%`}</td>
                      <td className="mono">{checkpoint.target}</td>
                      <td className="mono">{checkpoint.plannedBy ?? '—'}</td>
                      <td className="mono">{checkpoint.reachedOn ?? '—'}</td>
                      <td data-status={checkpoint.status}>
                        <span
                          className="register__phase-dot"
                          style={{ background: CHECKPOINT_TOKENS[checkpoint.status] }}
                          aria-hidden="true"
                        />{' '}
                        {CHECKPOINT_STATUS_LABELS[checkpoint.status]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="table__empty">
              {data.waves.length
                ? 'No wave has a site left to migrate.'
                : 'This rollout has no waves yet.'}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function LegendLine({ label, token, dashed }: { label: string; token: string; dashed?: boolean }) {
  return (
    <span className="chrome__legend-entry">
      <svg width="18" height="9" aria-hidden="true">
        <line
          x1="0"
          x2="18"
          y1="4.5"
          y2="4.5"
          style={{ stroke: token }}
          strokeWidth="2"
          strokeDasharray={dashed ? '4 2' : undefined}
        />
      </svg>
      {label}
    </span>
  )
}
