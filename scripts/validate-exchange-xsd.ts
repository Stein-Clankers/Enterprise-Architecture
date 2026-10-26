/**
 * Validates our exchange-format output against the Open Group's published XSDs.
 *
 * `xmllint` does the validating, so this needs libxml2: locally, it is a script
 * you run; in CI, a job of its own installs libxml2 and runs it on every push
 * (#76). The unit tests cover the structural rules offline.
 *
 * The XSDs are **not vendored**: they are The Open Group's, and this repo is MIT
 * — the same reason their ArchiSurance model is not in here either. They are
 * fetched once and cached under `node_modules/.cache/`, so only the first run of
 * a fresh checkout needs the network and nobody's bad day takes the check down
 * (#37). Use `--refresh` to re-fetch, or point `ARCHIMATE_XSD` at your own copy
 * of `archimate3_Diagram.xsd` (with `archimate3_View.xsd` and
 * `archimate3_Model.xsd` beside it).
 *
 * Validation is against the Diagram schema, which includes the View and Model
 * schemas: it is the one that knows `<views>` (#76), and the one Archi names.
 * CI runs this script in its own job (`.github/workflows/ci.yml`).
 *
 * Usage: npm run validate:xsd [-- --refresh]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { importArchimate } from '../src/io/archimate-native'
import { exportExchange, importExchangeXml } from '../src/io/exchange-format'
import type { Workspace } from '../src/model'
import { drawnWorkspace } from '../src/test/fixtures'
import { rolloutWorkspace } from '../src/test/rollout-fixture'

const XSD_BASE = 'https://www.opengroup.org/xsd/archimate/3.1/'
/** The Diagram schema includes View, which includes Model; all three sit together. */
const XSD_FILES = ['archimate3_Diagram.xsd', 'archimate3_View.xsd', 'archimate3_Model.xsd']
const CACHE_DIR = join('node_modules', '.cache', 'archipelago')
const CACHE = join(CACHE_DIR, 'archimate3_Diagram.xsd')
const cached = () => XSD_FILES.every((file) => existsSync(join(CACHE_DIR, file)))

const work = mkdtempSync(join(tmpdir(), 'archipelago-xsd-'))

/** The XSD on disk: whichever of the override, the cache or the network answers. */
async function schemaPath(): Promise<string> {
  const override = process.env.ARCHIMATE_XSD
  if (override) {
    if (!existsSync(override)) {
      console.error(`ARCHIMATE_XSD points at ${override}, which does not exist.`)
      process.exit(1)
    }
    console.log(`Using ${override} (ARCHIMATE_XSD)`)
    return override
  }

  const refresh = process.argv.includes('--refresh')
  if (!refresh && cached()) {
    const age = Math.round((Date.now() - statSync(CACHE).mtimeMs) / 86_400_000)
    console.log(
      `Using the cached XSD (${age} day${age === 1 ? '' : 's'} old; --refresh to re-fetch)`,
    )
    return CACHE
  }

  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    for (const file of XSD_FILES) {
      console.log(`Fetching ${XSD_BASE}${file}`)
      const response = await fetch(`${XSD_BASE}${file}`)
      if (!response.ok) throw new Error(`${file}: ${response.status} ${response.statusText}`)
      writeFileSync(join(CACHE_DIR, file), await response.text())
    }
    return CACHE
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    if (cached()) {
      console.warn(`Could not fetch the XSD (${why}); falling back to the cached copy.`)
      return CACHE
    }
    console.error(
      `Could not fetch the XSD (${why}), and there is no cached copy.\n` +
        `The schema is The Open Group's and is not redistributed in this MIT repo. Either\n` +
        `get online for one run, or download ${XSD_FILES.join(', ')} from ${XSD_BASE} into one\n` +
        `folder and set ARCHIMATE_XSD to the Diagram one.`,
    )
    process.exit(1)
  }
}

const xsdPath = await schemaPath()

/**
 * Every file is validated as it is checked in **and** as it comes back out of a
 * round trip, so what gets validated is what the app actually writes. The
 * junction fixture is here because junctions are the one place where our
 * catalogue and the schema disagree on shape: one `Junction` with a kind here,
 * `AndJunction`/`OrJunction` there (#36).
 */
const sources = [
  { label: 'bundled demo', path: 'src/io/demo/archisurance.xml' },
  { label: 'junction fixture', path: 'src/io/fixtures/junction-flow.xml' },
  // Views, nesting, bend-points, styles and folders, as Archi 5.10 exported them (#76).
  { label: 'Archi views and folders', path: 'src/io/fixtures/claims-platform.xml' },
  // The same, labelled in German; the round trip writes the model's language (#111).
  { label: 'Archi views and folders, in German', path: 'src/io/fixtures/claims-platform.de.xml' },
]

/**
 * A fixture that does not import fails the run. Skipping it instead would pass
 * without validating what it exists to check (#90).
 */
function imported(xml: string, label: string): Workspace {
  const { workspace } = importExchangeXml(xml, label)
  if (!workspace) {
    console.error(`✗ ${label} did not import, so nothing it covers was validated.`)
    process.exit(1)
  }
  return workspace
}

const targets: { label: string; path: string }[] = []
for (const source of sources) {
  targets.push(source)
  const { xml, problems } = exportExchange(imported(readFileSync(source.path, 'utf8'), source.path))
  for (const problem of problems) {
    console.log(`  ${problem.severity}: ${problem.message}`)
  }
  const exportedPath = join(work, `${basename(source.path, '.xml')}-round-tripped.xml`)
  writeFileSync(exportedPath, xml)
  targets.push({ label: `${source.label}, round-tripped`, path: exportedPath })
}

// A workspace whose ids are not XML names — legal in canonical JSON, illegal as
// xs:ID. The writer rewrites them; the schema is the judge of whether it did so
// well enough (#36).
{
  const demo = imported(readFileSync(sources[0]!.path, 'utf8'), sources[0]!.path)
  const original = demo.elements[0]!.id
  const rename = (id: string) => (id === original ? '9 odd:id' : id)
  const { xml } = exportExchange({
    ...demo,
    id: '9 workspace',
    elements: demo.elements.map((element) => ({ ...element, id: rename(element.id) })),
    relationships: demo.relationships.map((relationship) => ({
      ...relationship,
      source: rename(relationship.source),
      target: rename(relationship.target),
    })),
  })
  const rewrittenPath = join(work, 'rewritten-ids.xml')
  writeFileSync(rewrittenPath, xml)
  targets.push({ label: 'ids that are not XML names, rewritten on export', path: rewrittenPath })
}

// The declared property types the model now carries (#37, finding 6): the XSD is
// the judge of whether `currency`, `date` and `time` are spellings it accepts on
// a propertyDefinition, and it is the only thing that can say so.
const typed = imported(
  `<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/" identifier="m-typed">
  <name xml:lang="en">Declared types</name>
  <elements>
    <element identifier="e1" xsi:type="ApplicationComponent">
      <name xml:lang="en">Portal</name>
      <properties>
        <property propertyDefinitionRef="p1"><value xml:lang="en">1.50</value></property>
        <property propertyDefinitionRef="p2"><value xml:lang="en">2024-01-01</value></property>
        <property propertyDefinitionRef="p3"><value xml:lang="en">09:30:00</value></property>
        <property propertyDefinitionRef="p4"><value xml:lang="en">0912345678</value></property>
      </properties>
    </element>
  </elements>
  <propertyDefinitions>
    <propertyDefinition identifier="p1" type="currency"><name xml:lang="en">licenceFee</name></propertyDefinition>
    <propertyDefinition identifier="p2" type="date"><name xml:lang="en">validUntil</name></propertyDefinition>
    <propertyDefinition identifier="p3" type="time"><name xml:lang="en">cutOff</name></propertyDefinition>
    <propertyDefinition identifier="p4" type="number"><name xml:lang="en">assetNo</name></propertyDefinition>
  </propertyDefinitions>
</model>`,
  'declared property types',
)
const typedPath = join(work, 'declared-property-types.xml')
writeFileSync(typedPath, exportExchange(typed).xml)
targets.push({ label: 'declared currency/date/time/number types, re-exported', path: typedPath })

// Our own views and folders, written by us (#76): nesting, a note, a group, a
// view reference, bend-points, appearance, and the carried archipelago.style.
{
  const drawnPath = join(work, 'drawn-workspace.xml')
  writeFileSync(drawnPath, exportExchange(drawnWorkspace()).xml)
  targets.push({ label: 'drawn workspace, written by us', path: drawnPath })

  // The awkward cases the writer has to repair: a view above and left of the
  // origin, fractional positions, a shape nested in a note.
  const awkward = drawnWorkspace()
  const landscape = awkward.views.find((view) => view.id === 'view-landscape')
  if (!landscape) {
    console.error('✗ drawnWorkspace() has no view-landscape, so the awkward views were not built.')
    process.exit(1)
  }
  landscape.nodes = landscape.nodes.map((node) =>
    node.id === 'n-k8s'
      ? { ...node, bounds: { x: -40.5, y: -12.25, width: 0, height: 55.5 } }
      : node,
  )
  landscape.nodes.push({
    id: 'n-sticker',
    kind: 'note',
    text: 'nested in a note',
    parent: 'n-note',
    bounds: { x: 5, y: 5, width: 40, height: 20 },
  })
  const awkwardPath = join(work, 'awkward-views.xml')
  writeFileSync(awkwardPath, exportExchange(awkward).xml)
  targets.push({ label: 'views the writer had to shift, round and flatten', path: awkwardPath })
}

// A rollout of 160 sites (#209): the rollout and its waves as Work Packages,
// and a Work Package per site plan, aggregated by its wave and associated with
// its Location, written by us and then as it comes back out of a round trip.
{
  const rolloutPath = join(work, 'rollout.xml')
  const { xml } = exportExchange(rolloutWorkspace(160))
  writeFileSync(rolloutPath, xml)
  targets.push({ label: '160-site rollout, written by us', path: rolloutPath })
  const againPath = join(work, 'rollout-round-tripped.xml')
  writeFileSync(againPath, exportExchange(imported(xml, 'rollout.xml')).xml)
  targets.push({ label: '160-site rollout, round-tripped', path: againPath })
}

// Directed associations and influence modifiers (#84), read from what Archi
// wrote and written back by us.
{
  const archi = readFileSync(join('src', 'io', 'fixtures', 'relationship-attributes.xml'), 'utf8')
  const attributes = imported(archi, 'relationship-attributes.xml')
  const attributesPath = join(work, 'relationship-attributes.xml')
  writeFileSync(attributesPath, exportExchange(attributes).xml)
  targets.push({ label: 'isDirected and modifier, re-exported', path: attributesPath })
}

// Archi's own .archimate files, read natively and written by us (#13). The
// coverage model holds default-sized shapes, which Archi's export writes as
// w="-1" and fails its own XSD on; ours must not. The legacy model is Archi
// 2.0.0's, in the old vocabulary, read as Archi 5.10 reads it (#105). The view
// objects model holds legends, which the writer turns into empty labels (#134).
for (const name of ['claims-platform', 'archi-coverage', 'archi-legacy-open-day', 'view-objects']) {
  const path = join('src', 'io', 'fixtures', `${name}.archimate`)
  const { workspace } = importArchimate(readFileSync(path, 'utf8'), path)
  if (!workspace) {
    console.error(`✗ ${path} did not import, so nothing it covers was validated.`)
    process.exit(1)
  }
  const nativePath = join(work, `${name}-from-archimate.xml`)
  writeFileSync(nativePath, exportExchange(workspace).xml)
  targets.push({ label: `${name}.archimate, read natively and exported`, path: nativePath })
}

let failures = 0
for (const target of targets) {
  try {
    execFileSync('xmllint', ['--noout', '--schema', xsdPath, target.path], { stdio: 'pipe' })
    console.log(`✓ ${target.label} validates against the ArchiMate 3.1 exchange XSD (Diagram)`)
  } catch (error) {
    failures += 1
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : ''
    console.error(`✗ ${target.label} failed validation\n${stderr}`)
  }
}

process.exit(failures === 0 ? 0 : 1)
