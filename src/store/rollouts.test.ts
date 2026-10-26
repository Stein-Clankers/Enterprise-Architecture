import { describe, expect, it } from 'vitest'
import { rolloutPlanOf, validate, wavePlanOf, wavesOf, type Element, type View } from '@/model'
import { toCanonicalJson } from '@/io'
import { ROLLOUT_ID, rolloutWorkspace, siteId, waveId } from '@/test/rollout-fixture'
import { ModelStore, ReadOnlyModelError } from './model-store'
import {
  addSites,
  assignSites,
  createRollout,
  createWave,
  deleteRollout,
  deleteWave,
  removeSites,
  renameRollout,
  renameWave,
  setArchetype,
  unassignSites,
} from './rollouts'

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
