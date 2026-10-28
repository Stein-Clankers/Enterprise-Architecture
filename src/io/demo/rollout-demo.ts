import {
  addDays,
  dayAfterPeriod,
  dayStart,
  emptyWorkspace,
  periodOf,
  presetPlan,
  resolveSiteMilestones,
  ROLLOUT_PRESETS,
  switchMilestone,
  type Archetype,
  type Blackout,
  type Element,
  type Milestone,
  type PlanDate,
  type Relationship,
  type ResolvedMilestone,
  type RolloutPlan,
  type SitePlan,
  type SiteRag,
  type TemplateChange,
  type WavePlan,
  type Workspace,
} from '@/model'
import { ROLLOUT_DEMO_AS_OF, ROLLOUT_DEMO_ID } from './rollout-demo-constants'

export { ROLLOUT_DEMO_AS_OF, ROLLOUT_DEMO_ID }

/**
 * The generated 160-site data-migration rollout demo (#212, proposal §4.8).
 *
 * A fictional manufacturer, Kestrel Industries, moves the local data of 160
 * sites into one central store per region. Everything is built from a seed by
 * a small PRNG, never from `Math.random` or the clock, so the same seed writes
 * the same bytes: `npm run demo:generate` writes `rollout-demo.json` with
 * `ROLLOUT_DEMO_SEED`, and `rollout-demo.test.ts` fails when the checked-in
 * file is not what this writes.
 *
 * **The model.** Regions aggregate countries, countries aggregate sites and
 * one hub per region (proposal §4.1). A site's fields are `archipelago.site.*`
 * properties (ADR 0013 point 8). Each site aggregates its region's site file
 * share, and each plant its region's plant quality database: those are the
 * local stores, and each realizes the Data Objects it holds. Each hub
 * aggregates its region's central data lake, which realizes all of them, and
 * the platform it runs on. The stores are Artifacts because ArchiMate 3.2
 * lets an Artifact realize a Data Object and a System Software not.
 *
 * **The rollout.** A local store is shared by every site of its region, so a
 * template change names it once and `aggregating` picks the sites that have
 * it (ADR 0013 point 4). Per region, the template `replace`s each local store
 * with the region's lake at cutover and `retire`s it 90 days later
 * (proposal §4.8). Its milestones are the data-migration preset's (#213).
 * Eight waves, a pilot first, take every site but one. Each wave dates its
 * sites' cutover: the near waves to the day, then the week and the month, and
 * the later waves only to the quarter, rolling elaboration (proposal §5). Most
 * near-wave sites set a cutover of their own and the later waves' inherit the
 * wave's; every other milestone is spaced from the cutover by the site's
 * archetype (ADR 0016 point 2). The pilot is under way as of
 * `ROLLOUT_DEMO_AS_OF`, the day the rollout home opens at.
 *
 * **Seeded problems** for #214's plan checks, each placed by rule rather than
 * by the seed, so every seed has exactly one of each (`SEEDED`):
 * - one site in no wave;
 * - one wave over capacity;
 * - one cutover inside a blackout;
 * - one residency violation: a Swiss site whose data may not leave
 *   Switzerland, migrating to the lake at the Frankfurt hub.
 *
 * TODO(#214): the model has no site dependencies yet, so the demo seeds no
 * dependency-order violation. Add a hub-before-spokes dependency the plan
 * breaks once #214 adds them, and agree the residency classes below with the
 * residency check.
 */

/** The seed `npm run demo:generate` writes the checked-in demo with. */
export const ROLLOUT_DEMO_SEED = 212

export const ROLLOUT_DEMO_NAME = 'Site data to the regional lakes'
export const ROLLOUT_DEMO_SITES = 160

/** Which wave is which, and the problems the demo carries on purpose. */
export const SEEDED = {
  /** The wave over capacity: 20 sites against a capacity of 18. */
  overCapacityWave: 'wp-wave-2',
  /** The blackout one W1 site's cutover falls in. */
  blackout: 'bo-q1-close-2027',
  /** The cutover day inside that blackout. */
  blackoutCutover: '2027-03-31',
  /** The country whose first site is the residency violation. */
  residencyCountry: 'ch',
} as const

/** A site may keep its data anywhere, in its region, or in its country. */
export const RESIDENCY_CLASSES = ['none', 'region', 'country'] as const
export type ResidencyClass = (typeof RESIDENCY_CLASSES)[number]

/** The interim site fields (ADR 0013 point 8). */
export const SITE_FIELDS = {
  code: 'archipelago.site.code',
  volumeGb: 'archipelago.site.volumeGb',
  sourceSystems: 'archipelago.site.sourceSystems',
  dataQuality: 'archipelago.site.dataQuality',
  residency: 'archipelago.site.residency',
  headcount: 'archipelago.site.headcount',
} as const

// ── Seeded randomness ────────────────────────────────────────────────────────

/** mulberry32: small, fast, and the same sequence for a seed on every engine. */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

interface Random {
  next: () => number
  /** A whole number from `min` to `max`, both included. */
  int: (min: number, max: number) => number
  pick: <T>(items: readonly T[]) => T
  shuffle: <T>(items: readonly T[]) => T[]
}

function random(seed: number): Random {
  const next = prng(seed)
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)]!,
    shuffle: (items) => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = int(0, i)
        ;[out[i], out[j]] = [out[j]!, out[i]!]
      }
      return out
    },
  }
}

// ── Geography ────────────────────────────────────────────────────────────────

interface Country {
  code: string
  name: string
  cities: readonly string[]
}

interface Region {
  code: string
  name: string
  hub: { id: string; name: string; country: string }
  countries: readonly Country[]
}

/** Five regions of four countries; each region's hub sits in its first country. */
const REGIONS: readonly Region[] = [
  {
    code: 'ce',
    name: 'Central Europe',
    hub: { id: 'loc-hub-fra', name: 'Frankfurt data centre', country: 'de' },
    countries: [
      {
        code: 'de',
        name: 'Germany',
        cities: ['Hamburg', 'München', 'Stuttgart', 'Köln', 'Leipzig', 'Dortmund'],
      },
      { code: 'at', name: 'Austria', cities: ['Wien', 'Linz', 'Graz', 'Salzburg', 'Innsbruck'] },
      {
        code: 'ch',
        name: 'Switzerland',
        cities: ['Basel', 'Zürich', 'Genève', 'Lausanne', 'Bern'],
      },
      { code: 'pl', name: 'Poland', cities: ['Wrocław', 'Poznań', 'Gdańsk', 'Kraków', 'Łódź'] },
    ],
  },
  {
    code: 'we',
    name: 'Western Europe',
    hub: { id: 'loc-hub-par', name: 'Paris data centre', country: 'fr' },
    countries: [
      {
        code: 'fr',
        name: 'France',
        cities: ['Lyon', 'Lille', 'Toulouse', 'Nantes', 'Bordeaux', 'Strasbourg'],
      },
      {
        code: 'es',
        name: 'Spain',
        cities: ['Barcelona', 'Valencia', 'Sevilla', 'Bilbao', 'Zaragoza'],
      },
      { code: 'it', name: 'Italy', cities: ['Milano', 'Torino', 'Bologna', 'Verona', 'Padova'] },
      {
        code: 'be',
        name: 'Belgium',
        cities: ['Antwerpen', 'Gent', 'Liège', 'Charleroi', 'Brugge'],
      },
    ],
  },
  {
    code: 'ne',
    name: 'Northern Europe',
    hub: { id: 'loc-hub-lon', name: 'London data centre', country: 'gb' },
    countries: [
      {
        code: 'gb',
        name: 'United Kingdom',
        cities: ['Manchester', 'Leeds', 'Bristol', 'Birmingham', 'Glasgow', 'Sheffield'],
      },
      {
        code: 'ie',
        name: 'Ireland',
        cities: ['Dublin', 'Cork', 'Galway', 'Limerick', 'Waterford'],
      },
      {
        code: 'se',
        name: 'Sweden',
        cities: ['Göteborg', 'Malmö', 'Stockholm', 'Uppsala', 'Västerås'],
      },
      {
        code: 'dk',
        name: 'Denmark',
        cities: ['Aarhus', 'Odense', 'Aalborg', 'København', 'Esbjerg'],
      },
    ],
  },
  {
    code: 'am',
    name: 'Americas',
    hub: { id: 'loc-hub-ash', name: 'Ashburn data centre', country: 'us' },
    countries: [
      {
        code: 'us',
        name: 'United States',
        cities: ['Chicago', 'Houston', 'Atlanta', 'Columbus', 'Denver', 'Charlotte'],
      },
      {
        code: 'ca',
        name: 'Canada',
        cities: ['Toronto', 'Montréal', 'Calgary', 'Vancouver', 'Winnipeg'],
      },
      {
        code: 'mx',
        name: 'Mexico',
        cities: ['Monterrey', 'Guadalajara', 'Querétaro', 'Puebla', 'Saltillo'],
      },
      {
        code: 'br',
        name: 'Brazil',
        cities: ['São Paulo', 'Curitiba', 'Campinas', 'Joinville', 'Manaus'],
      },
    ],
  },
  {
    code: 'ap',
    name: 'Asia Pacific',
    hub: { id: 'loc-hub-sin', name: 'Singapore data centre', country: 'sg' },
    countries: [
      {
        code: 'sg',
        name: 'Singapore',
        cities: ['Jurong', 'Tuas', 'Woodlands', 'Changi', 'Tampines'],
      },
      { code: 'jp', name: 'Japan', cities: ['Osaka', 'Nagoya', 'Yokohama', 'Kobe', 'Fukuoka'] },
      {
        code: 'au',
        name: 'Australia',
        cities: ['Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Sydney'],
      },
      {
        code: 'in',
        name: 'India',
        cities: ['Pune', 'Chennai', 'Bengaluru', 'Ahmedabad', 'Hyderabad'],
      },
    ],
  },
]

const DATA_OBJECTS = [
  { id: 'do-documents', name: 'Site documents', store: 'files' },
  { id: 'do-hr', name: 'HR records', store: 'files' },
  { id: 'do-quality', name: 'Quality records', store: 'quality' },
  { id: 'do-production', name: 'Production records', store: 'quality' },
] as const

const regionLocation = (region: Region) => `loc-region-${region.code}`
const countryLocation = (country: Country) => `loc-country-${country.code}`
const filesStore = (region: Region) => `art-files-${region.code}`
const qualityStore = (region: Region) => `art-quality-${region.code}`
const lake = (region: Region) => `art-lake-${region.code}`
const platform = (region: Region) => `sys-platform-${region.code}`

// ── The rollout's shape ──────────────────────────────────────────────────────

/**
 * The data-migration preset's milestone set (#213, proposal §4.8), copied so
 * no edit to the demo reaches the preset.
 */
const MILESTONES: Milestone[] = presetPlan(ROLLOUT_PRESETS.dataMigration).milestones

/** The milestone a site switches over at: its cutover. */
const CUTOVER = switchMilestone(MILESTONES)!.id
/** The milestone that ends the freeze: the freeze runs from cutover to it. */
const FREEZE_END = 'reconciliationSignedOff'
/** Days from cutover to a local store's retirement (proposal §4.8). */
const RETIRE_AFTER_DAYS = 90

type ArchetypeId = 'plant' | 'office' | 'warehouse'

/**
 * Days from the previous milestone to each one: the spacing a site's other
 * milestones follow from its cutover, which is all the demo dates (ADR 0016
 * point 2). Our own figures, as the preset's are.
 */
const ARCHETYPES: Record<ArchetypeId, Archetype & { durations: Record<string, number> }> = {
  plant: {
    id: 'plant',
    label: 'Plant',
    durations: {
      mockLoad1: 21,
      mockLoad2: 21,
      dressRehearsal: 14,
      goNoGo: 7,
      freezeStart: 3,
      reconciliationSignedOff: 4,
      hypercareEnd: 28,
      legacyReadOnly: 14,
      legacyDecommissioned: 60,
    },
  },
  office: {
    id: 'office',
    label: 'Office',
    durations: {
      mockLoad1: 14,
      mockLoad2: 14,
      dressRehearsal: 7,
      goNoGo: 3,
      freezeStart: 2,
      reconciliationSignedOff: 2,
      hypercareEnd: 14,
      legacyReadOnly: 14,
      legacyDecommissioned: 30,
    },
  },
  warehouse: {
    id: 'warehouse',
    label: 'Warehouse',
    durations: {
      mockLoad1: 14,
      mockLoad2: 14,
      dressRehearsal: 7,
      goNoGo: 3,
      freezeStart: 2,
      reconciliationSignedOff: 3,
      hypercareEnd: 21,
      legacyReadOnly: 14,
      legacyDecommissioned: 45,
    },
  },
}

/** The longest freeze of any archetype: what a wave's own cutover keeps clear of blackouts. */
const LONGEST_FREEZE = Math.max(
  ...Object.values(ARCHETYPES).map((archetype) => archetype.durations[FREEZE_END]!),
)

const BLACKOUTS: Blackout[] = [
  { id: 'bo-year-end-2026', label: 'Year-end close', start: '2026-12-14', end: '2027-01-08' },
  { id: SEEDED.blackout, label: 'Q1 close', start: '2027-03-29', end: '2027-04-02' },
]

const DEFAULT_CAPACITY = 24

interface WaveSpec {
  id: string
  name: string
  label: string
  /** The window, at the precision the wave is planned to. */
  start: PlanDate
  end: PlanDate
  /** Sites the wave takes: the last wave takes every site left, which is this many. */
  size: number
  capacity?: number
  templateVersion: number
  /**
   * Which of its sites, by position in the wave, set a cutover of their own.
   * The rest inherit the wave's (ADR 0016 point 2).
   */
  ownCutover: (index: number) => boolean
}

const day = (date: string): PlanDate => ({ date, precision: 'day' })
const quarter = (date: string): PlanDate => ({ date, precision: 'quarter' })

/**
 * Pilot and W1 to the day, W2 to the week, W3 to the month, the rest to the
 * quarter: rolling elaboration (proposal §5). The nearer a wave, the more of
 * its sites set their own cutover; the later waves' sites inherit the wave's.
 */
const WAVES: readonly WaveSpec[] = [
  {
    id: 'wp-wave-pilot',
    name: 'Pilot wave',
    label: 'Pilot',
    start: day('2026-11-02'),
    end: day('2026-12-11'),
    size: 4,
    capacity: 4,
    templateVersion: 1,
    ownCutover: () => true,
  },
  {
    id: 'wp-wave-1',
    name: 'Wave 1',
    label: 'W1',
    start: day('2027-01-18'),
    end: day('2027-04-16'),
    size: 15,
    capacity: 16,
    templateVersion: 2,
    ownCutover: (index) => index % 3 !== 2,
  },
  {
    id: SEEDED.overCapacityWave,
    name: 'Wave 2',
    label: 'W2',
    start: { date: '2027-04-26', precision: 'week' },
    end: { date: '2027-06-28', precision: 'week' },
    size: 20,
    capacity: 18,
    templateVersion: 2,
    ownCutover: (index) => index % 2 === 0,
  },
  {
    id: 'wp-wave-3',
    name: 'Wave 3',
    label: 'W3',
    start: { date: '2027-08-01', precision: 'month' },
    end: { date: '2027-09-01', precision: 'month' },
    size: DEFAULT_CAPACITY,
    templateVersion: 2,
    ownCutover: (index) => index === 0,
  },
  ...['2027-10-01', '2028-01-01', '2028-04-01', '2028-07-01'].map((start, i): WaveSpec => ({
    id: `wp-wave-${i + 4}`,
    name: `Wave ${i + 4}`,
    label: `W${i + 4}`,
    start: quarter(start),
    end: quarter(start),
    size: DEFAULT_CAPACITY,
    templateVersion: 2,
    ownCutover: () => false,
  })),
]

// ── Day arithmetic ───────────────────────────────────────────────────────────

const WEEK_MS = 7 * 86_400_000

/** Monday is 0. */
function weekday(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
}

/** Does the span from `first` to `last`, both included, touch a blackout? */
function touchesBlackout(first: string, last: string): boolean {
  return BLACKOUTS.some((blackout) => first <= blackout.end && last >= blackout.start)
}

// ── The generator ────────────────────────────────────────────────────────────

interface Site {
  id: string
  code: string
  name: string
  region: Region
  country: Country
  archetype: ArchetypeId
  residency: ResidencyClass
}

/** The 160-site data-migration rollout demo for `seed`. Same seed, same workspace. */
export function rolloutDemoWorkspace(seed: number = ROLLOUT_DEMO_SEED): Workspace {
  const rng = random(seed)
  const elements: Element[] = []
  const relationships: Relationship[] = []
  const relate = (type: Relationship['type'], source: string, target: string) =>
    relationships.push({ id: `rel-${source}-${target}`, type, source, target, properties: {} })

  // Data objects, and per region the local stores, the lake and its platform.
  for (const object of DATA_OBJECTS) {
    elements.push({ id: object.id, type: 'DataObject', name: object.name, properties: {} })
  }
  for (const region of REGIONS) {
    elements.push(
      {
        id: filesStore(region),
        type: 'Artifact',
        name: `Site file share (${region.name})`,
        documentation: 'The file share every site of the region keeps its own documents on.',
        properties: {},
      },
      {
        id: qualityStore(region),
        type: 'Artifact',
        name: `Plant quality database (${region.name})`,
        documentation: 'The local quality and production database each plant of the region runs.',
        properties: {},
      },
      {
        id: lake(region),
        type: 'Artifact',
        name: `${region.name} data lake`,
        documentation: 'The central store the region’s sites migrate their data into.',
        properties: {},
      },
      {
        id: platform(region),
        type: 'SystemSoftware',
        name: `${region.name} data platform`,
        properties: {},
      },
    )
    for (const object of DATA_OBJECTS) {
      const local = object.store === 'files' ? filesStore(region) : qualityStore(region)
      relate('Realization', local, object.id)
      relate('Realization', lake(region), object.id)
    }
    relate('Assignment', platform(region), lake(region))
  }

  // The Location hierarchy: region, country, hub and site (proposal §4.1).
  const sites: Site[] = []
  const weights = REGIONS.flatMap((region) =>
    region.countries.map((country) => ({
      country,
      weight: (country.code === region.hub.country ? 2.5 : 1) * (0.6 + rng.next()),
    })),
  )
  const counts = new Map<string, number>(weights.map(({ country }) => [country.code, 4]))
  const total = weights.reduce((sum, { weight }) => sum + weight, 0)
  for (let n = counts.size * 4; n < ROLLOUT_DEMO_SITES; n += 1) {
    let draw = rng.next() * total
    const chosen = weights.find(({ weight }) => (draw -= weight) < 0) ?? weights.at(-1)!
    counts.set(chosen.country.code, counts.get(chosen.country.code)! + 1)
  }

  for (const region of REGIONS) {
    elements.push(
      { id: regionLocation(region), type: 'Location', name: region.name, properties: {} },
      { id: region.hub.id, type: 'Location', name: region.hub.name, properties: {} },
    )
    relate('Aggregation', region.hub.id, lake(region))
    relate('Aggregation', region.hub.id, platform(region))
    for (const country of region.countries) {
      const countryId = countryLocation(country)
      const hubCountry = country.code === region.hub.country
      elements.push({ id: countryId, type: 'Location', name: country.name, properties: {} })
      relate('Aggregation', regionLocation(region), countryId)
      if (hubCountry) relate('Aggregation', countryId, region.hub.id)

      const names = new Map<string, number>()
      for (let i = 1; i <= counts.get(country.code)!; i += 1) {
        const draw = rng.next()
        const archetype: ArchetypeId = draw < 0.45 ? 'plant' : draw < 0.8 ? 'office' : 'warehouse'
        const base = `${rng.pick(country.cities)} ${ARCHETYPES[archetype].label.toLowerCase()}`
        const seen = (names.get(base) ?? 0) + 1
        names.set(base, seen)
        const number = String(i).padStart(2, '0')
        sites.push({
          id: `loc-site-${country.code}-${number}`,
          code: `${country.code.toUpperCase()}-${number}`,
          name: seen === 1 ? base : `${base} ${seen}`,
          region,
          country,
          archetype,
          residency: residencyOf(rng.next(), hubCountry),
        })
      }
    }
  }

  // The seeded residency violation: the first Swiss site may not leave
  // Switzerland, and its region's lake is in Frankfurt.
  const residencySite = sites.find((site) => site.country.code === SEEDED.residencyCountry)!
  residencySite.residency = 'country'

  for (const site of sites) {
    const [volume, sourceSystems, headcount] = SITE_RANGES[site.archetype].map(([min, max]) =>
      rng.int(min, max),
    ) as [number, number, number]
    elements.push({
      id: site.id,
      type: 'Location',
      name: site.name,
      properties: {
        [SITE_FIELDS.code]: site.code,
        [SITE_FIELDS.volumeGb]: volume,
        [SITE_FIELDS.sourceSystems]: sourceSystems,
        [SITE_FIELDS.dataQuality]: rng.int(55, 98),
        [SITE_FIELDS.residency]: site.residency,
        [SITE_FIELDS.headcount]: headcount,
      },
    })
    relate('Aggregation', countryLocation(site.country), site.id)
    relate('Aggregation', site.id, filesStore(site.region))
    if (site.archetype === 'plant') relate('Aggregation', site.id, qualityStore(site.region))
  }

  // Waves. The pilot takes a site from each of four regions, of every
  // archetype, none of them bound to its country (so not the residency site);
  // one site is left in no wave; the rest go region by region.
  const pilot: Site[] = []
  for (const archetype of ['plant', 'office', 'warehouse', 'plant'] as const) {
    const candidates = sites.filter(
      (site) =>
        site.archetype === archetype &&
        site.residency === 'none' &&
        !pilot.some((chosen) => chosen.region === site.region),
    )
    pilot.push(rng.pick(candidates))
  }
  // The seeded site in no wave, from the sites the pilot does not take.
  const others = sites.filter((site) => !pilot.includes(site))
  const unassigned = rng.pick(others.filter((site) => site !== residencySite))
  const regionOrder = new Map(REGIONS.map((region, index) => [region, index]))
  const rest = rng
    .shuffle(others.filter((site) => site !== unassigned))
    .sort((a, b) => regionOrder.get(a.region)! - regionOrder.get(b.region)!)

  const waveOf = new Map<Site, WaveSpec>()
  /** A site's position in its wave, which decides whether it sets its own cutover. */
  const position = new Map<Site, number>()
  pilot.forEach((site, index) => {
    waveOf.set(site, WAVES[0]!)
    position.set(site, index)
  })
  let taken = 0
  for (const wave of WAVES.slice(1)) {
    // The last wave takes every site left: a site that should be in no wave
    // but is left in `rest` shows as one too many there, never hidden by
    // another site taking its place in no wave.
    const end = wave === WAVES.at(-1) ? rest.length : taken + wave.size
    rest.slice(taken, end).forEach((site, index) => {
      waveOf.set(site, wave)
      position.set(site, index)
    })
    taken += wave.size
  }
  // The seeded blackout: a site of W1, cut over in the Q1 close. W1 takes
  // `rest`'s first sites, so its first that is not the residency site is one.
  const blackoutSite = rest.find((site) => site !== residencySite)!

  // Each wave dates its sites' cutover at its own precision (ADR 0016 point 2),
  // clear of every blackout for the longest freeze; a site's other milestones
  // are spaced from its cutover by its archetype's durations.
  const wavePlans = new Map<WaveSpec, WavePlan>(
    WAVES.map((wave, order) => [
      wave,
      {
        kind: 'wave',
        rollout: ROLLOUT_DEMO_ID,
        label: wave.label,
        order,
        window: { start: wave.start, end: wave.end },
        ...(wave.capacity === undefined ? {} : { capacity: wave.capacity }),
        templateVersion: wave.templateVersion,
        milestones: { [CUTOVER]: periodIn(rng, wave, LONGEST_FREEZE) },
      },
    ]),
  )
  const shell: RolloutPlan = {
    kind: 'rollout',
    templateVersion: 2,
    milestones: MILESTONES,
    template: [],
    archetypes: Object.values(ARCHETYPES),
    sites: [],
  }

  // Site plans: the near waves' sites set their own cutover, the later waves'
  // inherit their wave's. The pilot is under way, so it has actual dates.
  const plans: SitePlan[] = []
  for (const site of sites) {
    const plan: SitePlan = { location: site.id, archetype: site.archetype }
    const wave = waveOf.get(site)
    if (wave) {
      plan.wave = wave.id
      const freeze = ARCHETYPES[site.archetype].durations[FREEZE_END]!
      if (site === blackoutSite) plan.milestones = { [CUTOVER]: day(SEEDED.blackoutCutover) }
      else if (wave.ownCutover(position.get(site)!)) {
        plan.milestones = { [CUTOVER]: periodIn(rng, wave, freeze) }
      }
      const actuals = actualsOf(rng, resolveSiteMilestones(shell, plan, wavePlans.get(wave)))
      if (Object.keys(actuals).length) plan.actuals = actuals
    }
    const rag = ragOf(rng, wave, site === blackoutSite)
    if (rag) plan.rag = rag
    plans.push(plan)
  }
  const note = (site: Site, notes: string) => {
    plans.find((plan) => plan.location === site.id)!.notes = notes
  }
  note(
    pilot[0]!,
    'Mock load 1 found duplicate supplier records; they are cleansed before mock load 2.',
  )
  note(
    residencySite,
    'HR records fall under Swiss data protection law; legal review of the move is open.',
  )
  note(
    blackoutSite,
    'Cutover set for 31 March at the site’s request, before the Q1 close was checked.',
  )

  // Per region, each local store is replaced by the lake at cutover and
  // retired 90 days later (proposal §4.8).
  // TODO(#230): the disposition per data object (migrate, archive, purge,
  // retain) is a planned value of the template change; the model has no field
  // for it yet, and #230 settles what a data migration's template means.
  const template: TemplateChange[] = REGIONS.flatMap((region) =>
    [filesStore(region), qualityStore(region)].flatMap((store): TemplateChange[] => [
      {
        id: `tc-${store}-replace`,
        kind: 'replace',
        subject: store,
        successor: lake(region),
        date: { anchor: CUTOVER, offsetDays: 0 },
        applicability: { kind: 'aggregating', element: store },
      },
      {
        id: `tc-${store}-retire`,
        kind: 'retire',
        subject: store,
        date: { anchor: CUTOVER, offsetDays: RETIRE_AFTER_DAYS },
        applicability: { kind: 'aggregating', element: store },
      },
    ]),
  )

  elements.push({
    id: ROLLOUT_DEMO_ID,
    type: 'WorkPackage',
    name: ROLLOUT_DEMO_NAME,
    documentation:
      'Moves each region’s site file share and plant quality database into the region’s central data lake, site by site, then retires them.',
    properties: { owner: 'Data Office' },
    plan: {
      kind: 'rollout',
      templateVersion: 2,
      milestones: MILESTONES,
      template,
      constraints: { blackouts: BLACKOUTS, defaultCapacity: DEFAULT_CAPACITY },
      archetypes: Object.values(ARCHETYPES),
      sites: plans,
    },
  })
  for (const wave of WAVES) {
    elements.push({
      id: wave.id,
      type: 'WorkPackage',
      name: wave.name,
      properties: {},
      plan: wavePlans.get(wave)!,
    })
    relate('Aggregation', ROLLOUT_DEMO_ID, wave.id)
  }

  return {
    ...emptyWorkspace('ws-rollout-demo', 'Kestrel Industries: site data migration'),
    documentation:
      'A generated demo (#212): a fictional manufacturer moving the local data of 160 sites into one central data lake per region, with a few planning problems seeded on purpose. Regenerate it with `npm run demo:generate`; never edit it by hand.',
    elements,
    relationships,
  }
}

/** Volume in GB, source systems and headcount, from and to, per archetype. */
const SITE_RANGES: Record<ArchetypeId, [number, number][]> = {
  plant: [
    [200, 6000],
    [4, 12],
    [150, 2400],
  ],
  office: [
    [20, 800],
    [1, 5],
    [20, 600],
  ],
  warehouse: [
    [50, 1500],
    [2, 6],
    [30, 300],
  ],
}

/**
 * Only a hub country can keep its data in the country and still migrate: its
 * lake is there. Anywhere else `country` would be a residency violation, and
 * the demo seeds exactly one, by hand.
 */
function residencyOf(draw: number, hubCountry: boolean): ResidencyClass {
  if (hubCountry) return draw < 0.25 ? 'country' : draw < 0.6 ? 'region' : 'none'
  return draw < 0.4 ? 'region' : 'none'
}

/**
 * A weekday in the wave's window whose freeze, `freeze` days from cutover,
 * stays inside the window and clear of every blackout.
 */
function cutoverDay(rng: Random, wave: WaveSpec, freeze: number): string {
  const days: string[] = []
  for (let d = wave.start.date; d <= addDays(wave.end.date, -freeze); d = addDays(d, 1)) {
    if (weekday(d) < 5 && !touchesBlackout(d, addDays(d, freeze))) days.push(d)
  }
  return rng.pick(days)
}

/**
 * A period of the wave's precision inside its window for a cutover whose
 * freeze lasts `freeze` days: to the day, a weekday whose freeze stays clear
 * of every blackout; to the week or the month, one of the window's; to the
 * quarter, the window's own.
 */
function periodIn(rng: Random, wave: WaveSpec, freeze: number): PlanDate {
  switch (wave.start.precision) {
    case 'day':
      return day(cutoverDay(rng, wave, freeze))
    case 'week': {
      // The window's end is a week of the window, so it may be drawn too.
      const weeks = (dayStart(wave.end.date) - dayStart(wave.start.date)) / WEEK_MS
      return { date: addDays(wave.start.date, rng.int(0, weeks) * 7), precision: 'week' }
    }
    case 'month': {
      const months: string[] = []
      for (let d = wave.start; d.date <= wave.end.date; d = periodOf(dayAfterPeriod(d), 'month')) {
        months.push(d.date)
      }
      return { date: rng.pick(months), precision: 'month' }
    }
    case 'quarter':
      return wave.start
  }
}

/** The milestones reached by `ROLLOUT_DEMO_AS_OF`, each a few days late at most. */
function actualsOf(rng: Random, milestones: readonly ResolvedMilestone[]): Record<string, string> {
  const actuals: Record<string, string> = {}
  for (const { milestone, planned } of milestones) {
    if (!planned || planned.date > ROLLOUT_DEMO_AS_OF) continue
    const actual = addDays(planned.date, rng.int(0, 3))
    actuals[milestone.id] = actual <= ROLLOUT_DEMO_AS_OF ? actual : ROLLOUT_DEMO_AS_OF
  }
  return actuals
}

/** Rated in the near waves only: a RAG is a judgement, made once a site is planned in detail. */
function ragOf(rng: Random, wave: WaveSpec | undefined, seeded: boolean): SiteRag | undefined {
  const draw = rng.next()
  if (wave === WAVES[0]) return draw < 0.3 ? 'amber' : 'green'
  if (wave !== WAVES[1]) return undefined
  if (seeded) return 'red'
  return draw < 0.2 ? 'amber' : draw < 0.6 ? 'green' : undefined
}
