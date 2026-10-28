import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SITE_PHASE_LABELS, formatPlanDate } from '@/model'
import { assignSites, unassignSites, useModelStore } from '@/store'
import { LIST_WINDOW } from '@/ui/inventory/list-window'
import { WaveHeading } from './WaveHeading'
import {
  RAG_TOKENS,
  SITE_PHASE_TOKENS,
  sourceText,
  waveHeading,
  type RolloutData,
  type SiteRow,
  type WaveColumn,
} from './rollout-data'

/**
 * The site register (#211, proposal §6 item 2): the inventory table scoped to
 * the rollout's Locations, with the rollout's columns: wave, archetype,
 * cutover, the derived phase today, and RAG. It is the inventory's table, in its classes and its
 * virtualisation above `LIST_WINDOW`, with a selection column in front.
 *
 * **Assigning the selection to a wave is one command**, however many sites
 * are selected: one undo puts every one of them back. A reader has no
 * selection column and no bulk bar, and becoming one clears the selection.
 *
 * Cutover is the site's resolved date for the milestone it switches over at
 * (`switchMilestone`), and says whether the site sets it or inherits it
 * (#213). The phase is derived at today, never stored; a writer's Dates
 * button opens the site's own dates.
 */

const COLUMNS_WRITER = '28px 72px minmax(0,1.6fr) 100px 100px 150px 130px 72px minmax(0,1fr) 64px'
const COLUMNS_READER = '72px minmax(0,1.6fr) 100px 100px 150px 130px 72px minmax(0,1fr)'

/**
 * The selects' values. A wave's is its id behind a prefix, and the two
 * choices that are no wave have no prefix, so no id can be taken for either
 * of them: an id of `*` or `` is a wave like any other (#223).
 */
const ALL = 'all'
const NO_WAVE = 'none'
const WAVE = 'wave:'
const waveOption = (id: string) => `${WAVE}${id}`
/** The wave id an option names, or `undefined` for All and No wave. */
const waveOfOption = (value: string) =>
  value.startsWith(WAVE) ? value.slice(WAVE.length) : undefined

export function SiteRegister({
  data,
  readOnly,
  onOpen,
  onEditDates,
}: {
  data: RolloutData
  readOnly: boolean
  onOpen: (locationId: string) => void
  onEditDates: (locationId: string) => void
}) {
  const store = useModelStore()
  const [query, setQuery] = useState('')
  const [waveFilter, setWaveFilter] = useState(ALL)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [target, setTarget] = useState(NO_WAVE)

  // Selecting is the first half of a bulk write; a reader cannot finish it.
  useEffect(() => {
    if (readOnly) setSelected(new Set())
  }, [readOnly])

  const waves = useMemo(
    () => new Map<string, WaveColumn>(data.waves.map((wave) => [wave.element.id, wave])),
    [data.waves],
  )
  // A chosen wave that has since gone (deleted, or undone) is no choice: a
  // select shows its first option, so that is what it drives, and Assign
  // never hands the store a dead id it would refuse in silence (#223).
  const live = (value: string, first: string) => {
    const wave = waveOfOption(value)
    return wave !== undefined && !waves.has(wave) ? first : value
  }
  const liveTarget = live(target, NO_WAVE)
  const liveFilter = live(waveFilter, ALL)
  const filterWave = waveOfOption(liveFilter)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.sites.filter((site) => {
      const option = site.wave === undefined ? NO_WAVE : waveOption(site.wave)
      if (liveFilter !== ALL && option !== liveFilter) return false
      if (!needle) return true
      return `${site.code ?? ''} ${site.name}`.toLowerCase().includes(needle)
    })
  }, [data.sites, query, liveFilter])

  // A site that left the rollout leaves the selection with it.
  const selection = data.sites.filter((site) => selected.has(site.location))
  const allShownSelected = shown.length > 0 && shown.every((site) => selected.has(site.location))

  const toggle = (location: string) =>
    setSelected((was) => {
      const next = new Set(was)
      if (next.has(location)) next.delete(location)
      else next.add(location)
      return next
    })

  const assign = () => {
    const locations = selection.map((site) => site.location)
    if (!locations.length) return
    const wave = waveOfOption(liveTarget)
    const done =
      wave === undefined
        ? unassignSites(store, data.rollout.id, locations)
        : assignSites(store, data.rollout.id, locations, wave)
    if (done) setSelected(new Set())
  }

  const columns = readOnly ? COLUMNS_READER : COLUMNS_WRITER
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualise = shown.length > LIST_WINDOW
  const virtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 38,
    overscan: 12,
    enabled: virtualise,
  })

  const row = (site: SiteRow) => (
    <RegisterRow
      key={site.location}
      site={site}
      columns={columns}
      readOnly={readOnly}
      selected={selected.has(site.location)}
      wave={site.wave === undefined ? undefined : waves.get(site.wave)}
      milestones={data.plan.milestones}
      onToggle={() => toggle(site.location)}
      onOpen={onOpen}
      onEditDates={onEditDates}
    />
  )

  return (
    <div className="register">
      <div className="register__controls">
        <input
          className="inventory__filter"
          placeholder="Filter by code or name…"
          aria-label="Filter sites by code or name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="register__select"
          aria-label="Show wave"
          value={liveFilter}
          onChange={(event) => setWaveFilter(event.target.value)}
        >
          <option value={ALL}>All waves</option>
          <option value={NO_WAVE}>Unassigned</option>
          {data.waves.map((wave) => (
            <option key={wave.element.id} value={waveOption(wave.element.id)}>
              {waveHeading(wave).text}
            </option>
          ))}
        </select>
        <span className="register__count mono">{`${shown.length} of ${data.sites.length} sites`}</span>
      </div>

      {liveFilter !== ALL && (
        <div className="chips">
          <button type="button" className="chip" onClick={() => setWaveFilter(ALL)}>
            <span className="chip__group">Wave</span>
            <span className="chip__value">
              {filterWave === undefined ? (
                'Unassigned'
              ) : (
                <WaveHeading wave={waves.get(filterWave)!} />
              )}
            </span>
            <span className="chip__remove" aria-hidden="true">
              ×
            </span>
            <span className="visually-hidden">Remove filter</span>
          </button>
        </div>
      )}

      {!readOnly && selection.length > 0 && (
        <div className="register__bulk" role="group" aria-label="Selected sites">
          <span className="mono">{`${selection.length} selected`}</span>
          <label className="register__bulk-field">
            <span className="section-label">Assign to</span>
            <select
              className="register__select"
              aria-label="Assign to wave"
              value={liveTarget}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value={NO_WAVE}>No wave</option>
              {data.waves.map((wave) => (
                <option key={wave.element.id} value={waveOption(wave.element.id)}>
                  {waveHeading(wave).text}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button button--primary" onClick={assign}>
            Assign
          </button>
          <button type="button" className="button" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className="table">
        <div className="table__header" style={{ gridTemplateColumns: columns }} role="row">
          {!readOnly && (
            <input
              type="checkbox"
              aria-label="Select every site shown"
              checked={allShownSelected}
              disabled={!shown.length}
              onChange={() =>
                setSelected((was) => {
                  const next = new Set(was)
                  for (const site of shown) {
                    if (allShownSelected) next.delete(site.location)
                    else next.add(site.location)
                  }
                  return next
                })
              }
            />
          )}
          <span>Code</span>
          <span>Site</span>
          <span>Wave</span>
          <span>Archetype</span>
          <span>Cutover</span>
          <span>Phase today</span>
          <span>RAG</span>
          <span>Region</span>
          {!readOnly && <span />}
        </div>
        {shown.length === 0 ? (
          <p className="table__empty">
            {data.sites.length ? 'No site matches this filter.' : 'No sites in this rollout yet.'}
          </p>
        ) : (
          <div className="table__scroll" ref={scrollRef}>
            {virtualise ? (
              <div className="table__virtual" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const site = shown[item.index]
                  if (!site) return null
                  return (
                    <div
                      key={site.location}
                      className="table__virtual-row"
                      style={{ transform: `translateY(${item.start}px)` }}
                      ref={virtualizer.measureElement}
                      data-index={item.index}
                    >
                      {row(site)}
                    </div>
                  )
                })}
              </div>
            ) : (
              shown.map(row)
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function RegisterRow({
  site,
  columns,
  readOnly,
  selected,
  wave,
  milestones,
  onToggle,
  onOpen,
  onEditDates,
}: {
  site: SiteRow
  columns: string
  readOnly: boolean
  selected: boolean
  wave: WaveColumn | undefined
  milestones: RolloutData['plan']['milestones']
  onToggle: () => void
  onOpen: (locationId: string) => void
  onEditDates: (locationId: string) => void
}) {
  const cutover = site.cutover?.planned ? site.cutover : undefined
  return (
    <div
      className={`table__row register__row${selected ? ' table__row--selected' : ''}`}
      style={{ gridTemplateColumns: columns }}
      data-location={site.location}
    >
      {!readOnly && (
        <input
          type="checkbox"
          aria-label={`Select ${site.code ?? site.name}`}
          checked={selected}
          onChange={onToggle}
        />
      )}
      <span className="register__code mono">{site.code ?? '—'}</span>
      {site.element ? (
        <button type="button" className="register__name" onClick={() => onOpen(site.location)}>
          {site.name}
        </button>
      ) : (
        <span className="register__name register__name--missing" title={site.location}>
          {`${site.name} · `}
          <span className="mono">{site.location}</span>
        </span>
      )}
      {wave ? (
        <WaveHeading wave={wave} className="register__mono" />
      ) : (
        <span className="register__mono mono">—</span>
      )}
      <span className="table__secondary">{site.archetype ?? '—'}</span>
      {cutover?.planned ? (
        <span
          className="register__date"
          data-source={cutover.source}
          title={`${cutover.milestone.label}: ${sourceText(cutover, wave ? waveHeading(wave).text : undefined, milestones)}`}
        >
          <span className="mono">{formatPlanDate(cutover.planned)}</span>
          <PlanSource set={cutover.source === 'site'} />
        </span>
      ) : (
        <span className="register__mono mono">—</span>
      )}
      <span className="register__phase" data-phase={site.phase}>
        <span
          className="register__phase-dot"
          style={{ background: SITE_PHASE_TOKENS[site.phase] }}
          aria-hidden="true"
        />
        {SITE_PHASE_LABELS[site.phase]}
        {site.overdue && <span className="register__overdue mono">OVERDUE</span>}
      </span>
      <span className="register__rag mono">
        {site.rag ? (
          <>
            <span
              className="register__rag-dot"
              style={{ background: RAG_TOKENS[site.rag] }}
              aria-hidden="true"
            />
            {site.rag.toUpperCase()}
          </>
        ) : (
          '—'
        )}
      </span>
      <span className="table__secondary">{site.region ?? '—'}</span>
      {!readOnly && (
        <button
          type="button"
          className="register__dates"
          aria-label={`Dates of ${site.code ?? site.name}`}
          onClick={() => onEditDates(site.location)}
        >
          Dates
        </button>
      )}
    </div>
  )
}

/** Whether a date is the site's own or inherited: said in words, never by colour alone (#213). */
export function PlanSource({ set }: { set: boolean }) {
  return (
    <span className={`plan-source${set ? ' plan-source--set' : ''}`}>
      {set ? 'set' : 'inherited'}
    </span>
  )
}
