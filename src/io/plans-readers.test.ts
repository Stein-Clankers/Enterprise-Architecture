import { describe, expect, it } from 'vitest'
import { rolloutPlanOf, validate, wavePlanOf, type Element, type Workspace } from '@/model'
import { ROLLOUT_ID, rolloutWorkspace, siteId, waveId } from '@/test/rollout-fixture'
import { importArchimate } from './archimate-native'
import { fromCanonicalJson, toCanonicalJson } from './canonical-json'
import { exportExchange, importExchangeXml } from './exchange-format'
import { PLAN_KEYS } from './plan-exchange'

/**
 * What the readers do with a plan they cannot take as it is (#209). Nothing is
 * dropped without a problem saying so: a part that cannot be read is named, a
 * plan key that cannot be read stays an ordinary property, and a site plan's
 * Work Package that cannot be folded stays a Work Package.
 */

const SITE_WP = (n: number) => `${ROLLOUT_ID}.site.${siteId(n)}`

function rolloutOf(workspace: Workspace) {
  return rolloutPlanOf(workspace.elements.find((element) => element.id === ROLLOUT_ID))
}

function element(workspace: Workspace, id: string): Element | undefined {
  return workspace.elements.find((candidate) => candidate.id === id)
}

function codes(problems: readonly { code: string }[]): string[] {
  return problems.map((p) => p.code)
}

// ── Canonical JSON ───────────────────────────────────────────────────────────

/** The fixture as canonical JSON, edited as a parsed object. */
interface RawWorkspace {
  elements: Record<string, unknown>[]
  relationships: Record<string, unknown>[]
}

function json(edit: (raw: RawWorkspace) => void): string {
  const raw = JSON.parse(toCanonicalJson(rolloutWorkspace(12))) as RawWorkspace
  edit(raw)
  return JSON.stringify(raw)
}

function rawPlan(raw: RawWorkspace, id: string) {
  return raw.elements.find((candidate) => candidate.id === id)!.plan as Record<string, unknown> & {
    sites: Record<string, unknown>[]
    milestones: unknown[]
  }
}

describe('reading plans from canonical JSON (#209)', () => {
  it('reports a plan on an element that is not a Work Package, and keeps the element', () => {
    const text = json((raw) => {
      raw.elements.find((candidate) => candidate.id === 'loc-emea')!.plan = rawPlan(raw, ROLLOUT_ID)
    })
    const { workspace, problems } = fromCanonicalJson(text)
    expect(element(workspace!, 'loc-emea')).toBeDefined()
    expect(element(workspace!, 'loc-emea')?.plan).toBeUndefined()
    expect(problems).toEqual([
      expect.objectContaining({ code: 'json.invalid-plan', subject: 'loc-emea' }),
    ])
  })

  it('reports a rollout whose template version cannot be read, and drops only that plan', () => {
    const { workspace, problems } = fromCanonicalJson(
      json((raw) => (rawPlan(raw, ROLLOUT_ID).templateVersion = 'two')),
    )
    expect(element(workspace!, ROLLOUT_ID)?.plan).toBeUndefined()
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'json.invalid-plan',
        subject: ROLLOUT_ID,
        message: expect.stringContaining('templateVersion "two"'),
      }),
    ])
  })

  it('reports a wave without its rollout, and drops that wave’s plan', () => {
    const { workspace, problems } = fromCanonicalJson(
      json((raw) => delete rawPlan(raw, waveId(1)).rollout),
    )
    expect(element(workspace!, waveId(1))?.plan).toBeUndefined()
    expect(wavePlanOf(element(workspace!, waveId(2)))).toBeDefined()
    expect(codes(problems)).toEqual(['json.invalid-plan'])
  })

  it('drops each unreadable part on its own, names it, and keeps the rest of the plan', () => {
    const { workspace, problems } = fromCanonicalJson(
      json((raw) => {
        const plan = rawPlan(raw, ROLLOUT_ID)
        plan.milestones.push({ id: 'goLive', label: 'Go live', startsPhase: 'unplanned' })
        plan.sites.push({ ...plan.sites[0], notes: 'a second plan for site 1' })
        plan.sites[2]!.rag = 'blue'
        plan.sites[3]!.milestones = { freezeStart: { date: '2027-05-11', precision: 'week' } }
        plan.future = true
      }),
    )
    const plan = rolloutOf(workspace!)!
    expect(plan.milestones.map((m) => m.id)).not.toContain('goLive')
    expect(plan.milestones).toHaveLength(5)
    expect(plan.sites).toHaveLength(12)
    expect(plan.sites.find((site) => site.location === siteId(1))?.notes).toBeUndefined()
    expect(plan.sites.find((site) => site.location === siteId(3))?.rag).toBeUndefined()
    expect(plan.sites.find((site) => site.location === siteId(3))?.wave).toBe(waveId(4))
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'json.invalid-plan',
        subject: ROLLOUT_ID,
        message: expect.stringContaining('5 parts'),
      }),
    ])
  })

  it('drops a second plan for a Location whole, and names none of its fields as lost from the first', () => {
    const { workspace, problems } = fromCanonicalJson(
      json((raw) =>
        rawPlan(raw, ROLLOUT_ID).sites.push({ location: siteId(1), rag: 'blue', wave: '' }),
      ),
    )
    const plan = rolloutOf(workspace!)!
    expect(plan.sites).toHaveLength(12)
    expect(plan.sites.find((site) => site.location === siteId(1))?.wave).toBe(waveId(0))
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'json.invalid-plan',
        message: expect.stringContaining(
          `has 1 part that could not be read and was dropped: sites[12], a second plan for "${siteId(1)}"`,
        ),
      }),
    ])
  })

  it('reads empty notes as no notes, which is the same model', () => {
    const text = json((raw) => (rawPlan(raw, ROLLOUT_ID).sites[0]!.notes = ''))
    const { workspace, problems } = fromCanonicalJson(text)
    expect(problems).toEqual([])
    expect(toCanonicalJson(workspace!)).toBe(toCanonicalJson(rolloutWorkspace(12)))
  })

  it('keeps a site plan whose Location is not in the file, for validate() to report', () => {
    const text = json((raw) => {
      raw.elements = raw.elements.filter((candidate) => candidate.id !== siteId(5))
      raw.relationships = raw.relationships.filter((candidate) => candidate.target !== siteId(5))
    })
    const { workspace, problems } = fromCanonicalJson(text)
    expect(problems).toEqual([])
    expect(rolloutOf(workspace!)?.sites.map((site) => site.location)).toContain(siteId(5))
    expect(codes(validate(workspace!).findings)).toContain('plan.site-location-missing')
  })

  it('upgrades a schema-5 file, which holds no plan, without touching it', () => {
    const { workspace, problems } = fromCanonicalJson(
      JSON.stringify({ schemaVersion: 5, id: 'ws', name: 'Old', elements: [], relationships: [] }),
    )
    expect(codes(problems)).toEqual(['json.schema-upgraded'])
    expect(workspace?.schemaVersion).toBe(6)
  })
})

// ── Exchange XML ─────────────────────────────────────────────────────────────

const EXPORTED = exportExchange(rolloutWorkspace(12)).xml

/** The xs:ID of the property definition named `key`. */
function definitionOf(xml: string, key: string): string {
  const match = new RegExp(
    `<propertyDefinition identifier="([^"]+)" type="string">\\s*<name xml:lang="en">${key.replace(/\./g, '\\.')}</name>`,
  ).exec(xml)
  if (!match?.[1]) throw new Error(`no definition for ${key}`)
  return match[1]
}

/** Apply `edit` to the `<element>` block whose identifier is `id`. */
function editElement(xml: string, id: string, edit: (block: string) => string): string {
  const start = xml.indexOf(`<element identifier="${id}"`)
  const end = xml.indexOf('</element>', start) + '</element>'.length
  if (start < 0) throw new Error(`no element ${id}`)
  return xml.slice(0, start) + edit(xml.slice(start, end)) + xml.slice(end)
}

/** A property line, as the writer spells one. */
function property(xml: string, key: string, value: string): string {
  return `<property propertyDefinitionRef="${definitionOf(xml, key)}"><value xml:lang="en">${value}</value></property>`
}

function setProperty(xml: string, id: string, key: string, value: string): string {
  const ref = definitionOf(xml, key)
  return editElement(xml, id, (block) =>
    block.replace(
      new RegExp(`(<property propertyDefinitionRef="${ref}">\\s*<value xml:lang="en">)[^<]*`),
      `$1${value}`,
    ),
  )
}

function read(xml: string) {
  const result = importExchangeXml(xml)
  if (!result.workspace) throw new Error(JSON.stringify(result.problems))
  return { workspace: result.workspace, problems: result.problems }
}

describe('reading plans from exchange XML (#209)', () => {
  it('keeps a plan value it cannot read as an ordinary property, and says so', () => {
    const { workspace, problems } = read(
      setProperty(EXPORTED, waveId(0), PLAN_KEYS.capacity, 'lots'),
    )
    const wave = element(workspace, waveId(0))!
    expect(wavePlanOf(wave)?.capacity).toBeUndefined()
    expect(wavePlanOf(wave)?.label).toBe('Pilot')
    expect(wave.properties).toEqual({ [PLAN_KEYS.capacity]: 'lots' })
    expect(problems).toEqual([
      expect.objectContaining({ code: 'exchange.plan-unreadable', subject: waveId(0) }),
    ])
  })

  it('keeps every plan key of a rollout whose template version cannot be read', () => {
    const { workspace, problems } = read(
      setProperty(EXPORTED, ROLLOUT_ID, PLAN_KEYS.templateVersion, 'two'),
    )
    const rollout = element(workspace, ROLLOUT_ID)!
    expect(rollout.plan).toBeUndefined()
    expect(rollout.properties[PLAN_KEYS.templateVersion]).toBe('two')
    expect(rollout.properties[PLAN_KEYS.milestones]).toBeDefined()
    // Its site plans have no rollout to fold into, so each stays a Work Package.
    expect(element(workspace, SITE_WP(1))?.type).toBe('WorkPackage')
    expect(codes(problems)).toContain('exchange.plan-unreadable')
    expect(codes(problems).filter((code) => code === 'exchange.plan-site-unfolded')).toHaveLength(
      12,
    )
  })

  it('keeps plan properties on an element that is not a Work Package', () => {
    const xml = EXPORTED.replace(
      `<element identifier="${waveId(3)}" xsi:type="WorkPackage">`,
      `<element identifier="${waveId(3)}" xsi:type="Deliverable">`,
    )
    const { workspace, problems } = read(xml)
    const deliverable = element(workspace, waveId(3))!
    expect(deliverable.plan).toBeUndefined()
    expect(deliverable.properties[PLAN_KEYS.label]).toBe('W3')
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'exchange.plan-unreadable', subject: waveId(3) }),
    )
  })

  it('keeps a site plan’s Work Package whose rollout is not in the file', () => {
    const { workspace, problems } = read(
      setProperty(EXPORTED, SITE_WP(3), PLAN_KEYS.rollout, 'wp-nope'),
    )
    expect(element(workspace, SITE_WP(3))?.properties[PLAN_KEYS.location]).toBe(siteId(3))
    expect(rolloutOf(workspace)?.sites.map((site) => site.location)).not.toContain(siteId(3))
    expect(problems).toEqual([
      expect.objectContaining({ code: 'exchange.plan-site-unfolded', subject: SITE_WP(3) }),
    ])
  })

  it('keeps a second Work Package for a Location the rollout already has a plan for', () => {
    const copy = EXPORTED.slice(
      EXPORTED.indexOf(`<element identifier="${SITE_WP(3)}"`),
      EXPORTED.indexOf('</element>', EXPORTED.indexOf(`<element identifier="${SITE_WP(3)}"`)) +
        '</element>'.length,
    ).replace(SITE_WP(3), 'wp-copy')
    const xml = EXPORTED.replace('  </elements>', `    ${copy}\n  </elements>`)
    const { workspace, problems } = read(xml)
    expect(element(workspace, 'wp-copy')?.type).toBe('WorkPackage')
    expect(rolloutOf(workspace)?.sites).toHaveLength(12)
    expect(problems).toEqual([
      expect.objectContaining({ code: 'exchange.plan-site-unfolded', subject: 'wp-copy' }),
    ])
  })

  it('folds a site plan back, and reports what was added to its Work Package in another tool', () => {
    let xml = editElement(EXPORTED, SITE_WP(4), (block) =>
      block
        .replace(/<name xml:lang="en">[^<]*<\/name>/, '<name xml:lang="en">Renamed in Archi</name>')
        .replace('<properties>', `<properties>${property(EXPORTED, 'owner', 'PMO')}`),
    )
    xml = setProperty(xml, SITE_WP(4), `${'archipelago.plan.milestone.'}freezeStart`, '2027-W99')
    const { workspace, problems } = read(xml)
    const site = rolloutOf(workspace)!.sites.find((candidate) => candidate.location === siteId(4))!
    expect(site.wave).toBeDefined()
    expect(site.milestones).toBeUndefined()
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'exchange.plan-site-content-dropped',
        subject: ROLLOUT_ID,
        message: expect.stringMatching(
          /owner = "PMO".*freezeStart = "2027-W99".*Renamed in Archi/s,
        ),
      }),
    ])
  })

  it('drops, and reports, a relationship someone drew to a site plan’s Work Package', () => {
    const xml = EXPORTED.replace(
      '  </relationships>',
      `    <relationship identifier="r-drawn" source="app-claims" target="${SITE_WP(3)}" xsi:type="Association"></relationship>\n  </relationships>`,
    )
    const { workspace, problems } = read(xml)
    expect(workspace.relationships.find((r) => r.id === 'r-drawn')).toBeUndefined()
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'exchange.plan-relationship-dropped',
        message: expect.stringContaining('r-drawn'),
      }),
    ])
  })

  it.each([
    ['a name', '<name xml:lang="en">contains</name>'],
    ['documentation', '<documentation xml:lang="en">Added in Archi.</documentation>'],
    ['a property', `<properties>${property(EXPORTED, 'owner', 'PMO')}</properties>`],
  ])('drops, and reports, the writer’s own Aggregation once someone gave it %s', (_, added) => {
    const own = `${SITE_WP(3)}.in`
    const start = EXPORTED.indexOf(`<relationship identifier="${own}"`)
    expect(start).toBeGreaterThan(-1)
    const open = EXPORTED.indexOf('>', start) + 1
    // It is the Aggregation from the site's own wave, which the fold would take as its own.
    expect(EXPORTED.slice(start, open)).toContain(
      `source="${waveId(4)}" target="${SITE_WP(3)}" xsi:type="Aggregation"`,
    )
    const { workspace, problems } = read(EXPORTED.slice(0, open) + added + EXPORTED.slice(open))
    const site = rolloutOf(workspace)!.sites.find((candidate) => candidate.location === siteId(3))
    expect(site?.wave).toBe(waveId(4))
    expect(workspace.relationships.find((r) => r.id === own)).toBeUndefined()
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'exchange.plan-relationship-dropped',
        message: expect.stringContaining(own),
      }),
    ])
  })

  it('reports a site plan filed in a folder, and nothing for one filed in its group', () => {
    const xml = EXPORTED.replace(
      '  <propertyDefinitions>',
      `  <organizations>
    <item>
      <label xml:lang="en">Implementation &amp; Migration</label>
      <item identifier="f-plans">
        <label xml:lang="en">Plans</label>
        <item identifierRef="${SITE_WP(3)}"/>
      </item>
      <item identifierRef="${SITE_WP(4)}"/>
    </item>
  </organizations>
  <propertyDefinitions>`,
    )
    const { workspace, problems } = read(xml)
    expect(rolloutOf(workspace)?.sites).toHaveLength(12)
    // One loss, one code and one severity, from both readers (the Archi model's test below).
    expect(problems).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'exchange.plan-folder-ignored',
        message: expect.stringContaining(SITE_WP(3)),
      }),
    ])
  })

  it('reports a drawing of a site plan’s Work Package, which has nothing left to draw', () => {
    const xml = EXPORTED.replace(
      '</model>',
      `  <views>
    <diagrams>
      <view identifier="v-1" xsi:type="Diagram">
        <name xml:lang="en">Plan</name>
        <node identifier="n-1" elementRef="${SITE_WP(3)}" xsi:type="Element" x="0" y="0" w="120" h="55"/>
      </view>
    </diagrams>
  </views>
</model>`,
    )
    const { workspace, problems } = read(xml)
    expect(workspace.views[0]?.nodes).toEqual([])
    expect(codes(problems)).toEqual(['exchange.dangling-view-node'])
  })
})

describe('writing plans to exchange XML (#209)', () => {
  it('reports a site plan whose Location is gone, writes it unassociated, and reads it back', () => {
    const workspace = rolloutWorkspace(12)
    workspace.elements = workspace.elements.filter((candidate) => candidate.id !== siteId(5))
    workspace.relationships = workspace.relationships.filter((r) => r.target !== siteId(5))
    const { xml, problems } = exportExchange(workspace)
    expect(problems).toEqual([
      expect.objectContaining({ code: 'exchange.plan-location-missing', subject: ROLLOUT_ID }),
    ])
    expect(xml).not.toContain(`target="${siteId(5)}"`)
    const back = read(xml)
    expect(back.problems).toEqual([])
    expect(toCanonicalJson(back.workspace)).toBe(toCanonicalJson(workspace))
  })

  it('reports a site in a wave that is not the rollout’s, aggregates it by the rollout, and keeps the id', () => {
    const workspace = rolloutWorkspace(12)
    rolloutOf(workspace)!.sites.find((site) => site.location === siteId(3))!.wave = 'wp-gone'
    const { xml, problems } = exportExchange(workspace)
    expect(problems).toEqual([
      expect.objectContaining({ code: 'exchange.plan-wave-missing', subject: ROLLOUT_ID }),
    ])
    expect(xml).toContain(`source="${ROLLOUT_ID}" target="${SITE_WP(3)}" xsi:type="Aggregation"`)
    const back = read(xml)
    expect(back.problems).toEqual([])
    expect(toCanonicalJson(back.workspace)).toBe(toCanonicalJson(workspace))
  })

  it('writes the file’s ids into the plan when an element’s id had to be rewritten', () => {
    const workspace = rolloutWorkspace(4)
    const rename = (id: string) => (id === 'sys-local-store' ? '9 local store' : id)
    workspace.elements = workspace.elements.map((candidate) => ({
      ...candidate,
      id: rename(candidate.id),
    }))
    const plan = rolloutOf(workspace)!
    plan.template = plan.template.map((change) => ({ ...change, subject: rename(change.subject) }))
    const { xml } = exportExchange(workspace)
    const back = read(xml).workspace
    const local = back.elements.find((candidate) => candidate.name === 'Local file store')!
    expect(local.id).not.toBe('9 local store')
    expect(
      rolloutOf(back)!.template.find((change) => change.id === 'tc-retire-store')?.subject,
    ).toBe(local.id)
  })
})

// ── Archi's own file ─────────────────────────────────────────────────────────

describe('reading plans from an Archi model (#209)', () => {
  /** What Archi saves for the exchange file's plan elements, as `<property>` children. */
  const archimate = (sites: string) => `<?xml version="1.0" encoding="UTF-8"?>
<archimate:model xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:archimate="http://www.archimatetool.com/archimate" name="M" id="m" version="5.0.0">
  <folder name="Implementation &amp; Migration" id="fi" type="implementation_migration">
    <element xsi:type="archimate:WorkPackage" name="Rollout" id="r">
      <property key="${PLAN_KEYS.kind}" value="rollout"/>
      <property key="${PLAN_KEYS.templateVersion}" value="1"/>
    </element>
    <element xsi:type="archimate:WorkPackage" name="W1" id="w">
      <property key="${PLAN_KEYS.kind}" value="wave"/>
      <property key="${PLAN_KEYS.rollout}" value="r"/>
      <property key="${PLAN_KEYS.label}" value="W1"/>
      <property key="${PLAN_KEYS.order}" value="1"/>
      <property key="${PLAN_KEYS.templateVersion}" value="1"/>
    </element>
    ${sites}
  </folder>
  <folder name="Other" id="fo" type="other">
    <element xsi:type="archimate:Location" name="Hamburg" id="loc"/>
  </folder>
  <folder name="Relations" id="fr" type="relations">
    <element xsi:type="archimate:AggregationRelationship" id="r-in" source="w" target="sp"/>
    <element xsi:type="archimate:AssociationRelationship" id="r-at" source="sp" target="loc"/>
  </folder>
</archimate:model>`

  it('folds a site plan’s Work Package back into its rollout', () => {
    const result = importArchimate(
      archimate(`<element xsi:type="archimate:WorkPackage" name="Rollout: Hamburg" id="sp">
      <documentation>Works council first.</documentation>
      <property key="${PLAN_KEYS.kind}" value="site"/>
      <property key="${PLAN_KEYS.rollout}" value="r"/>
      <property key="${PLAN_KEYS.location}" value="loc"/>
      <property key="${PLAN_KEYS.wave}" value="w"/>
      <property key="${PLAN_KEYS.rag}" value="amber"/>
    </element>`),
    )
    expect(result.problems).toEqual([])
    const workspace = result.workspace!
    expect(workspace.elements.map((candidate) => candidate.id).sort()).toEqual(['loc', 'r', 'w'])
    expect(workspace.relationships).toEqual([])
    expect(rolloutPlanOf(element(workspace, 'r'))?.sites).toEqual([
      { location: 'loc', wave: 'w', rag: 'amber', notes: 'Works council first.' },
    ])
    expect(wavePlanOf(element(workspace, 'w'))).toEqual({
      kind: 'wave',
      rollout: 'r',
      label: 'W1',
      order: 1,
      templateVersion: 1,
    })
  })

  it('reports the folder a site plan’s Work Package was filed in, which a record cannot keep', () => {
    const xml = archimate(`<folder name="Plans" id="f-plans">
      <element xsi:type="archimate:WorkPackage" name="Rollout: Hamburg" id="sp">
        <property key="${PLAN_KEYS.kind}" value="site"/>
        <property key="${PLAN_KEYS.rollout}" value="r"/>
        <property key="${PLAN_KEYS.location}" value="loc"/>
        <property key="${PLAN_KEYS.wave}" value="w"/>
      </element>
    </folder>`)
    const result = importArchimate(xml)
    expect(rolloutPlanOf(element(result.workspace!, 'r'))?.sites).toEqual([
      { location: 'loc', wave: 'w' },
    ])
    // The same code and severity as the exchange reader's.
    expect(result.problems).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'exchange.plan-folder-ignored',
        message: expect.stringContaining('(sp)'),
      }),
    ])
  })

  it('folds the writer’s own relationship filed in a folder, and reports only the filing', () => {
    const own =
      '<element xsi:type="archimate:AggregationRelationship" id="r-in" source="w" target="sp"/>'
    const xml =
      archimate(`<element xsi:type="archimate:WorkPackage" name="Rollout: Hamburg" id="sp">
      <property key="${PLAN_KEYS.kind}" value="site"/>
      <property key="${PLAN_KEYS.rollout}" value="r"/>
      <property key="${PLAN_KEYS.location}" value="loc"/>
      <property key="${PLAN_KEYS.wave}" value="w"/>
    </element>`)
    expect(xml).toContain(own)
    const result = importArchimate(
      xml.replace(own, `<folder name="Plan links" id="f-links">${own}</folder>`),
    )
    expect(rolloutPlanOf(element(result.workspace!, 'r'))?.sites).toEqual([
      { location: 'loc', wave: 'w' },
    ])
    expect(result.workspace!.relationships).toEqual([])
    expect(result.problems).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'exchange.plan-folder-ignored',
        message: expect.stringContaining('(r-in)'),
      }),
    ])
  })
})

// ── Every branch of the readers that leaves something out ────────────────────

describe('each unreadable part of a canonical plan is named (#209)', () => {
  type Raw = Record<string, unknown> & { sites: Record<string, unknown>[] }
  const rollout: [string, (plan: Raw) => void, string][] = [
    ['milestones not a list', (plan) => (plan.milestones = {}), 'milestones'],
    [
      'a second milestone of one id',
      (plan) => (plan.milestones = [m(), m()]),
      'milestones[1], a second "a"',
    ],
    ['sites not a list', (plan) => (plan.sites = {} as never), 'sites'],
    ['a site that is not an object', (plan) => plan.sites.push('loc' as never), 'sites[12]'],
    ['a site with no location', (plan) => plan.sites.push({ wave: 'w' }), 'sites[12]'],
    ['an empty wave', (plan) => (plan.sites[0]!.wave = ''), `site "${siteId(1)}".wave`],
    [
      'milestones not a record',
      (plan) => (plan.sites[0]!.milestones = []),
      `site "${siteId(1)}".milestones`,
    ],
    [
      'an actual that is no day',
      (plan) => (plan.sites[0]!.actuals = { cutover: 'soon' }),
      `site "${siteId(1)}".actuals.cutover`,
    ],
    ['notes that are not text', (plan) => (plan.sites[0]!.notes = 3), `site "${siteId(1)}".notes`],
    [
      'an unknown site key',
      (plan) => (plan.sites[0]!.exceptions = []),
      `site "${siteId(1)}".exceptions`,
    ],
    ['constraints not an object', (plan) => (plan.constraints = []), 'constraints'],
    [
      'a blackout that ends first',
      (plan) =>
        (plan.constraints = { blackouts: [{ id: 'b', start: '2027-02-01', end: '2027-01-01' }] }),
      'constraints.blackouts[0]',
    ],
    [
      'a capacity of nought',
      (plan) => (plan.constraints = { defaultCapacity: 0 }),
      'constraints.defaultCapacity',
    ],
    [
      'an unknown constraint',
      (plan) => (plan.constraints = { freeze: true }),
      'constraints.freeze',
    ],
    [
      'a milestone whose rollout date is no plan date (#213)',
      (plan) => (plan.milestones = [{ ...m(), date: { date: '2027-05-12', precision: 'month' } }]),
      'milestones[0]',
    ],
  ]

  function m() {
    return { id: 'a', label: 'A', startsPhase: 'cutover' }
  }

  it.each(rollout)('a rollout with %s', (_, edit, part) => {
    const text = json((raw) => edit(rawPlan(raw, ROLLOUT_ID) as Raw))
    const { workspace, problems } = fromCanonicalJson(text)
    expect(rolloutOf(workspace!)).toBeDefined()
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'json.invalid-plan',
        message: expect.stringContaining(`dropped: ${part}`),
      }),
    ])
  })

  const wave: [string, (plan: Record<string, unknown>) => void, string][] = [
    ['a window that is not an object', (plan) => (plan.window = 'Q2'), 'window'],
    [
      'a window start that is not a plan date',
      (plan) => (plan.window = { start: '2027-Q2' }),
      'window.start',
    ],
    ['an unknown window key', (plan) => (plan.window = { middle: 1 }), 'window.middle'],
    ['a capacity of nought', (plan) => (plan.capacity = 0), 'capacity 0'],
    ['an unknown key', (plan) => (plan.owner = 'PMO'), 'owner'],
    [
      'milestone dates that are not a record (#213)',
      (plan) => (plan.milestones = []),
      'milestones',
    ],
    [
      'a milestone date that is not a plan date (#213)',
      (plan) => (plan.milestones = { freezeStart: '2027-Q3' }),
      'milestones.freezeStart',
    ],
  ]

  it.each(wave)('a wave with %s', (_, edit, part) => {
    const { workspace, problems } = fromCanonicalJson(json((raw) => edit(rawPlan(raw, waveId(1)))))
    expect(wavePlanOf(element(workspace!, waveId(1)))).toBeDefined()
    expect(problems).toEqual([
      expect.objectContaining({ message: expect.stringContaining(`dropped: ${part}`) }),
    ])
  })

  const fatal: [string, string, (plan: Record<string, unknown>) => void, string][] = [
    ['a wave with no label', waveId(1), (plan) => delete plan.label, 'label undefined'],
    ['a wave with a fractional order', waveId(1), (plan) => (plan.order = 1.5), 'order 1.5'],
    [
      'a wave with template version 0',
      waveId(1),
      (plan) => (plan.templateVersion = 0),
      'templateVersion 0',
    ],
    [
      'a plan of an unknown kind',
      waveId(1),
      (plan) => (plan.kind = 'initiative'),
      'kind "initiative"',
    ],
  ]

  it.each(fatal)('%s is dropped whole, and said', (_, id, edit, part) => {
    const { workspace, problems } = fromCanonicalJson(json((raw) => edit(rawPlan(raw, id))))
    expect(element(workspace!, id)?.plan).toBeUndefined()
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'json.invalid-plan',
        message: expect.stringContaining(part),
      }),
    ])
  })

  it('a plan that is not an object is dropped, and said', () => {
    const { workspace, problems } = fromCanonicalJson(
      json((raw) => (raw.elements.find((e) => e.id === waveId(1))!.plan = 'W1')),
    )
    expect(element(workspace!, waveId(1))?.plan).toBeUndefined()
    expect(codes(problems)).toEqual(['json.invalid-plan'])
  })
})

describe('each exchange plan value that cannot be read is said (#209)', () => {
  it('keeps a rollout’s milestone set that is not JSON as a property, and reads the rest', () => {
    const { workspace, problems } = read(
      setProperty(EXPORTED, ROLLOUT_ID, PLAN_KEYS.milestones, 'cutover, hypercare'),
    )
    const rollout = element(workspace, ROLLOUT_ID)!
    expect(rolloutPlanOf(rollout)?.milestones).toEqual([])
    expect(rolloutPlanOf(rollout)?.sites).toHaveLength(12)
    expect(rollout.properties[PLAN_KEYS.milestones]).toBe('cutover, hypercare')
    expect(problems).toContainEqual(
      expect.objectContaining({ code: 'exchange.plan-unreadable', subject: ROLLOUT_ID }),
    )
  })

  it('names a malformed entry of a carried list it drops', () => {
    const { problems } = read(
      setProperty(
        EXPORTED,
        ROLLOUT_ID,
        PLAN_KEYS.archetypes,
        '[{"id":"office","label":"Office"},{"id":"plant"}]'.replace(/"/g, '&quot;'),
      ),
    )
    expect(problems).toContainEqual(
      expect.objectContaining({
        code: 'exchange.plan-unreadable',
        message: expect.stringContaining('dropped: archetypes[1]'),
      }),
    )
  })

  it('keeps a wave window it cannot read as a property', () => {
    const { workspace, problems } = read(
      setProperty(EXPORTED, waveId(1), PLAN_KEYS.windowStart, 'soon'),
    )
    const wave = element(workspace, waveId(1))!
    expect(wavePlanOf(wave)?.window).toEqual({ end: { date: '2027-06-01', precision: 'month' } })
    expect(wave.properties).toEqual({ [PLAN_KEYS.windowStart]: 'soon' })
    expect(codes(problems)).toEqual(['exchange.plan-unreadable'])
  })

  it('reads a wave’s milestone dates, and keeps one it cannot read as a property (#213)', () => {
    const key = 'archipelago.plan.milestone.freezeStart'
    expect(definitionOf(EXPORTED, key)).toBeDefined()
    const clean = element(read(EXPORTED).workspace, waveId(2))!
    expect(wavePlanOf(clean)?.milestones).toEqual({
      freezeStart: { date: '2027-07-01', precision: 'quarter' },
    })
    expect(clean.properties).toEqual({})

    const { workspace, problems } = read(setProperty(EXPORTED, waveId(2), key, 'soon'))
    const wave = element(workspace, waveId(2))!
    expect(wavePlanOf(wave)?.milestones).toBeUndefined()
    expect(wave.properties).toEqual({ [key]: 'soon' })
    expect(codes(problems)).toEqual(['exchange.plan-unreadable'])
  })

  it('keeps plan properties on a Work Package with no kind as ordinary properties', () => {
    const kind = definitionOf(EXPORTED, PLAN_KEYS.kind)
    const xml = editElement(EXPORTED, waveId(2), (block) =>
      block.replace(
        new RegExp(
          `<property propertyDefinitionRef="${kind}">\\s*<value xml:lang="en">wave</value>\\s*</property>`,
        ),
        '',
      ),
    )
    const { workspace, problems } = read(xml)
    expect(element(workspace, waveId(2))?.plan).toBeUndefined()
    expect(element(workspace, waveId(2))?.properties[PLAN_KEYS.label]).toBe('W2')
    expect(problems).toContainEqual(
      expect.objectContaining({
        code: 'exchange.plan-unreadable',
        subject: waveId(2),
        message: expect.stringContaining(`its ${PLAN_KEYS.kind} is missing`),
      }),
    )
  })

  it('keeps plan properties on an element of another type as ordinary properties', () => {
    const xml = editElement(EXPORTED, 'app-claims', (block) =>
      block.replace('<properties>', `<properties>${property(EXPORTED, PLAN_KEYS.label, 'W9')}`),
    )
    const { workspace, problems } = read(xml)
    expect(element(workspace, 'app-claims')?.properties[PLAN_KEYS.label]).toBe('W9')
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'exchange.plan-unreadable',
        message: expect.stringContaining('only a Work Package carries a plan'),
      }),
    ])
  })

  it('keeps a site plan’s Work Package that names no rollout, or no Location', () => {
    const noRollout = editElement(EXPORTED, SITE_WP(3), (block) =>
      block.replace(
        new RegExp(
          `<property propertyDefinitionRef="${definitionOf(EXPORTED, PLAN_KEYS.rollout)}">\\s*<value xml:lang="en">[^<]*</value>\\s*</property>`,
        ),
        '',
      ),
    )
    expect(read(noRollout).problems).toEqual([
      expect.objectContaining({
        code: 'exchange.plan-site-unfolded',
        message: expect.stringContaining('is not named'),
      }),
    ])
    const noLocation = setProperty(EXPORTED, SITE_WP(3), PLAN_KEYS.location, '')
    expect(read(noLocation).problems).toEqual([
      expect.objectContaining({
        code: 'exchange.plan-site-unfolded',
        message: expect.stringContaining('names no Location'),
      }),
    ])
  })

  it('reports an assessment someone gave a site plan’s Work Package', () => {
    const xml = editElement(
      EXPORTED.replace(
        '  </propertyDefinitions>',
        `    <propertyDefinition identifier="p-time" type="string"><name xml:lang="en">archipelago.timeClassification</name></propertyDefinition>\n  </propertyDefinitions>`,
      ),
      SITE_WP(3),
      (block) =>
        block.replace(
          '<properties>',
          '<properties><property propertyDefinitionRef="p-time"><value xml:lang="en">Invest</value></property>',
        ),
    )
    expect(read(xml).problems).toEqual([
      expect.objectContaining({
        code: 'exchange.plan-site-content-dropped',
        message: expect.stringContaining('its assessment (timeClassification)'),
      }),
    ])
  })

  /**
   * A carried `propertyTypes` entry makes the writer declare a plan key
   * `number` or `boolean`, and the exchange reader then reads the value as
   * one. The plan reader reads its text, which is what was written, so the
   * plan comes back, and keeps coming back, whole.
   */
  const typed: [string, string, 'number' | 'boolean', (workspace: Workspace) => void][] = [
    ['a wave’s order', PLAN_KEYS.order, 'number', () => {}],
    ['the template version', PLAN_KEYS.templateVersion, 'number', () => {}],
    [
      'a wave’s label',
      PLAN_KEYS.label,
      'boolean',
      (workspace) => {
        const wave = workspace.elements.find((candidate) => candidate.id === waveId(1))!
        wave.plan = { ...wavePlanOf(wave)!, label: 'true' }
      },
    ],
    [
      'a site’s archetype',
      PLAN_KEYS.archetype,
      'number',
      (workspace) => {
        rolloutOf(workspace)!.sites.find((site) => site.location === siteId(1))!.archetype = '7'
      },
    ],
    [
      'the Location of a site whose Location is gone',
      PLAN_KEYS.location,
      'number',
      (workspace) => {
        rolloutOf(workspace)!.sites.find((site) => site.location === siteId(5))!.location = '42'
      },
    ],
  ]

  it.each(typed)(
    'reads %s (%s) by its text when the file declares it %s',
    (_, key, type, prepare) => {
      const workspace = rolloutWorkspace(12)
      prepare(workspace)
      workspace.propertyTypes = { [key]: type }
      const { xml } = exportExchange(workspace)
      expect(xml).toMatch(
        new RegExp(
          `<propertyDefinition identifier="[^"]+" type="${type}">\\s*<name xml:lang="en">${key.replace(/\./g, '\\.')}</name>`,
        ),
      )
      const back = read(xml)
      expect(back.problems).toEqual([])
      expect(toCanonicalJson(back.workspace)).toBe(toCanonicalJson(workspace))
    },
  )

  it('drops, and reports, a relationship between two site plans’ Work Packages', () => {
    const xml = EXPORTED.replace(
      '  </relationships>',
      `    <relationship identifier="r-hub" source="${SITE_WP(3)}" target="${SITE_WP(4)}" xsi:type="Aggregation"></relationship>\n  </relationships>`,
    )
    expect(read(xml).problems).toEqual([
      expect.objectContaining({
        code: 'exchange.plan-relationship-dropped',
        message: expect.stringContaining('r-hub'),
      }),
    ])
  })
})
