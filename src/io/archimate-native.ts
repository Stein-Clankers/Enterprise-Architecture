import { XMLParser } from 'fast-xml-parser'
import {
  DEFAULT_JUNCTION_KIND,
  DEFAULT_TAG_GROUP,
  FOLDER_ROOT_LABELS,
  SCHEMA_VERSION,
  drawsRelationshipEnds,
  isElementType,
  isInfluenceModifier,
  isRelationshipType,
  viewpointByArchiId,
  type AccessType,
  type Appearance,
  type Element,
  type ElementType,
  type Folder,
  type FolderRoot,
  type FontStyle,
  type JunctionKind,
  type Point,
  type PropertyValue,
  type Relationship,
  type TextAlignment,
  type TextPosition,
  type LabelPosition,
  type View,
  type ViewConnection,
  type ViewNode,
  type Workspace,
} from '@/model'
import {
  EMPTIED_FOLDERS,
  MOVED_FROM_BUSINESS,
  RETIRED_FOLDER_TYPES,
  SWAPPED_FIGURES,
  compatibilityOf,
  isLegacyContainer,
  legacyDefaultSize,
  type Compatibility,
} from './archi-compatibility'
import { isReportDefinition, isTagGroup } from './canonical-json'
import { Ledger, reportUnread, type Ignored, type Noun } from './consumption'
import { defaultNodeSize } from './default-sizes'
import {
  LEGACY_REPORTS_KEY,
  REPORTS_KEY,
  TAG_GROUPS_KEY,
  carried,
  reportForeignModelProperties,
  reportUnreadProfileKeys,
  type ProblemSink,
} from './exchange-format'
import { STYLE_KEY, applyCarriedStyle, readCarriedStyle } from './exchange-views'
import {
  asString,
  bump,
  claimIdentifier,
  entries,
  isRawNode,
  list,
  listed,
  measured,
  num,
  type RawNode,
} from './exchange-xml'
import {
  failed,
  problem,
  propertyRepeated,
  succeeded,
  type ImportProblem,
  type ImportResult,
} from './problems'
import {
  readPortfolioProfile,
  readRelationshipProfile,
  stripProfileKeys,
} from './profile-properties'
import { LEGEND_FEATURE, parseLegendFeature } from './legend-feature'
import { setKey } from './records'
import { foldPlans } from './plan-exchange'
import { ARCHI_NAMESPACE, isArchiNamespace, rootUnreadable, xmlRoot } from './xml-root'

/**
 * Archi's native `.archimate` file (#13): how Archi users arrive.
 *
 * Read directly into the model, not through the exchange format. Archi's file
 * is closer to the model than the exchange format is: bounds are already
 * relative to the parent, colours are written only when someone set them, and
 * it holds things Archi's own exchange export loses (text alignment, a line's
 * name, an empty property value). The readers share what they can: the
 * portfolio-profile properties, the carried reports, tag groups and view style,
 * and the default sizes.
 *
 * `checked-in pairs` in `fixtures/` are each one model saved by Archi and
 * exported by Archi; `archimate-native.test.ts` reads both and compares them.
 * The differences it allows are the places where Archi's export is lossy.
 */

export { ARCHI_NAMESPACE, ARCHI_LEGACY_NAMESPACE } from './xml-root'

/** Is this text an Archi model file rather than an exchange file? Decided by the root's own namespace (#99). */
export function isArchiModel(text: string): boolean {
  return isArchiNamespace(xmlRoot(text)?.namespace)
}

/** Archi's top-level folder types. A `Map`: the key comes from the file (#37). */
const TOP_FOLDERS = new Map<string, FolderRoot>([
  ['strategy', 'strategy'],
  ['business', 'business'],
  ['application', 'application'],
  ['technology', 'technology'],
  ['motivation', 'motivation'],
  ['implementation_migration', 'implementation'],
  ['other', 'other'],
  ['relations', 'relations'],
  ['diagrams', 'views'],
])

/** Archi's access codes. Absent is 0, Write: EMF does not write a default. */
const ACCESS_CODES = new Map<string, AccessType>([
  ['0', 'Write'],
  ['1', 'Read'],
  ['2', 'Access'],
  ['3', 'ReadWrite'],
])

const TEXT_ALIGNMENT_CODES = new Map<string, TextAlignment>([
  ['1', 'left'],
  ['2', 'center'],
  ['4', 'right'],
])

const TEXT_POSITION_CODES = new Map<string, TextPosition>([
  ['0', 'top'],
  ['1', 'middle'],
  ['2', 'bottom'],
])

/** A connection's `textPosition` (#133): `IDiagramModelConnection.CONNECTION_TEXT_POSITION_*`. */
const LABEL_POSITION_CODES = new Map<string, LabelPosition>([
  ['0', 'source'],
  ['1', 'middle'],
  ['2', 'target'],
])

/** What Archi calls a specialization's property when it exports one. */
export const SPECIALIZATION_KEY = 'Specialization'

/**
 * Archi's display settings that Archipelago does not draw (`IDiagramModelObject`,
 * `IBorderObject`, `IIconic`, `ILockable` and their kin in Archi 5.10's model):
 * counted and reported as one line. Any other attribute is unread content (#101).
 */
const UNDRAWN_NODE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'type',
  'borderType',
  'borderColor',
  // Where an image sits; the image itself (`imagePath`) is reported per shape (#97).
  'imagePosition',
  'locked',
])
/**
 * A connection's `type` is its line decoration; its text alignment places its
 * label (`DiagramModelConnection`, checked class by class with javap). Its text
 * position, where along the line the label sits, is read (#133).
 */
const UNDRAWN_CONNECTION_ATTRIBUTES: ReadonlySet<string> = new Set(['type', 'textAlignment'])

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Kept, unlike the exchange reader: a junction carries both `xsi:type` and its
  // own `type`, and without the prefix the second overwrote the first.
  removeNSPrefix: false,
  parseAttributeValue: false,
  parseTagValue: false,
  // Archi writes names, keys, values and documentation verbatim, so they are read
  // verbatim: trimming changed them silently, and could merge two keys (#100).
  trimValues: false,
  htmlEntities: true,
})

interface Member {
  raw: RawNode
  /** The type as Archi 5.10 reads it: a legacy name is already converted. */
  type: string
  /** The legacy name the file wrote, when it wrote one (#105). */
  legacy?: string
  folder?: string
  /** Taken out of a Business subfolder by `Archimate2To3Handler` (#118). */
  moved?: true
  /** Filed under the first diagrams folder, the only one `Archimate32Handler` walks (#123 review). */
  firstDiagrams?: true
}

/**
 * Names Archi has since changed, and what Archi 5.10 reads them as: the
 * `TYPE_MAP` of `ConverterExtendedMetadata` in `com.archimatetool.model`
 * (archimatetool/archi, commit 414a4f00). ArchiMate 2.x names, British
 * spellings, the very old view type, the two junction classes Archi 4 merged,
 * and a concept Archi 4 removed. Archi applies the map to every file it loads,
 * whatever its namespace: a re-namespaced legacy file came out converted just
 * the same (#105).
 */
const LEGACY_TYPES: ReadonlyMap<string, string> = new Map([
  ['UsedByRelationship', 'ServingRelationship'],
  ['CommunicationPath', 'Path'],
  ['Network', 'CommunicationNetwork'],
  ['InfrastructureInterface', 'TechnologyInterface'],
  ['InfrastructureFunction', 'TechnologyFunction'],
  ['InfrastructureService', 'TechnologyService'],
  ['RealisationRelationship', 'RealizationRelationship'],
  ['SpecialisationRelationship', 'SpecializationRelationship'],
  ['DiagramModel', 'ArchimateDiagramModel'],
  ['AndJunction', 'Junction'],
  ['OrJunction', 'Junction'],
  ['BusinessActivity', 'BusinessProcess'],
])

/** A folder's element as a member, its type read as Archi 5.10 reads it. */
function memberOf(raw: RawNode, folder?: string): Member {
  const member: Member = { raw, ...archiType(raw) }
  if (folder !== undefined) member.folder = folder
  return member
}

/**
 * An element's type as Archi 5.10 reads it, and the legacy name it replaced.
 * One place for both the reader and the labeller of unread content, which
 * called a renamed relationship an element (#119 review). Archi maps every name
 * in its own package, which here is anything but the canvas's, as `classify`
 * has it; a literal `archimate:` prefix was a stand-in for that (#119 review).
 */
function archiType(raw: RawNode): { type: string; legacy?: string } {
  const type = typeOf(raw)
  const [prefix, local] = splitType(type)
  const renamed = prefix === 'canvas' ? undefined : LEGACY_TYPES.get(local)
  return renamed ? { type: `archimate:${renamed}`, legacy: local } : { type }
}

/** A conversion is counted once its member is kept: a skipped one was reported already. */
function countConversions(member: Member, reader: Reader): void {
  if (member.legacy) bump(reader.tally.renamed, member.legacy)
  if (member.moved) reader.tally.movedFromBusiness += 1
}

interface Tally {
  defaultSized: number
  onConnections: number
  /** Attribute name → how many objects carried it. */
  unsupported: Map<string, number>
  /** Attribute name → how many objects carried a value Archi would not write. */
  malformed: Map<string, number>
  /** What a view object carried that it cannot hold here → how many times. */
  viewContent: Map<string, number>
  /** Legends whose options Archi would not write as they stand (#134). */
  legendOptions: number
  routers: number
  specializations: number
  /** Legacy type name → how many were read under Archi 5.10's name (#105). */
  renamed: Map<string, number>
  /** Connections that named their relationship in the legacy `relationship` attribute. */
  legacyConnections: number
  /** Ids of legacy Or-junctions, which Archi 5.10 itself opens as and-junctions. */
  orJunctions: string[]
  /** Shapes an older model left unsized, sized by Archi's `FixDefaultSizesHandler` (#118). */
  legacySized: number
  /** Group and Grouping labels `DefaultTextAlignmentHandler` turned from centre to left. */
  leftAligned: number
  /** Top-level folders `Archimate2To3Handler` emptied, with where their contents went. */
  emptiedFolders: { name: string; root: FolderRoot }[]
  /** Elements `Archimate2To3Handler` took out of a Business subfolder. */
  movedFromBusiness: number
  /** Shapes whose outline opacity `OutlineOpacityHandler` changed. */
  outlineOpacity: number
}

interface Reader extends ProblemSink {
  /** Specialization id → it, by name. */
  profiles: Map<string, { name: string; raw: RawNode }>
  tally: Tally
  /** What was read, so that what was not is reported (#101). */
  ledger: Ledger
  /** The model's `version`, as the file wrote it. */
  version: string | undefined
  /** What Archi 5.10 changes in a model of that version as it opens it (#118). */
  compatibility: Compatibility
}

/**
 * What this reader deliberately does not read, and why (#101). Anything else it
 * does not mark as read is reported as `import.content-unread`.
 */
const IGNORED: readonly Ignored[] = [
  {
    at: 'model',
    key: '@xmlns*',
    reason:
      'Namespace declarations decide how the file is read (`xml-root.ts`); they hold no model content.',
  },
  {
    at: 'model',
    key: '@version',
    reason:
      'The model version of the Archi that saved the file. It decides which of Archi’s compatibility handlers apply (#118), and is reported with what they changed.',
  },
  {
    at: 'child',
    key: '@targetConnections',
    reason:
      'Archi’s back-reference to the connections ending on a shape, derived from their own source and target.',
  },
  {
    at: 'sourceConnection',
    key: '@targetConnections',
    reason:
      'Archi’s back-reference to the connections ending on a connection, derived from their own source and target.',
  },
]

export function importArchimate(xml: string, file?: string): ImportResult {
  const problems: ImportProblem[] = []
  const where = file ? { file } : {}

  let parsed: RawNode
  try {
    parsed = parser.parse(xml) as RawNode
  } catch (error) {
    return failed([
      problem(
        'error',
        'archimate.unparseable',
        `The file is not valid XML: ${error instanceof Error ? error.message : String(error)}`,
        where,
      ),
    ])
  }
  // Any root called `model` parses, so a file in another format would come in
  // empty, ok and silent. The namespace is what makes it Archi's (#99). A root
  // the scan cannot find is refused too: a guard that cannot classify its input
  // must not wave it through (#103). With no root and no model either, the
  // file is not a model at all, and the not-a-model check below says so (#104).
  const root = xmlRoot(xml)
  const rootKey = Object.keys(parsed).find((key) => /(^|:)model$/.test(key))
  if (!root && rootKey) return failed([rootUnreadable('archimate', where)])
  if (root?.local === 'model' && !isArchiNamespace(root.namespace)) {
    return failed([
      problem(
        'error',
        'archimate.wrong-namespace',
        `The root element <${root.local}> is ${root.namespace ? `in the namespace ${root.namespace}` : 'in no namespace'}, not Archi’s (${ARCHI_NAMESPACE}), so this is not an Archi model file.`,
        where,
      ),
    ])
  }
  const model = rootKey ? parsed[rootKey] : undefined
  if (!isRawNode(model)) {
    return failed([
      problem(
        'error',
        'archimate.not-a-model',
        'No <archimate:model> element — this does not look like an Archi model file.',
        where,
      ),
    ])
  }

  const ledger = new Ledger()
  ledger.use(model, 'folder')
  const version = asString(model['@version'])
  const reader: Reader = {
    problems,
    where,
    ledger,
    version,
    compatibility: compatibilityOf(version),
    profiles: readProfiles(model),
    tally: {
      defaultSized: 0,
      onConnections: 0,
      unsupported: new Map(),
      malformed: new Map(),
      viewContent: new Map(),
      legendOptions: 0,
      routers: 0,
      specializations: 0,
      renamed: new Map(),
      legacyConnections: 0,
      orJunctions: [],
      legacySized: 0,
      leftAligned: 0,
      emptiedFolders: [],
      movedFromBusiness: 0,
      outlineOpacity: 0,
    },
  }

  const { members, folders } = readFolders(model, reader)

  const elements: Element[] = []
  const elementIds = new Set<string>()
  for (const member of members) {
    const kind = classify(member.type)
    if (kind !== 'element') continue
    // A duplicate is skipped before it is read, so what it carries is not
    // reported as well, for an object that was not imported (#106 review).
    if (isDuplicate(member, elementIds, 'element', reader)) continue
    const element = readElement(member, reader)
    if (!element) {
      ledger.skip(member.raw)
      continue
    }
    elementIds.add(element.id)
    elements.push(element)
    countConversions(member, reader)
  }

  const relationships: Relationship[] = []
  const relationshipsById = new Map<string, Relationship>()
  for (const member of members) {
    if (classify(member.type) !== 'relationship') continue
    if (isDuplicate(member, relationshipsById, 'relationship', reader)) continue
    const relationship = readRelationship(member, elementIds, reader)
    if (!relationship) {
      ledger.skip(member.raw)
      continue
    }
    relationshipsById.set(relationship.id, relationship)
    relationships.push(relationship)
    countConversions(member, reader)
  }

  // Before views: a drawing of a folded site plan's Work Package is reported there (#209).
  const plans = foldPlans(elements, relationships, reader)

  const diagrams = members.filter((member) => classify(member.type) === 'diagram')
  const modelNames = new Map(
    members.map((member) => [
      asString(member.raw['@id']) ?? '',
      asString(member.raw['@name']) ?? '',
    ]),
  )
  for (const member of members) {
    if (classify(member.type) !== 'unsupported-view') continue
    ledger.skip(member.raw)
    problems.push(
      problem(
        'warning',
        'archimate.view-type-unsupported',
        `“${asString(member.raw['@name']) ?? ''}” is ${describeUnsupported(member.type)}, which Archipelago does not draw. It was skipped.`,
        { ...where, subject: asString(member.raw['@id']) ?? '' },
      ),
    )
  }
  for (const member of members) {
    if (classify(member.type) !== 'unknown') continue
    ledger.skip(member.raw)
    problems.push(
      problem(
        'error',
        'archimate.unknown-type',
        `"${asString(member.raw['@id']) ?? '(no id)'}" has type "${member.type}", which is not an ArchiMate 3.2 element, relationship or view. It was skipped.`,
        { ...where, subject: asString(member.raw['@id']) ?? '' },
      ),
    )
  }

  const viewIds = new Set(diagrams.map((member) => asString(member.raw['@id'])).filter(isString))
  const context: ViewContext = {
    elements: new Map(plans.elements.map((element) => [element.id, element])),
    relationships: new Map(
      plans.relationships.map((relationship) => [relationship.id, relationship]),
    ),
    viewIds,
    modelNames,
    reader,
  }
  const views: View[] = []
  const seenViews = new Set<string>()
  for (const member of diagrams) {
    if (isDuplicate(member, seenViews, 'view', reader)) continue
    const view = readView(member, context)
    if (!view) {
      ledger.skip(member.raw)
      continue
    }
    seenViews.add(view.id)
    views.push(view)
    countConversions(member, reader)
  }

  const modelProperties = readProperties(model, reader)
  const reports =
    carried(modelProperties[REPORTS_KEY], isReportDefinition, 'saved reports', reader) ??
    carried(modelProperties[LEGACY_REPORTS_KEY], isReportDefinition, 'saved reports', reader)
  const tagGroups = carried(modelProperties[TAG_GROUPS_KEY], isTagGroup, 'tag groups', reader)
  reportForeignModelProperties(modelProperties, problems, where)
  reportUnusedProfiles(model, reader)
  // The model's documentation: Archi's export writes the purpose there (#95).
  const purpose = textOf(model.purpose)
  ledger.text(model, 'purpose')
  reportTally(reader)
  ledger.use(model, '@id', '@name')
  readUnheldFeatures(model, reader)
  problems.push(
    ...reportUnread(
      ledger.unread(model, 'model', {
        ignored: IGNORED,
        subjectOf: (node) => asString(node['@id']),
      }),
      describe,
      where,
    ),
  )

  const workspace: Workspace = {
    id: asString(model['@id']) || 'ws-imported',
    name: asString(model['@name']) || 'Imported model',
    schemaVersion: SCHEMA_VERSION,
    elements: plans.elements,
    relationships: plans.relationships,
    views,
    folders,
    reports: reports ?? [],
    tagGroups: tagGroups ?? [DEFAULT_TAG_GROUP],
  }
  if (purpose) workspace.documentation = purpose
  return succeeded(workspace, problems)
}

// ── Folders ──────────────────────────────────────────────────────────────────

/**
 * Walk Archi's folder tree. Its top-level folders are the model tree's fixed
 * groups (they carry a `type`); every folder below them becomes a `Folder`.
 * Everything Archi files — elements, relationships, views — is an `<element>`
 * somewhere in this tree, so the walk also collects them, with their folder.
 */
function readFolders(model: RawNode, reader: Reader): { members: Member[]; folders: Folder[] } {
  const members: Member[] = []
  const folders: Folder[] = []
  const used = new Set<string>()
  collectIds(model, used)
  const folderProperties: string[] = []
  const topDocumented: string[] = []

  const claim = (raw: RawNode): string => {
    const own = asString(raw['@id'])
    if (own && !used.has(own)) {
      used.add(own)
      return own
    }
    return claimIdentifier(`folder-${own ?? 'unnamed'}`, used)
  }

  const { compatibility } = reader
  // Archi's `getFolder(type)` is the first top-level folder of that type: the one
  // `Archimate2To3Handler` moves elements out of, and `Archimate32Handler` walks.
  const firstOfType = (type: string) =>
    list(model.folder).find((top) => asString(top['@type']) === type)
  const businessTop = firstOfType('business')
  const diagramsTop = firstOfType('diagrams')

  /**
   * A folder's elements and the folders among them. `Archimate2To3Handler` moves
   * a folder into another's elements, and Archi 5.10 saves and reopens it there as
   * an `archimate:Folder` element (#118), so one is read as the folder it is.
   * Below 4.0.0, a Location, Meaning or Value in a Business subfolder is moved to
   * the top of its own group, as the handler moves it.
   */
  const collect = (raw: RawNode, folder: Folder | undefined, root: FolderRoot, top: RawNode) => {
    const nested: RawNode[] = []
    const business = compatibility.archimate2To3 && top === businessTop
    for (const element of list(raw.element)) {
      if (isFolderElement(element)) {
        nested.push(element)
        continue
      }
      const moved =
        folder !== undefined &&
        business &&
        MOVED_FROM_BUSINESS.has(splitType(archiType(element).type)[1])
      const member = moved ? memberOf(element) : memberOf(element, folder?.id)
      if (moved) member.moved = true
      if (top === diagramsTop) member.firstDiagrams = true
      members.push(member)
    }
    walk([...list(raw.folder), ...nested], folder, root, top)
  }

  const walk = (raws: RawNode[], parent: Folder | undefined, root: FolderRoot, top: RawNode) => {
    for (const raw of raws) {
      const folder: Folder = { id: claim(raw), name: asString(raw['@name']) ?? '' }
      const documentation = textOf(raw.documentation)
      if (documentation) folder.documentation = documentation
      if (parent) folder.parent = parent.id
      else folder.root = root
      if (entries(raw.property).length) folderProperties.push(folder.name || folder.id)
      folders.push(folder)
      reader.ledger.use(raw, '@id', '@name', 'element', 'folder')
      if (isFolderElement(raw)) reader.ledger.use(raw, '@xsi:type')
      reader.ledger.text(raw, 'documentation')
      reader.ledger.whole(raw, 'property')
      readUnheldFeatures(raw, reader)
      collect(raw, folder, root, top)
    }
  }

  for (const top of list(model.folder)) {
    const type = asString(top['@type']) ?? ''
    const topName = asString(top['@name'])
    // Below 4.0.0 Archi empties these by name, whatever their type, and removes them.
    const emptied = compatibility.archimate2To3 ? EMPTIED_FOLDERS.get(topName ?? '') : undefined
    const known = emptied ?? TOP_FOLDERS.get(type)
    if (emptied && (top.element !== undefined || top.folder !== undefined)) {
      reader.tally.emptiedFolders.push({ name: topName ?? '', root: emptied })
    }
    if (!known) {
      reader.problems.push(
        problem(
          'warning',
          'archimate.folder-type-unknown',
          `Top-level folder "${topName ?? ''}" ${describeFolderType(type)}; its contents were placed under ${FOLDER_ROOT_LABELS.other}.`,
          reader.where,
        ),
      )
    }
    const root = known ?? 'other'
    // A top-level folder is one of the model tree's fixed groups, which hold
    // neither documentation nor properties (#100).
    const name = asString(top['@name']) || FOLDER_ROOT_LABELS[root]
    if (textOf(top.documentation)) topDocumented.push(name)
    if (entries(top.property).length) folderProperties.push(name)
    // Its id and name are the fixed group's, which Archipelago supplies itself;
    // its documentation and properties are reported just above.
    reader.ledger.use(top, '@type', '@id', '@name', 'element', 'folder')
    reader.ledger.whole(top, 'documentation', 'property')
    readUnheldFeatures(top, reader)
    collect(top, undefined, root, top)
  }

  if (topDocumented.length) {
    reader.problems.push(
      problem(
        'warning',
        'archimate.top-folder-documentation-skipped',
        `${topDocumented.length} top-level folder${topDocumented.length === 1 ? '' : 's'} (${listed(topDocumented)}) carr${topDocumented.length === 1 ? 'ies' : 'y'} documentation. Archipelago's top-level groups are fixed and hold none, so it was not imported.`,
        reader.where,
      ),
    )
  }
  if (folderProperties.length) {
    reader.problems.push(
      problem(
        'warning',
        'archimate.folder-properties-skipped',
        `${folderProperties.length} folder${folderProperties.length === 1 ? '' : 's'} (${listed(folderProperties)}) carr${folderProperties.length === 1 ? 'ies' : 'y'} properties, which Archipelago folders do not hold yet. They were not imported.`,
        reader.where,
      ),
    )
  }
  return { members, folders }
}

/** Every id in the file, so a folder id that collides with one is replaced. */
function collectIds(node: RawNode, out: Set<string>): void {
  for (const element of list(node.element)) {
    if (isFolderElement(element)) {
      collectIds(element, out)
      continue
    }
    const id = asString(element['@id'])
    if (id) out.add(id)
  }
  for (const folder of list(node.folder)) collectIds(folder, out)
}

/** A folder Archi saved among a folder's elements (#118). */
function isFolderElement(raw: RawNode): boolean {
  const [prefix, local] = splitType(typeOf(raw))
  return prefix !== 'canvas' && local === 'Folder'
}

/**
 * Why a top-level folder is none of the fixed groups, true of each kind of type
 * (#118): Archi 5.10 reads a type it does not have as `user`, an ordinary folder.
 */
function describeFolderType(type: string): string {
  if (type === '' || type === 'user')
    return 'is an ordinary folder, not one of Archi’s fixed groups'
  if (RETIRED_FOLDER_TYPES.has(type)) {
    return `has type "${type}", which an older Archi wrote and Archi 5.10 no longer has`
  }
  return `has type "${type}", which Archi 5.10 does not define`
}

type MemberKind = 'element' | 'relationship' | 'diagram' | 'unsupported-view' | 'unknown'

function classify(type: string): MemberKind {
  const [prefix, local] = splitType(type)
  if (prefix === 'canvas') return 'unsupported-view'
  if (local === 'ArchimateDiagramModel') return 'diagram'
  if (local === 'SketchModel') return 'unsupported-view'
  if (local.endsWith('Relationship') && isRelationshipType(local.slice(0, -'Relationship'.length)))
    return 'relationship'
  if (local === 'Junction' || isElementType(local)) return 'element'
  return 'unknown'
}

function describeUnsupported(type: string): string {
  const [prefix, local] = splitType(type)
  if (prefix === 'canvas') return 'an Archi canvas'
  if (local === 'SketchModel') return 'an Archi sketch'
  return `a ${local}`
}

/** `archimate:BusinessActor` → `['archimate', 'BusinessActor']`. */
function splitType(type: string): [string, string] {
  const colon = type.indexOf(':')
  return colon < 0 ? ['', type] : [type.slice(0, colon), type.slice(colon + 1)]
}

function typeOf(raw: RawNode): string {
  return asString(raw['@xsi:type']) ?? ''
}

// ── Elements and relationships ───────────────────────────────────────────────

function readElement(member: Member, reader: Reader): Element | undefined {
  const { raw } = member
  const id = asString(raw['@id'])
  if (!id) {
    reader.problems.push(
      problem(
        'error',
        'archimate.element-no-id',
        'An element has no id and was skipped.',
        reader.where,
      ),
    )
    return undefined
  }
  const [, local] = splitType(member.type)
  let type: ElementType
  let junctionKind: JunctionKind | undefined
  if (local === 'Junction') {
    type = 'Junction'
    // Archi writes `type="or"` and leaves an and-junction without one.
    const kind = asString(raw['@type'])
    reader.ledger.use(raw, '@type')
    if (kind === 'or') junctionKind = 'or'
    else if (kind === undefined && member.legacy === 'OrJunction') {
      // Archi 5.10 maps the class and nothing else, so it opens this as an
      // and-junction. The file said or; that is kept, and the difference said.
      junctionKind = 'or'
      reader.tally.orJunctions.push(id)
    } else if (kind !== undefined && kind !== DEFAULT_JUNCTION_KIND) {
      reader.problems.push(
        problem(
          'warning',
          'archimate.junction-kind-unknown',
          `Junction "${id}" has type "${kind}", which is neither and nor or. It was read as an and-junction.`,
          { ...reader.where, subject: id },
        ),
      )
    }
  } else if (isElementType(local)) type = local
  else return undefined

  readUnheldFeatures(raw, reader)
  const properties = readConceptProperties(raw, id, reader)
  const { profile, unread } = readPortfolioProfile(properties)
  reportUnreadProfileKeys(id, unread, reader)
  const element: Element = {
    id,
    type,
    name: asString(raw['@name']) ?? '',
    properties: stripProfileKeys(properties, unread),
  }
  if (junctionKind) element.junctionKind = junctionKind
  const documentation = textOf(raw.documentation)
  if (documentation) element.documentation = documentation
  if (profile) element.profile = profile
  if (member.folder) element.folder = member.folder
  reader.ledger.use(raw, '@xsi:type', '@id', '@name')
  reader.ledger.text(raw, 'documentation')
  return element
}

function readRelationship(
  member: Member,
  elementIds: ReadonlySet<string>,
  reader: Reader,
): Relationship | undefined {
  const { raw } = member
  const { problems, where } = reader
  const id = asString(raw['@id'])
  const [, local] = splitType(member.type)
  const type = local.slice(0, -'Relationship'.length)
  if (!id || !isRelationshipType(type)) {
    problems.push(
      problem(
        'error',
        'archimate.relationship-no-id',
        'A relationship has no id and was skipped.',
        where,
      ),
    )
    return undefined
  }
  const source = asString(raw['@source'])
  const target = asString(raw['@target'])
  if (!source || !target || !elementIds.has(source) || !elementIds.has(target)) {
    problems.push(
      problem(
        'warning',
        'archimate.dangling-relationship',
        `Relationship "${id}" does not connect two elements of this model (Archi allows a relationship to end on another relationship; Archipelago does not yet). It was skipped.`,
        { ...where, subject: id },
      ),
    )
    return undefined
  }

  readUnheldFeatures(raw, reader)
  const properties = readConceptProperties(raw, id, reader)
  const read = readRelationshipProfile(properties)
  reportUnreadProfileKeys(id, read.unread, reader)
  const relationship: Relationship = {
    id,
    type,
    source,
    target,
    properties: stripProfileKeys(properties, read.unread),
  }
  const name = asString(raw['@name'])
  if (name) relationship.name = name
  const documentation = textOf(raw.documentation)
  if (documentation) relationship.documentation = documentation
  reader.ledger.use(raw, '@xsi:type', '@id', '@name', '@source', '@target')
  reader.ledger.text(raw, 'documentation')
  const profile = read.profile ?? {}

  if (type === 'Access') {
    reader.ledger.use(raw, '@accessType')
    const code = asString(raw['@accessType']) ?? '0'
    const accessType = ACCESS_CODES.get(code)
    if (accessType) profile.accessType = accessType
    else {
      problems.push(
        problem(
          'warning',
          'archimate.access-type-unknown',
          `Access relationship "${id}" has access type "${code}", which Archi does not define. It was read without one.`,
          { ...where, subject: id },
        ),
      )
    }
  }
  if (type === 'Association') {
    if (asString(raw['@directed']) === 'true') relationship.isDirected = true
    reader.ledger.use(raw, '@directed')
  }
  if (type === 'Influence') {
    const strength = asString(raw['@strength'])
    if (isInfluenceModifier(strength)) relationship.modifier = strength
    // An empty strength is no strength, as in the exchange reader: nothing is lost.
    reader.ledger.use(raw, '@strength')
  }
  if (Object.keys(profile).length) relationship.profile = profile
  if (member.folder) relationship.folder = member.folder
  return relationship
}

/** A concept's properties, with its specialization carried the way Archi exports it. */
function readConceptProperties(
  raw: RawNode,
  id: string,
  reader: Reader,
): Record<string, PropertyValue> {
  const properties = readProperties(raw, reader)
  const at = { ...reader.where, subject: id }
  const profileIds = (asString(raw['@profiles']) ?? '').split(/\s+/).filter(Boolean)
  // Every specialization named here is kept or reported below.
  reader.ledger.use(raw, '@profiles')
  const names: string[] = []
  const unknown: string[] = []
  for (const profileId of profileIds) {
    const profile = reader.profiles.get(profileId)
    if (profile === undefined) unknown.push(profileId)
    else {
      names.push(profile.name)
      // Its concept type is the concept's own, which the model holds already.
      reader.ledger.use(profile.raw, '@id', '@name', '@conceptType')
    }
  }
  if (unknown.length) {
    reader.problems.push(
      problem(
        'warning',
        'archimate.specialization-unknown',
        `"${id}" refers to specialization${unknown.length === 1 ? '' : 's'} "${unknown.join('", "')}", which the file does not define. ${unknown.length === 1 ? 'It was' : 'They were'} not imported.`,
        at,
      ),
    )
  }
  if (names[0] === undefined) return properties
  if (Object.hasOwn(properties, SPECIALIZATION_KEY)) {
    // The property is the user's own; overwriting it would lose that instead (#100).
    reader.problems.push(
      problem(
        'warning',
        'archimate.specialization-shadowed',
        `"${id}" has the specialization${names.length === 1 ? '' : 's'} “${names.join('”, “')}” and also its own “${SPECIALIZATION_KEY}” property, where a specialization is kept. The property was kept and ${names.length === 1 ? 'the specialization was' : 'the specializations were'} not imported.`,
        at,
      ),
    )
    return properties
  }
  setKey(properties, SPECIALIZATION_KEY, names[0])
  reader.tally.specializations += 1
  if (names.length > 1) {
    reader.problems.push(
      problem(
        'warning',
        'archimate.specializations-dropped',
        `"${id}" has ${names.length} specializations; only the first, “${names[0]}”, was kept.`,
        at,
      ),
    )
  }
  return properties
}

/** `<property key value>`. A property without a value is the empty string, as Archi shows it. */
function readProperties(raw: RawNode, reader: Reader): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {}
  let keyless = 0
  const repeated = new Set<string>()
  reader.ledger.use(raw, 'property')
  for (const property of entries(raw.property)) {
    const key = asString(property['@key'])
    if (key === undefined) {
      keyless += 1
      reader.ledger.skip(property)
      continue
    }
    // Archi allows a key twice; a record holds it once. The first is kept and
    // the rest are reported (#100).
    if (Object.hasOwn(out, key)) {
      repeated.add(key)
      reader.ledger.skip(property)
    } else {
      setKey(out, key, asString(property['@value']) ?? '')
      reader.ledger.use(property, '@key', '@value')
    }
  }
  const subject = asString(raw['@id'])
  if (repeated.size) reader.problems.push(propertyRepeated(subject, [...repeated], reader.where))
  if (keyless) {
    reader.problems.push(
      problem(
        'warning',
        'archimate.property-no-key',
        `${keyless} propert${keyless === 1 ? 'y has' : 'ies have'} no name; ${keyless === 1 ? 'its value was' : 'their values were'} not imported.`,
        subject === undefined ? reader.where : { ...reader.where, subject },
      ),
    )
  }
  return out
}

/**
 * Archi's specializations. Each is marked read only when a concept uses it, so an
 * unused one is reported rather than lost (#101).
 */
function readProfiles(model: RawNode): Map<string, { name: string; raw: RawNode }> {
  const out = new Map<string, { name: string; raw: RawNode }>()
  for (const profile of list(model.profile)) {
    const id = asString(profile['@id'])
    const name = asString(profile['@name'])
    if (id && name && !out.has(id)) out.set(id, { name, raw: profile })
  }
  return out
}

/**
 * A specialization no imported concept uses has nowhere to go: Archipelago has
 * none (#101). One that is used is kept as a property, without the image Archi
 * draws on every shape of a concept with it (#97), which is reported once.
 */
function reportUnusedProfiles(model: RawNode, reader: Reader): void {
  reader.ledger.use(model, 'profile')
  for (const { name, raw } of reader.profiles.values()) {
    if (reader.ledger.isUsed(raw, '@id')) {
      const image = asString(raw['@imagePath'])
      if (image === undefined) continue
      reader.problems.push(
        problem(
          'warning',
          'archimate.specialization-image-dropped',
          `The specialization “${name}” has the image “${image}”, which Archi draws on the shapes of what it specializes. Archipelago keeps the specialization as a property and does not draw the image yet.`,
          { ...reader.where, subject: asString(raw['@id']) ?? '' },
        ),
      )
      reader.ledger.use(raw, '@imagePath')
      continue
    }
    reader.ledger.lose(model, `an unused specialization (“${name}”)`)
    reader.ledger.skip(raw)
  }
}

// ── Views ────────────────────────────────────────────────────────────────────

interface ViewContext {
  elements: ReadonlyMap<string, Element>
  relationships: ReadonlyMap<string, Relationship>
  /** Views this import will hold: what a view reference may point at. */
  viewIds: ReadonlySet<string>
  /** Every model object's name, for a reference to a view that was not imported. */
  modelNames: ReadonlyMap<string, string>
  reader: Reader
}

/** A shape's absolute bounds, which bendpoints are computed from. */
interface Box {
  x: number
  y: number
  width: number
  height: number
}

function readView(member: Member, context: ViewContext): View | undefined {
  const { raw } = member
  const { reader } = context
  const id = asString(raw['@id'])
  const name = asString(raw['@name']) ?? ''
  if (!id) {
    reader.problems.push(
      problem(
        'error',
        'archimate.view-no-id',
        `A view${name ? ` (“${name}”)` : ''} has no id and was skipped.`,
        reader.where,
      ),
    )
    return undefined
  }
  const at = { ...reader.where, subject: id }
  const skip = (code: string, message: string) =>
    reader.problems.push(problem('warning', code, `View "${name || id}": ${message}`, at))

  const { [STYLE_KEY]: carriedRaw, ...properties } = readProperties(raw, reader)
  const view: View = { id, name, properties, nodes: [], connections: [] }
  reader.ledger.use(
    raw,
    '@xsi:type',
    '@id',
    '@name',
    '@viewpoint',
    '@connectionRouterType',
    'child',
  )
  reader.ledger.text(raw, 'documentation')
  readUnheldFeatures(raw, reader)
  const documentation = textOf(raw.documentation)
  if (documentation) view.documentation = documentation
  const viewpoint = asString(raw['@viewpoint'])
  if (viewpoint) {
    // Archi's ids, mapped to the names the exchange format (and so the model) uses.
    const mapped = viewpointByArchiId(viewpoint)
    if (mapped) view.viewpoint = mapped.name
    else
      skip(
        'archimate.viewpoint-unknown',
        `viewpoint "${viewpoint}" is not one Archipelago knows; the view was read without one.`,
      )
  }
  // Archi's `connectionRouterType` (#133): 2 is Manhattan, 0 (Archi's default,
  // never written) the bend-points. Anything else, such as the retired shortest
  // path (1), Archi 5.10 draws through the bend-points too
  // (`AbstractDiagramPart.setConnectionRouter`), and so does Archipelago, saying so.
  const router = asString(raw['@connectionRouterType'])
  if (router === '2') view.router = 'manhattan'
  else if (router !== undefined && router !== '0') reader.tally.routers += 1
  if (member.folder) view.folder = member.folder

  const boxes = new Map<string, Box>()
  const nodesById = new Map<string, ViewNode>()
  /** Shapes that carry connections, with the connection elements on them. */
  const owners: RawNode[] = []

  /**
   * Archi's bounds are relative to the parent shape. A shape that is skipped
   * still moves its children, so they are placed relative to the nearest
   * ancestor that was kept.
   */
  const walk = (raws: RawNode[], parent: { id: string; box: Box } | undefined, origin: Point) => {
    for (const child of raws) {
      owners.push(child)
      reader.ledger.first(child, 'bounds')
      const bounds = entries(child.bounds)[0] ?? {}
      const rawId = asString(child['@id'])
      if (rawId !== undefined && boxes.has(rawId)) {
        // Skipped before it is read, so nothing it carries is counted in a
        // report's tally; its children are still placed by it (#123 review).
        skip(
          'archimate.duplicate-node-id',
          `two shapes share the id "${rawId}"; the later one was skipped.`,
        )
        reader.ledger.skip(child, NESTED)
        const at = {
          x: origin.x + (num(bounds['@x']) ?? 0),
          y: origin.y + (num(bounds['@y']) ?? 0),
        }
        walk(list(child.child), parent, at)
        continue
      }
      countUnsupported(child, UNDRAWN_NODE_ATTRIBUTES, reader, swapsFigure(child, member, context))
      const x = origin.x + (measured(bounds, 'x', reader) ?? 0)
      const y = origin.y + (measured(bounds, 'y', reader) ?? 0)
      const node = readNode(child, context, skip)
      let next = parent
      if (node) {
        const size = defaultNodeSize(
          node.kind,
          node.kind === 'element' ? context.elements.get(node.element)?.type : undefined,
        )
        // Absent or not positive is Archi's default size, which it does not
        // record. Malformed is not: it was tallied as such (#100).
        let archiSized = false
        const sized = (key: 'width' | 'height'): number | undefined => {
          const value = measured(bounds, key, reader)
          if (value === undefined ? bounds[`@${key}`] === undefined : value <= 0) archiSized = true
          return value !== undefined && value > 0 ? value : undefined
        }
        let width = sized('width') ?? size.width
        let height = sized('height') ?? size.height
        if (
          reader.compatibility.defaultSizes &&
          (legacySide(bounds, 'width') === undefined || legacySide(bounds, 'height') === undefined)
        ) {
          // Below 3.0.0 Archi sizes both sides once either is unset (#118). Its
          // unset is -1 alone: a 0 it keeps, and draws as it draws a 0 today.
          ;({ width, height } = legacySize(child, context.elements))
          reader.tally.legacySized += 1
        } else if (archiSized) reader.tally.defaultSized += 1
        const box: Box = { x, y, width, height }
        node.bounds = {
          x: x - (parent?.box.x ?? 0),
          y: y - (parent?.box.y ?? 0),
          width,
          height,
        }
        if (parent) node.parent = parent.id
        checkViewContent(child, node, reader)
        // An image on a kept shape (#97): reported where it was, as an image box is.
        const image = asString(child['@imagePath'])
        if (image !== undefined) {
          skip(
            'archimate.image-not-drawn',
            `shape "${node.id}" shows the image “${image}”, which Archipelago does not draw yet. The shape was imported without it.`,
          )
          reader.ledger.use(child, '@imagePath')
        }
        reader.ledger.use(child, '@xsi:type', '@id', ...NESTED)
        boxes.set(node.id, box)
        nodesById.set(node.id, node)
        view.nodes.push(node)
        next = { id: node.id, box }
      } else reader.ledger.skip(child, NESTED)
      walk(list(child.child), next, { x, y })
    }
  }
  walk(list(raw.child), undefined, { x: 0, y: 0 })

  const rawConnections = owners.flatMap((owner) => list(owner.sourceConnection))
  const connectionIds = new Set(rawConnections.map((c) => asString(c['@id'])).filter(isString))
  const seen = new Set<string>()
  for (const rawConnection of rawConnections) {
    // Only a connection that is kept has its values and content tallied: a
    // skipped one was reported as skipped (#106 review).
    const rawId = asString(rawConnection['@id'])
    if (rawId !== undefined && seen.has(rawId)) {
      skip(
        'archimate.duplicate-connection-id',
        `two connections share the id "${rawId}"; the later one was skipped.`,
      )
      reader.ledger.skip(rawConnection)
      continue
    }
    const connection = readConnection(rawConnection, boxes, nodesById, connectionIds, context, skip)
    if (!connection) {
      reader.ledger.skip(rawConnection)
      continue
    }
    seen.add(connection.id)
    countUnsupported(rawConnection, UNDRAWN_CONNECTION_ATTRIBUTES, reader)
    checkViewContent(rawConnection, connection, reader)
    reader.ledger.use(rawConnection, '@xsi:type', '@id', '@source', '@target', 'bendpoint')
    view.connections.push(connection)
  }

  applyCarriedStyle(view, readCarriedStyle(carriedRaw), reader.problems, at)
  return view
}

function readNode(
  raw: RawNode,
  context: ViewContext,
  skip: (code: string, message: string) => void,
): ViewNode | undefined {
  const id = asString(raw['@id'])
  if (!id) {
    skip(
      'archimate.node-no-id',
      'a shape has no id and was skipped; anything nested in it was kept.',
    )
    return undefined
  }
  const base = { id, bounds: { x: 0, y: 0, width: 0, height: 0 } }
  const [, local] = splitType(typeOf(raw))
  let node: ViewNode
  switch (local) {
    case 'DiagramObject': {
      const element = asString(raw['@archimateElement'])
      if (!element || !context.elements.has(element)) {
        skip(
          'archimate.dangling-view-node',
          `shape "${id}" draws element "${element ?? '(none)'}", which was not imported. It was skipped; anything nested in it was kept.`,
        )
        return undefined
      }
      node = { ...base, kind: 'element', element }
      context.reader.ledger.use(raw, '@archimateElement')
      break
    }
    case 'Group': {
      node = { ...base, kind: 'group', name: asString(raw['@name']) ?? '' }
      const documentation = textOf(raw.documentation)
      if (documentation) node.documentation = documentation
      context.reader.ledger.use(raw, '@name')
      context.reader.ledger.text(raw, 'documentation')
      break
    }
    case 'Note': {
      // A legend is a note with a `legend` feature to Archi (#134). The first
      // one is the one Archi reads (`IFeatures.getString`); any other is left
      // to `checkViewContent`, as another feature would be.
      const legend = list(raw.feature).find((f) => asString(f['@name']) === LEGEND_FEATURE)
      if (legend === undefined) {
        node = { ...base, kind: 'note', text: textOf(raw.content) ?? '' }
        context.reader.ledger.text(raw, 'content')
        break
      }
      const { options, asWritten } = parseLegendFeature(asString(legend['@value']) ?? '')
      if (!asWritten) context.reader.tally.legendOptions += 1
      node = { ...base, kind: 'legend', options }
      const name = asString(raw['@name'])
      if (name !== undefined) node.name = name
      context.reader.ledger.use(raw, '@name')
      // Archi draws no text on a legend and shows no field for one, but keeps
      // what is there; this model has no place for it.
      // Empty content is no text, as on a note (#187 review).
      if (textOf(raw.content)) bump(context.reader.tally.viewContent, 'text on a legend')
      context.reader.ledger.whole(raw, 'content')
      break
    }
    case 'DiagramModelReference': {
      const ref = asString(raw['@model'])
      // Kept as a reference, or reported and kept as a note.
      context.reader.ledger.use(raw, '@model')
      if (ref !== undefined && context.viewIds.has(ref)) {
        node = { ...base, kind: 'view-ref', view: ref }
      } else {
        const target = ref === undefined ? undefined : context.modelNames.get(ref)
        skip(
          'archimate.dangling-view-reference',
          `shape "${id}" refers to ${target === undefined ? `"${ref ?? '(none)'}", which is not in the file` : `“${target}”, which was not imported`}. It was kept as a note.`,
        )
        node = { ...base, kind: 'note', text: target ?? '' }
      }
      break
    }
    case 'DiagramModelImage': {
      // An image box, named with the image it shows, so a report says which (#97).
      const image = asString(raw['@imagePath'])
      skip(
        'archimate.node-type-unsupported',
        `shape "${id}" is a DiagramModelImage ${image === undefined ? 'with no image in it' : `showing the image “${image}”`}, which Archipelago does not draw yet. It was skipped; anything nested in it was kept.`,
      )
      return undefined
    }
    default:
      skip(
        'archimate.node-type-unsupported',
        `shape "${id}" is ${local ? `a ${local}` : 'untyped'}, which Archipelago does not draw. It was skipped; anything nested in it was kept.`,
      )
      return undefined
  }
  // Archi centres a label it has no alignment for, and writes none at its
  // default. Archipelago draws these three left by default, so the centre is
  // said out loud; elsewhere the two defaults agree (#100).
  const grouped =
    node.kind === 'group' ||
    (node.kind === 'element' && context.elements.get(node.element)?.type === 'Grouping')
  const appearance = readAppearance(raw, context.reader, {
    node: true,
    // A legend is a note to Archi, so its alignment defaults as a note's does.
    centred: grouped || node.kind === 'note' || node.kind === 'legend',
    leftAligned: grouped && context.reader.compatibility.leftAlignedGroups,
  })
  if (appearance) node.appearance = appearance
  return node
}

function readConnection(
  raw: RawNode,
  boxes: ReadonlyMap<string, Box>,
  nodesById: ReadonlyMap<string, ViewNode>,
  connectionIds: ReadonlySet<string>,
  context: ViewContext,
  skip: (code: string, message: string) => void,
): ViewConnection | undefined {
  const id = asString(raw['@id'])
  const source = asString(raw['@source'])
  const target = asString(raw['@target'])
  if (!id || !source || !target) {
    skip(
      'archimate.connection-incomplete',
      'a connection without an id, source or target was skipped.',
    )
    return undefined
  }
  const from = boxes.get(source)
  const to = boxes.get(target)
  if (!from || !to) {
    const unknown = [source, target].filter((end) => !boxes.has(end))
    if (unknown.every((end) => connectionIds.has(end))) context.reader.tally.onConnections += 1
    else {
      skip(
        'archimate.dangling-view-connection',
        `connection "${id}" ends on "${unknown.join('", "')}", which is not a shape in the view. It was skipped.`,
      )
    }
    return undefined
  }

  const base = { id, source, target }
  // EMF writes no `xsi:type` when it is the reference's own type, which for a
  // shape's connections is the plain line. Only a re-save by Archi showed it (#100).
  const [, local] = splitType(typeOf(raw) || 'archimate:DiagramModelConnection')
  let connection: ViewConnection
  if (local === 'Connection') {
    // Older Archi named the attribute `relationship`; Archi 5.10 reads it as the
    // new one (`ConverterExtendedMetadata.getAttribute`, #105). Both set one
    // feature in document order, so with both present the later one wins, as
    // Archi 5.10 showed either way round (#119 review); the other is unread.
    const key =
      Object.keys(raw)
        .filter((k) => k === '@archimateRelationship' || k === '@relationship')
        .pop() ?? '@archimateRelationship'
    const relationship = asString(raw[key])
    const drawn = relationship === undefined ? undefined : context.relationships.get(relationship)
    if (!relationship || !drawn) {
      skip(
        'archimate.dangling-view-connection',
        `connection "${id}" draws relationship "${relationship ?? '(none)'}", which was not imported. It was skipped.`,
      )
      return undefined
    }
    if (!drawsRelationshipEnds(drawn, nodesById.get(source), nodesById.get(target))) {
      skip(
        'archimate.connection-mismatch',
        `connection "${id}" draws ${drawn.type} relationship "${relationship}" between shapes that do not show its source and target. It was skipped.`,
      )
      return undefined
    }
    connection = { ...base, kind: 'relationship', relationship }
    context.reader.ledger.use(raw, key)
    if (key === '@relationship') context.reader.tally.legacyConnections++
  } else if (local === 'DiagramModelConnection') {
    connection = { ...base, kind: 'line' }
    const name = asString(raw['@name'])
    if (name) connection.name = name
    context.reader.ledger.use(raw, '@name')
  } else {
    skip(
      'archimate.connection-type-unsupported',
      `connection "${id}" is ${local ? `a ${local}` : 'untyped'}, which Archipelago does not draw. It was skipped.`,
    )
    return undefined
  }
  // Read once the connection is known to be kept, so a malformed offset on a
  // skipped one is not reported as drawn (#106 review).
  const bendpoints = absoluteBendpoints(entries(raw.bendpoint), from, to, context.reader)
  if (bendpoints.length) connection.bendpoints = bendpoints
  const appearance = readAppearance(raw, context.reader, {
    node: false,
    centred: false,
    leftAligned: false,
  })
  if (appearance) connection.appearance = appearance
  return connection
}

/**
 * Archi stores a bendpoint as two offsets: one from the source shape's centre,
 * one from the target's. It draws the i-th of n at the weighted mean of the two,
 * weight (i + 1) / (n + 1), with integer centres and the result floored (GEF's
 * `RelativeBendpoint`, and Archi's exchange export, which this matches).
 */
function absoluteBendpoints(raws: RawNode[], from: Box, to: Box, reader: Reader): Point[] {
  const fromCentre = {
    x: from.x + Math.trunc(from.width / 2),
    y: from.y + Math.trunc(from.height / 2),
  }
  const toCentre = { x: to.x + Math.trunc(to.width / 2), y: to.y + Math.trunc(to.height / 2) }
  return raws.map((raw, i) => {
    const weight = (i + 1) / (raws.length + 1)
    const start = {
      x: fromCentre.x + (measured(raw, 'startX', reader) ?? 0),
      y: fromCentre.y + (measured(raw, 'startY', reader) ?? 0),
    }
    const end = {
      x: toCentre.x + (measured(raw, 'endX', reader) ?? 0),
      y: toCentre.y + (measured(raw, 'endY', reader) ?? 0),
    }
    return {
      x: Math.floor((1 - weight) * start.x + weight * end.x + 1e-9),
      y: Math.floor((1 - weight) * start.y + weight * end.y + 1e-9),
    }
  })
}

/**
 * Archi writes a colour or font only when someone set it, so everything here is
 * an override — unlike the exchange export, which writes Archi's defaults on
 * every object for the reader to recognise and drop.
 *
 * `leftAligned` is `DefaultTextAlignmentHandler` (#118): below 4.4.0 a group's or
 * Grouping's centre alignment, absent or written, is turned to left.
 */
function readAppearance(
  raw: RawNode,
  reader: Reader,
  object: { node: boolean; centred: boolean; leftAligned: boolean },
): Appearance | undefined {
  const appearance: Appearance = {}
  const alpha = measured(raw, 'alpha', reader)
  const fill = colour(raw, 'fillColor', 'alpha', alpha, reader)
  if (fill) appearance.fillColor = fill
  const lineAlpha =
    object.node && reader.compatibility.outlineOpacity
      ? outlineFromFill(raw, alpha, reader)
      : featureNumber(raw, LINE_ALPHA, reader)
  const line = colour(raw, 'lineColor', LINE_ALPHA, lineAlpha, reader)
  if (line) appearance.lineColor = line
  const lineWidth = measured(raw, 'lineWidth', reader)
  if (lineWidth !== undefined && lineWidth !== 1 && lineWidth > 0) appearance.lineWidth = lineWidth
  const font = readFont(asString(raw['@font']))
  reader.ledger.use(raw, '@font')
  if (font.name) appearance.fontName = font.name
  if (font.size) appearance.fontSize = font.size
  if (font.style.length) appearance.fontStyle = font.style
  const fontColor = colour(raw, 'fontColor', undefined, undefined, reader)
  if (fontColor) appearance.fontColor = fontColor
  if (object.node) {
    const alignment = coded(raw, 'textAlignment', TEXT_ALIGNMENT_CODES, reader)
    if (object.leftAligned && (alignment === 'center' || raw['@textAlignment'] === undefined)) {
      appearance.textAlignment = 'left'
      reader.tally.leftAligned += 1
    } else if (alignment) appearance.textAlignment = alignment
    else if (raw['@textAlignment'] === undefined && object.centred) {
      appearance.textAlignment = 'center'
    }
    const position = coded(raw, 'textPosition', TEXT_POSITION_CODES, reader)
    if (position) appearance.textPosition = position
  } else {
    const label = coded(raw, 'textPosition', LABEL_POSITION_CODES, reader)
    if (label) appearance.labelPosition = label
  }
  return Object.keys(appearance).length ? appearance : undefined
}

/**
 * `#rrggbb` plus Archi's 0–255 alpha → `#rrggbb` or `#rrggbbaa`. Archi applies
 * an alpha to the default colour too, and that colour has no value here, so an
 * alpha on its own is reported rather than dropped (#100).
 */
function colour(
  raw: RawNode,
  key: string,
  alphaKey: string | undefined,
  a: number | undefined,
  reader: Reader,
): string | undefined {
  const value = raw[`@${key}`]
  reader.ledger.use(raw, `@${key}`)
  if (value === undefined) {
    if (alphaKey !== undefined && a !== undefined && a < 255) {
      bump(reader.tally.unsupported, `${alphaKey} without ${key}`)
    }
    return undefined
  }
  const text = asString(value)
  if (!text || !/^#[0-9a-f]{6}$/i.test(text)) {
    bump(reader.tally.malformed, key)
    return undefined
  }
  const base = text.toLowerCase()
  if (a === undefined || a >= 255) return base
  return `${base}${Math.max(0, Math.round(a)).toString(16).padStart(2, '0')}`
}

/** One of Archi's numeric codes; a value it does not define is tallied as malformed. */
function coded<T>(
  raw: RawNode,
  key: string,
  codes: ReadonlyMap<string, T>,
  reader: Reader,
): T | undefined {
  const value = raw[`@${key}`]
  if (value === undefined) return undefined
  reader.ledger.use(raw, `@${key}`)
  const mapped = codes.get(asString(value) ?? '')
  if (mapped === undefined) bump(reader.tally.malformed, key)
  return mapped
}

/**
 * SWT's font string: `version|name|height|style|platform|…`. Style is a bit set:
 * 1 bold, 2 italic.
 */
function readFont(value: string | undefined): { name?: string; size?: number; style: FontStyle[] } {
  if (!value) return { style: [] }
  const [, name, height, style] = value.split('|')
  const size = Number(height)
  const bits = Number(style) || 0
  const styles: FontStyle[] = []
  if (bits & 1) styles.push('bold')
  if (bits & 2) styles.push('italic')
  return {
    ...(name ? { name } : {}),
    ...(Number.isFinite(size) && size > 0 ? { size: Math.round(size * 100) / 100 } : {}),
    style: styles,
  }
}

/**
 * Display settings Archi added after its first file format are `<feature>`
 * children, not attributes (`IDiagramModelObject.FEATURE_*` and its kin in
 * Archi 5.10). `lineAlpha` is read; the rest are counted with the unsupported
 * attributes. Any other feature is content, reported by `checkViewContent`.
 */
const LINE_ALPHA = 'lineAlpha'
const DISPLAY_FEATURES: ReadonlySet<string> = new Set([
  'gradient',
  'iconVisible',
  'iconColor',
  'deriveElementLineColor',
  'lineStyle',
  'hideJunctionArrows',
  'imageSource',
  'nameVisible',
  'textRelativePosition',
])
const isAppearanceFeature = (name: string) => name === LINE_ALPHA || DISPLAY_FEATURES.has(name)

/**
 * `OutlineOpacityHandler` (#118): at exactly 4.0.1 or 4.4.0, Archi sets every
 * shape's outline opacity to its fill opacity, over any it had. Counted when that
 * changes it; a malformed alpha is Archi's default, 255, as EMF reads it.
 */
function outlineFromFill(raw: RawNode, alpha: number | undefined, reader: Reader): number {
  const own = list(raw.feature).find((f) => asString(f['@name']) === LINE_ALPHA)
  const value = own === undefined ? undefined : num(own['@value'])
  // Replaced, but still a value Archi would not write (#123 review).
  if (own !== undefined && value === undefined) bump(reader.tally.malformed, LINE_ALPHA)
  const before = own === undefined ? 255 : (value ?? 255)
  const after = alpha ?? 255
  if (after !== before) reader.tally.outlineOpacity += 1
  return after
}

/** A feature's value as a number; present but not a number is malformed. */
function featureNumber(raw: RawNode, name: string, reader: Reader): number | undefined {
  const feature = list(raw.feature).find((f) => asString(f['@name']) === name)
  if (feature === undefined) return undefined
  const n = num(feature['@value'])
  if (n === undefined) bump(reader.tally.malformed, name)
  return n
}

/**
 * `swapped` is `Archimate32Handler` (#118): below 5.0.0 Archi swaps the figure of
 * thirteen element types between 0 and 1, so the figure it draws is the other
 * one, and only a figure other than 0 is one Archipelago does not draw.
 */
function countUnsupported(
  raw: RawNode,
  undrawn: ReadonlySet<string>,
  reader: Reader,
  swapped = false,
): void {
  for (const name of undrawn) {
    if (name === 'type' && swapped) {
      // A malformed figure is EMF's default, 0, before the swap.
      if (((num(raw['@type']) ?? 0) ^ 1) !== 0) bump(reader.tally.unsupported, name)
      reader.ledger.use(raw, '@type')
      continue
    }
    if (raw[`@${name}`] === undefined) continue
    bump(reader.tally.unsupported, name)
    reader.ledger.use(raw, `@${name}`)
  }
  for (const feature of list(raw.feature)) {
    const name = asString(feature['@name']) ?? ''
    if (DISPLAY_FEATURES.has(name)) bump(reader.tally.unsupported, name)
  }
}

/**
 * Does Archi swap this shape's figure as it opens the model (`Archimate32Handler`,
 * #118)? Only in a view under the first diagrams folder, the one it walks.
 */
function swapsFigure(raw: RawNode, view: Member, context: ViewContext): boolean {
  if (!context.reader.compatibility.alternateFigures || !view.firstDiagrams) return false
  if (splitType(typeOf(raw))[1] !== 'DiagramObject') return false
  const element = context.elements.get(asString(raw['@archimateElement']) ?? '')
  return element !== undefined && SWAPPED_FIGURES.has(element.type)
}

/**
 * The size `FixDefaultSizesHandler.getNewSize` gives a shape (#118). A shape with
 * both sides set keeps them; any other takes its legacy default, and a container
 * with children grows to hold each one, at its own new size, plus 10. Unset is
 * Archi's `-1` and nothing else: absent or malformed is EMF's default, -1, while
 * a 0 or another negative is kept, as Archi 5.10 kept them (#123 review).
 */
function legacySize(
  raw: RawNode,
  elements: ReadonlyMap<string, Element>,
): { width: number; height: number } {
  const bounds = entries(raw.bounds)[0] ?? {}
  const width = legacySide(bounds, 'width')
  const height = legacySide(bounds, 'height')
  if (width !== undefined && height !== undefined) return { width, height }
  const [, type] = splitType(typeOf(raw))
  const element = elements.get(asString(raw['@archimateElement']) ?? '')
  const fallback = legacyDefaultSize(type, element?.type)
  const children = list(raw.child)
  if (!isLegacyContainer(type) || children.length === 0) return fallback
  let grown = { width: 0, height: 0 }
  for (const child of children) {
    const at = entries(child.bounds)[0] ?? {}
    const size = legacySize(child, elements)
    grown = {
      width: Math.max((num(at['@x']) ?? 0) + size.width + 10, grown.width),
      height: Math.max((num(at['@y']) ?? 0) + size.height + 10, grown.height),
    }
  }
  return {
    width: Math.max(grown.width, fallback.width),
    height: Math.max(grown.height, fallback.height),
  }
}

/** A side as `FixDefaultSizesHandler` reads it: `undefined` when it is Archi's unset, -1. */
function legacySide(bounds: RawNode, key: 'width' | 'height'): number | undefined {
  const n = num(bounds[`@${key}`])
  return n === undefined || n === -1 ? undefined : n
}

/** The child elements a shape's nested shapes and connections hang from: walked, not consumed whole. */
const NESTED = ['child', 'sourceConnection']

const VIEW_OBJECT_LABELS: Record<ViewNode['kind'] | ViewConnection['kind'], string> = {
  element: 'an element’s shape',
  group: 'a group',
  note: 'a note',
  'view-ref': 'a view reference',
  legend: 'a legend',
  relationship: 'a relationship’s connection',
  line: 'a line',
}

/**
 * What Archi lets a shape or connection carry that it has no place for here:
 * properties, documentation anywhere but on a group, a label expression or
 * another feature (#100). Anything Archi would not write is left for the
 * ledger to report (#101).
 */
function checkViewContent(raw: RawNode, object: ViewNode | ViewConnection, reader: Reader): void {
  const on = VIEW_OBJECT_LABELS[object.kind]
  if (raw.property !== undefined) bump(reader.tally.viewContent, `properties on ${on}`)
  if (raw.documentation !== undefined && object.kind !== 'group') {
    bump(reader.tally.viewContent, `documentation on ${on}`)
  }
  // A legend's own feature was read with it (#134): the first, which is Archi's.
  let legendRead = object.kind !== 'legend'
  for (const feature of list(raw.feature)) {
    const name = asString(feature['@name']) ?? ''
    if (!legendRead && name === LEGEND_FEATURE) {
      legendRead = true
      continue
    }
    if (!isAppearanceFeature(name))
      bump(reader.tally.viewContent, `${describeFeature(name)} on ${on}`)
  }
  reader.ledger.whole(raw, 'property', 'feature')
  if (object.kind !== 'group') reader.ledger.whole(raw, 'documentation')
}

/**
 * Archi's features on an object that holds none here (an element, a relationship,
 * a view, a folder, the model): settings Archi added after its first file format,
 * stored as name and value. Each is reported by its name (#100, #110 review).
 */
function readUnheldFeatures(raw: RawNode, reader: Reader): void {
  for (const feature of list(raw.feature)) {
    reader.ledger.lose(raw, describeFeature(asString(feature['@name']) ?? ''))
  }
  reader.ledger.whole(raw, 'feature')
}

function describeFeature(name: string): string {
  return name === 'labelExpression' ? 'a label expression' : `the feature “${name}”`
}

/** What to call the object carrying unread content, from where it sits in the file (#101). */
function describe(path: readonly string[], node: RawNode): Noun {
  const at = path[path.length - 1]
  switch (at) {
    case 'model':
      return { one: 'the model', many: 'the model' }
    case 'folder':
      return path.length === 2
        ? { one: 'top-level folder', many: 'top-level folders' }
        : { one: 'folder', many: 'folders' }
    case 'element': {
      if (isFolderElement(node)) return { one: 'folder', many: 'folders' }
      const kind = classify(archiType(node).type)
      if (kind === 'relationship') return { one: 'relationship', many: 'relationships' }
      if (kind === 'diagram') return { one: 'view', many: 'views' }
      return { one: 'element', many: 'elements' }
    }
    case 'child':
      return { one: 'shape', many: 'shapes' }
    case 'sourceConnection':
      return { one: 'connection', many: 'connections' }
    case 'bounds':
      return { one: 'shape’s bounds', many: 'shapes’ bounds' }
    case 'bendpoint':
      return { one: 'bendpoint', many: 'bendpoints' }
    case 'property':
      return { one: 'property', many: 'properties' }
    case 'profile':
      return { one: 'specialization', many: 'specializations' }
    default:
      return { one: `<${at ?? ''}>`, many: `<${at ?? ''}> elements` }
  }
}

// ── Reporting ────────────────────────────────────────────────────────────────

function reportTally(reader: Reader): void {
  const { tally, problems, where } = reader
  reportCompatibility(reader)
  if (tally.renamed.size || tally.legacyConnections) {
    // An OrJunction is the one name not read as Archi reads it: Archi maps the
    // class and loses the kind; the file's or is kept (#119 review).
    const names = [...LEGACY_TYPES]
      .filter(([legacy]) => tally.renamed.has(legacy))
      .map(([legacy, now]) => {
        const n = tally.renamed.get(legacy)
        return legacy === 'OrJunction'
          ? `OrJunction as an or-junction (${n})`
          : `${legacy} as ${now} (${n})`
      })
    if (tally.legacyConnections) {
      names.push(
        `the connection attribute relationship as archimateRelationship (${tally.legacyConnections})`,
      )
    }
    problems.push(
      problem(
        'info',
        'archimate.legacy-names-converted',
        `This file uses names an older Archi wrote, and they were read under the names Archi 5.10 uses: ${names.join('; ')}.`,
        where,
      ),
    )
  }
  if (tally.orJunctions.length) {
    const n = tally.orJunctions.length
    problems.push(
      problem(
        'info',
        'archimate.legacy-or-junction',
        `${n} Or-junction${n === 1 ? '' : 's'} from an older Archi (${listed(tally.orJunctions)}) ${n === 1 ? 'was' : 'were'} kept as Or. Archi 5.10 opens ${n === 1 ? 'it as an And-junction' : 'them as And-junctions'}, so the file reads differently there.`,
        n === 1 ? { ...where, subject: tally.orJunctions[0]! } : where,
      ),
    )
  }
  if (tally.defaultSized) {
    problems.push(
      problem(
        'info',
        'archimate.default-size',
        `${tally.defaultSized} shape${tally.defaultSized === 1 ? ' was' : 's were'} left at Archi's default size, which the file does not record. ${tally.defaultSized === 1 ? 'It was' : 'They were'} drawn at Archi's standard defaults (120 × 55 for an element).`,
        where,
      ),
    )
  }
  if (tally.onConnections) {
    problems.push(
      problem(
        'warning',
        'archimate.connection-on-connection',
        `${tally.onConnections} connection${tally.onConnections === 1 ? '' : 's'} ended on another connection rather than on a shape. Archipelago does not draw those yet, so ${tally.onConnections === 1 ? 'it was' : 'they were'} skipped.`,
        where,
      ),
    )
  }
  if (tally.unsupported.size) {
    const names = [...tally.unsupported.keys()].sort()
    problems.push(
      problem(
        'info',
        'archimate.appearance-unsupported',
        `Some shapes and lines use Archi display settings Archipelago does not support yet (${listed(names)}); they are drawn without them.`,
        where,
      ),
    )
  }
  if (tally.malformed.size) {
    const names = [...tally.malformed.keys()].sort()
    problems.push(
      problem(
        'warning',
        'archimate.value-malformed',
        `Some shapes and lines hold values Archi does not write (${listed(names)}). A malformed position or bendpoint offset was read as 0, a size as Archi's default, and a colour, opacity, line width or text placement as not set, except an outline opacity that Archi replaces with the fill opacity as it opens the model, which was replaced the same way.`,
        where,
      ),
    )
  }
  if (tally.legendOptions) {
    problems.push(
      problem(
        'warning',
        'archimate.legend-options-malformed',
        `${tally.legendOptions} legend${tally.legendOptions === 1 ? ' holds' : 's hold'} options Archi does not write. Each was read as Archi reads it: a missing or unreadable option at Archi's default, and a number beyond Archi's bounds at the nearest one.`,
        where,
      ),
    )
  }
  if (tally.viewContent.size) {
    const found = [...tally.viewContent].map(([what, count]) => `${what} (${count})`).sort()
    problems.push(
      problem(
        'warning',
        'archimate.view-content-skipped',
        `Some objects in views carry what Archipelago cannot hold on them yet: ${found.join(', ')}. It was not imported.`,
        where,
      ),
    )
  }
  if (tally.routers) {
    problems.push(
      problem(
        'info',
        'archimate.router-unsupported',
        `${tally.routers} view${tally.routers === 1 ? ' names' : 's name'} a connection router that Archi 5.10 no longer draws, such as the retired shortest path. Archipelago, as Archi does, draws ${tally.routers === 1 ? 'its' : 'their'} connections through their bend-points, and saves ${tally.routers === 1 ? 'it' : 'them'} without the router.`,
        where,
      ),
    )
  }
  if (tally.specializations) {
    problems.push(
      problem(
        'info',
        'archimate.specialization-as-property',
        `${tally.specializations} element${tally.specializations === 1 ? ' has a specialization' : 's have specializations'}. Archipelago has none yet, so each was kept as a “${SPECIALIZATION_KEY}” property, as Archi's exchange export does.`,
        where,
      ),
    )
  }
}

/**
 * What Archi's compatibility handlers changed, said once (#118). Only what changed
 * is listed: a handler that found nothing to do says nothing.
 */
function reportCompatibility(reader: Reader): void {
  const { tally, version } = reader
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const changes: string[] = []
  if (tally.legacySized) {
    changes.push(
      `${plural(tally.legacySized, 'shape without a size was', 'shapes without a size were')} sized as Archi sizes ${tally.legacySized === 1 ? 'it' : 'them'}: 120 × 55 for any element but a junction, a Grouping too, and a group or shape grown to hold what is in it`,
    )
  }
  if (tally.leftAligned) {
    changes.push(
      `${plural(tally.leftAligned, 'group or Grouping label', 'group and Grouping labels')} aligned centre ${tally.leftAligned === 1 ? 'was' : 'were'} aligned left`,
    )
  }
  for (const { name, root } of tally.emptiedFolders) {
    changes.push(
      `the contents of the “${name}” folder were filed under ${FOLDER_ROOT_LABELS[root]}`,
    )
  }
  if (tally.movedFromBusiness) {
    changes.push(
      `${plural(tally.movedFromBusiness, 'Location, Meaning or Value element was', 'Location, Meaning and Value elements were')} moved out of a Business folder to the top of ${tally.movedFromBusiness === 1 ? 'its' : 'their'} own group`,
    )
  }
  if (tally.outlineOpacity) {
    changes.push(
      `${plural(tally.outlineOpacity, 'shape’s outline opacity was', 'shapes’ outline opacity was')} set to ${tally.outlineOpacity === 1 ? 'its' : 'their'} fill opacity`,
    )
  }
  if (!changes.length) return
  const saved =
    version === undefined
      ? 'This file records no model version, which Archi treats as older than every version'
      : `This file’s model version is “${version}”`
  reader.problems.push(
    problem(
      'info',
      'archimate.archi-compatibility',
      `${saved}, and Archi 5.10 changes such a model as it opens it. It was read with the same changes: ${changes.join('; ')}.`,
      reader.where,
    ),
  )
}

/** Is this member's id already taken by one kept earlier? If so, it is reported. */
function isDuplicate(
  member: Member,
  kept: { has(id: string): boolean },
  what: string,
  reader: Reader,
): boolean {
  const id = asString(member.raw['@id'])
  if (id === undefined || !kept.has(id)) return false
  duplicate(reader, what, id)
  reader.ledger.skip(member.raw)
  return true
}

function duplicate(reader: Reader, what: string, id: string): void {
  reader.problems.push(
    problem(
      'warning',
      'archimate.duplicate-id',
      `Two ${what}s share the id "${id}"; the later one was skipped.`,
      { ...reader.where, subject: id },
    ),
  )
}

// ── Values ───────────────────────────────────────────────────────────────────

/** A text child (`documentation`, `content`, `purpose`). */
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return textOf(value[0])
  if (isRawNode(value)) return textOf(value['#text'])
  return undefined
}

function isString(value: string | undefined): value is string {
  return value !== undefined
}
