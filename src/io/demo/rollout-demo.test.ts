import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  ROLLOUT_PRESETS,
  addDays,
  dayAfterPeriod,
  dayStart,
  resolveSiteMilestones,
  rolloutPlanOf,
  siteStatus,
  validate,
  wavePlanOf,
  wavesOf,
  type Element,
  type PlanDate,
  type ResolvedMilestone,
  type RolloutPlan,
  type SitePlan,
  type WavePlan,
  type Workspace,
} from '@/model'
import { ModelStore } from '@/store'
import { rolloutData } from '@/ui/rollout/rollout-data'
import { fromCanonicalJson, toCanonicalJson } from '../canonical-json'
import {
  ROLLOUT_DEMO_AS_OF as BUNDLED_AS_OF,
  ROLLOUT_DEMO_ID as BUNDLED_ID,
  ROLLOUT_DEMO_JSON,
  loadBundledDemo,
  loadRolloutDemoWorkspace,
} from '../demo'
import { exportExchange, importExchangeXml } from '../exchange-format'
import {
  ROLLOUT_DEMO_AS_OF,
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
 * not by luck. Four are here for a guard each, found by narrowing it and
 * scanning seeds:
 * - 4: `cutoverDay` checks the whole freeze, cutover to reconciliation,
 *   against the blackouts; checking only the cutover day, or one day short,
 *   lets a second freeze run into the Q1 close;
 * - 27: a wave's own cutover day is kept clear for the longest freeze of its
 *   sites, who inherit it; kept clear for none, sites inherit a freeze into
 *   the Q1 close;
 * - 38: the site in no wave is not the Swiss residency site, which would hide
 *   its violation;
 * - 67: the blackout site is not the residency site either, which would put
 *   two problems on one site.
 */
const SEEDS = [ROLLOUT_DEMO_SEED, 1, 4, 7, 27, 38, 67, 2026, 31_337]

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

/** The wave plan of the wave a site plan names, if any. */
function waveOf(workspace: Workspace, site: SitePlan): WavePlan | undefined {
  return wavePlanOf(workspace.elements.find((element) => element.id === site.wave))
}

/** A site's milestones as the app resolves them: its own, its wave's, or spaced (ADR 0016). */
function resolved(workspace: Workspace, site: SitePlan): Map<string, ResolvedMilestone> {
  const milestones = resolveSiteMilestones(planOf(workspace), site, waveOf(workspace, site))
  return new Map(milestones.map((milestone) => [milestone.milestone.id, milestone]))
}

/**
 * Does the span from the first day of `from`'s period to the last day of
 * `to`'s touch a blackout? Both ends inclusive, so a span of one period is
 * that whole period.
 */
function touchesBlackout(
  workspace: Workspace,
  from: ResolvedMilestone,
  to: ResolvedMilestone,
): boolean {
  const first = from.planned!.date
  const afterLast = dayAfterPeriod(to.planned!)
  return planOf(workspace).constraints!.blackouts!.some(
    (blackout) => blackout.start < afterLast && blackout.end >= first,
  )
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

  it('opens on the generator’s rollout, at the day the generator plans it as of', () => {
    expect(BUNDLED_ID).toBe(ROLLOUT_DEMO_ID)
    expect(BUNDLED_AS_OF).toBe(ROLLOUT_DEMO_AS_OF)
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

  it('uses the data-migration preset’s milestone set (#213)', () => {
    expect(plan.milestones).toEqual(ROLLOUT_PRESETS.dataMigration.milestones)
    for (const archetype of plan.archetypes) {
      expect(Object.keys(archetype.durations!).sort()).toEqual(
        plan.milestones
          .slice(1)
          .map((milestone) => milestone.id)
          .sort(),
      )
    }
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

  const byWave = (label: string) => {
    const wave = wavesOf(demo.elements, ROLLOUT_DEMO_ID).find(
      (element) => wavePlanOf(element)?.label === label,
    )!
    return { wave: wavePlanOf(wave)!, sites: plan.sites.filter((site) => site.wave === wave.id) }
  }
  const LABELS = ['Pilot', 'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7']
  const PRECISIONS = ['day', 'day', 'week', 'month', 'quarter', 'quarter', 'quarter', 'quarter']

  it('dates each wave’s cutover at the wave’s precision, and nothing else (#213)', () => {
    for (const [index, label] of LABELS.entries()) {
      const { wave } = byWave(label)
      expect(Object.keys(wave.milestones!)).toEqual(['freezeStart'])
      expect(wave.milestones!.freezeStart!.precision).toBe(PRECISIONS[index])
    }
  })

  it('has the near waves’ sites set their own cutovers, and the later waves’ inherit', () => {
    const own = (label: string) =>
      byWave(label).sites.filter((site) => site.milestones?.freezeStart !== undefined)
    // Pilot: all of them; W1: two in three, the seeded blackout site among
    // them at this seed; W2: every other one; W3: one; W4–W7: none.
    expect(LABELS.map((label) => own(label).length)).toEqual([4, 10, 10, 1, 0, 0, 0, 0])
    for (const [index, label] of LABELS.entries()) {
      for (const site of own(label)) {
        // The cutover is the only date a site sets; the rest are spaced from it.
        expect(Object.keys(site.milestones!)).toEqual(['freezeStart'])
        expect(site.milestones!.freezeStart!.precision).toBe(PRECISIONS[index])
      }
    }
  })

  it('resolves every milestone of a site at its wave’s precision, set or inherited', () => {
    for (const [index, label] of LABELS.entries()) {
      for (const site of byWave(label).sites) {
        const milestones = [...resolved(demo, site).values()]
        expect(milestones.map((milestone) => milestone.planned?.precision)).toEqual(
          Array<string>(10).fill(PRECISIONS[index]!),
        )
        const cutover = milestones.find((milestone) => milestone.milestone.id === 'freezeStart')!
        expect(cutover.source).toBe(site.milestones ? 'site' : 'wave')
        for (const milestone of milestones) {
          if (milestone !== cutover) expect(milestone.source).toBe('spaced')
        }
      }
    }
  })

  it('records actuals up to ROLLOUT_DEMO_AS_OF and none after, and only the pilot has reached one', () => {
    expect(ROLLOUT_DEMO_AS_OF).toBe('2026-10-23')
    const pilot = byWave('Pilot').sites
    for (const site of plan.sites) {
      for (const milestone of resolved(demo, site).values()) {
        // The site in no wave inherits no date, so it has reached nothing.
        const reached =
          milestone.planned !== undefined && milestone.planned.date <= ROLLOUT_DEMO_AS_OF
        // Every milestone planned to start by the as-of day has an actual, and no other.
        expect(milestone.actual !== undefined, `${site.location} ${milestone.milestone.id}`).toBe(
          reached,
        )
        if (milestone.actual) expect(milestone.actual <= ROLLOUT_DEMO_AS_OF).toBe(true)
      }
    }
    expect(pilot.every((site) => site.actuals !== undefined)).toBe(true)
    expect(plan.sites.filter((site) => site.actuals).length).toBe(pilot.length)
  })

  // ADR 0016 point 4, amended 2026-10-28: the W4–W7 sites have only a
  // quarter-precision cutover from their wave, and every other milestone is
  // spaced from it, so all of them are shown in that quarter. Reached on the
  // quarter's first day, they read Migrated on their cutover day. Reached on
  // the chain's exact day, a site cuts over first and is Migrated only from
  // the day its hypercare ends.
  it('has no W4–W7 site Migrated or Done before its hypercare ends, from ROLLOUT_DEMO_AS_OF on', () => {
    let checked = 0
    for (const label of ['W4', 'W5', 'W6', 'W7']) {
      const { wave, sites } = byWave(label)
      for (const site of sites) {
        const milestones = resolved(demo, site)
        const cutover = milestones.get('freezeStart')!
        const migrated = milestones.get('hypercareEnd')!
        expect(cutover.planned!.precision).toBe('quarter')
        expect(migrated.planned).toEqual(cutover.planned)
        const migratedOn = migrated.spacedFrom!.day
        const phase = (day: string) => siteStatus(plan, site, wave, dayStart(day)).phase
        // On its cutover day it is in Cutover, not past it.
        expect(phase(cutover.planned!.date), site.location).toBe('cutover')
        for (let day = ROLLOUT_DEMO_AS_OF; day < migratedOn; day = addDays(day, 1)) {
          expect(['migrated', 'done'], `${site.location} ${day}`).not.toContain(phase(day))
          checked++
        }
        expect(phase(migratedOn)).toBe('migrated')
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('has the pilot under way at ROLLOUT_DEMO_AS_OF: preparing, and not overdue', () => {
    const at = dayStart(ROLLOUT_DEMO_AS_OF)
    const pilot = byWave('Pilot')
    const statuses = pilot.sites.map((site) => siteStatus(plan, site, pilot.wave, at))
    expect(statuses.map((status) => status.phase)).toEqual(Array<string>(4).fill('preparing'))
    expect(statuses.map((status) => status.overdue)).toEqual(Array<boolean>(4).fill(false))
  })
})

describe.each(SEEDS)('the seeded problems, with seed %i (#212, for #214)', (seed) => {
  const workspace = rolloutDemoWorkspace(seed)
  const plan = planOf(workspace)
  const data = rolloutData(
    new ModelStore(workspace),
    ROLLOUT_DEMO_ID,
    dayStart(ROLLOUT_DEMO_AS_OF),
  )!

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

  const inWave = plan.sites.filter((site) => site.wave !== undefined)
  const seededSite = plan.sites.find(
    (site) => site.milestones?.freezeStart?.date === SEEDED.blackoutCutover,
  )!

  it('has exactly one cutover inside a blackout', () => {
    const inBlackout = inWave.filter((site) => {
      const cutover = resolved(workspace, site).get('freezeStart')!
      return touchesBlackout(workspace, cutover, cutover)
    })
    expect(inBlackout.map((site) => site.location)).toEqual([seededSite.location])
    expect(seededSite.milestones!.freezeStart).toEqual({
      date: SEEDED.blackoutCutover,
      precision: 'day',
    })
    expect(
      plan.constraints!.blackouts!.find((blackout) => blackout.id === SEEDED.blackout),
    ).toBeDefined()
  })

  it('has exactly one freeze, cutover to reconciliation, touching a blackout', () => {
    const frozenInBlackout = inWave.filter((site) => {
      const milestones = resolved(workspace, site)
      return touchesBlackout(
        workspace,
        milestones.get('freezeStart')!,
        milestones.get('reconciliationSignedOff')!,
      )
    })
    expect(frozenInBlackout.map((site) => site.location)).toEqual([seededSite.location])
  })

  /** Every cutover the demo dates: each wave's, and each site's own. */
  const cutovers: { who: string; wave: WavePlan; date: PlanDate }[] = [
    ...wavesOf(workspace.elements, ROLLOUT_DEMO_ID).map((element) => {
      const wave = wavePlanOf(element)!
      return { who: element.id, wave, date: wave.milestones!.freezeStart! }
    }),
    ...inWave
      .filter((site) => site.milestones?.freezeStart)
      .map((site) => ({
        who: site.location,
        wave: waveOf(workspace, site)!,
        date: site.milestones!.freezeStart!,
      })),
  ]

  it('dates every cutover, a wave’s or a site’s own, inside its wave’s window', () => {
    expect(cutovers.length).toBeGreaterThan(8)
    const outside = cutovers.filter(
      ({ wave, date }) =>
        date.date < wave.window!.start!.date ||
        dayAfterPeriod(date) > dayAfterPeriod(wave.window!.end!),
    )
    expect(outside.map(({ who }) => who)).toEqual([])
  })

  it('cuts over on a weekday wherever it is dated to the day', () => {
    const days = cutovers.filter(({ date }) => date.precision === 'day')
    expect(days.length).toBeGreaterThan(8)
    const weekend = days.filter(({ date }) =>
      [0, 6].includes(new Date(dayStart(date.date)).getUTCDay()),
    )
    expect(weekend.map(({ who }) => who)).toEqual([])
  })

  it('has exactly one residency violation, a Swiss site migrating to Frankfurt', () => {
    const violations = residencyViolations(workspace)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(new RegExp(`^loc-site-${SEEDED.residencyCountry}-`))
  })

  it('puts each seeded site problem on a site of its own', () => {
    const seeded = [
      data.unassigned[0]!.location,
      seededSite.location,
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
