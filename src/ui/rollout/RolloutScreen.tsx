import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useModelSelector, useModelStoreContext } from '@/store'
import { dayStart, isIsoDay, type Milestone } from '@/model'
import { AddSitesDialog, WaveDialog } from './RolloutDialogs'
import { BurnUp } from './BurnUp'
import { MilestoneDialog, MilestoneSet } from './MilestoneSet'
import { SiteDatesDialog } from './SiteDatesDialog'
import { SiteRegister } from './SiteRegister'
import { WaveBoard } from './WaveBoard'
import { WaveTimeline } from './WaveTimeline'
import { WaveHeading } from './WaveHeading'
import { rolloutData, type RolloutData, type WaveColumn } from './rollout-data'
import '@/ui/inventory/inventory.css'
import '@/ui/graph/graph.css'
import '@/ui/files/files.css'
import '@/ui/factsheet/factsheet.css'
import './rollout.css'

/**
 * A rollout's home (#211, proposal §6 item 1) at `/rollout/:id`: its KPIs,
 * then the register, the board, the timeline, the progress burn-up (#215) and
 * the milestone set as tabs.
 * The register derives each site's phase at today, taken once as the screen
 * mounts, so a phase does not change under the user between two renders. A
 * time point in the URL, `?at=2026-10-23`, takes its place, on every tab: the
 * rollout demo opens at the day it is planned as of (#212). A value that is
 * not a calendar day is ignored, and the screen stays at today.
 *
 * The route keys this screen on `id` (App.tsx), so going from one rollout to
 * another remounts it: no filter, selection, picked-up card or open dialog of
 * the first can carry onto the second (CLAUDE.md, key on the route param).
 * The tab is in the URL, so a tab is a link.
 */

export const TABS = ['register', 'board', 'timeline', 'progress', 'milestones'] as const

/** The search parameter holding the screen's time point, an ISO day. */
export const TIME_POINT_PARAM = 'at'
type Tab = (typeof TABS)[number]
const TAB_LABELS: Record<Tab, string> = {
  register: 'Site register',
  board: 'Wave board',
  timeline: 'Timeline',
  progress: 'Progress',
  milestones: 'Milestones',
}

type Dialog =
  | { kind: 'wave'; wave?: WaveColumn }
  | { kind: 'sites' }
  | { kind: 'milestone'; milestone?: Milestone }
  | { kind: 'dates'; location: string }

export function RolloutScreen() {
  const { id = '' } = useParams()
  const { role } = useModelStoreContext()
  const readOnly = role === 'reader'
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [today] = useState(() => Date.now())
  const atParam = params.get(TIME_POINT_PARAM)
  const asOf = isIsoDay(atParam) ? atParam : undefined
  const at = asOf === undefined ? today : dayStart(asOf)
  const data = useModelSelector((store) => rolloutData(store, id, at), [id, at])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const addWaveRef = useRef<HTMLButtonElement>(null)
  const addMilestoneRef = useRef<HTMLButtonElement>(null)
  const [refocusAddWave, setRefocusAddWave] = useState(false)
  const [refocusAddMilestone, setRefocusAddMilestone] = useState(false)

  // A dialog asked as a writer ends when the tab becomes a reader, and does
  // not reopen when it can write again: its Save would be refused (#198).
  useEffect(() => {
    if (readOnly) setDialog(null)
  }, [readOnly])

  // Deleting a wave unmounts the Edit button that opened the dialog, so focus
  // goes to + Wave, as the delete ends, rather than to <body>.
  useEffect(() => {
    if (!refocusAddWave) return
    addWaveRef.current?.focus()
    setRefocusAddWave(false)
  }, [refocusAddWave])

  // Deleting a milestone unmounts its row's Edit button: focus goes to + Milestone.
  useEffect(() => {
    if (!refocusAddMilestone) return
    addMilestoneRef.current?.focus()
    setRefocusAddMilestone(false)
  }, [refocusAddMilestone])

  const tab = TABS.find((candidate) => candidate === params.get('tab')) ?? 'register'

  if (!data) {
    return (
      <div className="rollout rollout--missing">
        <p className="table__empty">
          No rollout with the id <span className="mono">{id}</span>.{' '}
          <Link to="/rollouts">All rollouts</Link>
        </p>
      </div>
    )
  }

  // A site opens on its Migration tab, at the screen's time point, so the
  // phase there is the one the register shows (#215).
  const openSite = (locationId: string) =>
    navigate(
      `/element/${encodeURIComponent(locationId)}?tab=migration${asOf ? `&${TIME_POINT_PARAM}=${asOf}` : ''}`,
    )

  return (
    <div className="rollout">
      <div className="inventory__head rollout__head">
        <div>
          <p className="rollout__crumb mono">
            <Link to="/rollouts">ROLLOUTS</Link> / {data.rollout.id}
          </p>
          <h1 className="inventory__title">{data.rollout.name}</h1>
          <p className="inventory__result">
            {[
              `${data.sites.length} site${data.sites.length === 1 ? '' : 's'}`,
              `${data.waves.length} wave${data.waves.length === 1 ? '' : 's'}`,
              `template v${data.plan.templateVersion}`,
            ].join(' · ')}
          </p>
        </div>
        <div className="inventory__controls">
          <button
            type="button"
            className="button"
            onClick={() => navigate(`/element/${data.rollout.id}`)}
          >
            Fact sheet
          </button>
          {!readOnly && (
            <>
              <button type="button" className="button" onClick={() => setDialog({ kind: 'sites' })}>
                + Sites
              </button>
              <button
                ref={addWaveRef}
                type="button"
                className="button button--primary"
                onClick={() => setDialog({ kind: 'wave' })}
              >
                + Wave
              </button>
            </>
          )}
        </div>
      </div>

      <Kpis data={data} />

      <nav className="sheet__tabs rollout__tabs" aria-label="Rollout views">
        {TABS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-current={candidate === tab ? 'page' : undefined}
            className={`sheet__tab${candidate === tab ? ' sheet__tab--active' : ''}`}
            onClick={() =>
              setParams(
                (draft) => {
                  if (candidate === 'register') draft.delete('tab')
                  else draft.set('tab', candidate)
                  return draft
                },
                { replace: true },
              )
            }
          >
            {TAB_LABELS[candidate]}
          </button>
        ))}
      </nav>

      <div className="rollout__body">
        {tab === 'register' && (
          <SiteRegister
            data={data}
            readOnly={readOnly}
            onOpen={openSite}
            onEditDates={(location) => setDialog({ kind: 'dates', location })}
            {...(asOf ? { asOf } : {})}
          />
        )}
        {tab === 'board' && (
          <WaveBoard
            data={data}
            readOnly={readOnly}
            onEditWave={(wave) => setDialog({ kind: 'wave', wave })}
          />
        )}
        {tab === 'timeline' && <WaveTimeline data={data} {...(asOf ? { asOf } : {})} />}
        {tab === 'progress' && <BurnUp data={data} {...(asOf ? { asOf } : {})} />}
        {tab === 'milestones' && (
          <MilestoneSet
            data={data}
            readOnly={readOnly}
            addRef={addMilestoneRef}
            onEdit={(milestone) =>
              setDialog({ kind: 'milestone', ...(milestone ? { milestone } : {}) })
            }
          />
        )}
      </div>

      {dialog?.kind === 'wave' && (
        <WaveDialog
          rolloutId={data.rollout.id}
          {...(dialog.wave ? { wave: dialog.wave } : {})}
          defaultCapacity={data.plan.constraints?.defaultCapacity}
          milestones={data.plan.milestones}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null)
            setRefocusAddWave(true)
          }}
        />
      )}
      {dialog?.kind === 'sites' && (
        <AddSitesDialog rolloutId={data.rollout.id} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'milestone' && (
        <MilestoneDialog
          rolloutId={data.rollout.id}
          {...(dialog.milestone ? { milestone: dialog.milestone } : {})}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null)
            setRefocusAddMilestone(true)
          }}
        />
      )}
      {dialog?.kind === 'dates' && (
        <SiteDatesDialog data={data} location={dialog.location} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

/** Sites per wave, unassigned, and sites per region: counts, in mono (proposal §6). */
function Kpis({ data }: { data: RolloutData }) {
  const over = data.waves.filter((wave) => wave.over).length
  return (
    <section className="kpis" aria-label="Rollout KPIs">
      <div className="kpi">
        <span className="section-label">Sites</span>
        <span className="kpi__value mono">{data.sites.length}</span>
      </div>
      <div className="kpi">
        <span className="section-label">Unassigned</span>
        <span className="kpi__value mono" data-testid="kpi-unassigned">
          {data.unassigned.length}
        </span>
      </div>
      <div className="kpi">
        <span className="section-label">Over capacity</span>
        <span className={`kpi__value mono${over ? ' kpi__value--alert' : ''}`}>{over}</span>
      </div>
      <div className="kpi kpi--list">
        <span className="section-label">Sites per wave</span>
        <ul className="kpi__list" aria-label="Sites per wave">
          {data.waves.map((wave) => (
            <li key={wave.element.id} className="kpi__row">
              <WaveHeading wave={wave} className="kpi__key" />
              <span className={`kpi__count mono${wave.over ? ' kpi__count--alert' : ''}`}>
                {wave.capacity === undefined
                  ? wave.sites.length
                  : `${wave.sites.length} / ${wave.capacity}`}
              </span>
            </li>
          ))}
          {!data.waves.length && <li className="kpi__row kpi__none">No waves yet</li>}
        </ul>
      </div>
      <div className="kpi kpi--list">
        <span className="section-label">Sites per region</span>
        <ul className="kpi__list" aria-label="Sites per region">
          {data.regions.map((region) => (
            <li key={region.name} className="kpi__row">
              <span className="kpi__key">{region.name}</span>
              <span className="kpi__count mono">{region.count}</span>
            </li>
          ))}
          {!data.regions.length && <li className="kpi__row kpi__none">No sites yet</li>}
        </ul>
      </div>
    </section>
  )
}
