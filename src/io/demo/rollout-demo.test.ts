import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  rolloutPlanOf,
  validate,
  wavePlanOf,
  wavesOf,
  type Element,
  type RolloutPlan,
  type Workspace,
} from '@/model'
import { ModelStore } from '@/store'
import { rolloutData } from '@/ui/rollout/rollout-data'
import { fromCanonicalJson, toCanonicalJson } from '../canonical-json'
import {
  ROLLOUT_DEMO_JSON,
  ROLLOUT_DEMO_ROLLOUT_ID,
  loadBundledDemo,
  loadRolloutDemoWorkspace,
} from '../demo'
import { exportExchange, importExchangeXml } from '../exchange-format'
import {
  ROLLOUT_DEMO_ID,
  ROLLOUT_DEMO_SEED,
  ROLLOUT_DEMO_SITES,
  SEEDED,
  SITE_FIELDS,
  rolloutDemoWorkspace,
} from './rollout-demo'

/**
 * The generated rollout demo (#212). `rollout-demo.json` says it is
 * `rolloutDemoWorkspace(ROLLOUT_DEMO_SEED)` written by `toCanonicalJson`, so
 * it must be exactly that (CLAUDE.md, a fixture said to be a tool's output):
 * regenerate it with `npm run demo:generate`, never edit it by hand.
 */
const FILE = join(import.meta.dirname, 'rollout-demo.json')
const SCHEMA = join(process.cwd(), 'design', 'archipelago-workspace.schema.json')

/**
 * Seeds besides the checked-in one: the seeded problems are placed by rule,
 * not by luck. Two are here for a guard each, found by removing it and
 * scanning: without it, seed 38 would leave the Swiss residency site in no
 * wave, which hides its violation, and seed 67 would make it the blackout site
 * too, two problems on one site.
 */
const SEEDS = [ROLLOUT_DEMO_SEED, 1, 7, 38, 67, 2026, 31_337]

const demo = rolloutDemoWorkspace()
const elements = new Map(demo.elements.map((element) => [element.id, element]))

function planOf(workspace: Workspace): RolloutPlan {
  return rolloutPlanOf(workspace.elements.find((element) => element.id === ROLLOUT_DEMO_ID))!
}

/** The Locations aggregating `id`. */
function parentsOf(workspace: Workspace, id: string): Element[] {
  return workspace.relationships
    .filter((r) => r.type === 'Aggregation' && r.target === id)
    .map((r) => workspace.elements.find((element) => element.id === r.source)!)
    .filter((element) => element.type === 'Location')
}

function isIn(day: string, blackout: { start: string; end: string }): boolean {
  return blackout.start <= day && day <= blackout.end
}

/**
 * The sites whose data may not leave their country but whose migration
 * target, the successor of a `replace` that applies to them, is located in
 * another country. Worked out from the model, as #214's check will be.
 */
function residencyViolations(workspace: Workspace): string[] {
  const plan = planOf(workspace)
  const aggregates = (location: string, element: string) =>
    workspace.relationships.some(
      (r) => r.type === 'Aggregation' && r.source === location && r.target === element,
    )
  const countryOf = (location: string): string | undefined => parentsOf(workspace, location)[0]?.id
  const violations: string[] = []
  for (const site of plan.sites) {
    if (site.wave === undefined) continue
    const location = workspace.elements.find((element) => element.id === site.location)!
    if (location.properties[SITE_FIELDS.residency] !== 'country') continue
    for (const change of plan.template) {
      if (change.kind !== 'replace' || change.applicability.kind !== 'aggregating') continue
      if (!aggregates(site.location, change.applicability.element)) continue
      const hub = parentsOf(workspace, change.successor)[0]!
      if (countryOf(hub.id) !== countryOf(site.location)) violations.push(site.location)
    }
  }
  return [...new Set(violations)]
}

describe('the generated rollout demo is byte-stable (#212)', () => {
  it('writes the same bytes for the same seed', () => {
    expect(toCanonicalJson(rolloutDemoWorkspace(ROLLOUT_DEMO_SEED))).toBe(toCanonicalJson(demo))
  })

  it('writes different bytes for a different seed, so the seed is what decides', () => {
    expect(toCanonicalJson(rolloutDemoWorkspace(1))).not.toBe(toCanonicalJson(demo))
  })

  it('is checked in byte for byte as the generator writes it', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(toCanonicalJson(demo))
  })
})

describe('the checked-in rollout demo file (#212)', () => {
  const text = readFileSync(FILE, 'utf8')

  it('validates against the published schema', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true })
    addFormats(ajv)
    const check = ajv.compile(JSON.parse(readFileSync(SCHEMA, 'utf8')) as object)
    expect(check(JSON.parse(text)), JSON.stringify(check.errors)).toBe(true)
  })

  it('reads back with nothing to report and writes back byte for byte (ADR 0004)', () => {
    const result = fromCanonicalJson(text, 'rollout-demo.json')
    expect(result.problems).toEqual([])
    expect(toCanonicalJson(result.workspace!)).toBe(text)
  })

  it('is a valid model: every relationship allowed, every plan reference resolved', () => {
    expect(validate(demo).findings).toEqual([])
  })

  it('exports to the exchange format with nothing to report, and reads back to the same model', () => {
    const { xml, problems } = exportExchange(demo)
    expect(problems).toEqual([])
    const back = importExchangeXml(xml, 'rollout-demo.xml')
    expect(back.problems).toEqual([])
    // The writer declares the numeric site fields `number`, and the reader
    // keeps the declaration: the one thing the model gains on the way.
    const { propertyTypes, ...rest } = back.workspace!
    expect(propertyTypes).toEqual({
      [SITE_FIELDS.dataQuality]: 'number',
      [SITE_FIELDS.headcount]: 'number',
      [SITE_FIELDS.sourceSystems]: 'number',
      [SITE_FIELDS.volumeGb]: 'number',
    })
    expect(toCanonicalJson(rest)).toBe(toCanonicalJson(demo))
  })
})

describe('the bundled rollout demo, as "Explore the demo" loads it (#212)', () => {
  it('bundles the checked-in file', () => {
    expect(ROLLOUT_DEMO_JSON).toBe(readFileSync(FILE, 'utf8'))
  })

  it('opens on the generator’s rollout', () => {
    expect(ROLLOUT_DEMO_ROLLOUT_ID).toBe(ROLLOUT_DEMO_ID)
    expect(planOf(loadRolloutDemoWorkspace()).sites).toHaveLength(ROLLOUT_DEMO_SITES)
  })

  it('mints a fresh workspace id per load, and is otherwise the file', () => {
    const first = loadRolloutDemoWorkspace()
    const second = loadBundledDemo('rollout')
    expect(first.id).not.toBe(second.id)
    expect(first.id).not.toBe(demo.id)
    expect(toCanonicalJson({ ...first, id: demo.id })).toBe(toCanonicalJson(demo))
  })

  it('still loads the insurance landscape when asked for it', () => {
    expect(loadBundledDemo('archisurance').name).toBe('ArchiSurance')
  })
})

describe('what the rollout demo holds (#212)', () => {
  const plan = planOf(demo)
  const locations = demo.elements.filter((element) => element.type === 'Location')
  const sites = plan.sites.map((site) => elements.get(site.location)!)

  it('has 160 sites in 20 countries in 5 regions, aggregated region ◇— country ◇— site', () => {
    expect(plan.sites).toHaveLength(ROLLOUT_DEMO_SITES)
    const countries = new Set(sites.map((site) => parentsOf(demo, site.id)[0]!.id))
    expect(countries.size).toBe(20)
    const regions = new Set([...countries].map((country) => parentsOf(demo, country)[0]!.id))
    expect(regions.size).toBe(5)
    for (const region of regions) expect(parentsOf(demo, region)).toEqual([])
    // Five hubs beside them, which are no site of the rollout.
    expect(locations).toHaveLength(160 + 20 + 5 + 5)
  })

  it('gives every site its code and data-migration fields', () => {
    for (const site of sites) {
      expect(Object.keys(site.properties).sort()).toEqual(Object.values(SITE_FIELDS).sort())
    }
    expect(new Set(sites.map((site) => site.properties[SITE_FIELDS.code])).size).toBe(160)
  })

  it('aggregates local stores at every site, each realizing the Data Objects it holds', () => {
    for (const site of sites) {
      const stores = demo.relationships
        .filter((r) => r.type === 'Aggregation' && r.source === site.id)
        .map((r) => elements.get(r.target)!)
      expect(stores.length).toBeGreaterThan(0)
      for (const store of stores) {
        expect(store.type).toBe('Artifact')
        expect(
          demo.relationships.some(
            (r) =>
              r.type === 'Realization' &&
              r.source === store.id &&
              elements.get(r.target)?.type === 'DataObject',
          ),
        ).toBe(true)
      }
    }
  })

  it('has one central target store per region, at its regional hub', () => {
    const successors = new Set(
      plan.template.flatMap((change) => (change.kind === 'replace' ? [change.successor] : [])),
    )
    expect(successors.size).toBe(5)
    const hubs = [...successors].map((store) => parentsOf(demo, store))
    for (const hub of hubs) expect(hub).toHaveLength(1)
    expect(new Set(hubs.map((hub) => hub[0]!.id)).size).toBe(5)
  })

  it('replaces each local store at cutover and retires it after, at the sites that have it', () => {
    const cutover = plan.milestones.find((milestone) => milestone.startsPhase === 'cutover')!
    for (const change of plan.template) {
      expect(change.applicability).toEqual({ kind: 'aggregating', element: change.subject })
      expect(change.date).toEqual({
        anchor: cutover.id,
        offsetDays: change.kind === 'replace' ? 0 : 90,
      })
      // No template change applies to no site: that is a #214 check the demo must not trip.
      const applies = demo.relationships.filter(
        (r) => r.type === 'Aggregation' && r.target === change.subject,
      )
      expect(applies.length).toBeGreaterThan(0)
    }
    expect(plan.template.map((change) => change.kind).sort()).toEqual([
      ...Array<string>(10).fill('replace'),
      ...Array<string>(10).fill('retire'),
    ])
  })

  it('has eight waves, the pilot first, planned finer the nearer they are', () => {
    const waves = wavesOf(demo.elements, ROLLOUT_DEMO_ID).map((wave) => wavePlanOf(wave)!)
    expect(waves.map((wave) => wave.label)).toEqual([
      'Pilot',
      'W1',
      'W2',
      'W3',
      'W4',
      'W5',
      'W6',
      'W7',
    ])
    expect(waves.map((wave) => wave.window?.start?.precision)).toEqual([
      'day',
      'day',
      'week',
      'month',
      'quarter',
      'quarter',
      'quarter',
      'quarter',
    ])
    expect(waves.map((wave) => wave.window?.end?.precision)).toEqual(
      waves.map((wave) => wave.window?.start?.precision),
    )
  })

  it('dates the near waves’ sites to the day and leaves the later waves’ to their wave', () => {
    const byWave = (label: string) => {
      const wave = wavesOf(demo.elements, ROLLOUT_DEMO_ID).find(
        (element) => wavePlanOf(element)?.label === label,
      )!
      return plan.sites.filter((site) => site.wave === wave.id)
    }
    for (const site of [...byWave('Pilot'), ...byWave('W1')]) {
      expect(Object.keys(site.milestones!)).toEqual(
        expect.arrayContaining(plan.milestones.map((milestone) => milestone.id)),
      )
      expect(new Set(Object.values(site.milestones!).map((date) => date.precision))).toEqual(
        new Set(['day']),
      )
    }
    for (const site of byWave('W2')) {
      expect(Object.values(site.milestones!).map((date) => date.precision)).toEqual(['week'])
    }
    for (const label of ['W3', 'W4', 'W5', 'W6', 'W7']) {
      for (const site of byWave(label)) expect(site.milestones).toBeUndefined()
    }
    // The pilot is under way: it has actuals, and nothing later does.
    expect(byWave('Pilot').every((site) => site.actuals !== undefined)).toBe(true)
    expect(plan.sites.filter((site) => site.actuals).length).toBe(byWave('Pilot').length)
  })
})

describe.each(SEEDS)('the seeded problems, with seed %i (#212, for #214)', (seed) => {
  const workspace = rolloutDemoWorkspace(seed)
  const plan = planOf(workspace)
  const data = rolloutData(new ModelStore(workspace), ROLLOUT_DEMO_ID)!

  it('has every site but one in a wave', () => {
    expect(data.sites).toHaveLength(160)
    expect(data.unassigned).toHaveLength(1)
  })

  it('has exactly one wave over capacity', () => {
    expect(data.waves).toHaveLength(8)
    expect(data.waves.filter((wave) => wave.over).map((wave) => wave.element.id)).toEqual([
      SEEDED.overCapacityWave,
    ])
  })

  it('has exactly one cutover inside a blackout', () => {
    const blackouts = plan.constraints!.blackouts!
    const inBlackout = plan.sites.filter((site) => {
      const cutover = site.milestones?.freezeStart
      return cutover && blackouts.some((blackout) => isIn(cutover.date, blackout))
    })
    expect(inBlackout.map((site) => site.milestones!.freezeStart!.date)).toEqual([
      SEEDED.blackoutCutover,
    ])
    expect(blackouts.find((blackout) => blackout.id === SEEDED.blackout)).toBeDefined()
  })

  it('has exactly one residency violation, a Swiss site migrating to Frankfurt', () => {
    const violations = residencyViolations(workspace)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(new RegExp(`^loc-site-${SEEDED.residencyCountry}-`))
  })

  it('puts each seeded site problem on a site of its own', () => {
    const blackout = plan.sites.find(
      (site) => site.milestones?.freezeStart?.date === SEEDED.blackoutCutover,
    )!
    const seeded = [
      data.unassigned[0]!.location,
      blackout.location,
      ...residencyViolations(workspace),
    ]
    expect(seeded).toHaveLength(3)
    expect(new Set(seeded).size).toBe(3)
  })

  it('pilots one site in each of four regions, of every archetype, none bound to its country', () => {
    const pilot = data.waves[0]!.sites.map((site) => site.element!)
    expect(pilot).toHaveLength(4)
    const regions = pilot.map((site) => parentsOf(workspace, parentsOf(workspace, site.id)[0]!.id))
    expect(new Set(regions.map((region) => region[0]!.id)).size).toBe(4)
    expect(new Set(data.waves[0]!.sites.map((site) => site.archetype))).toEqual(
      new Set(['Plant', 'Office', 'Warehouse']),
    )
    for (const site of pilot) expect(site.properties[SITE_FIELDS.residency]).toBe('none')
  })
})
