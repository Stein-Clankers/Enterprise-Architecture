import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SITE_PHASE_LABELS, formatPlanDate, type SiteException } from '@/model'
import { useModelSelector } from '@/store'
import { WaveHeading } from './WaveHeading'
import { PlanSource } from './SiteRegister'
import { SiteDatesDialog } from './SiteDatesDialog'
import { SiteProgressDialog } from './SiteProgressDialog'
import {
  GO_NO_GO_LABELS,
  RAG_TOKENS,
  type SiteRow,
  SITE_PHASE_TOKENS,
  siteRollouts,
  sourceText,
  waveHeading,
  type RolloutData,
} from './rollout-data'
import './rollout.css'

/**
 * The site fact sheet's Migration tab (#215, proposal §6 item 7): one block
 * for each rollout the Location is a site of, with its wave, archetype, phase
 * at the time point, RAG and go/no-go, and every milestone's planned date
 * (set or inherited) beside its actual day.
 *
 * The phase is derived at `at`, never stored. The tab lives in the fact sheet,
 * which the route keys on the element id (App.tsx), so going from one site to
 * another remounts it: no open dialog or draft of one site reaches the next
 * (CLAUDE.md, key on the route param).
 *
 * Its edits are the rollout screens' own dialogs, each one command on save.
 * A reader sees no edit button, and a dialog open as a writer closes when the
 * tab becomes a reader and does not reopen (CLAUDE.md, reader rules).
 *
 * Each block also shows the site's exceptions and dependencies (proposal
 * §4.4, ADR 0017) and the plan checks' findings about the site (#214) at the
 * same time point. They are read here; the workbook's Exceptions and
 * Dependencies sheets edit them.
 */

type Dialog = { kind: 'dates' | 'progress'; rollout: string }

export function SiteMigration({
  locationId,
  at,
  asOf,
  readOnly,
}: {
  locationId: string
  /** The time point, UTC ms. */
  at: number
  /** The time point's day when the URL names one (`?at=`), for the words and the links. */
  asOf: string | undefined
  readOnly: boolean
}) {
  const rollouts = useModelSelector((s) => siteRollouts(s, locationId, at), [locationId, at])
  const [dialog, setDialog] = useState<Dialog | null>(null)

  // A dialog opened as a writer ends when the tab becomes a reader, and does
  // not reopen when it can write again: its Save would be refused (#198).
  // Neither dialog writes on blur or on unmount, only on Save, so it needs no
  // render gate for the one commit it stays on screen as a reader's: the test
  // with `TakesFocusAsReader` is that commit.
  useEffect(() => {
    if (readOnly) setDialog(null)
  }, [readOnly])

  const open = dialog ? rollouts.find((r) => r.rollout.id === dialog.rollout) : undefined
  const query = asOf ? `?at=${asOf}` : ''

  if (!rollouts.length) {
    return <p className="appears-in__empty">This Location is a site of no rollout.</p>
  }

  return (
    <div className="migration">
      {rollouts.map((data) => (
        <MigrationBlock
          key={data.rollout.id}
          data={data}
          locationId={locationId}
          asOf={asOf}
          query={query}
          readOnly={readOnly}
          onEdit={(kind) => setDialog({ kind, rollout: data.rollout.id })}
        />
      ))}
      {open && dialog?.kind === 'dates' && (
        <SiteDatesDialog data={open} location={locationId} onClose={() => setDialog(null)} />
      )}
      {open && dialog?.kind === 'progress' && (
        <SiteProgressDialog data={open} location={locationId} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

function MigrationBlock({
  data,
  locationId,
  asOf,
  query,
  readOnly,
  onEdit,
}: {
  data: RolloutData
  locationId: string
  asOf: string | undefined
  query: string
  readOnly: boolean
  onEdit: (kind: Dialog['kind']) => void
}) {
  const site = data.sites.find((candidate) => candidate.location === locationId)!
  const plan = data.plan.sites.find((candidate) => candidate.location === locationId)!
  const wave = data.waves.find((column) => column.element.id === site.wave)
  const waveLabel = wave ? waveHeading(wave).text : undefined
  const name = data.rollout.name
  return (
    <section
      className="migration__block"
      aria-label={`Migration in ${name}`}
      data-rollout={data.rollout.id}
    >
      <div className="migration__head">
        <Link
          className="migration__rollout"
          to={`/rollout/${encodeURIComponent(data.rollout.id)}${query}`}
        >
          {name}
        </Link>
        {!readOnly && (
          <div className="migration__actions">
            <button
              type="button"
              className="button"
              aria-label={`Dates in ${name}`}
              onClick={() => onEdit('dates')}
            >
              Dates…
            </button>
            <button
              type="button"
              className="button"
              aria-label={`Progress in ${name}`}
              onClick={() => onEdit('progress')}
            >
              Progress…
            </button>
          </div>
        )}
      </div>
      <dl className="migration__facts">
        <div>
          <dt className="section-label">Wave</dt>
          <dd data-fact="wave">
            {wave ? <WaveHeading wave={wave} /> : <span className="migration__none">No wave</span>}
          </dd>
        </div>
        <div>
          <dt className="section-label">Archetype</dt>
          {/* Shown whole, never cut short: "Standard (placeholder)" says its durations are ours (ADR 0016 point 7). */}
          <dd data-fact="archetype" className="migration__archetype">
            {site.archetype ?? <span className="migration__none">None</span>}
          </dd>
        </div>
        <div>
          <dt className="section-label">{asOf ? `Phase at ${asOf}` : 'Phase today'}</dt>
          <dd data-fact="phase" data-phase={site.phase} className="register__phase">
            <span
              className="register__phase-dot"
              style={{ background: SITE_PHASE_TOKENS[site.phase] }}
              aria-hidden="true"
            />
            {SITE_PHASE_LABELS[site.phase]}
            {site.overdue && <span className="register__overdue mono">OVERDUE</span>}
          </dd>
        </div>
        <div>
          <dt className="section-label">RAG</dt>
          <dd data-fact="rag" className="mono">
            {site.rag ? (
              <span className="register__phase">
                <span
                  className="register__phase-dot"
                  style={{ background: RAG_TOKENS[site.rag] }}
                  aria-hidden="true"
                />
                {site.rag.toUpperCase()}
              </span>
            ) : (
              <span className="migration__none">Not rated</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="section-label">Go/no-go</dt>
          <dd data-fact="go-no-go">
            {plan.goNoGo ? (
              <span className="mono">{GO_NO_GO_LABELS[plan.goNoGo].toUpperCase()}</span>
            ) : (
              <span className="migration__none">Not decided</span>
            )}
          </dd>
        </div>
      </dl>
      <table className="migration__milestones" aria-label={`Milestones in ${name}`}>
        <thead>
          <tr>
            <th scope="col">Milestone</th>
            <th scope="col">Planned</th>
            <th scope="col">Actual</th>
          </tr>
        </thead>
        <tbody>
          {site.milestones.map((resolved) => (
            <tr key={resolved.milestone.id} data-milestone={resolved.milestone.id}>
              <th scope="row">{resolved.milestone.label}</th>
              <td
                data-source={resolved.source ?? 'none'}
                title={sourceText(resolved, waveLabel, data.plan.milestones)}
              >
                {resolved.planned ? (
                  <span className="register__date">
                    <span className="mono">{formatPlanDate(resolved.planned)}</span>
                    <PlanSource set={resolved.source === 'site'} />
                  </span>
                ) : (
                  <span className="mono">—</span>
                )}
              </td>
              <td className="mono" data-actual={resolved.actual ?? ''}>
                {resolved.actual ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Exceptions data={data} exceptions={plan.exceptions ?? []} />
      <Dependencies data={data} locationId={locationId} query={query} />
      <SiteFindings data={data} locationId={locationId} />
    </section>
  )
}

const EXCEPTION_KIND_LABELS: Record<SiteException['kind'], string> = {
  skip: 'Skips',
  modify: 'Modifies',
  add: 'Adds',
}

/** What an exception changes: a template change by its id, or the site's own entry. */
function exceptionChange(exception: SiteException): string {
  if (exception.kind !== 'add') return exception.change
  return `${exception.change.kind} ${exception.change.subject} (site only)`
}

function Exceptions({
  data,
  exceptions,
}: {
  data: RolloutData
  exceptions: readonly SiteException[]
}) {
  const name = data.rollout.name
  return (
    <section className="migration__part" aria-label={`Exceptions in ${name}`}>
      <h3 className="section-label">Exceptions</h3>
      {exceptions.length ? (
        <table className="migration__milestones">
          <thead>
            <tr>
              <th scope="col">Exception</th>
              <th scope="col">Change</th>
              <th scope="col">Class</th>
              <th scope="col">Owner</th>
              <th scope="col">Expires</th>
            </tr>
          </thead>
          <tbody>
            {exceptions.map((exception) => (
              <tr key={exception.id} data-exception={exception.id}>
                <th scope="row">
                  {EXCEPTION_KIND_LABELS[exception.kind]}{' '}
                  <span className="mono migration__id">{exception.id}</span>
                </th>
                <td className="mono" data-field="change">
                  {exceptionChange(exception)}
                </td>
                <td className="mono" data-field="class">
                  {exception.class}
                </td>
                <td data-field="owner">
                  {exception.owner ?? <span className="migration__none">No owner</span>}
                </td>
                <td className="mono" data-field="expires">
                  {exception.expires ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="migration__empty">No exceptions: the site follows the template.</p>
      )}
    </section>
  )
}

/** A site of the rollout by its code or name, linked to its own Migration tab. */
function SiteLink({ row, id, query }: { row: SiteRow | undefined; id: string; query: string }) {
  const params = query ? `${query}&tab=migration` : '?tab=migration'
  return (
    <Link to={`/element/${encodeURIComponent(id)}${params}`} data-site={id}>
      {row ? (row.code ?? row.name) : <span className="mono">{id}</span>}
    </Link>
  )
}

function Dependencies({
  data,
  locationId,
  query,
}: {
  data: RolloutData
  locationId: string
  query: string
}) {
  const name = data.rollout.name
  const rows = new Map(data.sites.map((row) => [row.location, row]))
  const own = data.plan.sites.find((site) => site.location === locationId)?.dependsOn ?? []
  const of = data.plan.sites
    .filter((site) => site.dependsOn?.includes(locationId))
    .map((site) => site.location)
  const list = (ids: readonly string[], key: string, empty: string) =>
    ids.length ? (
      <ul className="migration__sites" data-dependencies={key}>
        {ids.map((id) => (
          <li key={id}>
            <SiteLink row={rows.get(id)} id={id} query={query} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="migration__empty" data-dependencies={key}>
        {empty}
      </p>
    )
  return (
    <section className="migration__part" aria-label={`Dependencies in ${name}`}>
      <h3 className="section-label">Cuts over after</h3>
      {list(own, 'on', 'No site must cut over before this one.')}
      <h3 className="section-label">Cuts over before</h3>
      {list(of, 'of', 'No site waits for this one.')}
    </section>
  )
}

function SiteFindings({ data, locationId }: { data: RolloutData; locationId: string }) {
  const name = data.rollout.name
  const findings = data.checks.filter((finding) => finding.subjectId === locationId)
  return (
    <section className="migration__part" aria-label={`Plan checks in ${name}`}>
      <h3 className="section-label">Plan checks</h3>
      {findings.length ? (
        <ul className="migration__findings">
          {findings.map((finding, index) => (
            <li
              key={`${finding.code}:${index}`}
              data-code={finding.code}
              data-severity={finding.severity}
            >
              <span>{finding.message}</span>{' '}
              <span className="mono migration__id">{finding.code}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="migration__empty">No plan check finds anything about this site.</p>
      )}
    </section>
  )
}
