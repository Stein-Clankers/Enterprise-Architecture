import { NavLink, useLocation } from 'react-router-dom'
import { COMPLETENESS_CONFIG, rolloutPlanOf } from '@/model'
import { useModelSelector } from '@/store'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

/**
 * The 208px left nav (handoff "Global chrome" → Left nav).
 *
 * The five phase-2 reports are drawn but inert, with a `P2` tag and a tooltip.
 * Showing where the product is going is worth more than a shorter nav, and it is
 * honest about what does not work yet — the alternative is a user clicking
 * Roadmap and finding nothing.
 */

interface PlannedItem {
  label: string
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

const PLANNED: PlannedItem[] = [
  { label: 'Capability map' },
  { label: 'Landscape' },
  { label: 'Roadmap' },
  { label: 'Matrix' },
  { label: 'Portfolio' },
]

export interface LeftNavProps {
  treeOpen: boolean
  /** Id of the tree panel, for `aria-controls`. */
  treeId: string
  onToggleTree: () => void
}

export function LeftNav({ treeOpen, treeId, onToggleTree }: LeftNavProps) {
  const { pathname } = useLocation()
  const stats = useModelSelector((store) => {
    let missingOwner = 0
    let rollouts = 0
    for (const element of store.elements()) {
      if (rolloutPlanOf(element)) rollouts += 1
      const owner = element.properties[COMPLETENESS_CONFIG.ownerProperty]
      if (typeof owner !== 'string' || !owner.trim()) missingOwner += 1
    }
    return {
      elements: store.elementCount,
      views: store.viewCount,
      relationships: store.relationshipCount,
      health: store.health(),
      missingOwner,
      rollouts,
    }
  })

  return (
    <nav className="nav" aria-label="Model">
      <div className="section-label nav__label">Workspace</div>
      <WorkspaceSwitcher />

      <div className="section-label nav__label">Model</div>
      <NavLink
        to="/inventory"
        className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`}
      >
        <span className="nav__glyph" aria-hidden="true" />
        <span className="nav__text">Inventory</span>
        <span className="nav__badge">{stats.elements}</span>
      </NavLink>
      <NavLink
        to="/graph"
        className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`}
      >
        <span className="nav__glyph" aria-hidden="true" />
        <span className="nav__text">Dependency graph</span>
      </NavLink>
      <NavLink
        to="/rollouts"
        className={({ isActive }) =>
          `nav__item${isActive || pathname.startsWith('/rollout/') ? ' nav__item--active' : ''}`
        }
      >
        <span className="nav__glyph" aria-hidden="true" />
        <span className="nav__text">Rollouts</span>
        <span className="nav__badge">{stats.rollouts || ''}</span>
      </NavLink>
      <NavLink
        to="/validate"
        className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`}
      >
        <span className="nav__glyph" aria-hidden="true" />
        <span className="nav__text">Validator</span>
      </NavLink>
      <button
        type="button"
        className={`nav__item${treeOpen ? ' nav__item--active' : ''}`}
        aria-expanded={treeOpen}
        aria-controls={treeOpen ? treeId : undefined}
        onClick={onToggleTree}
        title={treeOpen ? 'Hide the model tree' : 'Show the model tree'}
      >
        <span className="nav__glyph" aria-hidden="true" />
        <span className="nav__text">Model tree</span>
        <span className="nav__badge">
          {stats.views ? `${stats.views} view${stats.views === 1 ? '' : 's'}` : ''}
        </span>
      </button>

      {PLANNED.map((item) => (
        <button
          key={item.label}
          type="button"
          className="nav__item nav__item--planned"
          title="Planned for phase 2"
          // Not `disabled`: browsers suppress the tooltip on a disabled control,
          // and the tooltip is the whole point of drawing these items at all.
          aria-disabled="true"
          tabIndex={-1}
        >
          <span className="nav__glyph" aria-hidden="true" />
          <span className="nav__text">{item.label}</span>
          <span className="nav__badge">P2</span>
        </button>
      ))}

      <div className="section-label nav__label nav__label--spaced">Help</div>
      <NavLink
        to="/guide"
        className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`}
      >
        <span className="nav__glyph" aria-hidden="true" />
        <span className="nav__text">ArchiMate guide</span>
      </NavLink>

      <div className="health">
        <div className="section-label health__label">Model health</div>
        <div className="health__value">
          <span className="health__number">{stats.health}</span>
          <span className="health__unit">% complete</span>
        </div>
        <div className="health__bar">
          <div className="health__fill" style={{ width: `${stats.health}%` }} />
        </div>
        <div className="health__counts">
          <div>{`${plural(stats.elements, 'element')} · ${plural(stats.relationships, 'relation')}`}</div>
          <div>{`${plural(stats.missingOwner, 'element')} missing an owner`}</div>
        </div>
      </div>
    </nav>
  )
}
