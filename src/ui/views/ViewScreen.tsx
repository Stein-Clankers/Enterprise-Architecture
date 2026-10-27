import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  VIEWPOINTS,
  findViewpoint,
  legendEntries,
  isLabelPosition,
  isViewRouter,
  nestedConnections,
  paintFormat,
  removeNodes,
  typeLabel,
  type Bounds,
  type Element,
  type ElementNode,
  type ElementType,
  type Format,
  type LabelPosition,
  type Point,
  type RelationshipType,
  type View,
  type ViewConnection,
  type ViewNode,
  type ViewReferenceNode,
} from '@/model'
import { downloadBlob, downloadText } from '@/io'
import {
  newId,
  useModelStore,
  useModelStoreContext,
  useModelVersion,
  type ModelStore,
} from '@/store'
import { TypeCodeBadge } from '@/ui/common/TypeCodeBadge'
import { ViewDrawing, type DrawingLookups } from './ViewDrawing'
import { Minimap } from './Minimap'
import {
  absoluteIndex,
  centreOn,
  childrenIndex,
  connectionRoute,
  drawingBounds,
  fitViewport,
  zoomAround,
  type Viewport,
} from './geometry'
import { buildViewSvg, rasterise, viewFileName } from './export-view'
import { excludedBy } from './ghosts'
import {
  HANDLES,
  dropTarget,
  moveSelection,
  nodesInside,
  resizeNode,
  resized,
  spanned,
  topSelected,
  withDescendants,
  type Handle,
} from './edit'
import { connectChoice, nodeAt } from './connect'
import { magicEdit, magicMenu, magicNothing } from './magic'
import {
  ConnectMenu,
  MagicMenu,
  DeleteElementDialog,
  DeleteRelationshipDialog,
  NestingDialog,
} from './ConnectDialogs'
import {
  nestingEdit,
  nestingFor,
  withNewElement,
  type Nesting,
  type NestingChoices,
} from './nesting'
import {
  ELEMENT_DRAG_TYPE,
  VIEW_DRAG_TYPE,
  newDrawingNode,
  newElement,
  placement,
  toolSize,
  type Tool,
} from './create'
import { ElementPalette } from './ElementPalette'
import { heldCopyKey, withDrop } from './drop'
import {
  changeConnection,
  insertBendpoint,
  moveBendpoint,
  removeBendpoint,
  segmentHandles,
  straightened,
} from './bendpoints'
import { InlineName } from './InlineName'
import { DrawingAppearance, MultiSelectionPanel, PainterBanner } from './AppearanceSection'
import { ArrangeBar, type ArrangeAction } from './ArrangeBar'
import { align, arrangeable, canMatch, canReorder, distribute, matchSize, reorder } from './arrange'
import { GUIDE_THRESHOLD, snapMove, snapResize, type Guide, type SnapSettings } from './snap'
import { readGridPreferences, writeGridPreferences, type GridPreferences } from './grid-preferences'
import {
  clipboardChord,
  clipboardFor,
  copySelection,
  nextOffset,
  pasteInto,
  type ClipboardChord,
  type Snapshot,
} from './clipboard'
import { useScreenActions } from '@/ui/palette/context'
import type { PaletteAction } from '@/ui/palette/CommandPalette'
import { defaultNodeSize } from '@/io/default-sizes'
import type { ViewRouteState } from './use-create-view'
import './views.css'

/**
 * A hand-drawn view (#79), and its editor (#128): the drawing exactly as it was
 * made, with zoom, pan, fit, an outline, selection with a summary panel, and
 * SVG/PNG export. In the tab that holds the model, shapes can be selected,
 * moved, nested and un-nested, resized, nudged and removed from the view, each
 * as one command (ADR 0006). Delete removes a container with its contents, as
 * Archi does; Shift+Delete keeps the contents. Dragging from a selected shape's
 * connect handle to another shape draws a connection, offering only the
 * relationships ArchiMate allows (#129). A connection can be selected, removed
 * from the view, or deleted from the model. A reader tab gets the read-only canvas.
 *
 * Keyed on the view id by the route (CLAUDE.md), so viewport and selection never
 * carry over from one view to the next.
 */
export function ViewScreen() {
  const { id = '' } = useParams()
  const store = useModelStore()
  useModelVersion()
  const view = store.view(id)
  if (!view) {
    return (
      <div className="view-screen view-screen--missing">
        <p role="alert" className="view-screen__notice">
          There is no view with the id <code>{id}</code> in this workspace.
        </p>
        <p className="view-screen__notice">Open a view from the model tree.</p>
      </div>
    )
  }
  return <ViewCanvas view={view} store={store} />
}

/**
 * Whether the palette is collapsed to its glyphs (#146): a per-viewer
 * convenience, as the model tree's is, so it lives in localStorage and the
 * palette still works without it.
 */
export const PALETTE_COLLAPSED_STORAGE_KEY = 'archipelago.view-palette-collapsed'

function readPaletteCollapsed(): boolean {
  try {
    return localStorage.getItem(PALETTE_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    // Storage can be blocked (private mode, site-data policies): open, as for a new viewer.
    return false
  }
}

function writePaletteCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(PALETTE_COLLAPSED_STORAGE_KEY, String(collapsed))
  } catch {
    // The palette still collapses; it just will not be remembered.
  }
}

/** Movement below this many pixels is a click, not a drag. */
const CLICK_SLOP = 3
const NONE: string[] = []
const ZOOM_STEP = 1.2
/** Below this many screen pixels between lines the grid is a grey wash, so it is not drawn. */
const MIN_GRID_SPACING = 4
/** A drag this close to the canvas edge scrolls the view, faster the closer it gets. */
const EDGE = 24
const EDGE_SPEED = 12

/**
 * What a pointer press turned into. A press on a shape becomes a move, on a
 * resize handle a resize, on the connect handle a connection, on empty canvas
 * a lasso; Space, the middle button, or any press in a reader tab pans instead. The gesture lives here, in UI
 * state, and only its end reaches the store, as one command (ADR 0006).
 */
type Gesture =
  | {
      kind: 'pan'
      start: Point
      origin: Viewport
      node: string | null
      line: string | null
      moved: boolean
    }
  | { kind: 'connect'; start: Point; source: string; moved: boolean }
  | {
      kind: 'move'
      start: Point
      from: Point
      node: string
      ids: Set<string>
      additive: boolean
      moved: boolean
    }
  | { kind: 'lasso'; start: Point; from: Point; additive: boolean; base: string[]; moved: boolean }
  | { kind: 'resize'; start: Point; from: Point; node: string; handle: Handle; moved: boolean }
  | { kind: 'place'; start: Point; from: Point; tool: Tool; moved: boolean }
  /** A bend-point dragged (#133): `adding` when the drag began on a segment's handle. */
  | {
      kind: 'bend'
      start: Point
      connection: string
      index: number
      adding: boolean
      moved: boolean
    }

function ViewCanvas({ view, store }: { view: View; store: ModelStore }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { role } = useModelStoreContext()
  const editable = role === 'writer'

  /** The view mid-gesture, drawn instead of the stored one until the gesture ends. */
  const [preview, setPreview] = useState<View | null>(null)
  /**
   * A nesting waiting on its answer (#131): what to ask, and how the answer
   * commits. Meanwhile `preview` draws the shapes where they were dropped, and
   * `placing` is the palette's new element, which the model holds only once
   * the answer commits it.
   */
  const [nesting, setNesting] = useState<{
    ask: Nesting
    commit: (choices: NestingChoices) => void
  } | null>(null)
  const [placing, setPlacing] = useState<Element | null>(null)
  const shown = preview ?? view
  const bounds = useMemo(() => absoluteIndex(shown), [shown])
  const children = useMemo(() => childrenIndex(shown), [shown])
  const shownHidden = useMemo(() => nestedConnections(shown), [shown])
  const drawing = useMemo(() => drawingBounds(shown, bounds), [shown, bounds])
  const lookups = useMemo<DrawingLookups>(
    () => ({
      element: (elementId) => (placing?.id === elementId ? placing : store.element(elementId)),
      relationship: (relationshipId) => store.relationship(relationshipId),
      viewName: (viewId) => store.view(viewId)?.name,
    }),
    // Renewed on every model change, not only the view's: a rename on the canvas
    // (#130) changes the element and leaves the view as it was, and the drawing
    // would keep the old name. Each node still redraws only when the element it
    // draws is a new object (`DrawnNode`), so this costs one walk of the drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, store.version, placing],
  )

  const canvas = useRef<HTMLDivElement>(null)
  const drawingRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const requested = params.get('element')
  /**
   * The shape (`?node=`) or line (`?line=`) to open selected, as the validator
   * links to them (#193). Read once, as the view opens: an element can be
   * drawn twice, so `?element=` cannot name one of its shapes.
   */
  const [opening] = useState(() => {
    const node = view.nodes.find((n) => n.id === params.get('node'))
    const line = view.connections.find((c) => c.id === params.get('line'))
    return { node, line }
  })
  /**
   * What is selected: shapes, or one connection, never both. One state rather
   * than two, so no path can select a shape and leave a line selected beside
   * it (#142 review: the model tree's `?element=` did, and Delete then removed
   * the line).
   */
  const [picked, setPicked] = useState<{ nodes: string[] } | { line: string }>(() => {
    if (opening.line) return { line: opening.line.id }
    const node =
      opening.node ??
      (requested
        ? view.nodes.find((n) => n.kind === 'element' && n.element === requested)
        : undefined)
    return { nodes: node ? [node.id] : [] }
  })
  const selection = 'nodes' in picked ? picked.nodes : NONE
  const line = 'line' in picked ? picked.line : null
  /**
   * A press that changed the selection is in progress. The selection panel
   * waits for it to end: a press selects at once, so the shape can be dragged,
   * and a panel opening or changing then would narrow the canvas and slide
   * under the pointer, taking the rest of the drag with it (seen in a real
   * browser; jsdom lays nothing out). A press on what is already selected
   * leaves the panel alone, so clicking it does not make the canvas jump.
   */
  const [pressing, setPressing] = useState(false)
  const [lasso, setLasso] = useState<Bounds | null>(null)
  const [dropInto, setDropInto] = useState<string | null>(null)
  /** A connect gesture in progress: from the source's centre to the pointer, and the shape under it. */
  const [rubber, setRubber] = useState<{ from: Point; to: Point; over: string | null } | null>(null)
  /** A connect gesture that ended on another shape, waiting on the menu. */
  const [pending, setPending] = useState<{ source: string; target: string } | null>(null)
  /**
   * A connect gesture that ended on empty canvas, waiting on the magic
   * connector's menu (#132): the source shape, and where the new one goes.
   */
  const [magic, setMagic] = useState<{ source: string; at: Point } | null>(null)
  /** The relationship whose deletion from the model is waiting on confirmation. */
  const [deleting, setDeleting] = useState<string | null>(null)
  /**
   * Bumped by an action that removes the control holding focus: a panel's
   * buttons go with the panel, and a dialog gives focus back to an opener that
   * is gone, so focus would fall to `<body>` and the canvas would stop taking
   * keys (#142 review). Focused in an effect, so it lands after the dialog's
   * focus trap has let go.
   */
  const [refocus, setRefocus] = useState(0)
  useEffect(() => {
    if (refocus) canvas.current?.focus()
  }, [refocus])
  const release = () => setRefocus((n) => n + 1)
  const [exportError, setExportError] = useState<{ format: 'SVG' | 'PNG'; reason: string } | null>(
    null,
  )
  /** The grid and snapping this viewer chose (#136): a preference, kept in localStorage. */
  const [grid, setGrid] = useState(readGridPreferences)
  const changeGrid = useCallback((change: Partial<GridPreferences>) => {
    setGrid((current) => {
      const next = { ...current, ...change }
      writeGridPreferences(next)
      return next
    })
  }, [])
  /** The alignment guides a drag in progress is snapped to. */
  const [guides, setGuides] = useState<Guide[]>([])
  const gridPattern = useId()
  /** The palette tool the next press on the canvas places (#130). */
  const [tool, setTool] = useState<Tool | null>(null)
  /**
   * The format the painter picked up (#135), and the drawing it came from:
   * while held, a press on a drawing paints it.
   */
  const [painter, setPainter] = useState<{ format: Format; source: string } | null>(null)
  /** The node whose name is being typed on the canvas. */
  const [editing, setEditing] = useState<string | null>(null)
  /** The element whose deletion from the model is waiting on confirmation. */
  const [deletingElement, setDeletingElement] = useState<string | null>(null)
  const paletteFilter = useRef<HTMLInputElement>(null)
  /**
   * "New element in view…" in the command palette lands in the palette's type
   * filter (#130). Focused in an effect, which runs after the command palette's
   * unmount has given focus back to whatever opened it.
   */
  const [findType, setFindType] = useState(0)
  /** The palette drawn as glyphs only (#146). */
  const [collapsed, setCollapsed] = useState(readPaletteCollapsed)
  /** The canvas's left edge on screen as the palette was toggled, so the drawing can stay put. */
  const toggledAt = useRef<number | null>(null)
  const collapse = useCallback((next: boolean) => {
    toggledAt.current = canvas.current?.getBoundingClientRect().left ?? null
    writePaletteCollapsed(next)
    setCollapsed(next)
  }, [])
  /** The type filter is wanted, and focused as soon as it is there: a collapsed palette has none. */
  const wantsFilter = useRef(false)
  useEffect(() => {
    if (!findType) return
    wantsFilter.current = true
    collapse(false)
  }, [findType, collapse])
  useEffect(() => {
    if (!wantsFilter.current || !paletteFilter.current) return
    wantsFilter.current = false
    paletteFilter.current.focus()
  }, [findType, collapsed])
  const find = useCallback(() => setFindType((n) => n + 1), [])
  const screenActions = useMemo<PaletteAction[]>(
    () =>
      editable
        ? [
            {
              id: 'new-element-in-view',
              label: 'New element in view…',
              glyph: 'NE',
              run: find,
            },
          ]
        : [],
    [editable, find],
  )
  useScreenActions(screenActions)
  /**
   * A view made a moment ago opens with its name field focused and selected
   * (#130). Decided here, once, because this mounts once per view: the field
   * itself remounts on every rename (`key={view.name}`), and a field that
   * focused itself on mount took focus back after each one (#144 review). The
   * route state is consumed, so going Back to the view does not do it again.
   */
  const location = useLocation()
  const nameField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if ((location.state as ViewRouteState | null)?.naming !== true) return
    nameField.current?.focus()
    nameField.current?.select()
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    )
    // Only as the view opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // An undo can take away a selected shape; the selection holds only what is drawn.
  const present = useMemo(() => new Set(view.nodes.map((n) => n.id)), [view])
  const selected = selection.filter((id) => present.has(id))
  const single = selected.length === 1 ? selected[0]! : null
  // Nor can a line the nesting hides be selected: it is not drawn, as in Archi (#96).
  const hiddenLines = useMemo(() => nestedConnections(view), [view])
  const selectedLine =
    line === null || hiddenLines.has(line) ? undefined : view.connections.find((c) => c.id === line)
  /** The selected line as drawn: mid-drag, the preview's. */
  const shownLine =
    selectedLine && (shown.connections.find((c) => c.id === selectedLine.id) ?? selectedLine)
  /**
   * The selected line's bend-points can be edited: in the tab that holds the
   * model, and not in a Manhattan view, where Archi ignores them (#133).
   */
  const bendable = editable && view.router !== 'manhattan' && selectedLine !== undefined

  /**
   * The selection, with a single selected element mirrored into `?element=` so
   * the model tree (#80), which reads the URL, highlights it. `replace`: a click
   * on a shape is not a step Back should rewind.
   */
  const choose = useCallback(
    /** `within`: the view the ids are in, when it is newer than this render's (a shape just placed). */
    (ids: string[], within: View = view) => {
      setPicked({ nodes: ids })
      const node = ids.length === 1 ? within.nodes.find((n) => n.id === ids[0]) : undefined
      const element = node?.kind === 'element' ? node.element : null
      if (params.get('element') === element) return
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          if (element === null) next.delete('element')
          else next.set('element', element)
          return next
        },
        { replace: true },
      )
    },
    [view, params, setParams],
  )

  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /**
   * Until the user pans, zooms or edits, the viewport follows the canvas size:
   * the first measurement can come before the layout settles, and a window
   * resize should keep a fitted drawing fitted. Any gesture hands control to
   * the user, so an edit never makes the view jump; Fit hands it back.
   */
  const auto = useRef(true)
  const [initialTarget] = useState(
    () => opening.line?.source ?? opening.node?.id ?? (requested ? (selection[0] ?? null) : null),
  )
  const steer = useCallback((next: Viewport | ((current: Viewport | null) => Viewport)) => {
    auto.current = false
    setViewport(next)
  }, [])

  /**
   * Toggling the palette moves the canvas's left edge, and the drawing with
   * it. Before the browser paints, the viewport takes up the difference, so
   * every shape stays where it was on screen (#146). That hands the viewport
   * to the user, as any gesture does: an auto-fit would otherwise re-fit the
   * narrower or wider canvas, which is the jump this avoids.
   */
  useLayoutEffect(() => {
    const before = toggledAt.current
    toggledAt.current = null
    const after = canvas.current?.getBoundingClientRect().left
    if (before === null || after === undefined || after === before) return
    steer((current) => {
      const v = current ?? { x: 0, y: 0, zoom: 1 }
      return { ...v, x: v.x + before - after }
    })
  }, [collapsed, steer])

  const fit = useCallback(() => {
    auto.current = true
    setViewport(fitViewport(drawing, size.width, size.height))
  }, [drawing, size.width, size.height])

  // Fit the drawing, or centre on the element the link asked for.
  useEffect(() => {
    if (!auto.current || size.width === 0 || size.height === 0) return
    const fitted = fitViewport(drawing, size.width, size.height)
    const target = initialTarget ? bounds.get(initialTarget) : undefined
    if (target) {
      setViewport(
        centreOn(
          { ...fitted, zoom: Math.max(fitted.zoom, 1) },
          { x: target.x + target.width / 2, y: target.y + target.height / 2 },
          size.width,
          size.height,
        ),
      )
    } else setViewport(fitted)
  }, [size, drawing, bounds, initialTarget])

  /**
   * `?node=` and `?line=` have done their work once the view is open: the URL
   * goes back to saying what the tree reads, `?element=` for a shape.
   */
  useEffect(() => {
    if (!params.has('node') && !params.has('line')) return
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('node')
        next.delete('line')
        if (opening.node?.kind === 'element') next.set('element', opening.node.element)
        return next
      },
      { replace: true },
    )
    // Only as the view opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * The other direction: the tree selects an element by rewriting `?element=`.
   * Select its first drawing, and bring it on screen if it is not — without
   * touching a zoom the user chose.
   */
  useEffect(() => {
    if (!requested) return
    const current = single === null ? undefined : view.nodes.find((n) => n.id === single)
    if (current?.kind === 'element' && current.element === requested) return
    const node = view.nodes.find((n) => n.kind === 'element' && n.element === requested)
    if (!node) return
    setPicked({ nodes: [node.id] })
    const target = bounds.get(node.id)
    if (!target || !viewport || size.width === 0) return
    const left = target.x * viewport.zoom + viewport.x
    const top = target.y * viewport.zoom + viewport.y
    const onScreen =
      left >= 0 &&
      top >= 0 &&
      left + target.width * viewport.zoom <= size.width &&
      top + target.height * viewport.zoom <= size.height
    if (!onScreen) {
      steer(
        centreOn(
          viewport,
          { x: target.x + target.width / 2, y: target.y + target.height / 2 },
          size.width,
          size.height,
        ),
      )
    }
    // Only a change of the requested element moves the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested])

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms about the pointer; a plain wheel
  // pans. The listener is native because React's wheel listener is passive and
  // cannot stop the page itself from scrolling or zooming.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      steer((current) => {
        const vp = current ?? { x: 0, y: 0, zoom: 1 }
        if (event.ctrlKey || event.metaKey) {
          return zoomAround(vp, vp.zoom * Math.exp(-event.deltaY * 0.01), {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          })
        }
        return { ...vp, x: vp.x - event.deltaX, y: vp.y - event.deltaY }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [steer])

  const vp = viewport ?? { x: 0, y: 0, zoom: 1 }
  // The gesture handlers and the auto-scroll loop read the viewport between renders.
  const vpRef = useRef(vp)
  vpRef.current = vp
  const gesture = useRef<Gesture | null>(null)
  const pointer = useRef<Point>({ x: 0, y: 0 })
  const space = useRef(false)
  const scrolling = useRef<number | null>(null)
  /**
   * Where the canvas was last pressed, in view coordinates, since the last copy
   * or paste: a paste puts the copied shapes there (#137). Archi's
   * `PasteAction` keeps the same point from a mouse listener on the canvas and
   * forgets it after a copy or a paste.
   */
  const pressed = useRef<Point | null>(null)

  /** A screen (client) point in view coordinates. */
  const toView = useCallback((client: Point): Point => {
    const rect = canvas.current?.getBoundingClientRect()
    const v = vpRef.current
    return {
      x: (client.x - (rect?.left ?? 0) - v.x) / v.zoom,
      y: (client.y - (rect?.top ?? 0) - v.y) / v.zoom,
    }
  }, [])

  /** Is `client` (a screen point) on the canvas? */
  const onCanvas = (client: Point): boolean => {
    const rect = canvas.current?.getBoundingClientRect()
    return (
      rect !== undefined &&
      client.x >= rect.left &&
      client.x <= rect.right &&
      client.y >= rect.top &&
      client.y <= rect.bottom
    )
  }

  /**
   * The element a magic connector gesture starts from (#132): the one `nodeId`
   * draws. A note, a group or a view reference starts none, as in Archi, whose
   * magic connector starts only from an ArchiMate shape.
   */
  const magicSource = (nodeId: string): Element | undefined => {
    const node = view.nodes.find((n) => n.id === nodeId)
    return node?.kind === 'element' ? store.element(node.element) : undefined
  }

  const isJunction = useCallback(
    (elementId: string) => store.element(elementId)?.type === 'Junction',
    [store],
  )

  /** Where a move would drop the selection, with the pointer at `client`. */
  const dropFor = useCallback(
    (base: View, g: Extract<Gesture, { kind: 'move' }>, client: Point) =>
      dropTarget(base, topSelected(base, g.ids), toView(client), isJunction),
    [toView, isJunction],
  )

  /**
   * `base` as the gesture would leave it, with the pointer at `client`. The
   * commit passes the store's current view rather than the render's. They are
   * the same object in practice, since a store change re-renders the canvas
   * before a release can be handled; building on the store's is simply the
   * honest base for a command whose `before` is the store's.
   */
  const snapping = useCallback(
    (): SnapSettings => ({
      grid: grid.snap ? grid.size : null,
      guides: grid.guides,
      threshold: GUIDE_THRESHOLD / vpRef.current.zoom,
    }),
    [grid],
  )
  const arranged = useCallback(
    (
      base: View,
      g: Extract<Gesture, { kind: 'move' | 'resize' }>,
      client: Point,
    ): { view: View; guides: Guide[] } => {
      const at = toView(client)
      if (g.kind === 'move') {
        // Snapped as Archi snaps (#136): the shape under the pointer, in the container it goes into.
        const into = dropFor(base, g, client)
        const snap = snapMove(
          base,
          g.ids,
          g.node,
          into,
          at.x - g.from.x,
          at.y - g.from.y,
          snapping(),
        )
        const view = moveSelection(base, g.ids, Math.round(snap.dx), Math.round(snap.dy), { into })
        return { view, guides: snap.guides }
      }
      const node = base.nodes.find((n) => n.id === g.node)
      if (!node) return { view: base, guides: [] }
      const dx = Math.round(at.x - g.from.x)
      const dy = Math.round(at.y - g.from.y)
      const snap = snapResize(
        base,
        g.node,
        g.handle,
        resized(node.bounds, g.handle, dx, dy),
        snapping(),
      )
      return { view: resizeNode(base, g.node, snap.bounds), guides: snap.guides }
    },
    [toView, dropFor, snapping],
  )
  const outcome = useCallback(
    (base: View, g: Extract<Gesture, { kind: 'move' | 'resize' }>, client: Point): View =>
      arranged(base, g, client).view,
    [arranged],
  )

  /** `base` with the dragged bend-point at `client`: a new one, or one moved (#133). */
  const bent = useCallback(
    (base: View, g: Extract<Gesture, { kind: 'bend' }>, client: Point): View => {
      const at = toView(client)
      return changeConnection(base, g.connection, (c) =>
        g.adding ? insertBendpoint(c, g.index, at) : moveBendpoint(c, g.index, at),
      )
    },
    [toView],
  )

  /** Redraw the gesture in progress for the pointer at `client`. */
  const track = useCallback(
    (client: Point) => {
      const g = gesture.current
      if (!g || g.kind === 'pan' || g.kind === 'place') return
      if (g.kind === 'bend') {
        setPreview(bent(view, g, client))
        return
      }
      if (g.kind === 'lasso') {
        setLasso(spanned(g.from, toView(client)))
        return
      }
      if (g.kind === 'connect') {
        const b = bounds.get(g.source)
        if (!b) return
        const at = toView(client)
        const over = nodeAt(view, at)
        setRubber({
          from: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
          to: at,
          over: over !== undefined && over !== g.source ? over : null,
        })
        return
      }
      const next = arranged(view, g, client)
      setPreview(next.view)
      setGuides(next.guides)
      if (g.kind === 'move') {
        // Outlined only when the drop would change where the selection lives.
        const into = dropFor(view, g, client)
        const parents = new Set(
          [...topSelected(view, g.ids)].map((id) => view.nodes.find((n) => n.id === id)?.parent),
        )
        setDropInto(into !== undefined && !(parents.size === 1 && parents.has(into)) ? into : null)
      }
    },
    [view, bounds, toView, arranged, dropFor, bent],
  )

  /** Scroll while a drag rests near the canvas edge, carrying the gesture along. */
  const autoScroll = useCallback(() => {
    if (scrolling.current !== null) return
    const tick = () => {
      const g = gesture.current
      const rect = canvas.current?.getBoundingClientRect()
      if (!g || g.kind === 'pan' || g.kind === 'place' || !g.moved || !rect) {
        scrolling.current = null
        return
      }
      const push = (at: number, low: number, high: number) =>
        at < low + EDGE
          ? (EDGE_SPEED * (low + EDGE - at)) / EDGE
          : at > high - EDGE
            ? (-EDGE_SPEED * (at - (high - EDGE))) / EDGE
            : 0
      const sx = push(pointer.current.x, rect.left, rect.right)
      const sy = push(pointer.current.y, rect.top, rect.bottom)
      if (sx === 0 && sy === 0) {
        scrolling.current = null
        return
      }
      const next = { ...vpRef.current, x: vpRef.current.x + sx, y: vpRef.current.y + sy }
      vpRef.current = next
      steer(next)
      track(pointer.current)
      scrolling.current = requestAnimationFrame(tick)
    }
    scrolling.current = requestAnimationFrame(tick)
  }, [steer, track])
  useEffect(
    () => () => {
      if (scrolling.current !== null) cancelAnimationFrame(scrolling.current)
    },
    [],
  )

  const target = (event: { target: EventTarget | null }) => {
    const el = event.target instanceof Element ? event.target : null
    return {
      node: el?.closest('[data-node]')?.getAttribute('data-node') ?? null,
      handle: (el?.closest('[data-handle]')?.getAttribute('data-handle') ?? null) as Handle | null,
      line: el?.closest('[data-line-hit]')?.getAttribute('data-line-hit') ?? null,
      connect: el?.closest('[data-connect]') ? true : false,
      bendpoint: index(el?.closest('[data-bendpoint]')?.getAttribute('data-bendpoint')),
      segment: index(el?.closest('[data-segment]')?.getAttribute('data-segment')),
    }
  }

  /** Drop the gesture in progress without committing it: Escape, a lost pointer. */
  const cancelGesture = () => {
    gesture.current = null
    setPressing(false)
    setPreview(null)
    setLasso(null)
    setDropInto(null)
    setRubber(null)
    setGuides([])
  }

  /** Select one connection, and no shape. */
  const chooseLine = (id: string) => {
    choose([])
    setPicked({ line: id })
  }

  /**
   * A connect gesture ended on `target`. Between two element shapes the menu
   * asks which relationship; anything else gets a plain line at once, as Archi
   * draws one from a note or group.
   */
  const connect = (source: string, target: string) => {
    if (connectChoice(store, view, source, target).kind !== 'line') {
      setPending({ source, target })
      return
    }
    const id = newId('conn')
    if (store.addConnection(view.id, { id, kind: 'line', source, target })) chooseLine(id)
  }

  const create = (type: RelationshipType) => {
    if (!pending) return
    const choice = connectChoice(store, view, pending.source, pending.target)
    setPending(null)
    if (choice.kind !== 'relationship') return
    const relationship = newId('rel')
    const id = newId('conn')
    const made = store.addRelationshipInView(
      view.id,
      {
        id: relationship,
        type,
        source: choice.source.id,
        target: choice.target.id,
        properties: {},
      },
      { id, kind: 'relationship', relationship, source: pending.source, target: pending.target },
    )
    if (made) chooseLine(id)
  }

  /**
   * The magic connector's choice (#132): a new element of `target` where the
   * gesture ended, a `type` relationship to it from the source, and both
   * drawn, as one command. Its name opens for typing, as Archi opens a new
   * shape's.
   */
  const createMagic = (type: RelationshipType, target: ElementType) => {
    if (!magic) return
    setMagic(null)
    auto.current = false
    const base = store.view(view.id)
    if (!base) return
    const edit = magicEdit(base, magic.source, type, target, magic.at, isJunction, newId)
    if (!edit) return
    const made = store.updateViewAdding(view.id, () => edit.view, {
      elements: [edit.element],
      relationships: [edit.relationship],
    })
    if (!made) return
    choose([edit.node], made)
    // The editor opens only where there is a name to type (`editableText`), so
    // a junction gets none, and the closing menu hands focus back to the canvas.
    setEditing(edit.node)
  }

  const reuse = (relationship: string) => {
    if (!pending) return
    const { source, target } = pending
    setPending(null)
    const id = newId('conn')
    if (store.addConnection(view.id, { id, kind: 'relationship', relationship, source, target })) {
      chooseLine(id)
    }
  }

  /**
   * Commit `after`, which is `base` with `children` newly nested in `parent`,
   * as one command with what the nesting means (#131). Where Archi would ask,
   * the shapes stay drawn where they were dropped and the prompt opens; its
   * answer commits, and "none" commits the nesting alone. `adding` is a new
   * element the command makes with them, the palette's. `done` runs once the
   * command is made. Closing the prompt hands focus back to what opened it,
   * the canvas for a move; `done` says where it goes when that is wrong.
   */
  const nest = (
    base: View,
    after: View,
    parent: string | undefined,
    children: readonly string[],
    done: () => void,
    adding?: Element,
  ) => {
    const model = adding ? withNewElement(store, adding) : store
    const commit = (choices: NestingChoices) => {
      setNesting(null)
      setPreview(null)
      setPlacing(null)
      // The prompt is modal, so nothing else changes the view meanwhile; if
      // something did, the answer is not applied over it.
      if (store.view(view.id) !== base) return
      const edit =
        parent === undefined
          ? { view: after, relationships: [] }
          : nestingEdit(model, after, parent, children, choices, newId)
      const made = store.updateViewAdding(view.id, () => edit.view, {
        ...(adding ? { elements: [adding] } : {}),
        relationships: edit.relationships,
      })
      if (made) done()
    }
    const ask = parent === undefined ? undefined : nestingFor(model, after, parent, children)
    if (!ask) {
      commit(new Map())
      return
    }
    setPreview(after)
    setPlacing(adding ?? null)
    setNesting({ ask, commit })
  }

  /**
   * Place what `chosen` makes with its top-left corner at `at` (view
   * coordinates), inside whatever container is there (#130). An element is
   * made and drawn as one command; a note or group is one node. The new shape
   * is selected, and its name opens for typing, except a junction's, which has
   * none to show.
   */
  const place = (chosen: Tool, at: Point) => {
    // An edit hands the viewport to the user, so the auto-fit cannot make the
    // view jump. Here, not at each entry point: the keyboard path missed it
    // (#144 review).
    auto.current = false
    setTool(null)
    const spot = placement(view, at, toolSize(chosen), isJunction)
    if (chosen.kind === 'element') {
      const element = newElement(chosen)
      const node: ElementNode = { id: newId('node'), kind: 'element', element: element.id, ...spot }
      const base = store.view(view.id)
      if (!base) return
      // Placed in an element's shape, it asks what that means before its name
      // opens for typing, as Archi does.
      const after = { ...base, nodes: [...base.nodes, node] }
      nest(
        base,
        after,
        spot.parent,
        [node.id],
        () => {
          choose([node.id], store.view(view.id))
          if (chosen.type !== 'Junction') setEditing(node.id)
          else release()
        },
        element,
      )
      return
    }
    const node = newDrawingNode(chosen, spot)
    if (!store.addNode(view.id, node)) return
    choose([node.id], store.view(view.id))
    // A legend has no text to type (#134): the canvas keeps the keys, as for a junction.
    if (editableText(node) !== undefined) setEditing(node.id)
    else release()
  }

  /** The middle of the canvas on screen, in view coordinates: where the keyboard places. */
  const visibleCentre = (): Point => {
    const rect = canvas.current?.getBoundingClientRect()
    return toView({
      x: (rect?.left ?? 0) + (rect?.width ?? size.width) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? size.height) / 2,
    })
  }

  /** Place `chosen` centred in the visible canvas: the palette's keyboard path. */
  const placeAtCentre = (chosen: Tool) => {
    const centre = visibleCentre()
    const { width, height } = toolSize(chosen)
    place(chosen, { x: centre.x - width / 2, y: centre.y - height / 2 })
  }

  // Stable, so the memoised palette does not redraw with every canvas render.
  const latestPlace = useRef(placeAtCentre)
  latestPlace.current = placeAtCentre
  const placeFromPalette = useCallback((chosen: Tool) => latestPlace.current(chosen), [])
  const arm = useCallback((next: Tool | null) => {
    setTool(next)
    if (next) setPainter(null)
    // The canvas takes the next press, and Escape there disarms.
    if (next) canvas.current?.focus()
  }, [])

  /**
   * Draw an element the model already holds, dragged in from the model tree:
   * the same element, drawn again, never a copy. A view that draws it already
   * draws it twice, as Archi does. Its relationships to shapes already in the
   * view are drawn with it (#145), unless the copy key is held, as in Archi.
   * One command, so one undo takes the shape and its lines.
   */
  const drawExisting = (elementId: string, at: Point, withConnections: boolean) => {
    const element = store.element(elementId)
    if (!element) return
    auto.current = false
    const spot = placement(view, at, defaultNodeSize('element', element.type), isJunction)
    const node: ElementNode = { id: newId('node'), kind: 'element', element: element.id, ...spot }
    const base = store.view(view.id)
    if (!base) return
    const relationships = withConnections ? store.relationshipsOf(element.id) : []
    const after = withDrop(base, node, relationships, () => newId('conn'))
    nest(base, after, spot.parent, [node.id], () => {
      choose([node.id], store.view(view.id))
      release()
    })
  }

  /**
   * Draw a reference to the view `viewId`, dragged in from the model tree
   * (#134): one command, placed at Archi's default size inside whatever
   * container is there, as a palette shape is. A view dropped on itself draws
   * nothing, as in Archi; so does a view the model no longer holds.
   */
  const drawReference = (viewId: string, at: Point) => {
    if (viewId === view.id || !store.view(viewId)) return
    auto.current = false
    const node: ViewReferenceNode = {
      id: newId('node'),
      kind: 'view-ref',
      view: viewId,
      ...placement(view, at, defaultNodeSize('view-ref'), isJunction),
    }
    if (!store.addNode(view.id, node)) return
    choose([node.id], store.view(view.id))
    release()
  }

  /**
   * Commit what was typed into the inline editor: one command, or none when
   * nothing changed. Enter hands focus to the canvas, so the keyboard goes on
   * editing. A blur does not: it is the user putting focus somewhere else, and
   * taking it back made their next key edit the canvas (#144 review: Backspace
   * in the type filter deleted the shape just placed).
   */
  const commitName = (nodeId: string, value: string, ended: 'key' | 'blur') => {
    setEditing(null)
    if (ended === 'key') release()
    const node = view.nodes.find((n) => n.id === nodeId)
    if (!node) return
    if (node.kind === 'element') {
      const name = value.trim()
      const element = store.element(node.element)
      // An empty name is a slip, not a choice: the element keeps the one it had.
      if (element && name && name !== element.name) {
        store.updateElement(element.id, (e) => ({ ...e, name }))
      }
      return
    }
    store.updateNode(view.id, nodeId, (n) => {
      if (n.kind === 'note') return n.text === value ? n : { ...n, text: value }
      if (n.kind === 'group') {
        const name = value.trim()
        return name && name !== n.name ? { ...n, name } : n
      }
      return n
    })
  }

  /** What a node's inline editor starts from, or `undefined` for a node that has no name to type. */
  const editableText = (node: ViewNode | undefined): string | undefined => {
    if (!node) return undefined
    if (node.kind === 'note') return node.text
    if (node.kind === 'group') return node.name
    if (node.kind === 'element') {
      const element = store.element(node.element)
      return element && element.type !== 'Junction' ? element.name : undefined
    }
    return undefined
  }

  const endGesture = (client: Point) => {
    const g = gesture.current
    gesture.current = null
    setPressing(false)
    setPreview(null)
    setLasso(null)
    setDropInto(null)
    setRubber(null)
    setGuides([])
    if (!g) return
    if (g.kind === 'place') {
      // Where the press was, as Archi places on a click; a drag does not size it yet.
      place(g.tool, g.from)
      return
    }
    if (g.kind === 'pan') {
      if (!g.moved) {
        if (g.node) choose([g.node])
        else if (g.line) chooseLine(g.line)
        else choose([])
      }
      return
    }
    if (g.kind === 'connect') {
      if (!g.moved) return
      const at = toView(client)
      const over = nodeAt(view, at)
      if (over !== undefined && over !== g.source) connect(g.source, over)
      // On empty canvas, the magic connector (#132); the menu itself opens only
      // from an element's shape (`magicFrom`). A release off the canvas is a
      // drag abandoned, as it was before: the surface holds the pointer, so it
      // ends here wherever the pointer is (#181 review).
      else if (over === undefined && onCanvas(client)) setMagic({ source: g.source, at })
      return
    }
    if (g.kind === 'lasso') {
      if (!g.moved) {
        if (!g.additive) choose([])
        return
      }
      const inside = nodesInside(view, spanned(g.from, toView(client)))
      choose(g.additive ? [...g.base, ...inside.filter((id) => !g.base.includes(id))] : inside)
      return
    }
    if (g.kind === 'bend') {
      // A click on a handle changes nothing, as in GEF; a drag is one command.
      if (g.moved) store.updateView(view.id, (current) => bent(current, g, client))
      return
    }
    if (!g.moved) {
      // A click on a shape: select it alone, unless Shift or ⌘ already toggled it.
      if (g.kind === 'move' && !g.additive) choose([g.node])
      return
    }
    // Built on the store's current view; one that changed nothing is the view
    // itself, which the store records as nothing.
    if (g.kind === 'resize') {
      store.updateView(view.id, (current) => outcome(current, g, client))
      return
    }
    const base = store.view(view.id)
    if (!base) return
    const after = outcome(base, g, client)
    if (after === base) return
    // Shapes moved into an element's shape ask what that means (#131); a move
    // within the container they were in, or out of one, does not.
    const into = dropFor(base, g, client)
    const nested =
      into === undefined
        ? []
        : [...topSelected(base, g.ids)].filter(
            (id) => base.nodes.find((n) => n.id === id)?.parent !== into,
          )
    nest(base, after, into, nested, () => {})
  }

  /**
   * A run of nudges: the view before the first, the selection it moves, the
   * total so far, and the view the last one left. Each press is still its own
   * command, but each is computed from the start of the run by the running
   * total, so bend-points are rounded once, as one drag rounds them. Rounding at
   * every press would drift them: a weight-½ point would move 10 px for ten
   * 1 px presses one way and none the other (#140 review). A run ends when
   * anything else changes the view or the selection.
   */
  const nudgeRun = useRef<{
    start: View
    selection: string
    dx: number
    dy: number
    last: View
  } | null>(null)

  const nudge = (dx: number, dy: number) => {
    if (selected.length === 0) return
    auto.current = false
    const key = JSON.stringify(selected)
    const run = nudgeRun.current
    const continues = run !== null && run.last === view && run.selection === key
    const next = continues
      ? { ...run, dx: run.dx + dx, dy: run.dy + dy }
      : { start: view, selection: key, dx, dy, last: view }
    const ids = new Set(selected)
    const after = store.updateView(view.id, (current) =>
      // The run's start holds only if nothing else has changed the view since.
      current === next.last
        ? moveSelection(next.start, ids, next.dx, next.dy)
        : moveSelection(current, ids, dx, dy),
    )
    nudgeRun.current = after ? { ...next, last: after } : null
  }

  /** Whether an arrange action would change anything for the selection (#136). */
  const applies = (action: ArrangeAction): boolean => {
    switch (action.kind) {
      case 'align':
        return arrangeable(view, selected, 2) !== undefined
      case 'distribute':
        return arrangeable(view, selected, 3) !== undefined
      case 'match':
        return canMatch(view, selected)
      case 'order':
        return canReorder(view, selected, action.order)
    }
  }

  /** An arrange action, as one command; the selection stays, so the next one applies to it too. */
  const arrangeSelection = (action: ArrangeAction) => {
    auto.current = false
    const ids = [...selected]
    store.updateView(view.id, (current) => {
      switch (action.kind) {
        case 'align':
          return align(current, ids, action.alignment)
        case 'distribute':
          return distribute(current, ids, action.axis)
        case 'match':
          return matchSize(current, ids, action.dimension)
        case 'order':
          return reorder(current, ids, action.order)
      }
    })
  }

  /**
   * Paste `snapshot` into this view as one command (#137): the copies it makes,
   * if any, and the drawings. The pasted top-level shapes are selected
   * afterwards, as Archi selects them. `undefined` when nothing pastes.
   */
  const pasteHere = (snapshot: Snapshot, offset: Point, special: boolean) => {
    const made = pasteInto(store, view.id, snapshot, { offset, special, mint: newId })
    if (!made) return undefined
    auto.current = false
    choose([...made.pasted], made.view)
    return made
  }

  /** Run a clipboard chord; `true` when it did something, so the browser's own action is kept away. */
  const runChord = (chord: ClipboardChord): boolean => {
    const clipboard = clipboardFor(store)
    if (chord === 'copy') {
      const snapshot = copySelection(view, selected, store)
      if (!snapshot) return false
      clipboard.copy(snapshot)
      pressed.current = null
      return true
    }
    if (chord === 'duplicate') {
      // Copy and paste with no pointer, so at 10, 10 from the original; the clipboard is left alone.
      const snapshot = copySelection(view, selected, store)
      if (!snapshot) return false
      return pasteHere(snapshot, nextOffset(snapshot, { x: 0, y: 0 }, null), false) !== undefined
    }
    const snapshot = clipboard.snapshot
    if (!snapshot) return false
    const offset = nextOffset(snapshot, clipboard.offset, pressed.current)
    if (!pasteHere(snapshot, offset, chord === 'paste-special')) return false
    clipboard.pastedAt(offset)
    pressed.current = null
    return true
  }

  const zoomBy = (factor: number) =>
    steer(zoomAround(vp, vp.zoom * factor, { x: size.width / 2, y: size.height / 2 }))

  const exportSvg = () => {
    const g = drawingRef.current?.querySelector<SVGGElement>('[data-view-drawing]')
    if (!g || !drawing) return
    setExportError(null)
    try {
      downloadText(
        viewFileName(view.name, 'svg'),
        buildViewSvg(g, drawing, view.name).svg,
        'image/svg+xml',
      )
    } catch (error) {
      setExportError({ format: 'SVG', reason: reasonOf(error) })
    }
  }

  const exportPng = async () => {
    const g = drawingRef.current?.querySelector<SVGGElement>('[data-view-drawing]')
    if (!g || !drawing) return
    setExportError(null)
    try {
      downloadBlob(
        viewFileName(view.name, 'png'),
        await rasterise(buildViewSvg(g, drawing, view.name)),
      )
    } catch (error) {
      setExportError({ format: 'PNG', reason: reasonOf(error) })
    }
  }

  const selectedNode = single ? view.nodes.find((n) => n.id === single) : undefined
  const panelNode = pressing ? undefined : selectedNode
  const panelLine = pressing || panelNode ? undefined : selectedLine
  const panelMany = pressing || selected.length < 2 ? undefined : selected
  /** The selection's appearance (#135), in whichever panel shows the selection. */
  const appearance = (ids: readonly string[]) => (
    <DrawingAppearance
      // A new selection is a new section: a draft typed for one drawing never lands on another.
      key={JSON.stringify(ids)}
      store={store}
      view={view}
      ids={ids}
      editable={editable}
      isJunction={isJunction}
      painterSource={painter?.source ?? null}
      onPainter={(picked) => {
        setPainter(picked)
        if (!picked) return
        setTool(null)
        // As arm() does: the canvas takes the next press, and Escape there puts
        // the painter down. Left on the button, Escape reached nothing (#186 review).
        canvas.current?.focus()
      }}
      onDone={release}
    />
  )
  const route = (connection: ViewConnection) => connectionRoute(connection, bounds, shown.router)
  const pathOf = (points: Point[]) => `M${points.map((p) => `${p.x},${p.y}`).join('L')}`
  const choice = pending ? connectChoice(store, view, pending.source, pending.target) : undefined
  const magicFrom = magic ? magicSource(magic.source) : undefined
  // The one guard on the menu: a gesture from a shape that draws no element in
  // the model opens nothing, and a menu whose source has gone (removed, or
  // undone away) closes and stays closed rather than coming back with it.
  useEffect(() => {
    if (magic && !magicFrom) setMagic(null)
  }, [magic, magicFrom])
  const deletingRelationship = deleting === null ? undefined : store.relationship(deleting)
  const deletingElementValue = deletingElement === null ? undefined : store.element(deletingElement)
  const singleBounds = single ? bounds.get(single) : undefined
  // Handles hide while shapes are being dragged, and come back where they land.
  const dragging = preview !== null && gesture.current?.kind === 'move'
  const empty = !drawing
  const stats = [
    `${view.nodes.length} nodes`,
    `${view.connections.length} connections`,
    ...(view.viewpoint ? [`viewpoint ${view.viewpoint}`] : []),
  ].join(' · ')
  // Handles keep their screen size at any zoom.
  const handle = 7 / vp.zoom

  return (
    <div className="view-screen">
      <header className="view-screen__bar">
        <div>
          {editable ? (
            <h1 className="view-screen__title">
              <ViewNameField
                // Remounted when the stored name changes, so an undone rename shows.
                key={view.name}
                inputRef={nameField}
                name={view.name}
                onRename={(name) => store.updateView(view.id, (v) => ({ ...v, name }))}
                onDone={release}
              />
            </h1>
          ) : (
            <h1 className="view-screen__title">{view.name}</h1>
          )}
          <p className="view-screen__stats">{stats}</p>
        </div>
        {editable && (
          <div className="view-screen__settings">
            <label className="view-screen__viewpoint">
              <span className="view-screen__viewpoint-label">Viewpoint</span>
              <select
                className="view-screen__select"
                value={view.viewpoint ?? ''}
                onChange={(event) => {
                  const name = event.target.value
                  // Through the guard, as every form value is: only a viewpoint we know, or none.
                  if (name !== '' && !findViewpoint(name)) return
                  store.updateView(view.id, (v) => {
                    if ((v.viewpoint ?? '') === name) return v
                    const next = { ...v }
                    if (name === '') delete next.viewpoint
                    else next.viewpoint = name
                    return next
                  })
                }}
              >
                <option value="">None</option>
                {VIEWPOINTS.map((viewpoint) => (
                  <option key={viewpoint.id} value={viewpoint.name}>
                    {viewpoint.name}
                  </option>
                ))}
                {/* One from a newer tool: shown as it is, so the select does not claim "None". */}
                {view.viewpoint && !findViewpoint(view.viewpoint) && (
                  <option value={view.viewpoint} disabled>
                    {view.viewpoint}
                  </option>
                )}
              </select>
            </label>
            <label className="view-screen__viewpoint">
              <span className="view-screen__viewpoint-label">Router</span>
              <select
                className="view-screen__select"
                value={view.router ?? 'manual'}
                onChange={(event) => {
                  const router = event.target.value
                  // Through the guard (CLAUDE.md): only a router the model knows.
                  if (!isViewRouter(router)) return
                  store.updateView(view.id, (v) => {
                    if ((v.router ?? 'manual') === router) return v
                    const next = { ...v }
                    // Manual is the default, and absent, as one never switched.
                    if (router === 'manual') delete next.router
                    else next.router = router
                    return next
                  })
                }}
              >
                <option value="manual">Manual</option>
                <option value="manhattan">Manhattan</option>
              </select>
            </label>
          </div>
        )}
        <div className="view-screen__controls">
          <button type="button" className="button" onClick={fit} disabled={empty}>
            Fit
          </button>
          <button
            type="button"
            className="button"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            −
          </button>
          <span className="view-screen__zoom" aria-label="Zoom level">
            {Math.round(vp.zoom * 100)}%
          </span>
          <button
            type="button"
            className="button"
            aria-label="Zoom in"
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            +
          </button>
          <span className="view-screen__divider" />
          <button
            type="button"
            className="button"
            onClick={exportSvg}
            disabled={empty}
            title={empty ? 'Nothing to export: the view is empty' : undefined}
          >
            Export SVG
          </button>
          <button
            type="button"
            className="button"
            onClick={() => void exportPng()}
            disabled={empty}
            title={empty ? 'Nothing to export: the view is empty' : undefined}
          >
            Export PNG
          </button>
        </div>
      </header>
      {editable && (
        <ArrangeBar
          grid={grid}
          onGrid={changeGrid}
          applies={applies}
          onArrange={arrangeSelection}
        />
      )}
      {exportError && (
        <p role="alert" className="view-screen__error">
          {exportError.format} export failed: {exportError.reason}
        </p>
      )}

      <div
        className={`view-screen__body${panelNode || panelLine || panelMany ? ' view-screen__body--panel' : ''}${editable ? ' view-screen__body--palette' : ''}${editable && collapsed ? ' view-screen__body--collapsed' : ''}`}
      >
        {editable && (
          <ElementPalette
            ref={paletteFilter}
            viewpoint={view.viewpoint}
            armed={tool}
            onArm={arm}
            onPlace={placeFromPalette}
            collapsed={collapsed}
            onCollapse={collapse}
            onFind={find}
          />
        )}
        <div
          ref={canvas}
          className={`view-screen__canvas${editable ? ' view-screen__canvas--edit' : ''}${tool ? ' view-screen__canvas--place' : ''}${painter ? ' view-screen__canvas--paint' : ''}`}
          tabIndex={0}
          aria-label={`View ${view.name}`}
          aria-description={
            editable
              ? 'Drag shapes to move them, drag empty space to select, arrow keys to nudge. Drag from a selected shape’s connect handle to another shape to connect them. Delete removes from the view with everything inside; Shift+Delete keeps what is inside. Space and drag to pan. Command or Ctrl+C copies the selected shapes, Command or Ctrl+V pastes them where you last clicked, with Shift it draws the same elements again, and Command or Ctrl+D duplicates.'
              : undefined
          }
          onKeyDown={(event) => {
            if (event.key === ' ') {
              space.current = true
              event.preventDefault()
              return
            }
            if (event.key === 'Escape') {
              // As GEF does: Escape cancels a drag in progress, then an armed
              // palette tool, and only then the selection.
              if (gesture.current) cancelGesture()
              else if (painter) setPainter(null)
              else if (tool) setTool(null)
              else choose([])
              return
            }
            if (!editable || gesture.current) return
            const chord = clipboardChord(event)
            if (chord) {
              if (runChord(chord)) event.preventDefault()
              return
            }
            if (event.key === 'F2' && single) {
              // Archi's rename in place.
              if (editableText(view.nodes.find((n) => n.id === single)) !== undefined) {
                event.preventDefault()
                setEditing(single)
              }
              return
            }
            const step = event.shiftKey ? 10 : 1
            const arrows: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            }
            const arrow = arrows[event.key]
            if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLine) {
              // From the view only, as Archi's Delete; the model keeps the relationship.
              event.preventDefault()
              store.removeConnection(view.id, selectedLine.id)
              setPicked({ nodes: [] })
              return
            }
            if (arrow && selected.length) {
              event.preventDefault()
              nudge(arrow[0], arrow[1])
            } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected.length) {
              // As Archi: Delete removes a container with everything in it; Shift+Delete
              // is Archi's "Delete from View (keep children)" (DeleteContainerAction),
              // which lifts the children out where they were drawn.
              event.preventDefault()
              const ids = new Set(selected)
              store.updateView(view.id, (v) =>
                removeNodes(v, event.shiftKey ? ids : withDescendants(v, ids)),
              )
              choose([])
            }
          }}
          onKeyUp={(event) => {
            if (event.key === ' ') space.current = false
          }}
          onBlur={() => {
            // A Space released while focus was elsewhere never reaches the canvas.
            space.current = false
          }}
          onPointerDown={(event) => {
            const start = { x: event.clientX, y: event.clientY }
            // Any press, on a shape or not, as Archi's `PasteAction` listens to the whole canvas.
            pressed.current = toView(start)
            if (event.button !== 0 && event.button !== 1) return
            pointer.current = start
            const {
              node,
              handle: grip,
              line: hit,
              connect: linking,
              bendpoint: bendHandle,
              segment: segmentHandle,
            } = target(event)
            if (!editable || event.button === 1 || space.current) {
              gesture.current = { kind: 'pan', start, origin: vp, node, line: hit, moved: false }
              return
            }
            auto.current = false
            const from = toView(start)
            if (tool) {
              gesture.current = { kind: 'place', start, from, tool, moved: false }
              return
            }
            if (painter) {
              // Archi's format painter (#135): a press on a shape or a line paints
              // it, one command each, and selects nothing; anywhere else does nothing.
              const at = node ?? hit
              if (at)
                store.updateView(view.id, (v) => paintFormat(v, at, painter.format, isJunction))
              return
            }
            if (linking && single) {
              gesture.current = { kind: 'connect', start, source: single, moved: false }
              return
            }
            const bendAt = bendable ? (bendHandle ?? segmentHandle) : null
            if (bendable && selectedLine && bendAt !== null) {
              gesture.current = {
                kind: 'bend',
                start,
                connection: selectedLine.id,
                index: bendAt,
                adding: bendHandle === null,
                moved: false,
              }
              return
            }
            if (hit && !node) {
              // A press on a line selects it; its handles then shape it (#133).
              chooseLine(hit)
              return
            }
            if (grip && single) {
              gesture.current = {
                kind: 'resize',
                start,
                from,
                node: single,
                handle: grip,
                moved: false,
              }
              return
            }
            const additive = event.shiftKey || event.metaKey || event.ctrlKey
            if (node) {
              let ids = selected
              if (additive) {
                ids = selected.includes(node)
                  ? selected.filter((id) => id !== node)
                  : [...selected, node]
              } else if (!selected.includes(node)) {
                ids = [node]
              }
              if (ids !== selected) {
                // A selection made by this press: the panel waits for the release.
                setPressing(true)
                choose(ids)
              }
              gesture.current = {
                kind: 'move',
                start,
                from,
                node,
                ids: new Set(ids.includes(node) ? ids : []),
                additive,
                moved: false,
              }
              return
            }
            gesture.current = { kind: 'lasso', start, from, additive, base: selected, moved: false }
          }}
          onPointerMove={(event) => {
            const g = gesture.current
            if (!g) return
            // The button came up where the canvas could not see it: before the drag
            // captured the pointer, a release outside the canvas sends no pointerup.
            if (event.buttons === 0) {
              cancelGesture()
              return
            }
            const client = { x: event.clientX, y: event.clientY }
            pointer.current = client
            if (!g.moved && Math.hypot(client.x - g.start.x, client.y - g.start.y) < CLICK_SLOP) {
              return
            }
            // Captured only once it is a drag: capturing on press would retarget
            // the click and double-click to the canvas, and lose the shape.
            if (!g.moved) event.currentTarget.setPointerCapture?.(event.pointerId)
            g.moved = true
            if (g.kind === 'pan') {
              steer({
                ...g.origin,
                x: g.origin.x + client.x - g.start.x,
                y: g.origin.y + client.y - g.start.y,
              })
              return
            }
            if ((g.kind === 'move' && g.ids.size === 0) || g.kind === 'place') return
            track(client)
            autoScroll()
          }}
          onPointerUp={(event) => endGesture({ x: event.clientX, y: event.clientY })}
          onPointerCancel={cancelGesture}
          onDoubleClick={(event) => {
            const at = target(event)
            if (bendable && selectedLine && at.bendpoint !== null) {
              // Archi takes a bend-point out when it is dragged into line; a
              // double-click does it directly (#133). One command.
              const removed = at.bendpoint
              store.updateConnection(view.id, selectedLine.id, (c) => removeBendpoint(c, removed))
              return
            }
            const node = view.nodes.find((n) => n.id === at.node)
            if (node?.kind === 'view-ref' && store.view(node.view))
              navigate(`/view/${encodeURIComponent(node.view)}`)
            else if (editable && node && editableText(node) !== undefined) setEditing(node.id)
          }}
          onDragOver={(event) => {
            // An element row from the model tree (#130), or a view row (#134);
            // anything else is not ours to take.
            if (!editable) return
            const { types } = event.dataTransfer
            if (types.includes(VIEW_DRAG_TYPE)) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
              return
            }
            if (!types.includes(ELEMENT_DRAG_TYPE)) return
            event.preventDefault()
            // The copy key draws the shape alone (#145); the cursor says which drop this is.
            event.dataTransfer.dropEffect = heldCopyKey(event) ? 'copy' : 'move'
          }}
          onDrop={(event) => {
            // No role check: a browser sends `drop` only where `dragover` accepted, and that refuses a reader.
            const at = toView({ x: event.clientX, y: event.clientY })
            const viewId = event.dataTransfer.getData(VIEW_DRAG_TYPE)
            if (viewId) {
              event.preventDefault()
              drawReference(viewId, at)
              return
            }
            const elementId = event.dataTransfer.getData(ELEMENT_DRAG_TYPE)
            if (!elementId) return
            event.preventDefault()
            drawExisting(elementId, at, !heldCopyKey(event))
          }}
        >
          {empty ? (
            <p className="view-screen__notice">
              {editable
                ? 'This view is empty. Pick a type in the palette and click here to place it, or drag an element or a view in from the model tree.'
                : 'This view is empty.'}
            </p>
          ) : (
            <svg ref={drawingRef} className="view-screen__svg" data-testid="view-canvas">
              <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.zoom})`}>
                {/* The grid (#136), under the drawing and outside it, so no export draws it. */}
                {editable && grid.visible && grid.size * vp.zoom >= MIN_GRID_SPACING && (
                  <g data-testid="grid">
                    <defs>
                      <pattern
                        id={gridPattern}
                        width={grid.size}
                        height={grid.size}
                        patternUnits="userSpaceOnUse"
                      >
                        <path
                          className="view-screen__grid-line"
                          d={`M${grid.size},0L0,0L0,${grid.size}`}
                          vectorEffect="non-scaling-stroke"
                        />
                      </pattern>
                    </defs>
                    <rect
                      x={-vp.x / vp.zoom}
                      y={-vp.y / vp.zoom}
                      width={size.width / vp.zoom}
                      height={size.height / vp.zoom}
                      fill={`url(#${gridPattern})`}
                    />
                  </g>
                )}
                <ViewDrawing view={shown} bounds={bounds} children={children} lookups={lookups} />
                {/* Lines are thin; a wider, invisible stroke over each is what a press finds. */}
                <g data-testid="line-hits">
                  {shown.connections.map((connection) => {
                    if (shownHidden.has(connection.id)) return null
                    const points = route(connection)
                    return points ? (
                      <path
                        key={connection.id}
                        className="view-screen__hit"
                        data-line-hit={connection.id}
                        d={pathOf(points)}
                        strokeWidth={8 / vp.zoom}
                      />
                    ) : null
                  })}
                </g>
                {shownLine &&
                  (() => {
                    const points = route(shownLine)
                    if (!points) return null
                    const outline = (
                      <path
                        className="view-screen__selection-line"
                        data-testid="selection"
                        data-selected={shownLine.id}
                        d={pathOf(points)}
                        vectorEffect="non-scaling-stroke"
                      />
                    )
                    if (!bendable) return outline
                    // A bend-point's handle, and one in the middle of each segment to make one.
                    const bends = shownLine.bendpoints ?? []
                    const small = 5 / vp.zoom
                    return (
                      <>
                        {outline}
                        <g data-testid="bend-handles">
                          {segmentHandles(points).map((p, i) => (
                            <rect
                              key={`s${i}`}
                              className="view-screen__bend view-screen__bend--segment"
                              data-segment={i}
                              x={p.x - small / 2}
                              y={p.y - small / 2}
                              width={small}
                              height={small}
                              vectorEffect="non-scaling-stroke"
                            >
                              <title>Drag to bend the line here</title>
                            </rect>
                          ))}
                          {bends.map((p, i) => (
                            <rect
                              key={`b${i}`}
                              className="view-screen__bend"
                              data-bendpoint={i}
                              x={p.x - handle / 2}
                              y={p.y - handle / 2}
                              width={handle}
                              height={handle}
                              vectorEffect="non-scaling-stroke"
                            >
                              <title>Drag to move; double-click to remove</title>
                            </rect>
                          ))}
                        </g>
                      </>
                    )
                  })()}
                {dropInto && bounds.get(dropInto) && (
                  <rect
                    className="view-screen__drop"
                    data-testid="drop-target"
                    {...box(bounds.get(dropInto)!, 0)}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {guides.map((guide, i) => (
                  <line
                    key={i}
                    className="view-screen__guide"
                    data-testid="guide"
                    data-axis={guide.axis}
                    data-at={guide.at}
                    x1={guide.axis === 'x' ? guide.at : guide.from}
                    y1={guide.axis === 'x' ? guide.from : guide.at}
                    x2={guide.axis === 'x' ? guide.at : guide.to}
                    y2={guide.axis === 'x' ? guide.to : guide.at}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {selected.map((id, i) => {
                  const b = bounds.get(id)
                  // The primary selection, which align and match go by, as Archi marks it (#136).
                  const primary = selected.length > 1 && i === selected.length - 1
                  return b ? (
                    <rect
                      key={id}
                      className={`view-screen__selection${primary ? ' view-screen__selection--primary' : ''}`}
                      data-testid="selection"
                      data-selected={id}
                      data-primary={primary || undefined}
                      {...box(b, 2)}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null
                })}
                {editable && singleBounds && !dragging && (
                  <g data-testid="handles">
                    {HANDLES.map((h) => {
                      const p = handlePoint(singleBounds, h)
                      return (
                        <rect
                          key={h}
                          className={`view-screen__handle view-screen__handle--${h}`}
                          data-handle={h}
                          x={p.x - handle / 2}
                          y={p.y - handle / 2}
                          width={handle}
                          height={handle}
                          vectorEffect="non-scaling-stroke"
                        />
                      )
                    })}
                  </g>
                )}
                {editable && singleBounds && !dragging && !rubber && (
                  <g
                    className="view-screen__connect"
                    data-connect={single}
                    data-testid="connect-handle"
                    transform={`translate(${singleBounds.x + singleBounds.width + 12 / vp.zoom} ${singleBounds.y - 12 / vp.zoom}) scale(${1 / vp.zoom})`}
                  >
                    <title>Drag to another shape to connect</title>
                    <circle r={7} />
                    <path d="M-3,0L3,0M0.5,-2.5L3,0L0.5,2.5" />
                  </g>
                )}
                {rubber && (
                  <>
                    {rubber.over && bounds.get(rubber.over) && (
                      <rect
                        className="view-screen__drop"
                        data-testid="connect-target"
                        {...box(bounds.get(rubber.over)!, 0)}
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    <line
                      className="view-screen__rubber"
                      data-testid="rubber-band"
                      x1={rubber.from.x}
                      y1={rubber.from.y}
                      x2={rubber.to.x}
                      y2={rubber.to.y}
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                )}
                {lasso && (
                  <rect
                    className="view-screen__lasso"
                    data-testid="lasso"
                    {...box(lasso, 0)}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            </svg>
          )}
          {editing &&
            (() => {
              const node = view.nodes.find((n) => n.id === editing)
              const text = editableText(node)
              const b = bounds.get(editing)
              if (!node || text === undefined || !b) return null
              return (
                <InlineName
                  key={editing}
                  initial={text}
                  multiline={node.kind === 'note'}
                  label={
                    node.kind === 'note'
                      ? 'Note text'
                      : node.kind === 'group'
                        ? 'Group name'
                        : 'Element name'
                  }
                  box={{
                    left: b.x * vp.zoom + vp.x,
                    top: b.y * vp.zoom + vp.y,
                    width: b.width * vp.zoom,
                    height: b.height * vp.zoom,
                  }}
                  onCommit={(value, ended) => commitName(editing, value, ended)}
                  onCancel={() => {
                    setEditing(null)
                    release()
                  }}
                />
              )
            })()}
          {painter && (
            <PainterBanner
              onDone={() => {
                setPainter(null)
                release()
              }}
            />
          )}
          {drawing && viewport && size.width > 0 && (
            <Minimap
              drawing={drawing}
              boxes={bounds.values()}
              viewport={viewport}
              screen={size}
              onCentre={(point) => steer(centreOn(vp, point, size.width, size.height))}
            />
          )}
        </div>
        {panelNode && (
          <SelectionPanel
            // Keyed on the node, so a field's typing never carries to the next one (CLAUDE.md).
            key={panelNode.id}
            node={panelNode}
            view={view}
            store={store}
            editable={editable}
            onUpdate={(change) => store.updateNode(view.id, panelNode.id, change)}
            onDone={release}
            onRemove={() => {
              // As the Delete key: from the view only, with what is nested in it.
              const ids = new Set([panelNode.id])
              store.updateView(view.id, (v) => removeNodes(v, withDescendants(v, ids)))
              choose([])
              release()
            }}
            onDelete={(element) => setDeletingElement(element)}
            onClose={() => {
              choose([])
              release()
            }}
          >
            {appearance([panelNode.id])}
          </SelectionPanel>
        )}
        {panelMany && (
          <MultiSelectionPanel
            count={panelMany.length}
            onClose={() => {
              choose([])
              release()
            }}
          >
            {appearance(panelMany)}
          </MultiSelectionPanel>
        )}
        {panelLine && (
          <LinePanel
            // Keyed on the line, so a field's typing never carries to the next one (CLAUDE.md).
            key={panelLine.id}
            connection={panelLine}
            view={view}
            store={store}
            editable={editable}
            onDocument={(relationship, value) => {
              if (value === (store.relationship(relationship)?.documentation ?? '')) return
              store.updateRelationship(relationship, (r) => {
                // Cleared is absent, as on a relationship never documented (#171).
                if (value === '') delete r.documentation
                else r.documentation = value
                return r
              })
            }}
            onDone={release}
            onRemove={() => {
              store.removeConnection(view.id, panelLine.id)
              setPicked({ nodes: [] })
              release()
            }}
            onDelete={(relationship) => setDeleting(relationship)}
            onClose={() => {
              setPicked({ nodes: [] })
              release()
            }}
            onStraighten={() => {
              store.updateConnection(view.id, panelLine.id, straightened)
              // The button goes with the bend-points, and focus with it: back to the canvas.
              release()
            }}
            onLabelPosition={(position) =>
              store.updateConnection(view.id, panelLine.id, (c) => {
                if ((c.appearance?.labelPosition ?? 'middle') === position) return c
                const appearance = { ...c.appearance }
                // The middle is the default, and absent, as on a line never moved (#133).
                if (position === 'middle') delete appearance.labelPosition
                else appearance.labelPosition = position
                const next = { ...c }
                if (Object.keys(appearance).length) next.appearance = appearance
                else delete next.appearance
                return next
              })
            }
          >
            {appearance([panelLine.id])}
          </LinePanel>
        )}
      </div>
      {nesting && <NestingDialog nesting={nesting.ask} onDone={nesting.commit} />}
      {magic && magicFrom && (
        <MagicMenu
          source={magicFrom}
          entries={magicMenu(store, magicFrom, view.viewpoint)}
          nothing={magicNothing(store, magicFrom)}
          onCreate={createMagic}
          onCancel={() => setMagic(null)}
        />
      )}
      {choice && choice.kind !== 'line' && (
        <ConnectMenu
          choice={choice}
          onCreate={create}
          onReuse={(relationship) => reuse(relationship.id)}
          onCancel={() => setPending(null)}
        />
      )}
      {deletingElementValue && (
        <DeleteElementDialog
          element={deletingElementValue}
          removal={store.removalPreview(deletingElementValue.id)}
          inView
          elsewhere={store
            .viewsDrawing(deletingElementValue.id)
            .filter((other) => other.id !== view.id)}
          onConfirm={() => {
            store.removeElement(deletingElementValue.id)
            setDeletingElement(null)
            choose([])
            release()
          }}
          onCancel={() => setDeletingElement(null)}
        />
      )}
      {deletingRelationship && (
        <DeleteRelationshipDialog
          relationship={deletingRelationship}
          elsewhere={store
            .viewsDrawingRelationship(deletingRelationship.id)
            .filter((other) => other.id !== view.id)}
          onConfirm={() => {
            store.removeRelationship(deletingRelationship.id)
            setDeleting(null)
            setPicked({ nodes: [] })
            release()
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

/** Why an export failed, in words the alert can show. */
const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A handle's index from its data attribute, or `null` for none. */
function index(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : null
}

const box = (b: Bounds, pad: number) => ({
  x: b.x - pad,
  y: b.y - pad,
  width: b.width + pad * 2,
  height: b.height + pad * 2,
})

function handlePoint(b: Bounds, h: Handle): Point {
  const x = h.includes('w') ? b.x : h.includes('e') ? b.x + b.width : b.x + b.width / 2
  const y = h.includes('n') ? b.y : h.includes('s') ? b.y + b.height : b.y + b.height / 2
  return { x, y }
}

function SelectionPanel({
  node,
  view,
  store,
  editable,
  onUpdate,
  onDone,
  onRemove,
  onDelete,
  onClose,
  children,
}: {
  node: ViewNode
  view: View
  store: ModelStore
  editable: boolean
  /** Change the selected node, as one command; one that changes nothing makes none. */
  onUpdate: (change: (node: ViewNode) => ViewNode) => void
  /** A field's Enter or Escape is done with it: focus goes back to the canvas. */
  onDone: () => void
  onRemove: () => void
  onDelete: (element: string) => void
  onClose: () => void
  /** The drawing's appearance (#135), below its actions. */
  children?: React.ReactNode
}) {
  const navigate = useNavigate()
  const close = (
    <button type="button" className="button" onClick={onClose}>
      Close
    </button>
  )

  if (node.kind === 'element') {
    const element = store.element(node.element)
    if (!element) {
      return (
        <aside className="view-panel" aria-label="Selection">
          <div className="view-panel__kind">Missing element</div>
          <p className="view-panel__text">
            This shape draws <code>{node.element}</code>, which is not in the model.
          </p>
          <div className="view-panel__actions">{close}</div>
          {children}
        </aside>
      )
    }
    const relations = store.outgoing(element.id).length + store.incoming(element.id).length
    const views = store.viewsDrawing(element.id).length
    const documentation = element.documentation?.trim()
    const excluding = excludedBy(view.viewpoint, element.type)
    return (
      <aside className="view-panel" aria-label={`Selected: ${element.name}`}>
        <div className="view-panel__head">
          <TypeCodeBadge type={element.type} size={22} />
          <div>
            <div className="view-panel__name">{element.name}</div>
            <div className="view-panel__type">{typeLabel(element.type)}</div>
          </div>
        </div>
        {excluding && (
          // Why it is drawn ghosted (#194), naming the viewpoint, as the drawing cannot.
          <p className="view-panel__text view-panel__ghost">
            Ghosted: the {excluding.name} viewpoint does not allow this element.
          </p>
        )}
        <div className="view-panel__stats">
          <div className="view-panel__stat">
            <div className="view-panel__stat-key">Relations</div>
            <div className="view-panel__stat-value">{relations}</div>
          </div>
          <div className="view-panel__stat">
            <div className="view-panel__stat-key">Views</div>
            <div className="view-panel__stat-value">{views}</div>
          </div>
        </div>
        {documentation ? (
          <p className="view-panel__text">
            {documentation.length > 280 ? `${documentation.slice(0, 280)}…` : documentation}
          </p>
        ) : (
          <p className="view-panel__text view-panel__text--empty">No documentation.</p>
        )}
        <div className="view-panel__actions view-panel__actions--wrap">
          <button
            type="button"
            className="button button--primary"
            onClick={() => navigate(`/element/${encodeURIComponent(element.id)}`)}
          >
            Open fact sheet
          </button>
          {editable && (
            <button type="button" className="button" onClick={onRemove}>
              Remove from view
            </button>
          )}
          {editable && (
            <button type="button" className="button" onClick={() => onDelete(element.id)}>
              Delete from model…
            </button>
          )}
          {close}
        </div>
        {children}
      </aside>
    )
  }

  if (node.kind === 'view-ref') {
    const target = store.view(node.view)
    return (
      <aside className="view-panel" aria-label="Selected view reference">
        <div className="view-panel__kind">View reference</div>
        <div className="view-panel__name">{target?.name ?? 'Missing view'}</div>
        <div className="view-panel__actions">
          {target && (
            <button
              type="button"
              className="button button--primary"
              onClick={() => navigate(`/view/${encodeURIComponent(target.id)}`)}
            >
              Open view
            </button>
          )}
          {close}
        </div>
        {children}
      </aside>
    )
  }

  if (node.kind === 'legend') {
    const entries = legendEntries(view, node.options, {
      elementType: (id) => store.element(id)?.type,
      relationshipType: (id) => store.relationship(id)?.type,
    })
    return (
      <aside className="view-panel" aria-label="Selected legend">
        <div className="view-panel__kind">Legend</div>
        <p className="view-panel__text">
          {entries.length
            ? `Lists the ${entries.length} element and relationship type${entries.length === 1 ? '' : 's'} this view draws.`
            : 'This view draws no elements or relationships yet, so the legend lists nothing.'}
        </p>
        <div className="view-panel__actions">{close}</div>
        {children}
      </aside>
    )
  }

  if (node.kind === 'group' && editable) {
    return (
      <aside className="view-panel" aria-label="Selected group">
        <div className="view-panel__kind">Group</div>
        <PanelTextField
          // Remounted when the stored value changes, so an undone edit shows.
          key={`name ${node.name}`}
          label="Name"
          value={node.name}
          onCommit={(value) => {
            const name = value.trim()
            // An empty name is a slip, as on the canvas: the group keeps its own.
            onUpdate((n) => (n.kind === 'group' && name && name !== n.name ? { ...n, name } : n))
          }}
          onDone={onDone}
        />
        <PanelTextField
          key={`documentation ${node.documentation ?? ''}`}
          label="Documentation"
          multiline
          value={node.documentation ?? ''}
          onCommit={(value) =>
            onUpdate((n) => {
              if (n.kind !== 'group' || value === (n.documentation ?? '')) return n
              const next = { ...n }
              // Cleared is absent, as on a group never documented.
              if (value === '') delete next.documentation
              else next.documentation = value
              return next
            })
          }
          onDone={onDone}
        />
        <div className="view-panel__actions">{close}</div>
        {children}
      </aside>
    )
  }

  return (
    <aside className="view-panel" aria-label={`Selected ${node.kind}`}>
      <div className="view-panel__kind">{node.kind === 'note' ? 'Note' : 'Group'}</div>
      <p className="view-panel__text view-panel__text--pre">
        {node.kind === 'note' ? node.text : node.name}
      </p>
      {node.kind === 'group' && node.documentation && (
        <p className="view-panel__text view-panel__text--pre">{node.documentation}</p>
      )}
      <div className="view-panel__actions">{close}</div>
      {children}
    </aside>
  )
}

/**
 * A text field in the selection panel (#134): it commits once, when the typing
 * is done, never per keystroke, so each edit is one command. Leaving the field
 * commits; so does Enter on a one-line field, and ⌘/Ctrl+Enter on a multi-line
 * one, where Enter is a new line. Escape puts the stored value back. Both keys
 * hand focus to the canvas; leaving does not, since that is the user putting
 * focus somewhere (CLAUDE.md).
 *
 * The browser keeps its own undo of the typing while the field has focus: the
 * global ⌘Z stands down in a text field (`hasNativeUndo`).
 *
 * A press on another shape changes the selection before the browser moves
 * focus, and this field unmounts with the panel while it still has focus,
 * which sends no `blur`. So what was typed and not yet committed is committed
 * as the field unmounts, or a click elsewhere on the canvas would lose it.
 */
function PanelTextField({
  label,
  value,
  multiline = false,
  onCommit,
  onDone,
}: {
  label: string
  value: string
  multiline?: boolean
  onCommit: (value: string) => void
  onDone: () => void
}) {
  /** What is typed and not yet committed, or `null` when the field holds the stored value. */
  const pending = useRef<string | null>(null)
  const { store } = useModelStoreContext()
  const latest = useRef({ onCommit, value, store })
  latest.current = { onCommit, value, store }
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const commit = () => {
    const typed = pending.current
    pending.current = null
    if (typed === null) return
    latest.current.onCommit(typed)
    // The field shows what is stored: a commit that changed it remounts the
    // field with the new value, and one that was refused, an empty name, puts
    // the old one back rather than leaving the slip on show.
    if (input.current) input.current.value = latest.current.value
  }
  // Typing still pending when the field goes is committed, unless the field
  // goes because the tab became a reader: the store refuses that write, and a
  // throw here, in React's commit, would take the whole app down (#198). What
  // was typed is dropped, as a fact sheet's field drops it (#195).
  useEffect(
    () => () => {
      if (latest.current.store.writable) commit()
    },
    [],
  )
  const props = {
    ref: input,
    className: `view-panel__input${multiline ? ' view-panel__input--multiline' : ''}`,
    defaultValue: value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      pending.current = event.currentTarget.value
    },
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.currentTarget.value = value
        pending.current = null
        onDone()
      } else if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        commit()
        onDone()
      }
    },
  }
  return (
    <label className="view-panel__field">
      <span className="view-panel__stat-key">{label}</span>
      {multiline ? <textarea rows={4} {...props} /> : <input {...props} />}
    </label>
  )
}

/**
 * A selected connection: what it draws, and Archi's two ways to remove it.
 * Remove from view leaves the relationship in the model; Delete from model
 * takes it out of every view, after saying which (#129). A relationship's
 * documentation is edited here, as in Archi's Properties view (#171).
 */
function LinePanel({
  connection,
  view,
  store,
  editable,
  onDocument,
  onDone,
  onRemove,
  onDelete,
  onClose,
  onStraighten,
  onLabelPosition,
  children,
}: {
  connection: ViewConnection
  view: View
  store: ModelStore
  editable: boolean
  /** Commit a relationship's documentation; `''` clears it. */
  onDocument: (relationship: string, value: string) => void
  /** Hand focus back to the canvas, once a field's Enter or Escape is done. */
  onDone: () => void
  onRemove: () => void
  onDelete: (relationship: string) => void
  onClose: () => void
  /** Remove every bend-point (#133). */
  onStraighten: () => void
  onLabelPosition: (position: LabelPosition) => void
  /** The line's appearance (#135), below its actions. */
  children?: React.ReactNode
}) {
  // A Manhattan view ignores bend-points, so there is nothing to remove (#133).
  const manual = view.router !== 'manhattan'
  const nameOf = (nodeId: string) => {
    const node = view.nodes.find((n) => n.id === nodeId)
    if (!node) return nodeId
    if (node.kind === 'element') return store.element(node.element)?.name ?? node.element
    if (node.kind === 'note') return 'Note'
    if (node.kind === 'group') return node.name
    if (node.kind === 'legend') return 'Legend'
    return store.view(node.view)?.name ?? 'View reference'
  }
  const relationship =
    connection.kind === 'relationship' ? store.relationship(connection.relationship) : undefined
  const views = relationship ? store.viewsDrawingRelationship(relationship.id).length : 0
  /**
   * The viewpoint that ghosts this line, by `ghostsIn`'s rule: it refuses the
   * element at either end of a relationship's line (#194). Asked of the two
   * ends, not of the whole view, and named as the shape's panel names it.
   */
  const excluding = (() => {
    if (connection.kind !== 'relationship') return undefined
    for (const end of [connection.source, connection.target]) {
      const node = view.nodes.find((n) => n.id === end)
      const type = node?.kind === 'element' ? store.element(node.element)?.type : undefined
      const viewpoint = type && excludedBy(view.viewpoint, type)
      if (viewpoint) return viewpoint
    }
    return undefined
  })()
  const documentation = relationship?.documentation?.trim()
  return (
    <aside
      className="view-panel"
      aria-label={relationship ? `Selected: ${relationship.type} relationship` : 'Selected line'}
    >
      <div className="view-panel__kind">{relationship ? 'Relationship' : 'Line'}</div>
      {relationship && (
        <div className="view-panel__name view-panel__name--mono">{relationship.type}</div>
      )}
      <p className="view-panel__text">
        {nameOf(connection.source)} → {nameOf(connection.target)}
      </p>
      {excluding && (
        <p className="view-panel__text view-panel__ghost">
          Ghosted: the {excluding.name} viewpoint does not allow an element at its end.
        </p>
      )}
      {relationship && (
        <div className="view-panel__stats view-panel__stats--one">
          <div className="view-panel__stat">
            <div className="view-panel__stat-key">Views</div>
            <div className="view-panel__stat-value">{views}</div>
          </div>
        </div>
      )}
      {relationship &&
        (editable ? (
          <PanelTextField
            // Remounted when the stored value changes, so an undone edit shows.
            key={`documentation ${relationship.documentation ?? ''}`}
            label="Documentation"
            multiline
            value={relationship.documentation ?? ''}
            onCommit={(value) => onDocument(relationship.id, value)}
            onDone={onDone}
          />
        ) : documentation ? (
          <p className="view-panel__text view-panel__text--pre">{relationship.documentation}</p>
        ) : (
          <p className="view-panel__text view-panel__text--empty">No documentation.</p>
        ))}
      {editable && (
        <label className="view-panel__field">
          <span className="view-panel__stat-key">Label</span>
          <select
            className="view-screen__select"
            value={connection.appearance?.labelPosition ?? 'middle'}
            onChange={(event) => {
              const position = event.target.value
              // Through the guard (CLAUDE.md): only a position the model knows.
              if (isLabelPosition(position)) onLabelPosition(position)
            }}
          >
            <option value="source">At the source</option>
            <option value="middle">In the middle</option>
            <option value="target">At the target</option>
          </select>
        </label>
      )}
      <div className="view-panel__actions view-panel__actions--wrap">
        {editable && (
          <button type="button" className="button" onClick={onRemove}>
            Remove from view
          </button>
        )}
        {editable && manual && connection.bendpoints?.length ? (
          <button type="button" className="button" onClick={onStraighten}>
            Remove bend-points
          </button>
        ) : null}
        {editable && relationship && (
          <button type="button" className="button" onClick={() => onDelete(relationship.id)}>
            Delete from model…
          </button>
        )}
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      {children}
    </aside>
  )
}

/**
 * The view's name, typed where it is shown (#130). Enter or leaving the field
 * renames, as one command; Escape puts the name back. An empty name is not
 * taken. It never focuses itself: it remounts on every rename, so focus is
 * given to it by the canvas, once, when a new view opens.
 */
function ViewNameField({
  inputRef: ref,
  name,
  onRename,
  onDone,
}: {
  inputRef: React.RefObject<HTMLInputElement>
  name: string
  onRename: (name: string) => void
  onDone: () => void
}) {
  const commit = (value: string) => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== name) onRename(trimmed)
    else if (ref.current) ref.current.value = name
  }
  return (
    <input
      ref={ref}
      className="view-screen__name"
      aria-label="View name"
      defaultValue={name}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit(event.currentTarget.value)
          onDone()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.value = name
          onDone()
        }
      }}
      onBlur={(event) => commit(event.currentTarget.value)}
    />
  )
}
