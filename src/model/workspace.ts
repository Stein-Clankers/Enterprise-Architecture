import type { ElementType, JunctionKind } from './element-types'
import type { AccessType, RelationshipType } from './relationship-types'
import type { PortfolioProfile } from './profile'
import type { PlanProfile } from './plan'
import type { Layer } from './layers'

/**
 * The workspace: plain, serialisable data. The in-memory store (#4) wraps this
 * with indexes and a command stack; the canonical JSON format (#5) is this shape
 * with sorted keys and deterministic array order.
 */

/**
 * Current native schema version. Bump on any breaking shape change, and teach
 * `migrate.ts` to bring the previous version forward.
 *
 * - 1: elements, relationships, saved report views (`views`), tag groups.
 * - 2: hand-drawn views (`views`), folders; saved report views move to `reports`.
 * - 3: `Relationship.isDirected` and `Relationship.modifier` (#84). No shape
 *   change for older data; the bump is so a schema-2 build warns that it drops
 *   them rather than losing them quietly.
 * - 4: `Relationship.documentation` and `Workspace.documentation` (#95). No
 *   shape change for older data either; a schema-3 build warns that it drops
 *   them.
 * - 5: `View.router` and a connection's `Appearance.labelPosition` (#133). No
 *   shape change for older data either.
 * - 6: `Element.plan`: rollouts, waves and their site plans (#209). No shape
 *   change for older data either; a schema-5 build warns that it drops them.
 * - 7: initiatives, an `Element.plan` of kind `initiative` with its change
 *   entries (#61, ADR 0014). No shape change for older data either; a schema-6
 *   build reads such a plan as one it cannot read, and says so.
 */
export const SCHEMA_VERSION = 7

/** ArchiMate properties are string-valued in the exchange format; numbers and
 *  booleans are allowed here and serialise as their string form. */
export type PropertyValue = string | number | boolean

export interface Element {
  id: string
  type: ElementType
  name: string
  documentation?: string
  properties: Record<string, PropertyValue>
  profile?: PortfolioProfile
  /**
   * A Work Package's plan profile: a rollout with its site plans, one of its
   * waves (#209, ADR 0013), or an initiative (#61, ADR 0014). Absent on every
   * other element.
   */
  plan?: PlanProfile
  /**
   * And/or flavour of a `Junction`; meaningless on every other type. Absent
   * means `and`, which is what the specification says an unqualified junction is.
   */
  junctionKind?: JunctionKind
  /** Folder the element is filed in; absent means its type's default group. */
  folder?: string
}

/**
 * Relationship properties are first class (concept §4.3): support type, annual
 * cost, CRUD usage and validity dates live on the edge, not on either endpoint.
 * Anything not modelled here still lives in `properties`.
 */
export interface RelationshipProfile {
  /** Total annual cost carried by this dependency, in `currency`. */
  annualCost?: number
  currency?: string
  /** LeanIX-style support type on an application → capability realization. */
  supportType?: string
  /** Relation validity window — the time dimension on edges. */
  validFrom?: string
  validTo?: string
  /** Access qualifier for Access relationships. */
  accessType?: AccessType
}

export interface Relationship {
  id: string
  type: RelationshipType
  source: string
  target: string
  name?: string
  /**
   * What the relationship means, in the author's words: the exchange format's
   * `<documentation>` on a relationship, Archi's on any relationship (#95).
   */
  documentation?: string
  properties: Record<string, PropertyValue>
  profile?: RelationshipProfile
  /**
   * Association only: drawn with a half-arrowhead at the target. Absent means
   * undirected, which is what the specification says an unqualified association
   * is, so `false` is never stored.
   */
  isDirected?: true
  /**
   * Influence only: the strength the specification annotates the line with —
   * `+`, `++`, `-`, `--`, or any other text, such as a number on a scale.
   */
  modifier?: string
  /** Folder the relationship is filed in; absent means the Relations group. */
  folder?: string
}

/**
 * A saved report definition — the report engine's five primitives (concept §6.1).
 *
 * Called `ViewDefinition` and stored under `views` until schema 2, when hand-drawn
 * diagrams took the name `View` (#75).
 */
export interface ReportDefinition {
  id: string
  name: string
  kind: 'graph' | 'capability-map' | 'landscape' | 'matrix' | 'roadmap' | 'portfolio'
  baseType?: ElementType
  /** Facet filter, in the inventory's own encoding (`layer:application`, …). */
  filter?: { facets: string[]; mode: 'AND' | 'OR' | 'NOT'; query?: string }
  cluster?: string
  drilldown?: string
  colorView?: 'layer' | 'lifecycle' | 'time'
  /** Time point as a year, matching the graph slider. */
  timePoint?: number
}

// ── Hand-drawn views (#75, modelling concept §5.1) ───────────────────────────

/**
 * Position and size of a diagram node, **relative to its parent node** — or to
 * the view, for a node without one. Relative because that is what makes a group
 * move as one: dragging a parent changes one node's bounds, not every
 * descendant's. Archi stores nodes the same way; the exchange format's absolute
 * coordinates are converted at the boundary.
 */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** A point in view coordinates (absolute, not relative to any node). */
export interface Point {
  x: number
  y: number
}

export const FONT_STYLES = ['bold', 'italic', 'underline', 'strikethrough'] as const
export type FontStyle = (typeof FONT_STYLES)[number]

export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number]

export const TEXT_POSITIONS = ['top', 'middle', 'bottom'] as const
export type TextPosition = (typeof TEXT_POSITIONS)[number]

/**
 * Where a connection's label sits along it: Archi's `textPosition` on a
 * connection (`IDiagramModelConnection.CONNECTION_TEXT_POSITION_*`: 0 source,
 * 1 middle, 2 target), whose default is the middle.
 */
export const LABEL_POSITIONS = ['source', 'middle', 'target'] as const
export type LabelPosition = (typeof LABEL_POSITIONS)[number]

export function isLabelPosition(value: unknown): value is LabelPosition {
  return (LABEL_POSITIONS as readonly unknown[]).includes(value)
}

/**
 * How a view routes its connections: Archi's `connectionRouterType`. `manual`
 * (0, the default) runs each line through its bend-points; `manhattan` (2)
 * draws every line in horizontal and vertical segments and ignores its
 * bend-points, as Archi's `ManhattanConnectionRouter` does. Archi retired the
 * shortest-path router (1).
 */
export const VIEW_ROUTERS = ['manual', 'manhattan'] as const
export type ViewRouter = (typeof VIEW_ROUTERS)[number]

export function isViewRouter(value: unknown): value is ViewRouter {
  return (VIEW_ROUTERS as readonly unknown[]).includes(value)
}

/**
 * Per-object overrides of the notation's default look. Every field is optional:
 * absent means "as the notation draws it", so a model that never touched
 * appearance carries none of this. Colours are `#rrggbb`, or `#rrggbbaa` with an
 * alpha — the user's data, not the product palette, so tokens do not apply.
 */
export interface Appearance {
  fillColor?: string
  lineColor?: string
  lineWidth?: number
  fontName?: string
  fontSize?: number
  fontColor?: string
  fontStyle?: FontStyle[]
  textAlignment?: TextAlignment
  /** A shape's text, top to bottom. */
  textPosition?: TextPosition
  /** A connection's label, along the line (#133). */
  labelPosition?: LabelPosition
}

interface ViewNodeBase {
  /** Unique within its view. */
  id: string
  bounds: Bounds
  /** Id of the node this one is nested in, within the same view. */
  parent?: string
  appearance?: Appearance
}

/** A drawing of a model element. Many nodes, in many views, may draw one element. */
export interface ElementNode extends ViewNodeBase {
  kind: 'element'
  element: string
}

/** Free text on the canvas; not part of the model. */
export interface NoteNode extends ViewNodeBase {
  kind: 'note'
  text: string
}

/** A visual group: a labelled box, not the ArchiMate Grouping element. */
export interface GroupNode extends ViewNodeBase {
  kind: 'group'
  name: string
  documentation?: string
}

/** A link to another view, drawn as a box that navigates there. */
export interface ViewReferenceNode extends ViewNodeBase {
  kind: 'view-ref'
  view: string
}

/**
 * A legend (#134): a box listing the element and relationship types the view
 * draws, each with its symbol. Archi 5.10 saves one as a note carrying a
 * `legend` feature (`IDiagramModelNote.FEATURE_LEGEND`); here it is a kind of
 * its own, because it shows no text and holds no text to edit. The entries are
 * never stored: they are worked out from the view each time it is drawn
 * (`legendEntries`), as Archi's `LegendGraphics.update` does.
 */
export interface LegendNode extends ViewNodeBase {
  kind: 'legend'
  /**
   * Archi names a new legend "Legend" (`ArchimateDiagramModelFactory`) and
   * draws the name nowhere. Kept so a legend comes back out as it came in.
   */
  name?: string
  options: LegendOptions
}

/** Which colour a legend paints its symbols in: Archi's `ILegendOptions.COLORS_*` (0, 1, 2). */
export const LEGEND_COLOURS = ['none', 'core', 'user'] as const
export type LegendColours = (typeof LEGEND_COLOURS)[number]

/** How a legend orders its element entries: Archi's `ILegendOptions.SORT_*` (0, 1). */
export const LEGEND_SORTS = ['name', 'category'] as const
export type LegendSort = (typeof LEGEND_SORTS)[number]

/** Archi's bounds on a legend's rows per column and its column offset (`ILegendOptions`). */
export const LEGEND_ROWS = { min: 1, max: 100 } as const
export const LEGEND_WIDTH_OFFSET = { min: -200, max: 200 } as const

/**
 * What a legend shows and how: Archi's `ILegendOptions`, field for field. Every
 * field is stored, as Archi writes every one of them.
 */
export interface LegendOptions {
  /** List the view's element types. */
  elements: boolean
  /** List the view's relationship types. */
  relations: boolean
  /** List specializations of elements, by the specialization's name. */
  specializedElements: boolean
  /** List specializations of relationships, by the specialization's name. */
  specializedRelations: boolean
  /** Entries per column, `LEGEND_ROWS.min` to `LEGEND_ROWS.max`. */
  rowsPerColumn: number
  /** Extra space between columns, in pixels, within `LEGEND_WIDTH_OFFSET`. */
  widthOffset: number
  colours: LegendColours
  sort: LegendSort
}

/** A new legend's options: Archi 5.10's defaults (`ILegendOptions`, `PreferenceInitializer`). */
export const DEFAULT_LEGEND_OPTIONS: Readonly<LegendOptions> = {
  elements: true,
  relations: true,
  specializedElements: true,
  specializedRelations: true,
  rowsPerColumn: 15,
  widthOffset: 0,
  colours: 'core',
  sort: 'category',
}

export function isLegendColours(value: unknown): value is LegendColours {
  return (LEGEND_COLOURS as readonly unknown[]).includes(value)
}

export function isLegendSort(value: unknown): value is LegendSort {
  return (LEGEND_SORTS as readonly unknown[]).includes(value)
}

export type ViewNode = ElementNode | NoteNode | GroupNode | ViewReferenceNode | LegendNode
export type ViewNodeKind = ViewNode['kind']

interface ViewConnectionBase {
  /** Unique within its view. */
  id: string
  /** Node ids, within the same view. */
  source: string
  target: string
  /** Route corners in order from source to target, in view coordinates. */
  bendpoints?: Point[]
  appearance?: Appearance
}

/** A drawing of a model relationship between the nodes of its two elements. */
export interface RelationshipConnection extends ViewConnectionBase {
  kind: 'relationship'
  relationship: string
}

/** A plain line, typically from a note or group; not part of the model. */
export interface LineConnection extends ViewConnectionBase {
  kind: 'line'
  name?: string
}

export type ViewConnection = RelationshipConnection | LineConnection

/** A hand-drawn diagram (concept §5.1). Distinct from a `ReportDefinition`. */
export interface View {
  id: string
  name: string
  documentation?: string
  /**
   * ArchiMate viewpoint name, as the exchange format spells it. What it refuses
   * is drawn ghosted (#194), and the validator reports each such shape (#193).
   */
  viewpoint?: string
  /** Absent means `manual`, Archi's default, so only `manhattan` is ever stored (#133). */
  router?: Exclude<ViewRouter, 'manual'>
  folder?: string
  properties: Record<string, PropertyValue>
  nodes: ViewNode[]
  connections: ViewConnection[]
}

// ── Folders ──────────────────────────────────────────────────────────────────

/**
 * The fixed top-level groups of the model tree (#80), which user folders sit
 * within. Archi's own: Physical files under Technology, and Location, Grouping
 * and Junction under Other.
 */
export const FOLDER_ROOTS = [
  'strategy',
  'business',
  'application',
  'technology',
  'motivation',
  'implementation',
  'other',
  'relations',
  'views',
] as const
export type FolderRoot = (typeof FOLDER_ROOTS)[number]

export const FOLDER_ROOT_LABELS: Record<FolderRoot, string> = {
  strategy: 'Strategy',
  business: 'Business',
  application: 'Application',
  technology: 'Technology & Physical',
  motivation: 'Motivation',
  implementation: 'Implementation & Migration',
  other: 'Other',
  relations: 'Relations',
  views: 'Views',
}

/**
 * User organisation of elements, relationships and views. Organisation, not
 * semantics: nothing about an element changes with the folder it is filed in.
 *
 * Exactly one of `parent` and `root` is set: a folder nests in another folder,
 * or sits directly in one of the fixed groups. Membership is recorded on the
 * member (`Element.folder` and friends), so moving one object is one update.
 */
export interface Folder {
  id: string
  name: string
  documentation?: string
  parent?: string
  root?: FolderRoot
}

/** The group an element type is filed under when it has no folder. */
export function defaultFolderRoot(layer: Layer): FolderRoot {
  return layer === 'physical' ? 'technology' : layer
}

export function isFolderRoot(value: unknown): value is FolderRoot {
  return typeof value === 'string' && (FOLDER_ROOTS as readonly string[]).includes(value)
}

export interface TagDefinition {
  name: string
  /** CSS custom property carrying the tag colour (handoff "Tag colours"). */
  colourToken: string
}

export interface TagGroup {
  id: string
  name: string
  multiSelect: boolean
  tags: TagDefinition[]
}

export interface Workspace {
  id: string
  name: string
  /**
   * What the model is for: the exchange format's model `<documentation>`, which
   * is where Archi's export writes a model's purpose, and where its import reads
   * it back from (#95).
   */
  documentation?: string
  schemaVersion: number
  elements: Element[]
  relationships: Relationship[]
  /** Hand-drawn diagrams. */
  views: View[]
  folders: Folder[]
  /** Saved report definitions. */
  reports: ReportDefinition[]
  tagGroups: TagGroup[]
  /**
   * Exchange-format types declared for property keys whose values we hold as
   * text: `currency`, `date` and `time` have no counterpart in `PropertyValue`,
   * so `typeof value` can only say `string` for them and a re-export declared
   * them as `string` — a colleague reopening the file in Archi had lost the
   * typing and its formatting (#37). Keyed by property key. Absent for the keys
   * whose type the value itself carries (`boolean`, `number`).
   */
  propertyTypes?: Record<string, string>
  /**
   * The language the model's texts are written in, as an `xml:lang` tag. The
   * exchange format labels every text with one; a file authored in German came
   * back out claiming English, without a word (#111). The model holds one text
   * per field, so it holds one language. Absent means `en`, so a workspace in
   * English keeps the bytes it had before this field existed (ADR 0004).
   */
  language?: string
}

/** The language of a workspace that names none. */
export const DEFAULT_LANGUAGE = 'en'

/**
 * `xs:language`, the type of `xml:lang` in the exchange schema. A tag outside it
 * would make every exported text schema-invalid, so it is never held.
 */
export function isLanguageTag(value: unknown): value is string {
  return typeof value === 'string' && LANGUAGE_TAG.test(value)
}

/** The pattern of `xs:language`, shared with the published JSON schema. */
export const LANGUAGE_TAG_PATTERN = '^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$'
const LANGUAGE_TAG = new RegExp(LANGUAGE_TAG_PATTERN)

/** The default tag group and colours from the design handoff. */
export const DEFAULT_TAG_GROUP: TagGroup = {
  id: 'tg-portfolio',
  name: 'Portfolio',
  multiSelect: true,
  tags: [
    { name: 'Core', colourToken: 'var(--accent2)' },
    { name: 'Differentiating', colourToken: 'var(--accent)' },
    { name: 'Supporting', colourToken: 'var(--pas)' },
    { name: 'Cloud target', colourToken: 'var(--app)' },
    { name: 'GDPR', colourToken: 'var(--mot)' },
    { name: 'Vendor risk', colourToken: 'var(--lc-eol)' },
  ],
}

export function emptyWorkspace(id: string, name: string): Workspace {
  return {
    id,
    name,
    schemaVersion: SCHEMA_VERSION,
    elements: [],
    relationships: [],
    views: [],
    folders: [],
    reports: [],
    tagGroups: [DEFAULT_TAG_GROUP],
  }
}

/** Colour token for a tag, falling back to the neutral border colour. */
export function tagColourToken(workspace: Workspace, tag: string): string {
  for (const group of workspace.tagGroups) {
    const found = group.tags.find((t) => t.name === tag)
    if (found) return found.colourToken
  }
  return 'var(--bd2)'
}
