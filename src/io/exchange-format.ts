import { XMLParser } from 'fast-xml-parser'
import {
  ACCESS_TYPES,
  DEFAULT_JUNCTION_KIND,
  DEFAULT_LANGUAGE,
  DEFAULT_TAG_GROUP,
  SCHEMA_VERSION,
  defaultFolderRoot,
  findElementType,
  TYPE_SPECIFIC_ATTRIBUTES,
  isAccessType,
  isElementType,
  isInfluenceModifier,
  isLanguageTag,
  isRelationshipType,
  misplacedAttributes,
  type AccessType,
  type Element,
  type ElementType,
  type FolderRoot,
  type JunctionKind,
  type PropertyValue,
  type Relationship,
  type RelationshipType,
  type TypeSpecificAttribute,
  type Workspace,
} from '@/model'
import { isExchangeSafeId } from '@/store/ids'
import {
  canonicalReportsJson,
  canonicalTagGroupsJson,
  isReportDefinition,
  isTagGroup,
} from './canonical-json'
import { Ledger, reportUnread, type Ignored, type Noun } from './consumption'
import {
  failed,
  problem,
  propertyRepeated,
  succeeded,
  type ImportProblem,
  type ImportResult,
} from './problems'
import { setKey } from './records'
import {
  asString,
  attr,
  claimIdentifier,
  isRawNode,
  langString,
  list,
  listed,
  text,
  type RawNode,
} from './exchange-xml'
import {
  STYLE_KEY,
  carriesStyle,
  memberGroups,
  readOrganizations,
  readViews,
  writeOrganizations,
  writeViews,
} from './exchange-views'
import {
  PROFILE_NAMESPACE,
  profileToProperties,
  readPortfolioProfile,
  readRelationshipProfile,
  relationshipProfileToProperties,
  stripProfileKeys,
} from './profile-properties'
import { isArchiNamespace, rootUnreadable, xmlRoot } from './xml-root'
import {
  foldPlans,
  planToProperties,
  sitePlanExports,
  type PlanElementOut,
  type PlanRelationshipOut,
} from './plan-exchange'

/**
 * The Open Group ArchiMate Model Exchange File Format (concept §5.3 item 2).
 *
 * This is the entry ticket to the ArchiMate tool ecosystem: Archi and every
 * certified tool reads and writes it, so it is how a model gets in and out of
 * Archipelago without anyone's data being trapped.
 *
 * Written by hand rather than through a serialiser library because the schema
 * pins **element order** (`name`, `documentation`, `properties`) and identifier
 * types (`xs:ID` / `xs:IDREF`), and a generic object-to-XML mapper gives no
 * control over either. Reading uses fast-xml-parser; writing is string building
 * with explicit escaping.
 *
 * Diagrams (`<views>`) and folders (`<organizations>`) are read and written by
 * `exchange-views.ts` (#76). Saved report definitions are not diagrams; the
 * writer carries those as model properties.
 */

const NS = 'http://www.opengroup.org/xsd/archimate/3.0/'
/** Every version of the format, 3.0 and 3.1 alike, lives under this. */
const EXCHANGE_NAMESPACE_FAMILY = 'http://www.opengroup.org/xsd/archimate'
const XSI = 'http://www.w3.org/2001/XMLSchema-instance'
/**
 * The Diagram schema, which includes the Model schema and adds views — what
 * Archi references too. A file without views is valid against either.
 */
const SCHEMA_LOCATION = `${NS} http://www.opengroup.org/xsd/archimate/3.1/archimate3_Diagram.xsd`

/**
 * Model-level properties carrying what the format has no home for.
 *
 * Saved reports and tag groups are not ArchiMate concepts, so the schema
 * has nowhere to put them and an earlier build simply dropped both — an
 * Archipelago → XML → Archipelago trip destroyed every saved view and every
 * custom tag colour without saying a word (#36). They now travel as two
 * namespaced model properties: a tool that does not know Archipelago shows two
 * extra key/value pairs on the model and hands them back untouched.
 *
 * Reports travelled as `archipelago.views` until schema 2 renamed them (#75);
 * a file written then is still read.
 */
export const REPORTS_KEY = `${PROFILE_NAMESPACE}.reports`
export const LEGACY_REPORTS_KEY = `${PROFILE_NAMESPACE}.views`
export const TAG_GROUPS_KEY = `${PROFILE_NAMESPACE}.tagGroups`

/** Tag groups identical to the shipped default are left out — import restores them. */
const DEFAULT_TAG_GROUPS_JSON = canonicalTagGroupsJson([DEFAULT_TAG_GROUP])

/**
 * `Junction` is one element type here and two concrete types in the schema.
 *
 * A `Map` rather than an object literal because the key comes from the file:
 * `JUNCTION_TYPES['toString']` on a literal resolves to `Object.prototype`'s
 * method, so `xsi:type="toString"` imported as a Junction that was never in the
 * file, carrying a *function* as its `junctionKind` (#37).
 */
const JUNCTION_TYPES = new Map<string, JunctionKind>([
  ['AndJunction', 'and'],
  ['OrJunction', 'or'],
])

/**
 * The data types the schema allows on a `propertyDefinition`.
 *
 * `currency`, `date` and `time` have no counterpart in `PropertyValue` — their
 * values are text to us — so the declaration is remembered on the workspace and
 * written back out. Deriving the type from `typeof value` alone re-declared them
 * as `string`, and a colleague reopening the file in Archi had lost the typing
 * and its formatting (#37).
 */
const EXCHANGE_PROPERTY_TYPES = ['string', 'boolean', 'currency', 'date', 'time', 'number'] as const
type ExchangePropertyType = (typeof EXCHANGE_PROPERTY_TYPES)[number]

function isExchangePropertyType(value: string): value is ExchangePropertyType {
  return (EXCHANGE_PROPERTY_TYPES as readonly string[]).includes(value)
}

/** The XML, plus anything the format could not carry exactly as it stood. */
export interface ExchangeExportResult {
  xml: string
  problems: ImportProblem[]
}

// ── Export ───────────────────────────────────────────────────────────────────

/**
 * `accessType`, `isDirected` and `modifier`, each written only on the type the
 * schema defines it for. One on the wrong type would make the file invalid, so
 * it is left out and said so (#84).
 */
function typeSpecificAttributes(relationship: Relationship, problems: ImportProblem[]): string {
  const misplaced = misplacedAttributes(relationship)
  for (const attribute of misplaced) {
    problems.push(
      problem(
        'warning',
        'exchange.relationship-attribute-dropped',
        `Relationship "${relationship.id}" is a ${relationship.type} but carries ${attribute}, which only ${TYPE_SPECIFIC_ATTRIBUTES[attribute]} relationships have. The exchange schema does not allow it there, so it was left out.`,
        { subject: relationship.id },
      ),
    )
  }
  const written = (attribute: TypeSpecificAttribute) => !misplaced.includes(attribute)
  let out = ''
  if (relationship.profile?.accessType && written('accessType')) {
    out += ` accessType="${attr(relationship.profile.accessType)}"`
  }
  if (relationship.isDirected && written('isDirected')) out += ' isDirected="true"'
  // Written as it is: the reader keeps surrounding spaces since #100, so the
  // trimming #90 did here is no longer needed to read back what was written.
  if (relationship.modifier && written('modifier')) {
    out += ` modifier="${attr(relationship.modifier)}"`
  }
  return out
}

/**
 * Serialise a workspace to exchange-format XML, reporting what had to change.
 *
 * Two things can change on the way out: an id that is not a legal XML name has
 * to be rewritten, and a relationship whose endpoint is not in the model cannot
 * be referenced at all. Both are in the result rather than in the file's
 * silence.
 *
 * Property *definitions* are collected first because the format references them
 * by id from every property instance: one definition per distinct key, in first-
 * seen order, so a re-export of an unchanged model is stable.
 */
export function exportExchange(workspace: Workspace): ExchangeExportResult {
  const problems: ImportProblem[] = []
  const ids = exchangeIdentifiers(workspace, problems)
  const modelProperties = modelLevelProperties(workspace)
  // Site plans are records, so their Work Packages exist only in the file (#209).
  const planned = sitePlanExports(workspace, ids, problems)
  const definitions = collectPropertyDefinitions(workspace, modelProperties, planned, ids, problems)
  const lang = writtenLanguage(workspace, problems)
  const lines: string[] = []

  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push(
    `<model xmlns="${NS}" xmlns:xsi="${XSI}" xsi:schemaLocation="${SCHEMA_LOCATION}" identifier="${attr(ids.model)}">`,
  )
  lines.push(`  <name xml:lang="${lang}">${text(workspace.name)}</name>`)
  // Where Archi's export writes a model's purpose, and its import reads it (#95).
  if (workspace.documentation) {
    lines.push(
      `  <documentation xml:lang="${lang}">${text(workspace.documentation)}</documentation>`,
    )
  }
  lines.push(...propertyLines(modelProperties, definitions, lang, 2))

  if (workspace.elements.length) {
    lines.push('  <elements>')
    for (const element of workspace.elements) {
      const properties = {
        ...element.properties,
        ...profileToProperties(element.profile),
        ...planToProperties(element.plan, ids.of),
      }
      lines.push(
        `    <element identifier="${attr(ids.of(element.id))}" xsi:type="${attr(exchangeType(element))}">`,
      )
      lines.push(`      <name xml:lang="${lang}">${text(element.name)}</name>`)
      if (element.documentation) {
        lines.push(
          `      <documentation xml:lang="${lang}">${text(element.documentation)}</documentation>`,
        )
      }
      lines.push(...propertyLines(properties, definitions, lang, 6))
      lines.push('    </element>')
    }
    for (const site of planned.elements) lines.push(...sitePlanLines(site, definitions, lang))
    lines.push('  </elements>')
  }

  const relationships = workspace.relationships.filter((relationship) => {
    const missing = [relationship.source, relationship.target].find((id) => !ids.knows(id))
    if (missing === undefined) return true
    problems.push(
      problem(
        'warning',
        'exchange.dangling-relationship',
        `Relationship "${relationship.id}" points at "${missing}", which is not in this model. The format cannot reference what is not in the file, so the relationship was left out.`,
        { subject: relationship.id },
      ),
    )
    return false
  })

  if (relationships.length || planned.relationships.length) {
    lines.push('  <relationships>')
    for (const relationship of relationships) {
      const properties = {
        ...relationship.properties,
        ...relationshipProfileToProperties(relationship.profile),
      }
      lines.push(
        `    <relationship identifier="${attr(ids.of(relationship.id))}" source="${attr(ids.of(relationship.source))}" target="${attr(ids.of(relationship.target))}"${typeSpecificAttributes(relationship, problems)} xsi:type="${attr(relationship.type)}">`,
      )
      if (relationship.name) {
        lines.push(`      <name xml:lang="${lang}">${text(relationship.name)}</name>`)
      }
      if (relationship.documentation) {
        lines.push(
          `      <documentation xml:lang="${lang}">${text(relationship.documentation)}</documentation>`,
        )
      }
      lines.push(...propertyLines(properties, definitions, lang, 6))
      lines.push('    </relationship>')
    }
    for (const relationship of planned.relationships) {
      lines.push(...sitePlanRelationshipLines(relationship))
    }
    lines.push('  </relationships>')
  }

  const written = new Set<string>([
    ...workspace.elements.map((element) => element.id),
    ...relationships.map((relationship) => relationship.id),
    ...workspace.views.map((view) => view.id),
  ])
  const writing = {
    of: ids.of,
    written: (id: string) => written.has(id),
    claim: ids.claim,
    language: lang,
  }
  lines.push(
    ...writeOrganizations(
      workspace.folders,
      [
        ...workspace.elements.map((element) => ({
          id: element.id,
          root: elementGroup(element),
          ...(element.folder !== undefined ? { folder: element.folder } : {}),
        })),
        ...relationships.map((relationship) => ({
          id: relationship.id,
          root: 'relations' as const,
          ...(relationship.folder !== undefined ? { folder: relationship.folder } : {}),
        })),
        ...workspace.views.map((view) => ({
          id: view.id,
          root: 'views' as const,
          ...(view.folder !== undefined ? { folder: view.folder } : {}),
        })),
      ],
      writing,
    ),
  )

  if (definitions.size) {
    lines.push('  <propertyDefinitions>')
    for (const [key, definition] of definitions) {
      lines.push(
        `    <propertyDefinition identifier="${attr(definition.id)}" type="${definition.type}">`,
      )
      lines.push(`      <name xml:lang="${lang}">${text(key)}</name>`)
      lines.push('    </propertyDefinition>')
    }
    lines.push('  </propertyDefinitions>')
  }

  lines.push(
    ...writeViews(workspace.views, {
      ...writing,
      elements: new Map(workspace.elements.map((element) => [element.id, element])),
      propertyLines: (properties, indent) => propertyLines(properties, definitions, lang, indent),
      problems,
    }),
  )

  lines.push('</model>')
  return { xml: `${lines.join('\n')}\n`, problems }
}

/** A site plan's Work Package (#209): an element only the file holds. */
function sitePlanLines(
  site: PlanElementOut,
  definitions: Map<string, PropertyDefinition>,
  lang: string,
): string[] {
  const lines = [
    `    <element identifier="${attr(site.id)}" xsi:type="WorkPackage">`,
    `      <name xml:lang="${lang}">${text(site.name)}</name>`,
  ]
  if (site.documentation) {
    lines.push(
      `      <documentation xml:lang="${lang}">${text(site.documentation)}</documentation>`,
    )
  }
  lines.push(...propertyLines(site.properties, definitions, lang, 6))
  lines.push('    </element>')
  return lines
}

/** A relationship the writer adds for a site plan; its ids are the file's already. */
function sitePlanRelationshipLines(relationship: PlanRelationshipOut): string[] {
  return [
    `    <relationship identifier="${attr(relationship.id)}" source="${attr(relationship.source)}" target="${attr(relationship.target)}" xsi:type="${relationship.type}">`,
    '    </relationship>',
  ]
}

/**
 * The `xml:lang` every text is written with: the workspace's own (#111). Both
 * readers only ever hold a valid tag, so one that is not came from somewhere
 * else, and it is reported rather than written into a file the schema rejects.
 */
function writtenLanguage(workspace: Workspace, problems: ImportProblem[]): string {
  const { language } = workspace
  if (language === undefined || isLanguageTag(language)) return language ?? DEFAULT_LANGUAGE
  problems.push(
    problem(
      'warning',
      'exchange.language-invalid',
      `The model's language "${language}" is not a language tag the exchange format allows, so its texts were labelled ${DEFAULT_LANGUAGE}.`,
    ),
  )
  return DEFAULT_LANGUAGE
}

/**
 * The XML alone.
 *
 * Prefer `exportExchange`, which also hands back what it had to rewrite or leave
 * out — a caller that ignores those is back to losing data quietly.
 */
export function exportExchangeXml(workspace: Workspace): string {
  return exportExchange(workspace).xml
}

/** The fixed group an element is filed under when it has no folder. */
function elementGroup(element: Element): FolderRoot {
  const meta = findElementType(element.type)
  return meta ? defaultFolderRoot(meta.layer) : 'other'
}

/** The concrete schema type for an element: junctions are And or Or, never bare. */
function exchangeType(element: Element): string {
  if (element.type !== 'Junction') return element.type
  return (element.junctionKind ?? DEFAULT_JUNCTION_KIND) === 'or' ? 'OrJunction' : 'AndJunction'
}

interface ExchangeIdentifiers {
  /** The xs:ID written for the model itself. */
  model: string
  /** The xs:ID written for a concept — its own id, unless that had to be rewritten. */
  of: (id: string) => string
  /** Is this id in the file at all? An IDREF to anything else is unwritable. */
  knows: (id: string) => boolean
  /**
   * An xs:ID nothing else in this file has taken, spelled as close to `base` as
   * possible. Everything written into the document's one `xs:ID` namespace has
   * to come through here — property definitions minted their own `propid-N`
   * beside it, and a model holding an element *called* `propid-1` produced a
   * file with two identical `xs:ID`s that no certified tool will open (#37).
   */
  claim: (base: string) => string
}

/**
 * Map every id in the workspace to a legal xs:ID.
 *
 * xs:ID values are XML names: they cannot start with a digit and cannot contain
 * most punctuation. Ids we generate always qualify (`el-<uuid>`), but ids that
 * arrived in a JSON file need not — the native reader accepts them — and writing
 * one unchanged produced a file no ArchiMate tool would read (#36).
 *
 * Ids that already qualify keep their spelling, and they are all claimed before
 * anything is rewritten so that a rewrite cannot take a name another concept
 * needs.
 */
function exchangeIdentifiers(workspace: Workspace, problems: ImportProblem[]): ExchangeIdentifiers {
  // Views are identified concepts too: a view reference points at one by id.
  const conceptIds = [...workspace.elements, ...workspace.relationships, ...workspace.views].map(
    (concept) => concept.id,
  )
  const used = new Set(conceptIds.filter(isExchangeSafeId))
  const byId = new Map<string, string>()

  for (const id of conceptIds) {
    if (byId.has(id)) continue
    if (isExchangeSafeId(id)) {
      byId.set(id, id)
      continue
    }
    const safe = claimIdentifier(id, used)
    byId.set(id, safe)
    problems.push(
      problem(
        'warning',
        'exchange.id-rewritten',
        `"${id}" cannot be used as an XML id, so this file calls it "${safe}". Importing the file back will not restore the original id.`,
        { subject: id },
      ),
    )
  }

  let model = workspace.id
  if (!isExchangeSafeId(model) || used.has(model)) {
    model = claimIdentifier(workspace.id, used)
    problems.push(
      problem(
        'warning',
        'exchange.id-rewritten',
        `The workspace id "${workspace.id}" cannot be used as the model's XML id, so this file calls it "${model}".`,
        { subject: workspace.id },
      ),
    )
  } else {
    used.add(model)
  }

  return {
    model,
    of: (id) => byId.get(id) ?? id,
    knows: (id) => byId.has(id),
    claim: (base) => claimIdentifier(base, used),
  }
}

/** What the workspace carries that the schema has no element for. */
function modelLevelProperties(workspace: Workspace): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {}
  if (workspace.reports.length) out[REPORTS_KEY] = canonicalReportsJson(workspace.reports)
  const tagGroups = canonicalTagGroupsJson(workspace.tagGroups)
  if (tagGroups !== DEFAULT_TAG_GROUPS_JSON) out[TAG_GROUPS_KEY] = tagGroups
  return out
}

interface PropertyDefinition {
  /** xs:ID of the definition, referenced by every instance of the key. */
  id: string
  /** One of the schema's data types. */
  type: ExchangePropertyType
}

function propertyLines(
  properties: Record<string, PropertyValue>,
  definitions: Map<string, PropertyDefinition>,
  language: string,
  indent: number,
): string[] {
  const keys = Object.keys(properties)
  if (!keys.length) return []
  const pad = ' '.repeat(indent)
  const out = [`${pad}<properties>`]
  for (const key of keys) {
    const definition = definitions.get(key)
    if (!definition) continue
    out.push(`${pad}  <property propertyDefinitionRef="${attr(definition.id)}">`)
    out.push(`${pad}    <value xml:lang="${language}">${text(String(properties[key]))}</value>`)
    out.push(`${pad}  </property>`)
  }
  out.push(`${pad}</properties>`)
  return out
}

/**
 * One definition per distinct key, typed by the values it actually holds.
 *
 * The type matters on the way back in: written as `string`, `"pii": true` and
 * `"capacity": 42` returned as the strings `"true"` and `"42"`, which broke
 * filters and made the next canonical-JSON export differ from the last (#36).
 * A key used inconsistently — a number here, a word there — falls back to
 * `string`, because the format allows exactly one type per definition.
 */
function collectPropertyDefinitions(
  workspace: Workspace,
  modelProperties: Record<string, PropertyValue>,
  planned: { elements: readonly PlanElementOut[] },
  ids: ExchangeIdentifiers,
  problems: ImportProblem[],
): Map<string, PropertyDefinition> {
  const kinds = new Map<string, Set<string>>()
  const remember = (properties: Record<string, PropertyValue>) => {
    for (const [key, value] of Object.entries(properties)) {
      const seen = kinds.get(key)
      if (seen) seen.add(typeof value)
      else kinds.set(key, new Set([typeof value]))
    }
  }

  remember(modelProperties)
  for (const element of workspace.elements) {
    remember(element.properties)
    remember(profileToProperties(element.profile))
    remember(planToProperties(element.plan, ids.of))
  }
  for (const site of planned.elements) remember(site.properties)
  for (const relationship of workspace.relationships) {
    remember(relationship.properties)
    remember(relationshipProfileToProperties(relationship.profile))
  }
  for (const view of workspace.views) {
    remember(view.properties)
    if (carriesStyle(view)) remember({ [STYLE_KEY]: '' })
  }

  // A Map, not the record itself: the keys are the file's, and `declared['toString']`
  // on a plain object hands back a function (#37, finding 2's shape one file over).
  const declared = new Map(Object.entries(workspace.propertyTypes ?? {}))

  const definitions = new Map<string, PropertyDefinition>()
  for (const [key, seen] of kinds) {
    const derived = definitionType(seen)
    // `currency`, `date` and `time` values are text to us, so `typeof value` can
    // only ever say `string` for them. Where it says exactly that, the file's own
    // declaration is the better information and is written back unchanged (#37).
    const carried = declared.get(key)
    const type =
      derived === 'string' && carried !== undefined && isExchangePropertyType(carried)
        ? carried
        : derived
    if (seen.size > 1) {
      problems.push(
        problem(
          'info',
          'exchange.property-type-mixed',
          `Property "${key}" holds ${[...seen].sort().join(' and ')} values in this model, and the format allows one type per key. It was written as text, so it comes back as text.`,
        ),
      )
    }
    definitions.set(key, { id: ids.claim(`propid-${definitions.size + 1}`), type })
  }
  return definitions
}

function definitionType(seen: Set<string>): ExchangePropertyType {
  if (seen.size !== 1) return 'string'
  const [only] = [...seen]
  return only === 'boolean' || only === 'number' ? only : 'string'
}

// ── Import ───────────────────────────────────────────────────────────────────

/** A property definition as the file declares it: the key, and how to read values. */
interface DeclaredProperty {
  key: string
  type: string
  /** The `<propertyDefinition>`, whose name's language counts once a kept property uses it. */
  raw: RawNode
}

/** Where a reader reports to: the problem list and the file it is reading. */
export interface ProblemSink {
  problems: ImportProblem[]
  where: { file?: string }
}

/** Everything the readers below need, so the argument lists stay honest. */
interface Reader {
  definitions: Map<string, DeclaredProperty>
  /** propertyDefinitionRefs that resolved to nothing — reported once, at the end. */
  unresolved: Set<string>
  problems: ImportProblem[]
  where: { file?: string }
  /** What was read, so that what was not is reported (#101). */
  ledger: Ledger
}

/**
 * What this reader deliberately does not read, and why (#101). Anything else it
 * does not mark as read is reported as `import.content-unread`. The parser drops
 * namespace declarations itself (`removeNSPrefix`).
 */
const IGNORED: readonly Ignored[] = [
  {
    at: 'model',
    key: '@schemaLocation',
    reason: 'Where to fetch the schema. The writer names its own.',
  },
]

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Namespace prefixes vary between tools (`xsi:type`, `archimate:type`); dropping
  // them means the reader does not care which prefix a file happens to use.
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  // Names, keys, values and documentation are read as written. Trimming them
  // changed them without a word, and could merge two property names (#100).
  trimValues: false,
  // Decode numeric character references. Off, `&#xD;&#xA;` — how Archi writes a
  // line break in documentation or a note — arrived as those literal characters,
  // and `&#233;` as six characters instead of an é (#76). `&amp;#65;` still reads
  // as the text `&#65;`: the escaped ampersand is decoded once, not twice.
  htmlEntities: true,
})

export function importExchangeXml(xml: string, file?: string): ImportResult {
  const problems: ImportProblem[] = []
  const where = file ? { file } : {}

  let parsed: RawNode
  try {
    parsed = parser.parse(xml) as RawNode
  } catch (error) {
    return failed([
      problem(
        'error',
        'exchange.unparseable',
        `The file is not valid XML: ${error instanceof Error ? error.message : String(error)}`,
        where,
      ),
    ])
  }

  // Archi's own file also has a root called `model`, and read here it came in
  // empty, ok and silent (#99). Only Archi's namespaces are refused: a file with
  // no namespace, or a near miss, is still read, and the mismatch noted (#103).
  // A root the scan cannot find while the parser found a model is refused: the
  // guard must fail closed. With neither, the file is not a model at all, and
  // the not-a-model check below says so (#104).
  const root = xmlRoot(xml)
  if (!root && parsed.model !== undefined) return failed([rootUnreadable('exchange', where)])
  if (root?.local === 'model' && isArchiNamespace(root.namespace)) {
    return failed([
      problem(
        'error',
        'exchange.wrong-namespace',
        `The root element <model> is in Archi’s namespace (${root.namespace ?? ''}), so this is an Archi model file, not an ArchiMate Model Exchange Format file. Open it as an Archi model.`,
        where,
      ),
    ])
  }
  if (root?.local === 'model' && !root.namespace?.startsWith(EXCHANGE_NAMESPACE_FAMILY)) {
    problems.push(
      problem(
        'info',
        'exchange.namespace-unexpected',
        `The root element <model> is ${root.namespace ? `in the namespace ${root.namespace}` : 'in no namespace'}, not the Open Group’s (${NS}). It was read as the exchange format anyway.`,
        where,
      ),
    )
  }

  // Untrimmed, `<model> </model>` parses to ' ', which is truthy and was read as
  // an empty model, ok and silent (#106 review). Only an element is a model.
  const model = parsed.model
  if (!isRawNode(model)) {
    return failed([
      problem(
        'error',
        'exchange.not-a-model',
        'No <model> element — this does not look like an ArchiMate Model Exchange Format file.',
        where,
      ),
    ])
  }

  const ledger = new Ledger()
  ledger.use(model, '@identifier', 'elements', 'relationships', 'views', 'organizations')
  ledger.text(model, 'name')
  ledger.text(model, 'documentation')
  const reader: Reader = {
    definitions: readPropertyDefinitions(model, problems, where, ledger),
    unresolved: new Set<string>(),
    problems,
    where,
    ledger,
  }

  const elements: Element[] = []
  const seenIds = new Set<string>()

  for (const elementsNode of list(model.elements)) ledger.use(elementsNode, 'element')
  for (const raw of list((model.elements as RawNode | undefined)?.element)) {
    const element = readElement(raw, reader)
    if (!element) {
      ledger.skip(raw)
      continue
    }
    if (seenIds.has(element.id)) {
      ledger.skip(raw)
      problems.push(
        problem(
          'warning',
          'exchange.duplicate-id',
          `Two elements share the identifier "${element.id}"; the later one was skipped.`,
          {
            ...where,
            subject: element.id,
          },
        ),
      )
      continue
    }
    seenIds.add(element.id)
    elements.push(element)
  }

  const relationships: Relationship[] = []
  const seenRelationshipIds = new Set<string>()
  for (const relationshipsNode of list(model.relationships)) {
    ledger.use(relationshipsNode, 'relationship')
  }
  for (const raw of list((model.relationships as RawNode | undefined)?.relationship)) {
    const relationship = readRelationship(raw, seenIds, reader)
    if (!relationship) {
      ledger.skip(raw)
      continue
    }
    if (seenRelationshipIds.has(relationship.id)) {
      ledger.skip(raw)
      problems.push(
        problem(
          'warning',
          'exchange.duplicate-relationship-id',
          `Two relationships share the identifier "${relationship.id}"; the later one was skipped.`,
          { ...where, subject: relationship.id },
        ),
      )
      continue
    }
    seenRelationshipIds.add(relationship.id)
    relationships.push(relationship)
  }

  // Before views and folders: a drawing of a folded Work Package is reported there.
  const plans = foldPlans(elements, relationships, reader)

  const modelProperties = readProperties(model, reader, false)
  const reports =
    carried(modelProperties[REPORTS_KEY], isReportDefinition, 'saved reports', reader) ??
    carried(modelProperties[LEGACY_REPORTS_KEY], isReportDefinition, 'saved reports', reader)
  const tagGroups = carried(modelProperties[TAG_GROUPS_KEY], isTagGroup, 'tag groups', reader)

  reportForeignModelProperties(modelProperties, problems, where)

  const views = readViews(model, {
    elements: new Map(plans.elements.map((element) => [element.id, element])),
    relationships: new Map(
      plans.relationships.map((relationship) => [relationship.id, relationship]),
    ),
    readProperties: (raw) => readProperties(raw, reader),
    problems,
    where,
    ledger,
  })
  // A folded site plan's Work Package is filed nowhere now, which is said once below.
  const groups = memberGroups(plans.elements, plans.relationships, views)
  for (const id of plans.foldedElements) groups.set(id, 'implementation')
  for (const id of plans.foldedRelationships) groups.set(id, 'relations')
  const { folders, membership } = readOrganizations(model, groups, problems, where, ledger)
  reportFoldedFiling(
    [...plans.foldedElements, ...plans.foldedRelationships].filter((id) => membership.has(id)),
    reader,
  )
  const fileIn = <T extends { id: string; folder?: string }>(item: T): T => {
    const folder = membership.get(item.id)
    return folder === undefined ? item : { ...item, folder }
  }
  // Property values were read on the way; an unresolved definition can be on a view.
  reportUnresolvedProperties(reader)

  const language = modelLanguage(ledger.languages(), problems, where)

  problems.push(
    ...reportUnread(
      ledger.unread(model, 'model', {
        ignored: IGNORED,
        subjectOf,
      }),
      describe,
      where,
    ),
  )

  const workspace: Workspace = {
    id: asString(model['@identifier']) || 'ws-imported',
    name: langString(model.name) || 'Imported model',
    schemaVersion: SCHEMA_VERSION,
    elements: plans.elements.map(fileIn),
    relationships: plans.relationships.map(fileIn),
    views: views.map(fileIn),
    folders,
    reports: reports ?? [],
    tagGroups: tagGroups ?? [DEFAULT_TAG_GROUP],
  }
  const documentation = langString(model.documentation)
  if (documentation) workspace.documentation = documentation
  const propertyTypes = declaredPropertyTypes(reader.definitions)
  if (propertyTypes) workspace.propertyTypes = propertyTypes
  if (language !== DEFAULT_LANGUAGE) workspace.language = language

  return succeeded(workspace, problems)
}

/**
 * The one language the model is held in: the one most of its kept texts carry
 * (#111).
 *
 * Archi labels every text of an export with the one language its wizard asks
 * for, so a file in one language is the common case and this keeps it whole.
 * Tags are compared as BCP 47 compares them, ignoring case, and the spelling
 * most texts use is kept. An untagged text claims no language and has always
 * been written `en`, so it votes for `en`. A majority tag that `xs:language`
 * does not allow cannot be held, and the model stays `en` rather than letting a
 * stray minority decide. A tie goes to the tag that sorts first, so the result
 * does not depend on the order of the file (#114 review).
 *
 * A text the export will label differently is reported, not relabelled quietly.
 * Untagged texts are reported only when the model is not `en`: labelling them
 * `en` is what every export before this one did.
 */
function modelLanguage(
  languages: { tagged: ReadonlyMap<string, number>; untagged: number },
  problems: ImportProblem[],
  where: { file?: string },
): string {
  const groups = new Map<string, { n: number; spellings: Map<string, number> }>()
  const group = (key: string) => {
    let found = groups.get(key)
    if (!found) groups.set(key, (found = { n: 0, spellings: new Map() }))
    return found
  }
  for (const [tag, n] of languages.tagged) {
    const found = group(tag.toLowerCase())
    found.n += n
    found.spellings.set(tag, n)
  }
  if (languages.untagged) group(DEFAULT_LANGUAGE).n += languages.untagged

  const [winner] = [...groups].sort(([a, x], [b, y]) => y.n - x.n || (a < b ? -1 : a > b ? 1 : 0))
  let language = DEFAULT_LANGUAGE
  if (winner && winner[0] !== DEFAULT_LANGUAGE) {
    const [spelling] = [...winner[1].spellings].sort(
      ([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0),
    )
    if (spelling && isLanguageTag(spelling[0])) language = spelling[0]
  }

  const held = language.toLowerCase()
  const others = [...languages.tagged].filter(([tag]) => tag.toLowerCase() !== held)
  const labels = others.map(([tag, n]) => `${isLanguageTag(tag) ? tag : `“${tag}”`} (${n})`)
  let n = others.reduce((sum, [, count]) => sum + count, 0)
  if (held !== DEFAULT_LANGUAGE && languages.untagged) {
    labels.push(`no language (${languages.untagged})`)
    n += languages.untagged
  }
  if (n) {
    problems.push(
      problem(
        'info',
        'exchange.language-relabelled',
        `${n} text${n === 1 ? ' is' : 's are'} not labelled ${language}: ${listed(labels)}. Archipelago holds a model in one language, so an export labels ${n === 1 ? 'it' : 'them'} ${language}.`,
        where,
      ),
    )
  }
  return language
}

function readPropertyDefinitions(
  model: RawNode,
  problems: ImportProblem[],
  where: { file?: string },
  ledger: Ledger,
): Map<string, DeclaredProperty> {
  const definitions = new Map<string, DeclaredProperty>()
  const unknown = new Set<string>()
  ledger.use(model, 'propertyDefinitions')
  for (const container of list(model.propertyDefinitions))
    ledger.use(container, 'propertyDefinition')
  const container = model.propertyDefinitions as RawNode | undefined
  for (const raw of list(container?.propertyDefinition)) {
    const id = asString(raw['@identifier'])
    const key = langString(raw.name)
    // Without both there is nothing to look a value up by. Left unmarked, so the
    // ledger reports what it held (#101).
    if (!id || !key) continue
    const type = asString(raw['@type']) ?? 'string'
    if (!isExchangePropertyType(type)) unknown.add(type)
    definitions.set(id, { key, type, raw })
    ledger.use(raw, '@identifier', '@type')
    ledger.text(raw, 'name')
    // Written only for a key a kept property uses, so only such a use counts its
    // language, in `readProperties` (#114 review).
    ledger.forget(raw, 'name')
  }
  if (unknown.size) {
    problems.push(
      problem(
        'warning',
        'exchange.property-type-unknown',
        `${unknown.size} property definition${unknown.size === 1 ? '' : 's'} in this file declare${unknown.size === 1 ? 's' : ''} a type the exchange format has no such thing as (${listed([...unknown])}). Those values were read as text, and a re-export declares them as text.`,
        where,
      ),
    )
  }
  return definitions
}

/**
 * The declared types worth remembering on the workspace.
 *
 * `boolean` and `number` are re-derived from the value on the way out, but
 * `currency`, `date` and `time` have no counterpart in `PropertyValue`, so
 * without this the declaration was gone and the re-export said `string` (#37).
 * `string` itself is the default and is not worth a line in the file.
 */
function declaredPropertyTypes(
  definitions: Map<string, DeclaredProperty>,
): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const { key, type } of definitions.values()) {
    if (type === 'string' || !isExchangePropertyType(type)) continue
    if (!Object.hasOwn(out, key)) setKey(out, key, type)
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * The schema's element type, as a model type.
 *
 * The catalogue follows the specification, which has one `Junction`; the schema
 * has two concrete junction types. A bare `Junction` is not schema-valid but
 * tools write it, and the specification says an unqualified junction is an
 * And-junction — so it is read rather than refused.
 */
function readType(raw: string): { type: ElementType; junctionKind?: JunctionKind } | undefined {
  const kind = JUNCTION_TYPES.get(raw)
  if (kind !== undefined || raw === 'Junction') {
    // Absent means `and`, and the canonical writer omits it on that account, so
    // materialising it here made two files holding the same model differ byte
    // for byte on the field the reader had just invented (ADR 0004, #37).
    return kind === undefined || kind === DEFAULT_JUNCTION_KIND
      ? { type: 'Junction' }
      : { type: 'Junction', junctionKind: kind }
  }
  return isElementType(raw) ? { type: raw } : undefined
}

function readElement(raw: RawNode, reader: Reader): Element | undefined {
  const { problems, where } = reader
  const id = asString(raw['@identifier'])
  const type = asString(raw['@type'])
  if (!id) {
    problems.push(
      problem('error', 'exchange.element-no-id', 'An <element> has no identifier.', where),
    )
    return undefined
  }
  const mapped = type ? readType(type) : undefined
  if (!mapped) {
    problems.push(
      problem(
        'error',
        'exchange.unknown-element-type',
        `Element "${id}" has xsi:type "${type || '(none)'}", which is not an ArchiMate 3.2 element type. It was skipped.`,
        { ...where, subject: id },
      ),
    )
    return undefined
  }

  const properties = readProperties(raw, reader)
  const { profile, unread } = readPortfolioProfile(properties)
  reportUnreadProfileKeys(id, unread, reader)
  const element: Element = {
    id,
    type: mapped.type,
    name: langString(raw.name) ?? '',
    properties: stripProfileKeys(properties, unread),
  }
  if (mapped.junctionKind) element.junctionKind = mapped.junctionKind
  const documentation = langString(raw.documentation)
  if (documentation) element.documentation = documentation
  if (profile) element.profile = profile
  reader.ledger.use(raw, '@identifier', '@type')
  reader.ledger.text(raw, 'name')
  reader.ledger.text(raw, 'documentation')
  return element
}

/**
 * An `archipelago.*` key this build knows but could not read.
 *
 * The value is kept as an ordinary property by `stripProfileKeys`, so nothing is
 * lost — but the assessment the file was trying to express did not arrive, and
 * saying so is the difference between this and the silent drop it replaced (#37).
 */
export function reportUnreadProfileKeys(
  subject: string,
  unread: readonly string[],
  reader: ProblemSink,
): void {
  if (!unread.length) return
  reader.problems.push(
    problem(
      'warning',
      'exchange.profile-value-unreadable',
      `"${subject}" carries ${unread.length} Archipelago propert${unread.length === 1 ? 'y' : 'ies'} (${listed(unread)}) whose value this build cannot read, so ${unread.length === 1 ? 'it was' : 'they were'} kept as ordinary properties rather than as portfolio fields.`,
      { ...reader.where, subject },
    ),
  )
}

function readRelationship(
  raw: RawNode,
  knownIds: Set<string>,
  reader: Reader,
): Relationship | undefined {
  const { problems, where } = reader
  const id = asString(raw['@identifier'])
  const type = asString(raw['@type'])
  const source = asString(raw['@source'])
  const target = asString(raw['@target'])

  if (!id) {
    problems.push(
      problem('error', 'exchange.relationship-no-id', 'A <relationship> has no identifier.', where),
    )
    return undefined
  }
  if (!type || !isRelationshipType(type)) {
    problems.push(
      problem(
        'error',
        'exchange.unknown-relationship-type',
        `Relationship "${id}" has xsi:type "${type || '(none)'}", which is not an ArchiMate 3.2 relationship type. It was skipped.`,
        { ...where, subject: id },
      ),
    )
    return undefined
  }
  if (!source || !target) {
    problems.push(
      problem(
        'error',
        'exchange.relationship-no-endpoints',
        `Relationship "${id}" is missing a source or target.`,
        {
          ...where,
          subject: id,
        },
      ),
    )
    return undefined
  }
  if (!knownIds.has(source) || !knownIds.has(target)) {
    problems.push(
      problem(
        'warning',
        'exchange.dangling-relationship',
        `Relationship "${id}" points at an element that is not in the file. It was skipped.`,
        { ...where, subject: id },
      ),
    )
    return undefined
  }

  const properties = readProperties(raw, reader)
  const read = readRelationshipProfile(properties)
  reportUnreadProfileKeys(id, read.unread, reader)
  const relationship: Relationship = {
    id,
    type,
    source,
    target,
    properties: stripProfileKeys(properties, read.unread),
  }
  const name = langString(raw.name)
  if (name) relationship.name = name
  const documentation = langString(raw.documentation)
  if (documentation) relationship.documentation = documentation
  reader.ledger.use(raw, '@identifier', '@type', '@source', '@target')
  reader.ledger.text(raw, 'name')
  reader.ledger.text(raw, 'documentation')

  const profile = read.profile ?? {}
  const attributes = readTypeSpecificAttributes(raw, id, type, reader)
  if (attributes.accessType) profile.accessType = attributes.accessType
  if (attributes.isDirected) relationship.isDirected = true
  if (attributes.modifier !== undefined) relationship.modifier = attributes.modifier
  if (Object.keys(profile).length) relationship.profile = profile

  return relationship
}

/**
 * `accessType`, `isDirected` and `modifier`: the attributes the schema defines
 * on one relationship type each (#84). One on another type, or a value the
 * schema does not allow, is reported rather than read — the file said something
 * this model cannot hold, and dropping it quietly is what #84 was.
 */
function readTypeSpecificAttributes(
  raw: RawNode,
  id: string,
  type: RelationshipType,
  reader: Reader,
): { accessType?: AccessType; isDirected?: true; modifier?: string } {
  const out: { accessType?: AccessType; isDirected?: true; modifier?: string } = {}
  const ignored = (message: string) =>
    reader.problems.push(
      problem('warning', 'exchange.relationship-attribute-ignored', message, {
        ...reader.where,
        subject: id,
      }),
    )

  for (const attribute of Object.keys(TYPE_SPECIFIC_ATTRIBUTES) as TypeSpecificAttribute[]) {
    const value = asString(raw[`@${attribute}`])
    if (value === undefined) continue
    // Read, or reported as ignored: an empty modifier is no modifier.
    reader.ledger.use(raw, `@${attribute}`)
    const owner = TYPE_SPECIFIC_ATTRIBUTES[attribute]
    if (type !== owner) {
      ignored(
        `Relationship "${id}" is a ${type}, but carries ${attribute}="${value}", which only ${owner} relationships have. It was ignored.`,
      )
      continue
    }
    switch (attribute) {
      case 'accessType':
        if (isAccessType(value)) out.accessType = value
        else {
          ignored(
            `Access relationship "${id}" has accessType "${value}", which is not one of ${ACCESS_TYPES.join(', ')}. It was ignored.`,
          )
        }
        break
      case 'isDirected':
        // xs:boolean: the schema allows 1 and 0 as well as the words.
        if (value === 'true' || value === '1') out.isDirected = true
        else if (value !== 'false' && value !== '0') {
          ignored(
            `Association "${id}" has isDirected "${value}", which is not a boolean. It was read as undirected.`,
          )
        }
        break
      case 'modifier':
        // An empty modifier is no modifier; anything else is the file's text.
        if (isInfluenceModifier(value)) out.modifier = value
        break
    }
  }
  return out
}

/**
 * `votes` is false for the model's own properties: those Archipelago reads are
 * its own carried JSON, and the rest are dropped and reported, so none of them
 * is a text of the model whose language it should take (#114 review).
 */
function readProperties(raw: RawNode, reader: Reader, votes = true): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {}
  const repeated = new Set<string>()
  const { ledger } = reader
  ledger.use(raw, 'properties')
  for (const container of list(raw.properties)) ledger.use(container, 'property')
  const container = raw.properties as RawNode | undefined
  for (const property of list(container?.property)) {
    const ref = asString(property['@propertyDefinitionRef'])
    const definition = ref ? reader.definitions.get(ref) : undefined
    if (!definition) {
      reader.unresolved.add(ref ?? '(none)')
      ledger.skip(property)
      continue
    }
    const value = langString(property.value)
    if (value === undefined) {
      // The schema requires a value. An empty one is `<value/>`, read as the
      // empty string; with none, there is no value to keep (#100, #101).
      ledger.lose(raw, `a property with no <value> (“${definition.key}”)`)
      ledger.skip(property)
      continue
    }
    // A name may repeat on one object; the model holds it once. The first is
    // kept and the rest are reported (#100).
    if (Object.hasOwn(out, definition.key)) {
      repeated.add(definition.key)
      ledger.skip(property)
    } else {
      setKey(out, definition.key, typedValue(value, definition.type))
      ledger.use(property, '@propertyDefinitionRef')
      ledger.text(property, 'value')
      if (votes) ledger.text(definition.raw, 'name')
      else ledger.forget(property, 'value')
    }
  }
  if (repeated.size) {
    reader.problems.push(
      propertyRepeated(asString(raw['@identifier']), [...repeated], reader.where),
    )
  }
  return out
}

/**
 * A property value in the type its definition declares.
 *
 * A value that does not match its declared type stays a string rather than
 * becoming `NaN` or `false`: the file said one thing and holds another, and
 * guessing would lose what it actually holds.
 *
 * "Matches" means the *text* survives, not just the parse. `Number` is not
 * reversible — `0912345678`, `1.50` and a twenty-digit account number all come
 * back spelled differently, and it is the new spelling that the next export
 * writes into the file (#37). A number we cannot spell back stays the text it
 * was; `currency`, `date` and `time` are text to begin with.
 */
function typedValue(value: string, type: string): PropertyValue {
  if (type === 'boolean') {
    if (value === 'true') return true
    if (value === 'false') return false
    return value
  }
  if (type === 'number') {
    const parsed = Number(value)
    if (value.trim() === '' || !Number.isFinite(parsed)) return value
    return String(parsed) === value ? parsed : value
  }
  return value
}

/**
 * Read back one of the lists the writer carries as a model property. `undefined`
 * means the file carries none, which is not the same as carrying an empty one.
 */
export function carried<T>(
  raw: PropertyValue | undefined,
  isValid: (value: unknown) => value is T,
  what: string,
  reader: ProblemSink,
): T[] | undefined {
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : undefined
  } catch {
    parsed = undefined
  }
  if (!Array.isArray(parsed)) {
    reader.problems.push(
      problem(
        'warning',
        'exchange.carried-unreadable',
        `The ${what} carried by this file could not be read and were dropped.`,
        reader.where,
      ),
    )
    return undefined
  }
  const kept = parsed.filter(isValid)
  if (kept.length !== parsed.length) {
    reader.problems.push(
      problem(
        'warning',
        'exchange.carried-unreadable',
        `${parsed.length - kept.length} of the ${parsed.length} ${what} carried by this file were malformed and were dropped.`,
        reader.where,
      ),
    )
  }
  return kept
}

/**
 * A site plan's Work Package, or one of its relationships, that the file
 * filed in a folder (#209). The plan is a record of its rollout now, and a
 * record has no folder, so the filing is said, not dropped quietly.
 */
function reportFoldedFiling(ids: readonly string[], reader: ProblemSink): void {
  if (!ids.length) return
  reader.problems.push(
    problem(
      'info',
      'exchange.plan-folder-ignored',
      `${ids.length} site plan${ids.length === 1 ? '' : 's'}' Work Packages or relationships (${listed(ids)}) ${ids.length === 1 ? 'was' : 'were'} filed in a folder. Site plans are records of their rollout, so the folder was not kept.`,
      reader.where,
    ),
  )
}

/** Model-level properties are read for what is ours; the rest have nowhere to go. */
export function reportForeignModelProperties(
  modelProperties: Record<string, PropertyValue>,
  problems: ImportProblem[],
  where: { file?: string },
): void {
  const foreign = Object.keys(modelProperties).filter(
    (key) => key !== REPORTS_KEY && key !== LEGACY_REPORTS_KEY && key !== TAG_GROUPS_KEY,
  )
  if (!foreign.length) return
  problems.push(
    problem(
      'info',
      'exchange.model-properties-skipped',
      `${foreign.length} model-level propert${foreign.length === 1 ? 'y' : 'ies'} (${listed(foreign)}) ${foreign.length === 1 ? 'was' : 'were'} not imported — Archipelago keeps properties on elements and relationships.`,
      where,
    ),
  )
}

function reportUnresolvedProperties(reader: Reader): void {
  if (!reader.unresolved.size) return
  const refs = [...reader.unresolved]
  reader.problems.push(
    problem(
      'warning',
      'exchange.property-unresolved',
      `${refs.length} property definition${refs.length === 1 ? '' : 's'} referenced by this file ${refs.length === 1 ? 'is' : 'are'} missing (${listed(refs)}), so the values using ${refs.length === 1 ? 'it' : 'them'} could not be read.`,
      reader.where,
    ),
  )
}

/** An object's id. A folder may have none, and then borrows none from the model. */
function subjectOf(node: RawNode, at: string): string | undefined | null {
  const id = asString(node['@identifier']) ?? asString(node['@identifierRef'])
  return id ?? (at === 'item' ? null : undefined)
}

/** What to call the object carrying unread content, from where it sits in the file (#101). */
function describe(path: readonly string[], node: RawNode): Noun {
  const at = path[path.length - 1]
  switch (at) {
    case 'model':
      return { one: 'the model', many: 'the model' }
    case 'element':
      return { one: 'element', many: 'elements' }
    case 'relationship':
      return { one: 'relationship', many: 'relationships' }
    case 'view':
      return { one: 'view', many: 'views' }
    case 'node':
      return { one: 'view node', many: 'view nodes' }
    case 'connection':
      return { one: 'connection', many: 'connections' }
    case 'item':
      return node['@identifierRef'] === undefined
        ? { one: 'folder', many: 'folders' }
        : { one: 'folder entry', many: 'folder entries' }
    case 'propertyDefinition':
      return { one: 'property definition', many: 'property definitions' }
    case 'property':
      return { one: 'property', many: 'properties' }
    case 'bendpoint':
      return { one: 'bendpoint', many: 'bendpoints' }
    default:
      return { one: `<${at ?? ''}>`, many: `<${at ?? ''}> elements` }
  }
}
