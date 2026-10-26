import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatPlanDate, type SiteRag } from '@/model'
import { assignSites, unassignSites, useModelStore } from '@/store'
import { LIST_WINDOW } from '@/ui/inventory/list-window'
import type { RolloutData, SiteRow } from './rollout-data'

/**
 * The site register (#211, proposal §6 item 2): the inventory table scoped to
 * the rollout's Locations, with the rollout's columns: wave, archetype,
 * cutover and RAG. It is the inventory's table, in its classes and its
 * virtualisation above `LIST_WINDOW`, with a selection column in front.
 *
 * **Assigning the selection to a wave is one command**, however many sites
 * are selected: one undo puts every one of them back. A reader has no
 * selection column and no bulk bar, and becoming one clears the selection.
 *
 * Cutover is a site's own date for the milestone that starts the cutover
 * phase. Inherited dates are #213's, so a site that sets none shows `—`.
 */

const COLUMNS_WRITER = '28px 72px minmax(0,1.6fr) 120px 110px 108px 72px minmax(0,1fr)'
const COLUMNS_READER = '72px minmax(0,1.6fr) 120px 110px 108px 72px minmax(0,1fr)'
const NO_WAVE = ''
const ALL = '*'

const RAG_TOKENS: Record<SiteRag, string> = {
  green: 'var(--lc-act)',
  amber: 'var(--lc-out)',
  red: 'var(--lc-eol)',
}

export function SiteRegister({
  data,
  readOnly,
  onOpen,
}: {
  data: RolloutData
  readOnly: boolean
  onOpen: (locationId: string) => void
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

  const waveLabels = useMemo(
    () =>
      new Map(data.waves.map((wave) => [wave.element.id, wave.plan.label || wave.element.name])),
    [data.waves],
  )

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return data.sites.filter((site) => {
      if (waveFilter !== ALL && (site.wave ?? NO_WAVE) !== waveFilter) return false
      if (!needle) return true
      return `${site.code ?? ''} ${site.name}`.toLowerCase().includes(needle)
    })
  }, [data.sites, query, waveFilter])

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
    const done =
      target === NO_WAVE
        ? unassignSites(store, data.rollout.id, locations)
        : assignSites(store, data.rollout.id, locations, target)
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
      waveLabel={site.wave ? waveLabels.get(site.wave) : undefined}
      onToggle={() => toggle(site.location)}
      onOpen={onOpen}
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
          value={waveFilter}
          onChange={(event) => setWaveFilter(event.target.value)}
        >
          <option value={ALL}>All waves</option>
          <option value={NO_WAVE}>Unassigned</option>
          {data.waves.map((wave) => (
            <option key={wave.element.id} value={wave.element.id}>
              {wave.plan.label || wave.element.name}
            </option>
          ))}
        </select>
        <span className="register__count mono">{`${shown.length} of ${data.sites.length} sites`}</span>
      </div>

      {waveFilter !== ALL && (
        <div className="chips">
          <button type="button" className="chip" onClick={() => setWaveFilter(ALL)}>
            <span className="chip__group">Wave</span>
            <span className="chip__value">
              {waveFilter === NO_WAVE ? 'Unassigned' : waveLabels.get(waveFilter)}
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
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value={NO_WAVE}>No wave</option>
              {data.waves.map((wave) => (
                <option key={wave.element.id} value={wave.element.id}>
                  {wave.plan.label || wave.element.name}
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
          <span>RAG</span>
          <span>Region</span>
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
  waveLabel,
  onToggle,
  onOpen,
}: {
  site: SiteRow
  columns: string
  readOnly: boolean
  selected: boolean
  waveLabel: string | undefined
  onToggle: () => void
  onOpen: (locationId: string) => void
}) {
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
      <span className="register__mono mono">{waveLabel ?? '—'}</span>
      <span className="table__secondary">{site.archetype ?? '—'}</span>
      <span className="register__mono mono">
        {site.cutover ? formatPlanDate(site.cutover) : '—'}
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
    </div>
  )
}
