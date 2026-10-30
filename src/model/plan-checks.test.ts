import { describe, expect, it } from 'vitest'
import {
  addDays,
  dayStart,
  type Blackout,
  type Disposition,
  type PlanDate,
  type RolloutPlan,
  type SiteException,
  type SitePlan,
  type TemplateChange,
  type WavePlan,
} from './plan'
import { appliesTo, planChecks } from './plan-checks'
import { ROLLOUT_PRESETS, RESIDENCY_FIELD, presetPlan } from './presets'
import { validate } from './validate'
import { emptyWorkspace, type Element, type Relationship, type Workspace } from './workspace'

/**
 * The plan checks (#214). One small data-migration rollout that every check
 * passes, then one change per case, so each finding has a subject that only
 * the check under test decides, and every expectation is the whole list of
 * findings: a check that also fires elsewhere fails the case.
 *
 * Europe aggregates Austria and Germany; Austria aggregates the three sites
 * and a Vienna data centre, Germany a Frankfurt one. Each site aggregates the
 * legacy store the template replaces with the Vienna cloud store. Sites A and
 * B are in W1, planned to the day; C is in W2, 26 weeks later, and depends on
 * A. The time point is before any of it.
 */

const ROLLOUT = 'wp-r'
const W1 = 'wp-w1'
const W2 = 'wp-w2'
const A = 'loc-a'
const B = 'loc-b'
const C = 'loc-c'
const NOW = dayStart('2026-10-29')

const day = (date: string): PlanDate => ({ date, precision: 'day' })

const W1_DATES: Record<string, string> = {
  mappingSignedOff: '2027-01-04',
  mockLoad1: '2027-01-25',
  mockLoad2: '2027-02-15',
  dressRehearsal: '2027-03-01',
  goNoGo: '2027-03-08',
  freezeStart: '2027-03-11',
  reconciliationSignedOff: '2027-03-15',
  hypercareEnd: '2027-04-12',
  legacyReadOnly: '2027-04-13',
  legacyDecommissioned: '2027-07-12',
}

const shifted = (dates: Record<string, string>, days: number) =>
  Object.fromEntries(Object.entries(dates).map(([id, date]) => [id, day(addDays(date, days))]))

const location = (id: string, name: string, properties: Element['properties'] = {}): Element => ({
  id,
  type: 'Location',
  name,
  // A copy: the sites are given one class object, and a case changes one site's.
  properties: { ...properties },
})

const store = (id: string, name: string): Element => ({
  id,
  type: 'SystemSoftware',
  name,
  properties: {},
})

let relationshipCount = 0
const aggregation = (source: string, target: string): Relationship => ({
  id: `rel-${++relationshipCount}`,
  type: 'Aggregation',
  source,
  target,
  properties: {},
})

function wave(id: string, label: string, order: number, plan: Partial<WavePlan>): Element {
  return {
    id,
    type: 'WorkPackage',
    name: `Wave ${label}`,
    properties: {},
    plan: { kind: 'wave', rollout: ROLLOUT, label, order, templateVersion: 1, ...plan },
  }
}

const REPLACE: TemplateChange = {
  id: 'tc-replace',
  kind: 'replace',
  subject: 'sys-legacy',
  successor: 'sys-cloud',
  date: { anchor: 'freezeStart', offsetDays: 0 },
  applicability: { kind: 'aggregating', element: 'sys-legacy' },
}

/** The rollout every check passes. */
function clean(): Workspace {
  const country = { [RESIDENCY_FIELD]: 'country' }
  const elements: Element[] = [
    location('loc-eu', 'Europe'),
    location('loc-at', 'Austria'),
    location('loc-de', 'Germany'),
    location(A, 'Site A', country),
    location(B, 'Site B', country),
    location(C, 'Site C', country),
    location('loc-dc-at', 'Vienna data centre'),
    location('loc-dc-de', 'Frankfurt data centre'),
    store('sys-legacy', 'Legacy store'),
    store('sys-cloud', 'Vienna cloud store'),
    store('sys-cloud-de', 'Frankfurt cloud store'),
    {
      id: ROLLOUT,
      type: 'WorkPackage',
      name: 'Rollout',
      properties: {},
      plan: {
        kind: 'rollout',
        ...presetPlan(ROLLOUT_PRESETS.dataMigration),
        templateVersion: 1,
        template: [structuredClone(REPLACE)],
        constraints: {
          defaultCapacity: 3,
          blackouts: [{ id: 'bo-summer', label: 'Summer', start: '2027-08-01', end: '2027-08-15' }],
        },
        sites: [
          {
            location: A,
            wave: W1,
            blackouts: [{ id: 'bo-a', start: '2027-12-01', end: '2027-12-03' }],
          },
          {
            location: B,
            wave: W1,
            exceptions: [
              {
                id: 'ex-b',
                kind: 'modify',
                change: 'tc-replace',
                offsetDays: 7,
                class: 'operational',
                owner: 'Ops',
                expires: '2030-12-31',
              },
            ],
          },
          { location: C, wave: W2, dependsOn: [A] },
        ],
      },
    },
    wave(W1, 'W1', 1, { capacity: 2, milestones: shifted(W1_DATES, 0) }),
    wave(W2, 'W2', 2, { milestones: shifted(W1_DATES, 182) }),
  ]
  const relationships = [
    aggregation('loc-eu', 'loc-at'),
    aggregation('loc-eu', 'loc-de'),
    aggregation('loc-at', A),
    aggregation('loc-at', B),
    aggregation('loc-at', C),
    aggregation('loc-at', 'loc-dc-at'),
    aggregation('loc-de', 'loc-dc-de'),
    aggregation('loc-dc-at', 'sys-cloud'),
    aggregation('loc-dc-de', 'sys-cloud-de'),
    aggregation(A, 'sys-legacy'),
    aggregation(B, 'sys-legacy'),
    aggregation(C, 'sys-legacy'),
    aggregation(ROLLOUT, W1),
    aggregation(ROLLOUT, W2),
  ]
  return { ...emptyWorkspace('ws-checks', 'Checks'), elements, relationships }
}

const element = (model: Workspace, id: string) => model.elements.find((e) => e.id === id)!
const planOf = (model: Workspace) => element(model, ROLLOUT).plan as RolloutPlan
const siteOf = (model: Workspace, id: string) => planOf(model).sites.find((s) => s.location === id)!
const waveOf = (model: Workspace, id: string) => element(model, id).plan as WavePlan

/** The clean rollout with one change. */
function changed(change: (model: Workspace) => void): Workspace {
  const model = clean()
  change(model)
  return model
}

/** The findings as `code subject`, in order. */
function checked(model: Workspace, at = NOW): string[] {
  return planChecks(model, ROLLOUT, at).map((finding) => `${finding.code} ${finding.subjectId}`)
}

function messages(model: Workspace, at = NOW): string[] {
  return planChecks(model, ROLLOUT, at).map((finding) => finding.message)
}

const blackout = (start: string, end = start): Blackout => ({ id: `bo-${start}`, start, end })
const addBlackout = (model: Workspace, value: Blackout) =>
  planOf(model).constraints!.blackouts!.push(value)
const setSiteDate = (model: Workspace, site: string, milestone: string, date: PlanDate) => {
  const plan = siteOf(model, site)
  plan.milestones = { ...plan.milestones, [milestone]: date }
}
const dropWaveDate = (model: Workspace, id: string, milestone: string) => {
  delete waveOf(model, id).milestones![milestone]
}
const withoutPreset = (model: Workspace) => {
  delete planOf(model).preset
}
const exception = (fields: Partial<SiteException> & Pick<SiteException, 'kind'>): SiteException =>
  ({ id: 'ex-x', class: 'legal', expires: '2030-12-31', ...fields }) as SiteException

describe('the clean rollout', () => {
  it('passes every check, and is a valid model', () => {
    const model = clean()
    // Assert the presence first: the rollout has its sites and waves.
    expect(planOf(model).sites).toHaveLength(3)
    expect(checked(model)).toEqual([])
    expect(validate(model).findings).toEqual([])
  })

  it('is no rollout for an id that is not one', () => {
    expect(planChecks(clean(), W1, NOW)).toEqual([])
    expect(planChecks(clean(), 'wp-nothing', NOW)).toEqual([])
  })
})

describe('a site in no wave', () => {
  it('is reported when the site has no wave', () => {
    const model = changed((m) => delete siteOf(m, B).wave)
    expect(checked(model)).toEqual([`rollout.site-unassigned ${B}`])
  })

  it('is reported when its wave is not one of this rollout', () => {
    const model = changed((m) => {
      m.elements.push(wave('wp-other', 'X', 1, {}))
      ;(element(m, 'wp-other').plan as WavePlan).rollout = 'wp-another'
      siteOf(m, B).wave = 'wp-other'
    })
    expect(checked(model)).toEqual([`rollout.site-unassigned ${B}`])
  })
})

describe('a wave over capacity', () => {
  it('is reported one site over its capacity, and not at it', () => {
    expect(checked(changed((m) => (waveOf(m, W1).capacity = 1)))).toEqual([
      `rollout.wave-over-capacity ${W1}`,
    ])
    // The clean rollout has W1 at its capacity of 2.
    expect(waveOf(clean(), W1).capacity).toBe(2)
  })

  it('takes the wave’s own capacity over the rollout’s default', () => {
    // A default of 1 would put W1's two sites over; its own 2 holds them.
    expect(checked(changed((m) => (planOf(m).constraints!.defaultCapacity = 1)))).toEqual([])
  })

  it('takes the rollout’s default for a wave that sets none', () => {
    const model = changed((m) => {
      planOf(m).constraints!.defaultCapacity = 1
      siteOf(m, B).wave = W2
    })
    expect(checked(model)).toEqual([`rollout.wave-over-capacity ${W2}`])
  })

  it('says a wave with no capacity, and no default, is not checked', () => {
    const model = changed((m) => delete planOf(m).constraints!.defaultCapacity)
    expect(checked(model)).toEqual([`rollout.wave-capacity-unset ${W2}`])
  })
})

describe('a site with no cutover date', () => {
  it('is said, and takes the site out of the date checks', () => {
    // C depends on A: with no date, the order of the two is not judged.
    const model = changed((m) => dropWaveDate(m, W2, 'freezeStart'))
    expect(checked(model)).toEqual([`rollout.site-undated ${C}`])
  })

  it('is said once, for the rollout, when the set has no cutover milestone', () => {
    const model = changed((m) => {
      withoutPreset(m)
      const plan = planOf(m)
      plan.milestones = plan.milestones.filter(
        (milestone) => milestone.startsPhase !== 'cutover' && milestone.startsPhase !== 'hypercare',
      )
    })
    expect(checked(model)).toEqual([`rollout.site-undated ${ROLLOUT}`])
  })

  it('says nothing of a site in no wave, which is reported as such', () => {
    const model = changed((m) => {
      delete siteOf(m, C).wave
      delete siteOf(m, C).dependsOn
    })
    expect(checked(model)).toEqual([`rollout.site-unassigned ${C}`])
  })
})

describe('a cutover inside a blackout', () => {
  // Without the preset, so the freeze, which starts at cutover, is not checked too.
  const cutoverIn = (value: Blackout, own?: string) =>
    checked(
      changed((m) => {
        withoutPreset(m)
        if (own) siteOf(m, own).blackouts = [value]
        else addBlackout(m, value)
      }),
    )

  it('is reported on either end of the blackout, and not a day outside it', () => {
    expect(cutoverIn(blackout('2027-03-05', '2027-03-11'))).toEqual([
      `rollout.cutover-in-blackout ${A}`,
      `rollout.cutover-in-blackout ${B}`,
    ])
    expect(cutoverIn(blackout('2027-03-11', '2027-03-20'))).toHaveLength(2)
    expect(cutoverIn(blackout('2027-03-05', '2027-03-10'))).toEqual([])
    expect(cutoverIn(blackout('2027-03-12', '2027-03-20'))).toEqual([])
  })

  it('reads a site’s own blackouts for that site only', () => {
    expect(cutoverIn(blackout('2027-03-11'), A)).toEqual([`rollout.cutover-in-blackout ${A}`])
  })

  it('compares a coarse date’s whole period, and an actual day over the plan', () => {
    const week = changed((m) => {
      withoutPreset(m)
      setSiteDate(m, A, 'freezeStart', { date: '2027-03-08', precision: 'week' })
      addBlackout(m, blackout('2027-03-14'))
    })
    // The week of 8 March ends on the 14th; a day date on the 8th would miss it.
    expect(checked(week)).toEqual([`rollout.cutover-in-blackout ${A}`])
    const actual = changed((m) => {
      withoutPreset(m)
      siteOf(m, A).actuals = { freezeStart: '2027-03-14' }
      addBlackout(m, blackout('2027-03-14'))
    })
    expect(checked(actual)).toEqual([`rollout.cutover-in-blackout ${A}`])
    const actualClear = changed((m) => {
      withoutPreset(m)
      siteOf(m, A).actuals = { freezeStart: '2027-03-13' }
      addBlackout(m, blackout('2027-03-11'))
    })
    expect(checked(actualClear)).toEqual([`rollout.cutover-in-blackout ${B}`])
  })
})

describe('a dependency order violated', () => {
  it('is reported for a site cutting over before the one it depends on', () => {
    const model = changed((m) => (siteOf(m, A).dependsOn = [C]))
    expect(checked(model)).toEqual([`rollout.dependency-order ${A}`])
    expect(messages(model)[0]).toBe(
      'Site “Site A” depends on “Site C”, but cuts over 2027-03-11, not after “Site C” (2027-09-09).',
    )
  })

  it('is reported on the same day, and not a day after', () => {
    expect(checked(changed((m) => (siteOf(m, B).dependsOn = [A])))).toEqual([
      `rollout.dependency-order ${B}`,
    ])
    const after = changed((m) => {
      siteOf(m, B).dependsOn = [A]
      setSiteDate(m, B, 'freezeStart', day('2027-03-12'))
    })
    expect(checked(after)).toEqual([])
  })

  it('takes an actual day over the plan, on both sides', () => {
    // B planned a day after A, but A actually cut over later.
    const late = changed((m) => {
      siteOf(m, B).dependsOn = [A]
      setSiteDate(m, B, 'freezeStart', day('2027-03-12'))
      siteOf(m, A).actuals = { freezeStart: '2027-03-12' }
    })
    expect(checked(late)).toEqual([`rollout.dependency-order ${B}`])
    // B planned on A's day, but actually cut over the day after.
    const actual = changed((m) => {
      siteOf(m, B).dependsOn = [A]
      siteOf(m, B).actuals = { freezeStart: '2027-03-12' }
    })
    expect(checked(actual)).toEqual([])
  })

  it('takes an early actual over the plan, on both sides', () => {
    // A was planned for the 11th and cut over on the 9th: B, planned for the 10th, comes after it.
    const hubEarly = changed((m) => {
      siteOf(m, B).dependsOn = [A]
      setSiteDate(m, B, 'freezeStart', day('2027-03-10'))
      siteOf(m, A).actuals = { freezeStart: '2027-03-09' }
    })
    expect(checked(hubEarly)).toEqual([])
    // B was planned for the 12th, after A, and cut over on the 10th, before it.
    const spokeEarly = changed((m) => {
      siteOf(m, B).dependsOn = [A]
      setSiteDate(m, B, 'freezeStart', day('2027-03-12'))
      siteOf(m, B).actuals = { freezeStart: '2027-03-10' }
    })
    expect(checked(spokeEarly)).toEqual([`rollout.dependency-order ${B}`])
  })

  it('says it cannot judge a dependency on a site in no wave, or with no cutover date', () => {
    const noWave = changed((m) => delete siteOf(m, A).wave)
    expect(checked(noWave)).toEqual([
      `rollout.site-unassigned ${A}`,
      `rollout.dependency-unchecked ${C}`,
    ])
    expect(messages(noWave)[1]).toContain('which is in no wave')
    // A site in no wave is not placed by the plan, even with a cutover date of its own.
    const dated = changed((m) => {
      delete siteOf(m, A).wave
      setSiteDate(m, A, 'freezeStart', day('2027-01-04'))
    })
    expect(checked(dated)).toEqual([
      `rollout.site-unassigned ${A}`,
      `rollout.dependency-unchecked ${C}`,
    ])
    const undated = changed((m) => dropWaveDate(m, W1, 'freezeStart'))
    expect(checked(undated)).toEqual([
      `rollout.site-undated ${A}`,
      `rollout.site-undated ${B}`,
      `rollout.dependency-unchecked ${C}`,
    ])
    expect(messages(undated)[2]).toContain('which has no cutover date')
  })

  it('leaves a dependency on no site of the rollout, or on itself, to validate()', () => {
    const model = changed((m) => (siteOf(m, C).dependsOn = [C, 'loc-eu']))
    expect(checked(model)).toEqual([])
    expect(validate(model).findings.map((finding) => finding.code)).toEqual([
      'plan.site-dependency-self',
      'plan.site-dependency-unknown',
    ])
  })
})

describe('an expired exception', () => {
  const expiring = (expires: string) =>
    changed((m) => {
      const ex = siteOf(m, B).exceptions![0]!
      ex.expires = expires
    })

  it('holds through its last day and has expired from the next', () => {
    const model = expiring('2027-01-31')
    expect(checked(model, dayStart('2027-02-01') - 1)).toEqual([])
    expect(checked(model, dayStart('2027-02-01'))).toEqual([`rollout.exception-expired ${B}`])
  })

  it.each(['legal', 'operational', 'preference'] as const)(
    'has expired from the day after its last, as a %s exception',
    (kind) => {
      const model = changed((m) => {
        const ex = siteOf(m, B).exceptions![0]!
        ex.expires = '2027-01-31'
        ex.class = kind
      })
      expect(checked(model, dayStart('2027-02-01'))).toEqual([`rollout.exception-expired ${B}`])
    },
  )

  it('says a preference with no expiry, and lets a legal or operational one be open-ended', () => {
    const open = (kind: SiteException['class']) =>
      changed((m) => {
        const ex = siteOf(m, B).exceptions![0]!
        delete ex.expires
        ex.class = kind
      })
    expect(checked(open('preference'))).toEqual([`rollout.exception-no-expiry ${B}`])
    expect(messages(open('preference'))[0]).toBe(
      'Exception "ex-b" of site “Site B” (preference, owned by Ops) is a preference with no expiry, so it is never found expired.',
    )
    expect(checked(open('legal'))).toEqual([])
    expect(checked(open('operational'))).toEqual([])
  })
})

describe('a next-wave site still at coarse precision', () => {
  // Without the preset, so a quarter that starts before the mock loads does not fail them too.
  const coarse = (precision: PlanDate['precision'], at = NOW, actual?: string) =>
    checked(
      changed((m) => {
        withoutPreset(m)
        // After W1's mapping (4 January) and clear of the summer blackout.
        setSiteDate(m, A, 'freezeStart', { date: '2027-04-01', precision })
        setSiteDate(m, C, 'freezeStart', { date: '2027-10-01', precision })
        if (actual) siteOf(m, A).actuals = { freezeStart: actual }
      }),
      at,
    )

  it('is reported for a quarter in the next wave only', () => {
    expect(coarse('quarter')).toEqual([`rollout.next-wave-coarse ${A}`])
  })

  it('is not reported for a month', () => {
    expect(coarse('month')).toEqual([])
  })

  it('takes in the next wave once the first has started, and keeps the first', () => {
    // W1's mapping is signed off on 4 January: W1 is under way, W2 is next.
    expect(coarse('quarter', dayStart('2027-01-04') - 1)).toEqual([`rollout.next-wave-coarse ${A}`])
    expect(coarse('quarter', dayStart('2027-01-04'))).toEqual([
      `rollout.next-wave-coarse ${A}`,
      `rollout.next-wave-coarse ${C}`,
    ])
  })

  it('counts a wave as under way once one of its sites has started, while another is Planned', () => {
    // A signed its mapping off early; B is still Planned. W1 is under way, so W2 is next.
    const at = dayStart('2026-12-15')
    const model = changed((m) => {
      withoutPreset(m)
      setSiteDate(m, A, 'freezeStart', { date: '2027-04-01', precision: 'quarter' })
      setSiteDate(m, B, 'freezeStart', { date: '2027-04-01', precision: 'quarter' })
      setSiteDate(m, C, 'freezeStart', { date: '2027-10-01', precision: 'quarter' })
      siteOf(m, A).actuals = { mappingSignedOff: '2026-12-01' }
    })
    expect(checked(model, at)).toEqual([
      `rollout.next-wave-coarse ${A}`,
      `rollout.next-wave-coarse ${B}`,
      `rollout.next-wave-coarse ${C}`,
    ])
    expect(messages(model, at)[1]).toContain('is in W1, a wave under way, and its')
    expect(messages(model, at)[2]).toContain('is in W2, the next wave, and its')
  })

  it('takes in every wave when none is wholly Planned', () => {
    const model = changed((m) => {
      withoutPreset(m)
      setSiteDate(m, A, 'freezeStart', { date: '2027-04-01', precision: 'quarter' })
      setSiteDate(m, C, 'freezeStart', { date: '2027-10-01', precision: 'quarter' })
      siteOf(m, C).actuals = { mappingSignedOff: '2026-10-01' }
    })
    expect(checked(model, dayStart('2027-01-04'))).toEqual([
      `rollout.next-wave-coarse ${A}`,
      `rollout.next-wave-coarse ${C}`,
    ])
  })

  it('skips a wave with no sites', () => {
    const model = changed((m) => {
      withoutPreset(m)
      m.elements.push(wave('wp-w0', 'W0', 0, {}))
      setSiteDate(m, A, 'freezeStart', { date: '2027-04-01', precision: 'quarter' })
    })
    expect(checked(model)).toEqual([`rollout.next-wave-coarse ${A}`])
  })

  it('is not reported for a cutover with an actual day', () => {
    expect(coarse('quarter', NOW, '2027-04-02')).toEqual([])
  })
})

describe('a template change that applies to no site', () => {
  const intro = (applicability: TemplateChange['applicability']): TemplateChange => ({
    id: 'tc-intro',
    kind: 'introduce',
    subject: 'sys-cloud',
    date: { anchor: 'freezeStart', offsetDays: 0 },
    applicability,
  })

  it('is reported when no site matches its rule', () => {
    const model = changed((m) =>
      planOf(m).template.push(intro({ kind: 'aggregating', element: 'sys-cloud' })),
    )
    expect(checked(model)).toEqual([`rollout.change-applies-to-no-site ${ROLLOUT}`])
    expect(messages(model)[0]).toContain('no site matches its applicability')
  })

  it('is reported when every site it matches skips it, and not when one does not', () => {
    const skipAll = changed((m) => {
      planOf(m).template.push(intro({ kind: 'all' }))
      for (const site of planOf(m).sites) {
        site.exceptions = [
          ...(site.exceptions ?? []),
          exception({ id: `ex-skip-${site.location}`, kind: 'skip', change: 'tc-intro' }),
        ]
      }
    })
    expect(checked(skipAll)).toEqual([`rollout.change-applies-to-no-site ${ROLLOUT}`])
    expect(messages(skipAll)[0]).toContain('the 3 sites it applies to skip it')
    const oneLeft = changed((m) => {
      planOf(m).template.push(intro({ kind: 'all' }))
      for (const site of planOf(m).sites.slice(1)) {
        site.exceptions = [
          exception({ id: `ex-skip-${site.location}`, kind: 'skip', change: 'tc-intro' }),
        ]
      }
    })
    expect(checked(oneLeft)).toEqual([])
  })

  it('reads a skip of that change only', () => {
    const model = changed((m) => {
      planOf(m).template.push(intro({ kind: 'all' }))
      for (const site of planOf(m).sites) {
        site.exceptions = [
          exception({ id: `ex-skip-${site.location}`, kind: 'skip', change: 'tc-replace' }),
        ]
      }
    })
    // Every site skips the replace, none the introduce.
    expect(checked(model)).toEqual([`rollout.change-applies-to-no-site ${ROLLOUT}`])
    expect(messages(model)[0]).toContain('"tc-replace"')
  })
})

describe('appliesTo, one case per rule', () => {
  const site: SitePlan = { location: A, archetype: 'plant' }
  const aggregates = (location: string, target: string) => location === A && target === 'sys-legacy'
  it.each([
    [{ kind: 'all' } as const, true],
    [{ kind: 'archetypes', archetypes: ['plant'] } as const, true],
    [{ kind: 'archetypes', archetypes: ['office'] } as const, false],
    [{ kind: 'aggregating', element: 'sys-legacy' } as const, true],
    [{ kind: 'aggregating', element: 'sys-cloud' } as const, false],
  ])('%o is %s', (rule, expected) => {
    expect(appliesTo(rule as TemplateChange['applicability'], site, aggregates)).toBe(expected)
  })

  it('an archetype rule does not pick a site with no archetype', () => {
    expect(
      appliesTo({ kind: 'archetypes', archetypes: ['plant'] }, { location: A }, aggregates),
    ).toBe(false)
  })
})

describe('a site whose baseline lacks what a template change retires', () => {
  const withChange = (change: Partial<TemplateChange>, lacking = A) =>
    changed((m) => {
      planOf(m).template.push({
        id: 'tc-x',
        subject: 'sys-legacy',
        date: { anchor: 'hypercareEnd', offsetDays: 30 },
        applicability: { kind: 'all' },
        ...change,
      } as TemplateChange)
      m.relationships = m.relationships.filter(
        (r) => !(r.source === lacking && r.target === 'sys-legacy'),
      )
    })

  it.each([
    ['retire', { kind: 'retire' }, [`rollout.baseline-lacks-retired ${A}`]],
    [
      'replace',
      { kind: 'replace', successor: 'sys-cloud' },
      [`rollout.baseline-lacks-retired ${A}`],
    ],
    ['introduce', { kind: 'introduce' }, []],
    ['modify', { kind: 'modify', field: 'timeClassification', value: 'Eliminate' }, []],
  ] as const)('a %s is %s', (_, change, expected) => {
    expect(checked(withChange(change as Partial<TemplateChange>))).toEqual(expected)
  })

  it('is not reported at a site that skips the change', () => {
    const model = withChange({ kind: 'retire' })
    siteOf(model, A).exceptions = [exception({ kind: 'skip', change: 'tc-x' })]
    expect(checked(model)).toEqual([])
  })

  it('leaves a subject, or a site’s Location, that is not in the model to validate()', () => {
    const gone = withChange({ kind: 'retire', subject: 'sys-gone' })
    expect(checked(gone)).toEqual([])
    expect(validate(gone).findings.map((f) => f.code)).toEqual(['plan.template-subject-unknown'])
    const noLocation = changed((m) => {
      planOf(m).template.push({
        id: 'tc-x',
        kind: 'retire',
        subject: 'sys-legacy',
        date: { anchor: 'hypercareEnd', offsetDays: 30 },
        applicability: { kind: 'all' },
      })
      planOf(m).sites.push({ location: 'loc-gone', wave: W2 })
    })
    expect(checked(noLocation)).toEqual([])
  })
})

describe('the data-migration preset’s checks', () => {
  it('runs none of them for a rollout made from no preset', () => {
    const model = changed((m) => {
      withoutPreset(m)
      setSiteDate(m, A, 'mockLoad2', day('2027-03-20'))
      setSiteDate(m, A, 'reconciliationSignedOff', day('2027-04-20'))
      addBlackout(m, blackout('2027-03-13'))
      element(m, A).properties[RESIDENCY_FIELD] = 'continent'
    })
    expect(checked(model)).toEqual([])
  })

  it('runs the generic preset’s, which are none', () => {
    const model = changed((m) => {
      planOf(m).preset = 'generic'
      addBlackout(m, blackout('2027-03-13'))
    })
    expect(checked(model)).toEqual([])
  })

  describe('a milestone a check reads that the set no longer has', () => {
    const without = (...ids: string[]) =>
      changed((m) => {
        planOf(m).milestones = planOf(m).milestones.filter((x) => !ids.includes(x.id))
      })

    it.each([
      ['mockLoad2', 1],
      ['freezeStart', 1],
      ['reconciliationSignedOff', 2],
      ['hypercareEnd', 1],
    ])('%s is reported for each check that reads it', (id, count) => {
      const found = checked(without(id)).filter((f) => f.startsWith('rollout.preset-milestone'))
      expect(found).toEqual(Array(count).fill(`rollout.preset-milestone-missing ${ROLLOUT}`))
    })
  })

  describe('mock loads', () => {
    it('reports a mock load on the cutover day, and not the day before', () => {
      expect(checked(changed((m) => setSiteDate(m, A, 'mockLoad2', day('2027-03-11'))))).toEqual([
        `rollout.mock-loads ${A}`,
      ])
      expect(checked(changed((m) => setSiteDate(m, A, 'mockLoad2', day('2027-03-10'))))).toEqual([])
    })

    it('reports a mock load with no date', () => {
      const model = changed((m) => dropWaveDate(m, W1, 'mockLoad1'))
      expect(checked(model)).toEqual([`rollout.mock-loads ${A}`, `rollout.mock-loads ${B}`])
      expect(messages(model)[0]).toContain('1 of the 2 mock loads')
      expect(messages(model)[0]).toContain('Mock load 1 has no date')
    })

    it('takes an actual day over the plan, early or late, for the cutover and for each load', () => {
      // A cut over on 10 February, before its mock load 2 (15 February).
      const earlyCutover = changed((m) => (siteOf(m, A).actuals = { freezeStart: '2027-02-10' }))
      expect(checked(earlyCutover)).toEqual([`rollout.mock-loads ${A}`])
      // Mock load 2 is planned after the cutover, which actually happens later still.
      const lateCutover = changed((m) => {
        setSiteDate(m, A, 'mockLoad2', day('2027-03-12'))
        setSiteDate(m, A, 'reconciliationSignedOff', day('2027-03-25'))
        siteOf(m, A).actuals = { freezeStart: '2027-03-20' }
      })
      expect(checked(lateCutover)).toEqual([])
      // Mock load 2 is planned on the cutover day, and actually ran on 1 March.
      const earlyLoad = changed((m) => {
        setSiteDate(m, A, 'mockLoad2', day('2027-03-12'))
        siteOf(m, A).actuals = { mockLoad2: '2027-03-01' }
      })
      expect(checked(earlyLoad)).toEqual([])
      // Mock load 2 was planned in good time, and actually ran on the cutover day.
      const lateLoad = changed((m) => (siteOf(m, A).actuals = { mockLoad2: '2027-03-11' }))
      expect(checked(lateLoad)).toEqual([`rollout.mock-loads ${A}`])
    })

    it('counts the mock loads the milestone set still has', () => {
      const model = changed((m) => {
        planOf(m).milestones = planOf(m).milestones.filter((x) => x.id !== 'mockLoad2')
        dropWaveDate(m, W1, 'mockLoad1')
      })
      expect(checked(model)).toEqual([
        `rollout.preset-milestone-missing ${ROLLOUT}`,
        `rollout.mock-loads ${A}`,
        `rollout.mock-loads ${B}`,
      ])
      expect(messages(model)[1]).toContain('has 0 of the 1 mock load the milestone set still has')
    })

    it('reads each mock load the preset names', () => {
      expect(checked(changed((m) => setSiteDate(m, A, 'mockLoad1', day('2027-03-12'))))).toEqual([
        `rollout.mock-loads ${A}`,
      ])
    })
  })

  describe('the freeze', () => {
    it('is reported touching a blackout from its first day to reconciliation’s last', () => {
      // W1 freezes from 11 to 15 March; cutover is the 11th, so the 13th is the freeze only.
      expect(checked(changed((m) => addBlackout(m, blackout('2027-03-13'))))).toEqual([
        `rollout.freeze-in-blackout ${A}`,
        `rollout.freeze-in-blackout ${B}`,
      ])
      expect(checked(changed((m) => addBlackout(m, blackout('2027-03-15'))))).toHaveLength(2)
      expect(checked(changed((m) => addBlackout(m, blackout('2027-03-16'))))).toEqual([])
    })

    it('is reported on its first day, beside the cutover: neither check yields to the other', () => {
      expect(checked(changed((m) => addBlackout(m, blackout('2027-03-11'))))).toEqual([
        `rollout.cutover-in-blackout ${A}`,
        `rollout.cutover-in-blackout ${B}`,
        `rollout.freeze-in-blackout ${A}`,
        `rollout.freeze-in-blackout ${B}`,
      ])
    })

    it('says a freeze that ends before it starts is not checked, and judges one that ends on its first day', () => {
      const inverted = changed((m) =>
        setSiteDate(m, A, 'reconciliationSignedOff', day('2027-03-10')),
      )
      expect(checked(inverted)).toEqual([`rollout.freeze-unchecked ${A}`])
      expect(messages(inverted)[0]).toBe(
        'The freeze of site “Site A” ends 2027-03-10 (Reconciliation signed off), before it starts 2027-03-11 (Freeze starts), so it is not checked against blackouts.',
      )
      const oneDay = changed((m) => {
        setSiteDate(m, A, 'reconciliationSignedOff', day('2027-03-11'))
        siteOf(m, A).blackouts = [blackout('2027-03-11')]
      })
      expect(checked(oneDay)).toEqual([
        `rollout.cutover-in-blackout ${A}`,
        `rollout.freeze-in-blackout ${A}`,
      ])
    })

    it('takes an actual day over the plan, early or late, at either end, to tell an inverted freeze', () => {
      const inverted = (plan: Record<string, string>, actuals: Record<string, string>) =>
        checked(
          changed((m) => {
            for (const [id, date] of Object.entries(plan)) setSiteDate(m, A, id, day(date))
            siteOf(m, A).actuals = actuals
          }),
        )
      const unchecked = [`rollout.freeze-unchecked ${A}`]
      // Reconciliation, planned the 15th, actually signed off the 10th, before the freeze starts.
      expect(inverted({}, { reconciliationSignedOff: '2027-03-10' })).toEqual(unchecked)
      // The freeze, planned the 11th, actually starts the 16th, after reconciliation.
      expect(inverted({}, { freezeStart: '2027-03-16' })).toEqual(unchecked)
      // Reconciliation planned the 10th, before the freeze: actually signed off the 12th, after it.
      expect(
        inverted(
          { reconciliationSignedOff: '2027-03-10' },
          { reconciliationSignedOff: '2027-03-12' },
        ),
      ).toEqual([])
      // The same plan, and the freeze actually started the 9th, before reconciliation.
      expect(
        inverted({ reconciliationSignedOff: '2027-03-10' }, { freezeStart: '2027-03-09' }),
      ).toEqual([])
    })

    it('reads a site’s own blackouts for that site only', () => {
      const model = changed((m) => (siteOf(m, B).blackouts = [blackout('2027-03-13')]))
      expect(checked(model)).toEqual([`rollout.freeze-in-blackout ${B}`])
    })

    it('says it cannot judge a freeze whose end has no date', () => {
      const model = changed((m) => dropWaveDate(m, W2, 'reconciliationSignedOff'))
      expect(checked(model)).toEqual([
        `rollout.freeze-unchecked ${C}`,
        `rollout.reconciliation-unchecked ${C}`,
      ])
    })
  })

  describe('reconciliation', () => {
    it('is reported signed off on the day hypercare ends, and not the day before', () => {
      const on = changed((m) => setSiteDate(m, A, 'reconciliationSignedOff', day('2027-04-12')))
      expect(checked(on)).toEqual([`rollout.reconciliation-late ${A}`])
      const before = changed((m) => setSiteDate(m, A, 'reconciliationSignedOff', day('2027-04-11')))
      expect(checked(before)).toEqual([])
    })

    it('takes an actual day over the plan, early or late', () => {
      // Hypercare, planned to end 12 April, actually ended on the day of reconciliation.
      const model = changed((m) => (siteOf(m, A).actuals = { hypercareEnd: '2027-03-15' }))
      expect(checked(model)).toEqual([`rollout.reconciliation-late ${A}`])
      // Reconciliation, planned the 15th, was actually signed off on the day hypercare ends.
      const late = changed(
        (m) => (siteOf(m, A).actuals = { reconciliationSignedOff: '2027-04-12' }),
      )
      expect(checked(late)).toEqual([`rollout.reconciliation-late ${A}`])
    })

    it('says it cannot judge a site whose hypercare has no end date', () => {
      const model = changed((m) => dropWaveDate(m, W2, 'hypercareEnd'))
      expect(checked(model)).toEqual([`rollout.reconciliation-unchecked ${C}`])
    })
  })

  describe('residency', () => {
    const toGermany = (m: Workspace) =>
      (planOf(m).template[0] = { ...REPLACE, successor: 'sys-cloud-de' })

    it('is reported for each restricted site whose data leaves its country', () => {
      const model = changed(toGermany)
      expect(checked(model)).toEqual([
        `rollout.residency ${A}`,
        `rollout.residency ${B}`,
        `rollout.residency ${C}`,
      ])
      expect(messages(model)[0]).toBe(
        'Site “Site A” keeps its data in its country (Austria), and template change "tc-replace" moves it to “Frankfurt cloud store”, at “Frankfurt data centre”, outside it.',
      )
    })

    it('lets a region site’s data move within its region, and no further', () => {
      const region = changed((m) => {
        toGermany(m)
        element(m, A).properties[RESIDENCY_FIELD] = 'region'
        element(m, B).properties[RESIDENCY_FIELD] = 'none'
        element(m, C).properties[RESIDENCY_FIELD] = 'none'
      })
      expect(checked(region)).toEqual([])
      const outside = changed((m) => {
        toGermany(m)
        m.elements.push(location('loc-us', 'United States'), location('loc-dc-us', 'Virginia'))
        m.relationships = m.relationships.filter((r) => r.target !== 'sys-cloud-de')
        m.relationships.push(
          aggregation('loc-us', 'loc-dc-us'),
          aggregation('loc-dc-us', 'sys-cloud-de'),
        )
        element(m, A).properties[RESIDENCY_FIELD] = 'region'
        element(m, B).properties[RESIDENCY_FIELD] = 'none'
        element(m, C).properties[RESIDENCY_FIELD] = 'none'
      })
      expect(checked(outside)).toEqual([`rollout.residency ${A}`])
    })

    it('reads a site’s own replace, and not a change it skips', () => {
      const own = changed((m) => {
        siteOf(m, A).exceptions = [
          exception({
            kind: 'add',
            change: {
              id: 'site-a-replace',
              kind: 'replace',
              subject: 'sys-legacy',
              successor: 'sys-cloud-de',
              date: { anchor: 'freezeStart', offsetDays: 0 },
            },
          }),
        ]
      })
      expect(checked(own)).toEqual([`rollout.residency ${A}`])
      expect(messages(own)[0]).toContain('its exception "ex-x"')
      const skipped = changed((m) => {
        toGermany(m)
        for (const id of [A, B, C]) {
          if (id !== A) element(m, id).properties[RESIDENCY_FIELD] = 'none'
        }
        siteOf(m, A).exceptions = [exception({ kind: 'skip', change: 'tc-replace' })]
      })
      expect(checked(skipped)).toEqual([])
    })

    it('reads a purge or retain as keeping the data, and an archive or migrate as a move', () => {
      const disposed = (disposition: Disposition, change = 'tc-replace') =>
        checked(
          changed((m) => {
            toGermany(m)
            element(m, B).properties[RESIDENCY_FIELD] = 'none'
            element(m, C).properties[RESIDENCY_FIELD] = 'none'
            siteOf(m, A).exceptions = [exception({ kind: 'modify', change, disposition })]
          }),
        )
      expect(disposed('purge')).toEqual([])
      expect(disposed('retain')).toEqual([])
      expect(disposed('archive')).toEqual([`rollout.residency ${A}`])
      expect(disposed('migrate')).toEqual([`rollout.residency ${A}`])
      // Another change's purge keeps nothing of this one's data.
      expect(disposed('purge', 'tc-other')).toEqual([`rollout.residency ${A}`])
    })

    it('is one finding per site, naming every move out of its area', () => {
      const ownReplace = (successor: string) =>
        exception({
          kind: 'add',
          change: {
            id: 'site-a-replace',
            kind: 'replace',
            subject: 'sys-legacy',
            successor,
            date: { anchor: 'freezeStart', offsetDays: 0 },
          },
        })
      const both = changed((m) => {
        toGermany(m)
        element(m, B).properties[RESIDENCY_FIELD] = 'none'
        element(m, C).properties[RESIDENCY_FIELD] = 'none'
        siteOf(m, A).exceptions = [ownReplace('sys-cloud-de')]
      })
      expect(checked(both)).toEqual([`rollout.residency ${A}`])
      expect(messages(both)[0]).toBe(
        'Site “Site A” keeps its data in its country (Austria), and template change "tc-replace" moves it to “Frankfurt cloud store”, at “Frankfurt data centre”; its exception "ex-x" moves it to “Frankfurt cloud store”, at “Frankfurt data centre”, outside it.',
      )
      // A store no Location aggregates, reached twice by one site, names the site once.
      const unlocated = changed((m) => {
        m.elements.push(store('sys-nowhere', 'Nowhere store'))
        planOf(m).template[0] = { ...REPLACE, successor: 'sys-nowhere' }
        element(m, B).properties[RESIDENCY_FIELD] = 'none'
        element(m, C).properties[RESIDENCY_FIELD] = 'none'
        siteOf(m, A).exceptions = [ownReplace('sys-nowhere')]
      })
      expect(checked(unlocated)).toEqual(['rollout.residency-unchecked sys-nowhere'])
      expect(messages(unlocated)[0]).toContain('Site “Site A”, whose data must stay')
    })

    it('reads a template replace only at the sites it applies to', () => {
      const model = changed((m) => {
        toGermany(m)
        m.relationships = m.relationships.filter(
          (r) => !(r.source === A && r.target === 'sys-legacy'),
        )
      })
      expect(checked(model)).toEqual([`rollout.residency ${B}`, `rollout.residency ${C}`])
    })

    it('reports a store any of whose Locations is outside', () => {
      const model = changed((m) => m.relationships.push(aggregation('loc-dc-de', 'sys-cloud')))
      expect(checked(model)).toEqual([
        `rollout.residency ${A}`,
        `rollout.residency ${B}`,
        `rollout.residency ${C}`,
      ])
      expect(messages(model)[0]).toContain('at “Frankfurt data centre”, outside it')
    })

    it('locates a store by Locations only', () => {
      // A grouping that aggregates the Vienna store is not where it is.
      const model = changed((m) => {
        m.elements.push({ id: 'grp-cloud', type: 'Grouping', name: 'Cloud', properties: {} })
        m.relationships.push(aggregation('grp-cloud', 'sys-cloud'))
      })
      expect(checked(model)).toEqual([])
    })

    it('counts Aggregation only, for the areas and for the store', () => {
      const model = changed((m) => {
        toGermany(m)
        const toDe = m.relationships.find((r) => r.target === 'sys-cloud-de')!
        toDe.type = 'Association'
      })
      expect(checked(model)).toEqual([`rollout.residency-unchecked sys-cloud-de`])
    })

    it('says, once per store, that a store no Location aggregates is not checked', () => {
      const model = changed(
        (m) => (m.relationships = m.relationships.filter((r) => r.target !== 'sys-cloud')),
      )
      expect(checked(model)).toEqual([`rollout.residency-unchecked sys-cloud`])
      expect(messages(model)[0]).toBe(
        '3 sites whose data must stay in their country or region move it to “Vienna cloud store”, which no Location aggregates, so whether it stays there is not checked.',
      )
    })

    it('says a class it cannot read, and a site no Location places, are not checked', () => {
      const unreadable = changed((m) => (element(m, A).properties[RESIDENCY_FIELD] = 'continent'))
      expect(checked(unreadable)).toEqual([`rollout.residency-unchecked ${A}`])
      const unplaced = changed((m) => {
        m.relationships = m.relationships.filter((r) => r.target !== A)
      })
      expect(checked(unplaced)).toEqual([`rollout.residency-unchecked ${A}`])
      const noRegion = changed((m) => {
        element(m, A).properties[RESIDENCY_FIELD] = 'region'
        m.relationships = m.relationships.filter((r) => r.target !== 'loc-at')
      })
      expect(checked(noRegion)).toEqual([`rollout.residency-unchecked ${A}`])
    })

    it('says, once for the rollout, which sites have no class', () => {
      const model = changed((m) => {
        delete element(m, A).properties[RESIDENCY_FIELD]
        delete element(m, C).properties[RESIDENCY_FIELD]
      })
      expect(checked(model)).toEqual([`rollout.residency-unchecked ${ROLLOUT}`])
      expect(messages(model)[0]).toBe(
        `2 sites have no residency class (${RESIDENCY_FIELD}), so where their data may go is not checked: Site A, Site C.`,
      )
    })

    it('does not check a site with class none', () => {
      const model = changed((m) => {
        toGermany(m)
        for (const id of [A, B, C]) element(m, id).properties[RESIDENCY_FIELD] = 'none'
      })
      expect(checked(model)).toEqual([])
    })
  })
})
