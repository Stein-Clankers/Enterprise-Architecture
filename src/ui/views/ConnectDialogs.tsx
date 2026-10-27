import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  relationshipTypeMeta,
  typeLabel,
  type Element,
  type ElementType,
  type Relationship,
  type RelationshipType,
  type View,
} from '@/model'
import { planCascadeText, type RemovalSummary } from '@/store'
import { DialogOverlay } from '@/ui/common/DialogOverlay'
import { useFocusTrap } from '@/ui/common/use-focus-trap'
import type { ConnectChoice } from './connect'
import type { MagicEntry } from './magic'
import type { Nesting, NestingChoices, NestingOption } from './nesting'

/**
 * The dialogs of connecting (#129): the menu a connect gesture ends in, the
 * confirmation before a relationship leaves the model, and the question a
 * nesting asks (#131), and the magic connector's menu (#132). All are modal, as the fact sheet's relation picker is:
 * focus enters, stays, and goes back to the canvas, and Escape cancels.
 */

function useEscape(onCancel: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])
}

function Ends({ source, target }: { source: Element; target: Element }) {
  return (
    <p className="connect-menu__ends">
      <span>{source.name || typeLabel(source.type)}</span>
      <span className="connect-menu__arrow" aria-hidden="true">
        →
      </span>
      <span>{target.name || typeLabel(target.type)}</span>
    </p>
  )
}

function TypeName({ type }: { type: RelationshipType }) {
  return (
    <>
      <span className="connect-menu__abbr">{relationshipTypeMeta(type).abbr}</span>
      <span className="connect-menu__type">{type}</span>
    </>
  )
}

export interface ConnectMenuProps {
  choice: Extract<ConnectChoice, { kind: 'relationship' | 'refused' }>
  onCreate: (type: RelationshipType) => void
  onReuse: (relationship: Relationship) => void
  onCancel: () => void
}

/**
 * What to draw between two element shapes: only the types ArchiMate allows
 * from the one to the other, and any relationship of the model between them
 * that this view does not draw yet. With nothing allowed, it says so and offers
 * nothing to choose.
 */
export function ConnectMenu({ choice, onCreate, onReuse, onCancel }: ConnectMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  useEscape(onCancel)
  const label =
    choice.kind === 'relationship'
      ? `Connect ${choice.source.name || typeLabel(choice.source.type)} to ${choice.target.name || typeLabel(choice.target.type)}`
      : 'Connect'
  return (
    <DialogOverlay onDismiss={onCancel}>
      <div
        className="dialog connect-menu"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={ref}
      >
        <div className="dialog__title section-label">Connect</div>
        {choice.kind === 'refused' ? (
          <p className="dialog__problem" role="alert">
            {choice.reason}
          </p>
        ) : (
          <>
            <Ends source={choice.source} target={choice.target} />
            {choice.existing.length > 0 && (
              <section className="connect-menu__group" aria-label="Already in the model">
                <div className="dialog__label">Already in the model</div>
                {choice.existing.map((relationship) => (
                  <button
                    key={relationship.id}
                    type="button"
                    className="connect-menu__item"
                    onClick={() => onReuse(relationship)}
                  >
                    <TypeName type={relationship.type} />
                    <span className="connect-menu__note">
                      {relationship.name ? `“${relationship.name}”, ` : ''}draw it here
                    </span>
                  </button>
                ))}
              </section>
            )}
            {choice.types.length > 0 ? (
              <section className="connect-menu__group" aria-label="New relationship">
                <div className="dialog__label">New relationship</div>
                {choice.types.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="connect-menu__item"
                    onClick={() => onCreate(type)}
                  >
                    <TypeName type={type} />
                  </button>
                ))}
              </section>
            ) : (
              <p className="dialog__problem" role="alert">
                {choice.why} Nothing was created.
              </p>
            )}
          </>
        )}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </DialogOverlay>
  )
}

export interface DeleteRelationshipDialogProps {
  relationship: Relationship
  /** The views drawing it other than this one. */
  elsewhere: readonly View[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Archi's "Delete from Model" for a connection: the relationship goes, and with
 * it every drawing of it, so the dialog names the other views that lose one.
 */
export function DeleteRelationshipDialog({
  relationship,
  elsewhere,
  onConfirm,
  onCancel,
}: DeleteRelationshipDialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  useEscape(onCancel)
  return (
    <DialogOverlay onDismiss={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete relationship from the model"
        ref={ref}
      >
        <div className="dialog__title section-label">Delete from model</div>
        <p className="connect-menu__text">
          The <span className="connect-menu__type">{relationship.type}</span> relationship
          {relationship.name ? ` “${relationship.name}”` : ''} leaves the model, and every view that
          draws it.
        </p>
        {elsewhere.length > 0 ? (
          <div className="dialog__field">
            <div className="dialog__label">Also drawn in</div>
            <ul className="connect-menu__views">
              {elsewhere.map((view) => (
                <li key={view.id}>{view.name}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="connect-menu__text">No other view draws it.</p>
        )}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={onConfirm}>
            Delete from model
          </button>
        </div>
      </div>
    </DialogOverlay>
  )
}

export interface DeleteElementDialogProps {
  element: Element
  /**
   * What the delete does, from `ModelStore.removalPreview`: the summary of the
   * commands Delete dispatches, so the dialog says all of it (#223).
   */
  removal: RemovalSummary
  /**
   * Whether it is asked from a view that draws the element (the canvas) or from
   * outside any view (the fact sheet, #193). "Also" and "other" are only true
   * of the first.
   */
  inView: boolean
  /** The views drawing it, other than this one when `inView`. */
  elsewhere: readonly View[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Archi's "Delete from Model" for a shape (#130): the element goes, with every
 * relationship it has and every drawing of it, so the dialog says how many
 * relationships and names the other views that lose a drawing. A plan element
 * takes more with it (#222), and the dialog says that too: a rollout's waves
 * and site plans, a wave's sites left unassigned.
 */
export function DeleteElementDialog({
  element,
  removal,
  inView,
  elsewhere,
  onConfirm,
  onCancel,
}: DeleteElementDialogProps) {
  const drawn = inView || elsewhere.length > 0
  const relations = removal.relationships
  const cascade = planCascadeText(removal, 'asked')
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  useEscape(onCancel)
  return (
    <DialogOverlay onDismiss={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete element from the model"
        ref={ref}
      >
        <div className="dialog__title section-label">Delete from model</div>
        <p className="connect-menu__text">
          {typeLabel(element.type)} “{element.name}” leaves the model
          {relations > 0
            ? `, with its ${relations} relationship${relations === 1 ? '' : 's'}${drawn ? ',' : ''}`
            : ''}
          {drawn ? ' and every view that draws it.' : '.'}
        </p>
        {cascade && <p className="connect-menu__text">{cascade}</p>}
        {elsewhere.length > 0 ? (
          <div className="dialog__field">
            <div className="dialog__label">{inView ? 'Also drawn in' : 'Drawn in'}</div>
            <ul className="connect-menu__views">
              {elsewhere.map((view) => (
                <li key={view.id}>{view.name}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="connect-menu__text">
            {inView ? 'No other view draws it.' : 'No view draws it.'}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={onConfirm}>
            Delete from model
          </button>
        </div>
      </div>
    </DialogOverlay>
  )
}

function named(element: Element): string {
  return element.name || typeLabel(element.type)
}

/** One option, as the nesting prompt lists it: the type, and the relationship's two ends. */
function OptionText({ option }: { option: NestingOption }) {
  return (
    <>
      <TypeName type={option.type} />
      <span className="connect-menu__note">
        {named(option.source)} → {named(option.target)}
      </span>
    </>
  )
}

export interface NestingDialogProps {
  nesting: Nesting
  /** Every child asked about, with its answer; `null` is none. */
  onDone: (choices: NestingChoices) => void
}

/**
 * Archi's "Nested Elements Relationship" (#131): which relationship nesting a
 * shape in an element's shape means. One child is asked with a list, first
 * option first in line, as Archi preselects it; several children are asked
 * with a row each, every row set to its first option. "None", Escape or a
 * press outside nests the shapes and makes nothing, as Archi's None does.
 */
export function NestingDialog({ nesting, onDone }: NestingDialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  const none = () => onDone(new Map(nesting.ask.map((child) => [child.node, null])))
  useEscape(none)
  const [rows, setRows] = useState<ReadonlyMap<string, number>>(
    () => new Map(nesting.ask.map((child) => [child.node, 0])),
  )
  const single = nesting.ask.length === 1 ? nesting.ask[0] : undefined
  const parent = named(nesting.element)
  return (
    <DialogOverlay onDismiss={none}>
      <div
        className="dialog connect-menu"
        role="dialog"
        aria-modal="true"
        aria-label={`Nested in ${parent}`}
        ref={ref}
      >
        <div className="dialog__title section-label">Nested relationship</div>
        {single ? (
          <>
            <p className="connect-menu__text">
              “{named(single.element)}” is now inside “{parent}”. Choose the relationship this
              nesting means, or none.
            </p>
            <section className="connect-menu__group" aria-label="New relationship">
              {single.options.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  className="connect-menu__item"
                  onClick={() => onDone(new Map([[single.node, option]]))}
                >
                  <OptionText option={option} />
                </button>
              ))}
            </section>
          </>
        ) : (
          <>
            <p className="connect-menu__text">
              These are now inside “{parent}”. Choose the relationship each nesting means, or none.
            </p>
            <div className="connect-menu__group">
              {nesting.ask.map((child) => (
                <label key={child.node} className="dialog__field">
                  <span className="dialog__label">{named(child.element)}</span>
                  <select
                    className="dialog__control"
                    value={rows.get(child.node) ?? -1}
                    onChange={(event) =>
                      setRows((current) =>
                        new Map(current).set(child.node, Number(event.target.value)),
                      )
                    }
                  >
                    <option value={-1}>(none)</option>
                    {child.options.map((option, index) => (
                      <option key={option.type} value={index}>
                        {option.type}: {named(option.source)} → {named(option.target)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </>
        )}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={none}>
            None
          </button>
          {!single && (
            <button
              type="button"
              className="button button--primary"
              onClick={() =>
                onDone(
                  new Map(
                    nesting.ask.map((child) => [
                      child.node,
                      child.options[rows.get(child.node) ?? -1] ?? null,
                    ]),
                  ),
                )
              }
            >
              Create
            </button>
          )}
        </div>
      </div>
    </DialogOverlay>
  )
}

export interface MagicMenuProps {
  source: Element
  entries: readonly MagicEntry[]
  /** What it says when `entries` is empty (`magicNothing`). */
  nothing: string
  onCreate: (type: RelationshipType, target: ElementType) => void
  onCancel: () => void
}

/**
 * The magic connector's menu (#132): a connect gesture released on empty
 * canvas. Relationship types first, as Archi's menu is by default; the one in
 * line shows the new elements it can reach, grouped by layer. Up and down move
 * within a column, right (or Enter, which presses the type) goes into the
 * element types and left back, Enter on an element type creates, and Escape or
 * a press outside makes nothing. Hovering a type brings its element types up, and focus to
 * it, as Archi's submenus open on hover.
 */
export function MagicMenu({ source, entries, nothing, onCreate, onCancel }: MagicMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref)
  useEscape(onCancel)
  const [chosen, setChosen] = useState(0)
  // The model can change while the menu is open, and the list with it: the
  // entry in line is the last one when the one chosen has gone.
  const active = Math.min(chosen, entries.length - 1)
  const typeButtons = useRef<(HTMLButtonElement | null)[]>([])
  const targetButtons = useRef<(HTMLButtonElement | null)[]>([])
  const panel = useId()
  const entry = entries[active]
  // Each render refills it; a shorter list must not keep the last one's tail.
  targetButtons.current.length = entry ? countTargets(entry) : 0
  /**
   * Bumped to go into the element types of the entry in line. Focused in an
   * effect, once that entry's column is drawn: a click on another type changes
   * the column, and focusing in the handler would land on the old one's button
   * just before it is replaced.
   */
  const [enter, setEnter] = useState(0)
  useEffect(() => {
    if (enter) targetButtons.current[0]?.focus()
  }, [enter])
  const into = (index: number) => {
    setChosen(index)
    setEnter((n) => n + 1)
  }

  const moveTo = (list: (HTMLButtonElement | null)[], index: number) => {
    const count = list.length
    if (count === 0) return
    list[((index % count) + count) % count]?.focus()
  }

  const onTypeKey = (event: ReactKeyboardEvent, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length
      setChosen(next)
      typeButtons.current[next]?.focus()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      into(index)
    }
  }

  const onTargetKey = (event: ReactKeyboardEvent, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveTo(targetButtons.current, index + (event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      typeButtons.current[active]?.focus()
    }
  }

  let flat = 0
  return (
    <DialogOverlay onDismiss={onCancel}>
      <div
        className="dialog magic-menu"
        role="dialog"
        aria-modal="true"
        aria-label={`New element from ${named(source)}`}
        ref={ref}
      >
        <div className="dialog__title section-label">New element</div>
        <p className="connect-menu__text">
          From “{named(source)}”: choose the relationship, then the element it leads to.
        </p>
        {entry ? (
          <div className="magic-menu__columns">
            <section className="connect-menu__group magic-menu__types" aria-label="Relationship">
              {entries.map((candidate, index) => (
                <button
                  key={candidate.type}
                  ref={(el) => {
                    typeButtons.current[index] = el
                  }}
                  type="button"
                  className={`connect-menu__item${index === active ? ' magic-menu__item--active' : ''}`}
                  aria-current={index === active ? 'true' : undefined}
                  aria-controls={panel}
                  tabIndex={index === active ? 0 : -1}
                  // A hover brings the type into line and takes focus with it,
                  // as a native menu's hover does: focus never stays on an
                  // element type the hover is about to replace (#181 review).
                  onPointerEnter={() => {
                    setChosen(index)
                    typeButtons.current[index]?.focus()
                  }}
                  onClick={() => into(index)}
                  onKeyDown={(event) => onTypeKey(event, index)}
                >
                  <span className="connect-menu__abbr">
                    {relationshipTypeMeta(candidate.type).abbr}
                  </span>
                  <span className="magic-menu__phrase">{candidate.phrase}</span>
                  <span className="magic-menu__count">{countTargets(candidate)}</span>
                </button>
              ))}
            </section>
            <section
              id={panel}
              className="magic-menu__targets"
              aria-label={`${entry.phrase}: new element`}
            >
              {entry.groups.map((group) => (
                <div
                  key={group.layer}
                  className="connect-menu__group"
                  role="group"
                  aria-label={group.label}
                >
                  <div className="dialog__label">{group.label}</div>
                  {group.types.map((type) => {
                    const index = flat++
                    return (
                      <button
                        key={type}
                        ref={(el) => {
                          targetButtons.current[index] = el
                        }}
                        type="button"
                        className="connect-menu__item"
                        tabIndex={-1}
                        onClick={() => onCreate(entry.type, type)}
                        onKeyDown={(event) => onTargetKey(event, index)}
                      >
                        <span className="magic-menu__target">{typeLabel(type)}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </section>
          </div>
        ) : (
          <p className="dialog__problem" role="alert">
            {nothing}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </DialogOverlay>
  )
}

/** How many element types a relationship type reaches, shown beside it. */
function countTargets(entry: MagicEntry): number {
  return entry.groups.reduce((sum, group) => sum + group.types.length, 0)
}
