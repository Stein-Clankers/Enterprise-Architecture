import { describe, expect, it } from 'vitest'
import {
  ROLLOUT_PRESETS,
  dayStart,
  presetPlan,
  resolveSiteMilestones,
  siteStatus,
  rolloutPlanOf,
  validate,
  wavePlanOf,
  wavesOf,
  type Element,
  type View,
} from '@/model'
import { toCanonicalJson } from '@/io'
import { ROLLOUT_ID, rolloutWorkspace, siteId, waveId } from '@/test/rollout-fixture'
import { ModelStore, ReadOnlyModelError } from './model-store'
import {
  addMilestone,
  addSites,
  assignSites,
  createRollout,
  createWave,
  deleteRollout,
  deleteWave,
  milestoneIdFor,
  milestoneUsage,
  moveMilestone,
  removeMilestone,
  removeSites,
  renameRollout,
  renameWave,
  setArchetype,
  setSiteMilestones,
  snapPlanDate,
  unassignSites,
  updateMilestone,
  updateWave,
} from './rollouts'
import { planCascadeText } from './removal'
import { describeCommand } from './commands'

/** The 160-site fixture, in a store. */
function store(): ModelStore {
  return new ModelStore(rolloutWorkspace(160))
}

/** Everything a command that is refused, or undone, must leave as it was. */
function state(s: ModelStore) {
  return { json: toCanonicalJson(s.snapshot()), history: s.history.length, dirty: s.dirty }
}

function plan(s: ModelStore, id = ROLLOUT_ID) {
  return rolloutPlanOf(s.element(id))!
}

/** A fresh rollout with two waves and two archetypes, and no sites. */
function freshRollout(s: ModelStore) {
  const rollout = createRollout(s, {
    name: 'Network refresh',
    milestones: [{ id: 'cutover', label: 'Cutover', startsPhase: 'cutover' }],
    archetypes: [
      { id: 'hub', label: 'Hub' },
      { id: 'spoke', label: 'Spoke' },
    ],
  })!
  const first = createWave(s, rollout.id, { name: 'Network W1', label: 'W1' })!
  const second = createWave(s, rollout.id, { name: 'Network W2', label: 'W2', capacity: 40 })!
  return { rollout, first, second }
}

const forty = Array.from({ length: 40 }, (_, i) => siteId(i + 1))

describe('creating, renaming and deleting a rollout (#209)', () => {
  it('creates a Work Package with a rollout plan at template version 1, as one step', () => {
    const s = store()
    const before = state(s)
    const rollout = createRollout(s, { name: 'Network refresh' })!
    expect(s.element(rollout.id)).toMatchObject({ type: 'WorkPackage', name: 'Network refresh' })
    expect(plan(s, rollout.id)).toEqual({
      kind: 'rollout',
      templateVersion: 1,
      milestones: [],
      template: [],
      archetypes: [],
      sites: [],
    })
    s.undo()
    expect(state(s).json).toBe(before.json)
  })

  it('refuses a rollout whose milestone set repeats an id, and stores nothing', () => {
    const s = store()
    const before = state(s)
    const milestone = { id: 'cutover', label: 'Cutover', startsPhase: 'cutover' } as const
    expect(createRollout(s, { name: 'Twice', milestones: [milestone, milestone] })).toBeUndefined()
    expect(state(s)).toEqual(before)
  })

  it('renames a rollout, and nothing that is not one', () => {
    const s = store()
    expect(renameRollout(s, ROLLOUT_ID, 'Data to the lake')).toBe(true)
    expect(s.element(ROLLOUT_ID)?.name).toBe('Data to the lake')
    const before = state(s)
    expect(renameRollout(s, waveId(1), 'Not a rollout')).toBe(false)
    expect(renameRollout(s, 'loc-emea', 'Not a rollout')).toBe(false)
    expect(state(s)).toEqual(before)
  })

  it('deletes a rollout with its waves, their relationships and drawings, as one step', () => {
    const s = store()
    const view: View = {
      id: 'view-plan',
      name: 'Plan',
      properties: {},
      nodes: [
        {
          id: 'n-r',
          kind: 'element',
          element: ROLLOUT_ID,
          bounds: { x: 0, y: 0, width: 120, height: 55 },
        },
        {
          id: 'n-w',
          kind: 'element',
          element: waveId(1),
          bounds: { x: 0, y: 100, width: 120, height: 55 },
        },
      ],
      connections: [
        {
          id: 'c-rw',
          kind: 'relationship',
          relationship: 'rel-rollout-wave-1',
          source: 'n-r',
          target: 'n-w',
        },
      ],
    }
    s.addView(view)
    const before = state(s)

    expect(deleteRollout(s, ROLLOUT_ID)).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    expect(s.element(ROLLOUT_ID)).toBeUndefined()
    expect(wavesOf(s.elements(), ROLLOUT_ID)).toEqual([])
    expect(s.relationship('rel-rollout-wave-1')).toBeUndefined()
    expect(s.view('view-plan')).toMatchObject({ nodes: [], connections: [] })

    s.undo()
    expect(state(s).json).toBe(before.json)
  })
})

describe('creating, renaming and deleting waves (#209)', () => {
  it('creates a wave aggregated by its rollout, locked to its template version, as one step', () => {
    const s = store()
    const before = state(s)
    const wave = createWave(s, ROLLOUT_ID, { name: 'Wave 5', label: 'W5' })!
    expect(s.history.length).toBe(before.history + 1)
    expect(wavePlanOf(wave)).toEqual({
      kind: 'wave',
      rollout: ROLLOUT_ID,
      label: 'W5',
      order: 5,
      templateVersion: 2,
    })
    expect(s.incoming(wave.id)).toEqual([
      expect.objectContaining({ type: 'Aggregation', source: ROLLOUT_ID, target: wave.id }),
    ])
    s.undo()
    expect(state(s).json).toBe(before.json)
  })

  it('refuses a wave for what is not a rollout, or with a capacity of nought', () => {
    const s = store()
    const before = state(s)
    expect(createWave(s, waveId(1), { name: 'X', label: 'X' })).toBeUndefined()
    expect(createWave(s, 'nope', { name: 'X', label: 'X' })).toBeUndefined()
    expect(createWave(s, ROLLOUT_ID, { name: 'X', label: 'X', capacity: 0 })).toBeUndefined()
    expect(state(s)).toEqual(before)
  })

  it('renames a wave, and nothing that is not one', () => {
    const s = store()
    expect(renameWave(s, waveId(1), 'First wave')).toBe(true)
    expect(s.element(waveId(1))?.name).toBe('First wave')
    expect(renameWave(s, ROLLOUT_ID, 'Not a wave')).toBe(false)
  })

  it('deletes a wave and unassigns its sites in the same step; the sites stay planned', () => {
    const s = store()
    const before = state(s)
    const inWave = plan(s).sites.filter((site) => site.wave === waveId(2))
    expect(inWave.length).toBeGreaterThan(0)

    expect(deleteWave(s, waveId(2))).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    expect(s.element(waveId(2))).toBeUndefined()
    const after = plan(s)
    expect(after.sites).toHaveLength(160)
    for (const site of inWave) {
      const now = after.sites.find((candidate) => candidate.location === site.location)!
      expect(now).toEqual(omitWave(site))
    }

    s.undo()
    expect(state(s).json).toBe(before.json)
  })

  it('a site whose wave is deleted after its freeze reads the phase of its actuals, never overdue (ADR 0016, amended)', () => {
    // Site 1 is in the pilot, froze on 2 March 2027 by its actual date, and
    // has no actual for reconciliation, which the pilot planned for 1 March.
    const s = store()
    const june = dayStart('2027-06-01')
    const status = () => {
      const site = plan(s).sites.find((candidate) => candidate.location === siteId(1))!
      const wave = site.wave === undefined ? undefined : wavePlanOf(s.element(site.wave))
      return siteStatus(plan(s), site, wave, june)
    }
    expect(status()).toMatchObject({ phase: 'migrated', overdue: true })
    expect(deleteWave(s, waveId(0))).toBe(true)
    // Unassigned, its dates kept (ADR 0015 point 6), and its actual freeze
    // starts Cutover: not Unplanned, and nothing it had planned is overdue.
    expect(status()).toMatchObject({ phase: 'cutover', overdue: false })
  })
})

function omitWave<T extends { wave?: string }>(site: T): Omit<T, 'wave'> {
  const { wave: _, ...rest } = site
  return rest
}

describe('assigning sites (#209)', () => {
  it('assigns forty sites to a wave as one command, and one undo puts all forty back', () => {
    const s = store()
    const { rollout, second } = freshRollout(s)
    const before = state(s)

    expect(assignSites(s, rollout.id, forty, second.id)).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    const assigned = plan(s, rollout.id).sites
    expect(assigned.map((site) => site.location)).toEqual(forty)
    expect(assigned.every((site) => site.wave === second.id)).toBe(true)

    s.undo()
    expect(state(s).json).toBe(before.json)
    s.redo()
    expect(plan(s, rollout.id).sites.filter((site) => site.wave === second.id)).toHaveLength(40)
  })

  it('moves sites between waves and keeps the rest of each plan', () => {
    const s = store()
    const site = siteId(12)
    const was = plan(s).sites.find((candidate) => candidate.location === site)!
    expect(assignSites(s, ROLLOUT_ID, [site], waveId(4))).toBe(true)
    expect(plan(s).sites.find((candidate) => candidate.location === site)).toEqual({
      ...was,
      wave: waveId(4),
    })
  })

  it('stores nothing for an empty <select> value, an unknown wave, or another rollout’s wave', () => {
    const s = store()
    const { first } = freshRollout(s)
    const before = state(s)
    for (const wave of ['', 'wp-nope', 'loc-emea', ROLLOUT_ID, first.id, undefined, null]) {
      expect(assignSites(s, ROLLOUT_ID, forty, wave), String(wave)).toBe(false)
      expect(state(s)).toEqual(before)
    }
  })

  it('assigns nothing when one of the ids is not a Location', () => {
    const s = store()
    const before = state(s)
    expect(assignSites(s, ROLLOUT_ID, [siteId(1), 'app-claims'], waveId(1))).toBe(false)
    expect(assignSites(s, ROLLOUT_ID, [siteId(1), 'nope'], waveId(1))).toBe(false)
    expect(assignSites(s, ROLLOUT_ID, [], waveId(1))).toBe(false)
    expect(state(s)).toEqual(before)
  })

  it('records nothing when every site is already in that wave', () => {
    const s = store()
    const before = state(s)
    expect(assignSites(s, ROLLOUT_ID, [siteId(1), siteId(2)], waveId(0))).toBe(true)
    expect(state(s)).toEqual(before)
  })

  it('unassigns sites as one command; they stay in the rollout', () => {
    const s = store()
    const before = state(s)
    expect(unassignSites(s, ROLLOUT_ID, forty)).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    const sites = plan(s).sites.filter((site) => forty.includes(site.location))
    expect(sites).toHaveLength(40)
    expect(sites.every((site) => site.wave === undefined)).toBe(true)
    s.undo()
    expect(state(s).json).toBe(before.json)
  })

  it('adds and removes sites, each as one command', () => {
    const s = store()
    const { rollout } = freshRollout(s)
    expect(addSites(s, rollout.id, [siteId(1), siteId(2)])).toBe(true)
    expect(plan(s, rollout.id).sites).toEqual([{ location: siteId(1) }, { location: siteId(2) }])
    expect(addSites(s, rollout.id, ['app-claims'])).toBe(false)
    const before = state(s)
    expect(removeSites(s, rollout.id, [siteId(1)])).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    expect(plan(s, rollout.id).sites).toEqual([{ location: siteId(2) }])
  })
})

describe('setting an archetype (#209)', () => {
  it('sets the archetype of many sites as one command, and clears it with null', () => {
    const s = store()
    const before = state(s)
    expect(setArchetype(s, ROLLOUT_ID, forty, 'plant')).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    const sites = () => plan(s).sites.filter((site) => forty.includes(site.location))
    expect(sites().every((site) => site.archetype === 'plant')).toBe(true)
    expect(setArchetype(s, ROLLOUT_ID, forty, null)).toBe(true)
    expect(sites().every((site) => site.archetype === undefined)).toBe(true)
    s.undo()
    s.undo()
    expect(state(s).json).toBe(before.json)
  })

  it('stores nothing for an empty value or an archetype the rollout does not define', () => {
    const s = store()
    const before = state(s)
    for (const archetype of ['', 'warehouse', 'Plant', undefined]) {
      expect(setArchetype(s, ROLLOUT_ID, forty, archetype), String(archetype)).toBe(false)
      expect(state(s)).toEqual(before)
    }
  })
})

describe('deleting a Location (#209)', () => {
  it('never drops its plan: the plan stays, and validate() reports it', () => {
    const s = store()
    const before = plan(s).sites.find((site) => site.location === siteId(5))!
    expect(validate(s.snapshot()).findings).toEqual([])

    s.removeElement(siteId(5))
    expect(s.element(siteId(5))).toBeUndefined()
    expect(plan(s).sites.find((site) => site.location === siteId(5))).toEqual(before)
    expect(validate(s.snapshot()).findings).toEqual([
      expect.objectContaining({ code: 'plan.site-location-missing', subjectId: ROLLOUT_ID }),
    ])
  })

  it('still reassigns, and unassigns, a site whose Location is gone (#222)', () => {
    const s = store()
    s.removeElement(siteId(5))
    const before = state(s)

    expect(assignSites(s, ROLLOUT_ID, [siteId(5)], waveId(3))).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    expect(plan(s).sites.find((site) => site.location === siteId(5))?.wave).toBe(waveId(3))
    // A gone Location is still refused for a site the rollout does not hold.
    s.removeElement(siteId(6))
    expect(removeSites(s, ROLLOUT_ID, [siteId(6)])).toBe(true)
    const refused = state(s)
    expect(assignSites(s, ROLLOUT_ID, [siteId(6)], waveId(3))).toBe(false)
    expect(state(s)).toEqual(refused)
  })
})

describe('deleting a plan element anywhere cascades the plan (#222)', () => {
  it('Delete on a wave, through removeElement, unassigns its sites in the same step', () => {
    const s = store()
    const before = state(s)
    const inWave = plan(s).sites.filter((site) => site.wave === waveId(2))
    expect(inWave.length).toBeGreaterThan(0)

    s.removeElement(waveId(2))
    expect(s.history.length).toBe(before.history + 1)
    expect(s.element(waveId(2))).toBeUndefined()
    expect(plan(s).sites.filter((site) => site.wave === waveId(2))).toEqual([])
    expect(plan(s).sites).toHaveLength(160)
    expect(validate(s.snapshot()).findings).toEqual([])

    s.undo()
    expect(state(s).json).toBe(before.json)
  })

  it('Delete on a rollout, through removeElement, takes its waves with it', () => {
    const s = store()
    const before = state(s)
    s.removeElement(ROLLOUT_ID)
    expect(s.history.length).toBe(before.history + 1)
    expect(s.element(ROLLOUT_ID)).toBeUndefined()
    expect(wavesOf(s.elements(), ROLLOUT_ID)).toEqual([])
    expect(validate(s.snapshot()).findings).toEqual([])

    s.undo()
    expect(state(s).json).toBe(before.json)
  })

  it('a wave deleted with its rollout needs no unassignment of the rollout it goes with', () => {
    const s = store()
    const commands = s.removalCommands([waveId(1), ROLLOUT_ID])
    expect(commands.every((command) => command.kind === 'remove-element')).toBe(true)
    expect(commands).toHaveLength(1 + 5)
  })
})

describe('editing a wave (#211)', () => {
  it('changes name, label, window and capacity as one command, and undoes as one', () => {
    const s = store()
    const before = state(s)
    const window = {
      start: { date: '2027-04-01', precision: 'quarter' },
      end: { date: '2027-05-10', precision: 'week' },
    } as const
    expect(
      updateWave(s, waveId(1), { name: 'First wave', label: 'W1a', window, capacity: 12 }),
    ).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    expect(s.element(waveId(1))?.name).toBe('First wave')
    expect(wavePlanOf(s.element(waveId(1)))).toMatchObject({ label: 'W1a', window, capacity: 12 })
    s.undo()
    expect(state(s).json).toBe(before.json)
  })

  it('clears the window with {} and the capacity with null', () => {
    const s = store()
    expect(updateWave(s, waveId(0), { window: {}, capacity: null })).toBe(true)
    const wave = wavePlanOf(s.element(waveId(0)))!
    expect('window' in wave).toBe(false)
    expect('capacity' in wave).toBe(false)
  })

  it('refuses a capacity of nought, an unaligned date, an end before the start, or no wave', () => {
    const s = store()
    const before = state(s)
    expect(updateWave(s, waveId(1), { capacity: 0 })).toBe(false)
    expect(
      updateWave(s, waveId(1), { window: { start: { date: '2027-05-12', precision: 'week' } } }),
    ).toBe(false)
    expect(
      updateWave(s, waveId(1), {
        window: {
          start: { date: '2027-06-01', precision: 'month' },
          end: { date: '2027-05-01', precision: 'month' },
        },
      }),
    ).toBe(false)
    expect(updateWave(s, ROLLOUT_ID, { label: 'X' })).toBe(false)
    expect(state(s)).toEqual(before)
  })

  it('records nothing when nothing changes', () => {
    const s = store()
    const before = state(s)
    expect(updateWave(s, waveId(1), { label: 'W1' })).toBe(true)
    expect(state(s)).toEqual(before)
  })

  it('takes a window whose end period runs past its start, though the end’s first day is earlier (#223)', () => {
    const s = store()
    // 2027-W14 starts Monday 5 April; 2027-Q2 starts 1 April and runs to June.
    const window = {
      start: { date: '2027-04-05', precision: 'week' },
      end: { date: '2027-04-01', precision: 'quarter' },
    } as const
    expect(updateWave(s, waveId(1), { window })).toBe(true)
    expect(wavePlanOf(s.element(waveId(1)))?.window).toEqual(window)
    // And an end period over before the start begins is still refused.
    const before = state(s)
    expect(
      updateWave(s, waveId(1), {
        window: {
          start: { date: '2027-04-05', precision: 'week' },
          end: { date: '2027-03-01', precision: 'month' },
        },
      }),
    ).toBe(false)
    expect(state(s)).toEqual(before)
  })
})

describe('what a delete would do, read off its commands (#223)', () => {
  it('a rollout: its waves and its site plans go with it', () => {
    const s = store()
    const preview = s.removalPreview(ROLLOUT_ID)
    expect(preview).toEqual({
      relationships: s.relationshipsOf(ROLLOUT_ID).length,
      waves: 5,
      sitePlans: 160,
      unassigned: 0,
      askedWaves: 0,
    })
    expect(planCascadeText(preview, 'asked')).toBe(
      'Its 5 waves go with it, and its 160 site plans are removed.',
    )
    expect(planCascadeText(preview, 'done')).toBe(
      'Its 5 waves went with it, and its 160 site plans were removed.',
    )
  })

  it('a wave: its sites stay in the rollout, unassigned', () => {
    const s = store()
    const inWave = plan(s).sites.filter((site) => site.wave === waveId(2)).length
    const preview = s.removalPreview(waveId(2))
    expect(preview).toMatchObject({ waves: 0, sitePlans: 0, unassigned: inWave, askedWaves: 1 })
    expect(planCascadeText(preview, 'asked')).toBe(
      `Its ${inWave} sites stay in the rollout, unassigned, with their dates.`,
    )
    // One site, in the singular; none, said as such.
    expect(planCascadeText({ ...preview, unassigned: 1 }, 'asked')).toBe(
      'Its 1 site stays in the rollout, unassigned, with its dates.',
    )
    expect(planCascadeText({ ...preview, unassigned: 0 }, 'asked')).toBe('No site is in it.')
    expect(planCascadeText({ ...preview, unassigned: 0 }, 'done')).toBe('')
  })

  it('anything else: its relationships, and nothing about plans', () => {
    const s = store()
    const preview = s.removalPreview('app-claims')
    expect(preview).toEqual({
      relationships: s.relationshipsOf('app-claims').length,
      waves: 0,
      sitePlans: 0,
      unassigned: 0,
      askedWaves: 0,
    })
    expect(planCascadeText(preview, 'asked')).toBe('')
  })

  it('is what removeElement does: the rollout delete and deleteRollout dispatch the same', () => {
    const s = store()
    const viaCommand = store()
    s.removeElement(ROLLOUT_ID)
    deleteRollout(viaCommand, ROLLOUT_ID)
    expect(state(viaCommand)).toEqual(state(s))
  })
})

describe('snapping a form’s plan date to its period (#222, ADR 0015)', () => {
  it.each([
    ['2027-05-12', 'week', '2027-05-10'],
    ['2027-05-10', 'week', '2027-05-10'],
    ['2027-01-01', 'week', '2026-12-28'],
    ['2027-05-12', 'month', '2027-05-01'],
    ['2027-05-12', 'quarter', '2027-04-01'],
    ['2027-12-31', 'quarter', '2027-10-01'],
    ['2027-05-12', 'day', '2027-05-12'],
  ] as const)('%s at %s precision is the period starting %s', (day, precision, start) => {
    expect(snapPlanDate(day, precision)).toEqual({ date: start, precision })
  })

  it('names no period for an empty field, a day that is not one, or an unknown precision', () => {
    for (const [day, precision] of [
      ['', 'week'],
      ['2027-02-30', 'day'],
      ['2027-05-12', ''],
      ['2027-05-12', 'year'],
      [undefined, 'month'],
    ]) {
      expect(snapPlanDate(day, precision), `${day} ${precision}`).toBeUndefined()
    }
  })
})

describe('as a reader (#209)', () => {
  /** Every rollout command, each with arguments it would accept as a writer. */
  const commands: [string, (s: ModelStore) => unknown][] = [
    ['createRollout', (s) => createRollout(s, { name: 'R' })],
    ['renameRollout', (s) => renameRollout(s, ROLLOUT_ID, 'R')],
    ['deleteRollout', (s) => deleteRollout(s, ROLLOUT_ID)],
    ['createWave', (s) => createWave(s, ROLLOUT_ID, { name: 'W', label: 'W' })],
    ['renameWave', (s) => renameWave(s, waveId(1), 'W')],
    ['deleteWave', (s) => deleteWave(s, waveId(1))],
    ['addSites', (s) => addSites(s, ROLLOUT_ID, ['loc-emea'])],
    ['removeSites', (s) => removeSites(s, ROLLOUT_ID, [siteId(1)])],
    ['assignSites', (s) => assignSites(s, ROLLOUT_ID, forty, waveId(3))],
    ['unassignSites', (s) => unassignSites(s, ROLLOUT_ID, forty)],
    ['setArchetype', (s) => setArchetype(s, ROLLOUT_ID, forty, 'plant')],
    ['updateWave', (s) => updateWave(s, waveId(1), { capacity: 9 })],
    ['addMilestone', (s) => addMilestone(s, ROLLOUT_ID, { label: 'Go', startsPhase: 'cutover' })],
    ['updateMilestone', (s) => updateMilestone(s, ROLLOUT_ID, 'freezeStart', { label: 'F' })],
    ['moveMilestone', (s) => moveMilestone(s, ROLLOUT_ID, 'freezeStart', 1)],
    ['removeMilestone', (s) => removeMilestone(s, ROLLOUT_ID, 'legacyDecommissioned')],
    [
      'setSiteMilestones',
      (s) => setSiteMilestones(s, ROLLOUT_ID, siteId(4), { freezeStart: null }),
    ],
  ]

  it.each(commands)('%s works for a writer', (_, command) => {
    const s = store()
    const before = state(s)
    command(s)
    expect(state(s).json).not.toBe(before.json)
  })

  it.each(commands)('%s throws ReadOnlyModelError and changes nothing', (_, command) => {
    const s = store()
    s.setWritable(false)
    const before = state(s)
    expect(() => command(s)).toThrow(ReadOnlyModelError)
    expect(state(s)).toEqual(before)
  })

  it.each(commands)(
    '%s throws for a reader even when it would find nothing to do',
    (_, command) => {
      const s = new ModelStore({
        ...rolloutWorkspace(0),
        elements: [] as Element[],
        relationships: [],
      })
      s.setWritable(false)
      expect(() => command(s)).toThrow(ReadOnlyModelError)
    },
  )

  /**
   * Every command, each with arguments it refuses as a writer. A command that
   * refuses dispatches nothing, so the store's own refusal never runs: only
   * the command's check can say "read-only" instead of a quiet `false`.
   */
  const refused: [string, (s: ModelStore) => unknown][] = [
    ['createRollout', (s) => createRollout(s, { name: 1 as unknown as string })],
    ['renameRollout', (s) => renameRollout(s, waveId(1), 'R')],
    ['deleteRollout', (s) => deleteRollout(s, waveId(1))],
    ['createWave', (s) => createWave(s, waveId(1), { name: 'W', label: 'W' })],
    ['renameWave', (s) => renameWave(s, ROLLOUT_ID, 'W')],
    ['deleteWave', (s) => deleteWave(s, ROLLOUT_ID)],
    ['addSites', (s) => addSites(s, ROLLOUT_ID, [])],
    ['removeSites', (s) => removeSites(s, ROLLOUT_ID, [])],
    ['assignSites', (s) => assignSites(s, ROLLOUT_ID, forty, '')],
    ['unassignSites', (s) => unassignSites(s, 'nope', forty)],
    ['setArchetype', (s) => setArchetype(s, ROLLOUT_ID, forty, 'warehouse')],
    ['updateWave', (s) => updateWave(s, ROLLOUT_ID, { capacity: 9 })],
    ['addMilestone', (s) => addMilestone(s, ROLLOUT_ID, { label: 'Go', startsPhase: '' })],
    ['updateMilestone', (s) => updateMilestone(s, ROLLOUT_ID, 'freezeStart', { startsPhase: '' })],
    ['moveMilestone', (s) => moveMilestone(s, ROLLOUT_ID, 'nope', 1)],
    ['removeMilestone', (s) => removeMilestone(s, ROLLOUT_ID, 'freezeStart')],
    [
      'setSiteMilestones',
      (s) =>
        setSiteMilestones(s, ROLLOUT_ID, siteId(4), {
          freezeStart: { date: '2027-05-10', precision: '' },
        }),
    ],
  ]

  it.each(refused)('%s refuses this input as a writer', (_, command) => {
    const s = store()
    const before = state(s)
    expect(command(s)).toBeFalsy()
    expect(state(s)).toEqual(before)
  })

  it.each(refused)('%s throws for a reader even on input it would refuse', (_, command) => {
    const s = store()
    s.setWritable(false)
    expect(() => command(s)).toThrow(ReadOnlyModelError)
  })
})

describe('what each command refuses, and what it records nothing for (#209)', () => {
  it('refuses each command on what is not its kind of plan, and stores nothing', () => {
    const s = store()
    const before = state(s)
    expect(deleteRollout(s, waveId(1))).toBe(false)
    expect(deleteWave(s, ROLLOUT_ID)).toBe(false)
    expect(setArchetype(s, waveId(1), forty, 'plant')).toBe(false)
    expect(removeSites(s, waveId(1), forty)).toBe(false)
    expect(removeSites(s, ROLLOUT_ID, [])).toBe(false)
    expect(unassignSites(s, 'nope', forty)).toBe(false)
    expect(addSites(s, ROLLOUT_ID, [])).toBe(false)
    expect(state(s)).toEqual(before)
  })

  it('records nothing for a site that is not in the rollout', () => {
    const s = store()
    const before = state(s)
    expect(unassignSites(s, ROLLOUT_ID, ['loc-emea'])).toBe(true)
    expect(setArchetype(s, ROLLOUT_ID, ['loc-emea'], 'plant')).toBe(true)
    expect(removeSites(s, ROLLOUT_ID, ['loc-emea'])).toBe(true)
    expect(state(s)).toEqual(before)
  })

  it('creates a rollout with constraints and a wave with a window', () => {
    const s = store()
    const rollout = createRollout(s, { name: 'R', constraints: { defaultCapacity: 20 } })!
    expect(plan(s, rollout.id).constraints).toEqual({ defaultCapacity: 20 })
    const window = { start: { date: '2027-04-01', precision: 'quarter' } } as const
    const wave = createWave(s, rollout.id, { name: 'W', label: 'W', window })!
    expect(wavePlanOf(s.element(wave.id))?.window).toEqual(window)
    const before = state(s)
    const unaligned = { start: { date: '2027-05-01', precision: 'quarter' } } as const
    expect(createWave(s, rollout.id, { name: 'W', label: 'W', window: unaligned })).toBeUndefined()
    expect(state(s)).toEqual(before)
  })

  it('deletes a wave no site is in as the wave’s removal alone', () => {
    const s = store()
    const wave = createWave(s, ROLLOUT_ID, { name: 'Spare', label: 'W9' })!
    expect(deleteWave(s, wave.id)).toBe(true)
    expect(s.history.at(-1)?.command.kind).toBe('remove-element')
  })
})

// ── #213: milestone sets, site overrides and wave dates ──────────────────────

const freeze = (s: ModelStore, n: number) => {
  const p = plan(s)
  const site = p.sites.find((candidate) => candidate.location === siteId(n))!
  const wave = site.wave === undefined ? undefined : wavePlanOf(s.element(site.wave))
  return resolveSiteMilestones(p, site, wave).find((r) => r.milestone.id === 'freezeStart')!
}

/** Reconciliation, used by a site's date and actual, two waves and an archetype. */
function reconciliationInUse(): ModelStore {
  const workspace = rolloutWorkspace(160)
  const rollout = rolloutPlanOf(workspace.elements.find((e) => e.id === ROLLOUT_ID))!
  rollout.archetypes.find((a) => a.id === 'plant')!.durations!.reconciliationSignedOff = 7
  const site = rollout.sites.find((candidate) => candidate.location === siteId(1))!
  site.actuals = { ...site.actuals, reconciliationSignedOff: '2027-03-04' }
  const five = rollout.sites.find((candidate) => candidate.location === siteId(5))!
  five.milestones = { reconciliationSignedOff: { date: '2027-05-01', precision: 'month' } }
  return new ModelStore(workspace)
}

describe('milestone sets (#213)', () => {
  it('a rollout made from a preset starts with its milestones and a Standard archetype of its durations', () => {
    const s = store()
    const preset = ROLLOUT_PRESETS.dataMigration
    const rollout = createRollout(s, { name: 'Data', ...presetPlan(preset) })!
    expect(plan(s, rollout.id).milestones).toEqual(preset.milestones)
    expect(plan(s, rollout.id).archetypes).toEqual([
      { id: 'standard', label: 'Standard (placeholder)', durations: preset.durations },
    ])
  })

  it('adds a milestone with an id made from its label, unique in the set, one command each', () => {
    const s = store()
    const before = state(s)
    expect(addMilestone(s, ROLLOUT_ID, { label: ' Go/no-go ', startsPhase: 'preparing' })).toBe(
      'goNoGo',
    )
    expect(addMilestone(s, ROLLOUT_ID, { label: 'Go/No-Go', startsPhase: 'cutover' })).toBe(
      'goNoGo2',
    )
    expect(addMilestone(s, ROLLOUT_ID, { label: '— · —', startsPhase: 'done' })).toBe('milestone')
    expect(s.history.length).toBe(before.history + 3)
    expect(plan(s).milestones.at(-3)).toEqual({
      id: 'goNoGo',
      label: 'Go/no-go',
      startsPhase: 'preparing',
    })
  })

  it('refuses a milestone with no label, or with an empty phase, and stores nothing', () => {
    const s = store()
    const before = state(s)
    expect(addMilestone(s, ROLLOUT_ID, { label: ' ', startsPhase: 'cutover' })).toBeUndefined()
    expect(addMilestone(s, ROLLOUT_ID, { label: 'Go', startsPhase: '' })).toBeUndefined()
    expect(addMilestone(s, ROLLOUT_ID, { label: 'Go', startsPhase: 'unplanned' })).toBeUndefined()
    expect(addMilestone(s, waveId(1), { label: 'Go', startsPhase: 'cutover' })).toBeUndefined()
    expect(state(s)).toEqual(before)
  })

  it('edits a label, a phase and the rollout’s date as one command, and null clears the date', () => {
    const s = store()
    const before = state(s)
    const q3 = { date: '2027-07-01', precision: 'quarter' } as const
    expect(
      updateMilestone(s, ROLLOUT_ID, 'freezeStart', {
        label: 'Freeze',
        startsPhase: 'hypercare',
        date: q3,
      }),
    ).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    expect(plan(s).milestones[2]).toEqual({
      id: 'freezeStart',
      label: 'Freeze',
      startsPhase: 'hypercare',
      date: q3,
    })
    expect(updateMilestone(s, ROLLOUT_ID, 'freezeStart', { date: null })).toBe(true)
    expect(plan(s).milestones[2]).not.toHaveProperty('date')
    s.undo()
    s.undo()
    expect(state(s).json).toBe(before.json)
  })

  it('records nothing for an edit that changes nothing, and refuses a bad one', () => {
    const s = store()
    const before = state(s)
    expect(updateMilestone(s, ROLLOUT_ID, 'freezeStart', { label: 'Freeze starts' })).toBe(true)
    const legacy = plan(s).milestones.at(-1)!
    expect(updateMilestone(s, ROLLOUT_ID, legacy.id, { date: { ...legacy.date! } })).toBe(true)
    expect(state(s)).toEqual(before)
    expect(updateMilestone(s, ROLLOUT_ID, 'freezeStart', { label: '' })).toBe(false)
    expect(updateMilestone(s, ROLLOUT_ID, 'freezeStart', { startsPhase: '' })).toBe(false)
    expect(
      updateMilestone(s, ROLLOUT_ID, 'freezeStart', {
        date: { date: '2027-07-02', precision: 'quarter' },
      }),
    ).toBe(false)
    expect(updateMilestone(s, ROLLOUT_ID, 'nope', { label: 'X' })).toBe(false)
    expect(state(s)).toEqual(before)
  })

  it('moves a milestone one place, as one command, and does nothing at either end', () => {
    const s = store()
    const before = state(s)
    expect(moveMilestone(s, ROLLOUT_ID, 'freezeStart', 1)).toBe(true)
    expect(
      plan(s)
        .milestones.map((m) => m.id)
        .slice(0, 4),
    ).toEqual(['mappingSignedOff', 'constructor', 'reconciliationSignedOff', 'freezeStart'])
    expect(s.history.length).toBe(before.history + 1)
    expect(moveMilestone(s, ROLLOUT_ID, 'freezeStart', -1)).toBe(true)
    expect(plan(s).milestones.map((m) => m.id)[2]).toBe('freezeStart')
    const moved = state(s)
    expect(moveMilestone(s, ROLLOUT_ID, 'mappingSignedOff', -1)).toBe(true)
    expect(moveMilestone(s, ROLLOUT_ID, 'legacyDecommissioned', 1)).toBe(true)
    expect(state(s)).toEqual(moved)
    expect(moveMilestone(s, ROLLOUT_ID, 'nope', 1)).toBe(false)
  })

  it('says what uses a milestone: sites, waves, archetypes and anchored template changes', () => {
    const s = store()
    const p = plan(s)
    const sites = p.sites.filter(
      (site) => site.milestones?.freezeStart !== undefined || site.actuals?.freezeStart,
    ).length
    expect(sites).toBeGreaterThan(2)
    expect(milestoneUsage(s, ROLLOUT_ID, 'freezeStart')).toEqual({
      sites,
      waves: 4,
      // Plant's, and the Standard archetype the preset seeds.
      archetypes: 2,
      anchoredChanges: ['tc-replace-store'],
    })
    expect(milestoneUsage(s, ROLLOUT_ID, 'legacyDecommissioned')).toEqual({
      sites: 0,
      waves: 0,
      archetypes: 1,
      anchoredChanges: [],
    })
  })

  it('deletes a milestone with every date and duration for it, as one command one undo puts back', () => {
    const s = reconciliationInUse()
    const before = state(s)
    expect(milestoneUsage(s, ROLLOUT_ID, 'reconciliationSignedOff')).toEqual({
      sites: 2,
      waves: 2,
      archetypes: 2,
      anchoredChanges: [],
    })
    expect(removeMilestone(s, ROLLOUT_ID, 'reconciliationSignedOff')).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    const p = plan(s)
    expect(p.milestones.map((m) => m.id)).not.toContain('reconciliationSignedOff')
    expect(JSON.stringify(p)).not.toContain('reconciliationSignedOff')
    expect(JSON.stringify(s.snapshot())).not.toContain('reconciliationSignedOff')
    // Site 5 had only that date: it has no dates left, not an empty record.
    expect(p.sites.find((site) => site.location === siteId(5))).not.toHaveProperty('milestones')
    expect(validate(s.snapshot()).findings).toEqual([])
    s.undo()
    expect(state(s).json).toBe(before.json)
  })

  it('refuses to delete a milestone a template change is anchored on, or one not in the set', () => {
    const s = store()
    const before = state(s)
    expect(removeMilestone(s, ROLLOUT_ID, 'freezeStart')).toBe(false)
    expect(removeMilestone(s, ROLLOUT_ID, 'nope')).toBe(false)
    expect(removeMilestone(s, waveId(1), 'freezeStart')).toBe(false)
    expect(state(s)).toEqual(before)
  })

  it('makes an id from the label’s words, and a free one when it is taken', () => {
    expect(milestoneIdFor('Hypercare ends', [])).toBe('hypercareEnds')
    expect(milestoneIdFor('UAT 2 sign-off', [])).toBe('uat2SignOff')
    const taken = [
      { id: 'cutover', label: 'C', startsPhase: 'cutover' },
      { id: 'cutover2', label: 'C', startsPhase: 'cutover' },
    ] as const
    expect(milestoneIdFor('Cutover', [...taken])).toBe('cutover3')
  })

  it('keeps the letters of any script in an id: “Übergabe” is übergabe', () => {
    expect(milestoneIdFor('Übergabe', [])).toBe('übergabe')
    expect(milestoneIdFor('Go-live Zürich 2', [])).toBe('goLiveZürich2')
    expect(milestoneIdFor('Constructor', [])).toBe('constructor')
    // Decomposed (U, then U+0308 COMBINING DIAERESIS) is the same id as composed.
    expect('U\u0308bergabe').not.toBe('Übergabe')
    expect(milestoneIdFor('U\u0308bergabe', [])).toBe('übergabe')
    // A mark with no composed form stays in its word: Hindi's vowel signs.
    expect(milestoneIdFor('हिन्दी', [])).toBe('हिन्दी')
  })
})

describe('the history names the milestone each command touched (#229 review)', () => {
  const label = (s: ModelStore) => s.history.at(-1)!.label
  const ROLLOUT = '“Local data to the central lake”'

  it('adding, editing and moving a milestone', () => {
    const s = store()
    addMilestone(s, ROLLOUT_ID, { label: 'Go/no-go', startsPhase: 'preparing' })
    expect(label(s)).toBe(`Added milestone “Go/no-go” to ${ROLLOUT}`)
    updateMilestone(s, ROLLOUT_ID, 'freezeStart', { label: 'Freeze' })
    expect(label(s)).toBe(`Updated milestone “Freeze” of ${ROLLOUT}`)
    updateMilestone(s, ROLLOUT_ID, 'freezeStart', {
      date: { date: '2027-07-01', precision: 'quarter' },
    })
    expect(label(s)).toBe(`Updated milestone “Freeze” of ${ROLLOUT}`)
    moveMilestone(s, ROLLOUT_ID, 'freezeStart', 1)
    expect(label(s)).toBe(
      `Moved milestone “Freeze” after “Reconciliation signed off” in ${ROLLOUT}`,
    )
    // Moving the other one earlier is the same swap, and says the same.
    moveMilestone(s, ROLLOUT_ID, 'freezeStart', -1)
    expect(label(s)).toBe(
      `Moved milestone “Reconciliation signed off” after “Freeze” in ${ROLLOUT}`,
    )
  })

  it('deleting a milestone nothing else uses', () => {
    const s = store()
    // Not Go/no-go: the Standard archetype spaces that one.
    addMilestone(s, ROLLOUT_ID, { label: 'Board sign-off', startsPhase: 'preparing' })
    removeMilestone(s, ROLLOUT_ID, 'boardSignOff')
    expect(label(s)).toBe(`Deleted milestone “Board sign-off” from ${ROLLOUT}`)
  })

  it('deleting a milestone with its sites’, waves’ and archetypes’ dates, which is a batch', () => {
    const s = reconciliationInUse()
    removeMilestone(s, ROLLOUT_ID, 'reconciliationSignedOff')
    expect(s.history.at(-1)!.command.kind).toBe('batch')
    expect(label(s)).toBe(
      `Deleted milestone “Reconciliation signed off” from ${ROLLOUT}, with its dates on 2 sites and 2 waves and its durations in 2 archetypes`,
    )
  })

  it('deleting a milestone only waves date, and one only an archetype spaces', () => {
    const s = store()
    removeMilestone(s, ROLLOUT_ID, 'reconciliationSignedOff')
    expect(label(s)).toBe(
      `Deleted milestone “Reconciliation signed off” from ${ROLLOUT}, with its dates on 2 waves and its duration in 1 archetype`,
    )
    const t = store()
    removeMilestone(t, ROLLOUT_ID, 'constructor')
    expect(label(t)).toBe(
      `Deleted milestone “Constructor” from ${ROLLOUT}, with its dates on 21 sites and 2 waves and its duration in 1 archetype`,
    )
  })

  it('setting or clearing a site’s own dates', () => {
    const s = store()
    setSiteMilestones(s, ROLLOUT_ID, siteId(4), { freezeStart: null })
    expect(label(s)).toBe(`Updated the “Freeze starts” date of 1 site in ${ROLLOUT}`)
    setSiteMilestones(s, ROLLOUT_ID, siteId(4), {
      constructor: { date: '2027-04-01', precision: 'month' },
      hypercareEnd: { date: '2027-07-01', precision: 'quarter' },
    })
    expect(label(s)).toBe(
      `Updated the “Constructor” and “Hypercare ends” dates of 1 site in ${ROLLOUT}`,
    )
  })

  it('reads any other batch, and any other plan change, as before', () => {
    const s = store()
    updateWave(s, waveId(1), { capacity: 9 })
    expect(label(s)).toBe('Updated plan of “Wave 1”')
    assignSites(s, ROLLOUT_ID, [siteId(17)], waveId(1))
    expect(label(s)).toBe(`Updated plan of ${ROLLOUT}`)
    const rollout = s.element(ROLLOUT_ID)!
    const wave = s.element(waveId(1))!
    expect(
      describeCommand({
        kind: 'batch',
        commands: [
          { kind: 'update-element', before: rollout, after: { ...rollout, name: 'Renamed' } },
          { kind: 'update-element', before: wave, after: wave },
        ],
      }),
    ).toBe('2 changes')
    // A milestone's deletion batched with anything but its waves' updates is
    // not one this app makes, and is not named as one.
    const removed = { ...rollout, plan: { ...plan(s), milestones: plan(s).milestones.slice(1) } }
    expect(
      describeCommand({
        kind: 'batch',
        commands: [
          { kind: 'update-element', before: rollout, after: removed },
          { kind: 'update-element', before: wave, after: wave },
        ],
      }),
    ).toBe(
      'Deleted milestone “Mapping signed off” from “Local data to the central lake”, with its dates on 29 sites and 1 wave',
    )
    const site = s.element(siteId(1))!
    expect(
      describeCommand({
        kind: 'batch',
        commands: [
          { kind: 'update-element', before: rollout, after: removed },
          { kind: 'update-element', before: site, after: { ...site, name: 'Renamed' } },
        ],
      }),
    ).toBe('2 changes')
  })
})

describe('a site’s own dates, and inheriting again (#213, ADR 0016)', () => {
  it('clearing an override makes the site inherit its wave’s date again, as one command', () => {
    const s = store()
    // Site 4 is in W1 and sets its own freeze, at week precision.
    expect(freeze(s, 4)).toMatchObject({
      source: 'site',
      planned: { date: '2027-05-10', precision: 'week' },
    })
    const before = state(s)
    expect(setSiteMilestones(s, ROLLOUT_ID, siteId(4), { freezeStart: null })).toBe(true)
    expect(s.history.length).toBe(before.history + 1)
    expect(freeze(s, 4)).toMatchObject({
      source: 'wave',
      planned: { date: '2027-05-17', precision: 'day' },
    })
  })

  it('sets an override at any precision, which is then the site’s and set', () => {
    const s = store()
    const q = { date: '2027-04-01', precision: 'quarter' } as const
    expect(setSiteMilestones(s, ROLLOUT_ID, siteId(5), { freezeStart: q })).toBe(true)
    expect(freeze(s, 5)).toMatchObject({ source: 'site', planned: q })
  })

  it('refuses a date whose precision is empty, stores nothing, and keeps the other values', () => {
    const s = store()
    const before = state(s)
    expect(
      setSiteMilestones(s, ROLLOUT_ID, siteId(4), {
        mappingSignedOff: null,
        freezeStart: { date: '2027-05-10', precision: '' },
      }),
    ).toBe(false)
    expect(setSiteMilestones(s, ROLLOUT_ID, siteId(4), { freezeStart: undefined })).toBe(false)
    expect(state(s)).toEqual(before)
  })

  it('refuses a date for a milestone the rollout does not have, or a site not in it', () => {
    const s = store()
    const before = state(s)
    const day = { date: '2027-05-10', precision: 'day' } as const
    expect(setSiteMilestones(s, ROLLOUT_ID, siteId(4), { goLive: day })).toBe(false)
    expect(setSiteMilestones(s, ROLLOUT_ID, 'loc-emea', { freezeStart: day })).toBe(false)
    expect(setSiteMilestones(s, waveId(1), siteId(4), { freezeStart: day })).toBe(false)
    expect(state(s)).toEqual(before)
  })
})

describe('a wave’s milestone dates (#213)', () => {
  it('are set, replaced and cleared with the wave’s other fields, in one command each', () => {
    const s = store()
    const before = state(s)
    const q = { date: '2027-07-01', precision: 'quarter' } as const
    expect(updateWave(s, waveId(4), { milestones: { freezeStart: q } })).toBe(true)
    expect(wavePlanOf(s.element(waveId(4)))?.milestones).toEqual({ freezeStart: q })
    expect(updateWave(s, waveId(4), { milestones: {} })).toBe(true)
    expect(wavePlanOf(s.element(waveId(4)))).not.toHaveProperty('milestones')
    expect(s.history.length).toBe(before.history + 2)
  })

  it('refuse a date for a milestone the rollout does not have, on create and on edit', () => {
    const s = store()
    const before = state(s)
    const day = { date: '2027-05-10', precision: 'day' } as const
    expect(updateWave(s, waveId(4), { milestones: { goLive: day } })).toBe(false)
    expect(
      createWave(s, ROLLOUT_ID, { name: 'W5', label: 'W5', milestones: { goLive: day } }),
    ).toBeUndefined()
    expect(state(s)).toEqual(before)
    const wave = createWave(s, ROLLOUT_ID, {
      name: 'W5',
      label: 'W5',
      milestones: { freezeStart: day },
    })!
    expect(wavePlanOf(s.element(wave.id))?.milestones).toEqual({ freezeStart: day })
  })
})
