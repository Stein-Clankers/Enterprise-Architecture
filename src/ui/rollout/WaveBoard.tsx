import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { formatPlanDate } from '@/model'
import { assignSites, unassignSites, useModelStore } from '@/store'
import { LIST_WINDOW } from '@/ui/inventory/list-window'
import type { RolloutData, SiteRow, WaveColumn } from './rollout-data'

/**
 * The wave board (#211, proposal §6 item 3): a column per wave, with the
 * unassigned sites first. Each column shows its window and a capacity bar, and
 * says when it is over capacity. A card is a site: its code in mono, its name
 * and its archetype.
 *
 * Moving a card is one command, by either path:
 * - **drag and drop** onto another column;
 * - **the keyboard:** Space or Enter picks the focused card up, ← and → choose
 *   the column, Space or Enter drops it there, and Escape puts it back.
 *
 * Either way focus lands on the moved card in its new column, because the
 * card the user was holding is where their next key belongs.
 *
 * As a reader the board has no drag handles and nothing picks up. Becoming a
 * reader mid-drag or with a card picked up ends that mode: a drop after the
 * switch finds nothing in hand (CLAUDE.md, reader rules).
 *
 * Above `LIST_WINDOW` sites each column virtualises, as the inventory table
 * does, so a 160-site rollout hands the browser a screenful of cards.
 */

/** A card's height plus the gap below it; the virtualiser's row size. */
export const CARD_PITCH = 64

interface Picked {
  location: string
  from: number
  target: number
}

export function WaveBoard({
  data,
  readOnly,
  onEditWave,
}: {
  data: RolloutData
  readOnly: boolean
  onEditWave: (wave: WaveColumn) => void
}) {
  const store = useModelStore()
  const columns: { wave: WaveColumn | undefined; sites: SiteRow[] }[] = [
    { wave: undefined, sites: data.unassigned },
    ...data.waves.map((wave) => ({ wave, sites: wave.sites })),
  ]
  const virtualise = data.sites.length > LIST_WINDOW

  const [picked, setPicked] = useState<Picked | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [focusRequest, setFocusRequest] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // A reader holds nothing: the switch ends a pick-up and a drag, and they do
  // not come back when the tab can write again.
  useEffect(() => {
    if (!readOnly) return
    setPicked(null)
    setDragging(null)
    setDragOver(null)
  }, [readOnly])

  const columnName = (index: number) => {
    const wave = columns[index]?.wave
    return wave ? wave.plan.label || wave.element.name : 'Unassigned'
  }
  const siteName = (location: string) => {
    const site = data.sites.find((candidate) => candidate.location === location)
    return site ? (site.code ?? site.name) : location
  }

  const move = (location: string, to: number) => {
    const column = columns[to]
    if (!column) return
    const done = column.wave
      ? assignSites(store, data.rollout.id, [location], column.wave.element.id)
      : unassignSites(store, data.rollout.id, [location])
    if (!done) return
    setFocusRequest(location)
    setAnnouncement(`${siteName(location)} moved to ${columnName(to)}.`)
  }

  const onCardKeyDown = (event: KeyboardEvent, site: SiteRow, column: number, index: number) => {
    const holding = picked?.location === site.location ? picked : null
    const key = event.key
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (holding) return
      event.preventDefault()
      const next = columns[column]?.sites[index + (key === 'ArrowDown' ? 1 : -1)]
      if (next) setFocusRequest(next.location)
      return
    }
    if (readOnly) return
    if (key === ' ' || key === 'Enter') {
      event.preventDefault()
      if (!holding) {
        setPicked({ location: site.location, from: column, target: column })
        setAnnouncement(
          `${siteName(site.location)} picked up from ${columnName(column)}. ← and → choose a wave, Enter drops, Escape cancels.`,
        )
      } else {
        setPicked(null)
        if (holding.target === holding.from) setAnnouncement('Put back.')
        else move(site.location, holding.target)
      }
    } else if (holding && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault()
      const target = Math.min(
        Math.max(holding.target + (key === 'ArrowRight' ? 1 : -1), 0),
        columns.length - 1,
      )
      setPicked({ ...holding, target })
      setAnnouncement(`Over ${columnName(target)}.`)
    } else if (holding && key === 'Escape') {
      event.preventDefault()
      setPicked(null)
      setAnnouncement('Put back.')
    }
  }

  const onFocused = useCallback(() => setFocusRequest(null), [])

  return (
    <div className="board">
      <p className="visually-hidden" aria-live="assertive">
        {announcement}
      </p>
      {!readOnly && (
        <p className="board__hint" id="board-hint">
          Drag a card to a wave, or focus it and press Space: ← → choose the wave, Space drops,
          Escape cancels.
        </p>
      )}
      <div className="board__columns">
        {columns.map((column, index) => (
          <BoardColumn
            key={column.wave?.element.id ?? 'unassigned'}
            index={index}
            wave={column.wave}
            sites={column.sites}
            readOnly={readOnly}
            virtualise={virtualise}
            picked={picked}
            dropTarget={dragging !== null && dragOver === index}
            focusRequest={focusRequest}
            onFocused={onFocused}
            onCardKeyDown={onCardKeyDown}
            onEditWave={onEditWave}
            onDragStart={(location) => setDragging(location)}
            onDragEnd={() => {
              setDragging(null)
              setDragOver(null)
            }}
            onDragOver={(event) => {
              // Nothing is in hand for a reader: its cards do not drag, and
              // the switch to reader drops what was.
              if (dragging === null) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (dragOver !== index) setDragOver(index)
            }}
            onDrop={(event) => {
              event.preventDefault()
              const location = dragging
              setDragging(null)
              setDragOver(null)
              // Nothing in hand after a reader switch: the drag ended with it.
              if (location === null) return
              const from = columns.findIndex((candidate) =>
                candidate.sites.some((site) => site.location === location),
              )
              if (from !== index) move(location, index)
            }}
            onBlurCard={(location) => {
              if (picked?.location === location) setPicked(null)
            }}
          />
        ))}
      </div>
    </div>
  )
}

interface BoardColumnProps {
  index: number
  wave: WaveColumn | undefined
  sites: SiteRow[]
  readOnly: boolean
  virtualise: boolean
  picked: Picked | null
  dropTarget: boolean
  focusRequest: string | null
  onFocused: () => void
  onCardKeyDown: (event: KeyboardEvent, site: SiteRow, column: number, index: number) => void
  onEditWave: (wave: WaveColumn) => void
  onDragStart: (location: string) => void
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
  onBlurCard: (location: string) => void
}

function BoardColumn({
  index,
  wave,
  sites,
  readOnly,
  virtualise,
  picked,
  dropTarget,
  focusRequest,
  onFocused,
  onCardKeyDown,
  onEditWave,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onBlurCard,
}: BoardColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const cards = useRef(new Map<string, HTMLElement>())
  const virtualizer = useVirtualizer({
    count: sites.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_PITCH,
    overscan: 6,
    enabled: virtualise,
  })

  // A requested card is focused once it is on screen: at once when it is, or
  // after the virtualiser has scrolled it into the window.
  useEffect(() => {
    if (focusRequest === null) return
    const at = sites.findIndex((site) => site.location === focusRequest)
    if (at < 0) return
    const card = cards.current.get(focusRequest)
    if (card) {
      card.focus()
      onFocused()
    } else if (virtualise) {
      virtualizer.scrollToIndex(at, { align: 'center' })
    }
  })

  const label = wave ? wave.plan.label || wave.element.name : 'Unassigned'
  const target = picked !== null && picked.target === index
  const window = wave?.plan.window
  const count = sites.length
  const capacity = wave?.capacity

  const renderCard = (site: SiteRow, at: number) => (
    <BoardCard
      key={site.location}
      site={site}
      readOnly={readOnly}
      held={picked?.location === site.location}
      cardRef={(node) => {
        if (node) cards.current.set(site.location, node)
        else cards.current.delete(site.location)
      }}
      onKeyDown={(event) => onCardKeyDown(event, site, index, at)}
      onDragStart={() => onDragStart(site.location)}
      onDragEnd={onDragEnd}
      onBlur={() => onBlurCard(site.location)}
    />
  )

  return (
    <section
      className={`board__column${target || dropTarget ? ' board__column--target' : ''}${wave?.over ? ' board__column--over' : ''}`}
      aria-label={`${label}: ${count} site${count === 1 ? '' : 's'}${capacity === undefined ? '' : ` of ${capacity}`}${wave?.over ? ', over capacity' : ''}`}
      data-column={wave?.element.id ?? 'unassigned'}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <header className="board__head">
        <div className="board__title-row">
          <span className="board__label mono">{label}</span>
          {wave && wave.plan.label && wave.plan.label !== wave.element.name && (
            <span className="board__name">{wave.element.name}</span>
          )}
          {wave && !readOnly && (
            <button
              type="button"
              className="board__edit"
              onClick={() => onEditWave(wave)}
              aria-label={`Edit ${label}`}
            >
              Edit
            </button>
          )}
        </div>
        <div className="board__window mono">
          {wave
            ? window?.start || window?.end
              ? `${window.start ? formatPlanDate(window.start) : '…'} → ${window.end ? formatPlanDate(window.end) : '…'}`
              : 'No window'
            : 'In no wave'}
        </div>
        <div className="board__load">
          <span className="board__count mono">
            {capacity === undefined ? `${count}` : `${count} / ${capacity}`}
          </span>
          {wave?.over && capacity !== undefined && (
            <span className="board__over mono">{`OVER +${count - capacity}`}</span>
          )}
        </div>
        {/* Drawn empty without a capacity, so every column's cards start level. */}
        <span
          className={`board__bar${capacity === undefined ? ' board__bar--none' : ''}`}
          aria-hidden="true"
        >
          {capacity !== undefined && (
            <span
              className="board__bar-fill"
              style={{ width: `${Math.min(count / capacity, 1) * 100}%` }}
            />
          )}
        </span>
      </header>
      <div className="board__cards" ref={scrollRef}>
        {virtualise ? (
          <div className="board__virtual" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const site = sites[item.index]
              if (!site) return null
              return (
                <div
                  key={site.location}
                  className="board__virtual-row"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {renderCard(site, item.index)}
                </div>
              )
            })}
          </div>
        ) : (
          sites.map(renderCard)
        )}
        {count === 0 && <p className="board__empty">No sites</p>}
      </div>
    </section>
  )
}

function BoardCard({
  site,
  readOnly,
  held,
  cardRef,
  onKeyDown,
  onDragStart,
  onDragEnd,
  onBlur,
}: {
  site: SiteRow
  readOnly: boolean
  held: boolean
  cardRef: (node: HTMLElement | null) => void
  onKeyDown: (event: KeyboardEvent) => void
  onDragStart: () => void
  onDragEnd: () => void
  onBlur: () => void
}) {
  const content = (
    <>
      <span className="board-card__top">
        <span className="board-card__code mono">{site.code ?? '—'}</span>
        {site.archetype && <span className="board-card__archetype">{site.archetype}</span>}
      </span>
      <span className="board-card__name">{site.name}</span>
    </>
  )
  if (readOnly) {
    return (
      <div
        ref={cardRef}
        className="board-card"
        data-location={site.location}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {content}
      </div>
    )
  }
  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-roledescription="site card"
      aria-pressed={held}
      aria-describedby="board-hint"
      aria-label={`${site.code ? `${site.code} ` : ''}${site.name}`}
      className={`board-card board-card--movable${held ? ' board-card--held' : ''}`}
      data-location={site.location}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', site.location)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <span className="board-card__handle" aria-hidden="true" data-testid="drag-handle">
        ⠿
      </span>
      <span className="board-card__body">{content}</span>
    </div>
  )
}
