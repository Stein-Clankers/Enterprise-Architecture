import { describe, expect, it } from 'vitest'
import { deriveLifecyclePhase } from './lifecycle'
import {
  modelAt,
  planConflicts,
  stateOfPhase,
  valueAt,
  type ElementState,
  type ModelState,
  type Scenario,
} from './model-at'
import {
  INITIATIVE_STATUSES,
  type InitiativeChange,
  type InitiativeStatus,
  type PlanDate,
} from './plan'
import { LIFECYCLE_PHASES, type LifecycleDates } from './profile'
import { emptyWorkspace, type Element, type Relationship, type Workspace } from './workspace'

// ── Builders ─────────────────────────────────────────────────────────────────

const day = (iso: string) => Date.parse(iso)
const on = (date: string, precision: PlanDate['precision'] = 'day'): PlanDate => ({
  date,
  precision,
})

function app(id: string, lifecycle?: LifecycleDates): Element {
  return {
    id,
    type: 'ApplicationComponent',
    name: id.toUpperCase(),
    properties: {},
    ...(lifecycle && { profile: { lifecycle } }),
  }
}

function rel(
  id: string,
  source: string,
  target: string,
  profile?: Relationship['profile'],
): Relationship {
  return { id, type: 'Serving', source, target, properties: {}, ...(profile && { profile }) }
}

function initiative(id: string, status: InitiativeStatus, changes: InitiativeChange[]): Element {
  return {
    id,
    type: 'WorkPackage',
    name: `Initiative ${id}`,
    properties: {},
    plan: { kind: 'initiative', status, changes },
  }
}

function workspace(elements: Element[], relationships: Relationship[] = []): Workspace {
  return { ...emptyWorkspace('ws', 'W'), elements, relationships }
}

const introduce = (id: string, subject: string, date: string): InitiativeChange => ({
  id,
  kind: 'introduce',
  subject,
  date: on(date),
})
const retire = (id: string, subject: string, date: string): InitiativeChange => ({
  id,
  kind: 'retire',
  subject,
  date: on(date),
})
const replace = (
  id: string,
  subject: string,
  successor: string,
  date: string,
): InitiativeChange => ({ id, kind: 'replace', subject, successor, date: on(date) })
const add = (id: string, subject: string, date: string): InitiativeChange => ({
  id,
  kind: 'add',
  subject,
  date: on(date),
})
const remove = (id: string, subject: string, date: string): InitiativeChange => ({
  id,
  kind: 'remove',
  subject,
  date: on(date),
})

function stateOf(ws: Workspace, id: string, at: string, scenario?: Scenario) {
  return modelAt(ws, day(at), scenario).elements.get(id)
}

function valid(ws: Workspace, id: string, at: string, scenario?: Scenario): boolean {
  return modelAt(ws, day(at), scenario).relationships.has(id)
}

// ── Baseline: stored dates only ──────────────────────────────────────────────

describe('modelAt on stored dates alone (ADR 0014 §1)', () => {
  it('derives the same state as the lifecycle phase, on every combination of dates', () => {
    // Every subset of the five phase dates, each a year apart, read before,
    // on and between every date: the parsed-number path must agree with the
    // derivation the rest of the app uses.
    const years = [2025, 2026, 2027, 2028, 2029]
    const probes = [2024, 2025, 2025.5, 2026, 2026.5, 2027, 2027.5, 2028, 2028.5, 2029, 2030]
    let compared = 0
    for (let mask = 1; mask < 32; mask++) {
      const lifecycle: LifecycleDates = {}
      LIFECYCLE_PHASES.forEach((phase, index) => {
        if (mask & (1 << index)) lifecycle[phase] = `${years[index]}-01-01`
      })
      const ws = workspace([app('a', lifecycle)])
      for (const year of probes) {
        const at = Date.UTC(Math.floor(year), year % 1 ? 6 : 0, 1)
        const expected = stateOfPhase(deriveLifecyclePhase(lifecycle, at))
        expect(modelAt(ws, at).elements.get('a'), `${JSON.stringify(lifecycle)} @ ${year}`).toBe(
          expected,
        )
        compared++
      }
    }
    expect(compared).toBe(31 * probes.length)
  })

  it('reads an element with no dates as live', () => {
    expect(stateOf(workspace([app('a')]), 'a', '1990-01-01')).toBe('live')
  })

  it('maps each phase to one of three states', () => {
    expect(LIFECYCLE_PHASES.map(stateOfPhase)).toEqual([
      'planned',
      'live',
      'live',
      'live',
      'retired',
    ])
  })

  it('holds a relationship valid from validFrom up to, not including, validTo', () => {
    const ws = workspace(
      [app('a'), app('b')],
      [rel('r', 'a', 'b', { validFrom: '2026-03-01', validTo: '2027-03-01' })],
    )
    expect(valid(ws, 'r', '2026-02-28')).toBe(false)
    expect(valid(ws, 'r', '2026-03-01')).toBe(true)
    expect(valid(ws, 'r', '2027-02-28')).toBe(true)
    expect(valid(ws, 'r', '2027-03-01')).toBe(false)
  })

  it('reads an absent bound as open, on each side', () => {
    const ws = workspace(
      [app('a'), app('b')],
      [
        rel('from', 'a', 'b', { validFrom: '2026-01-01' }),
        rel('to', 'a', 'b', { validTo: '2026-01-01' }),
        rel('none', 'a', 'b'),
      ],
    )
    expect(valid(ws, 'from', '2099-01-01')).toBe(true)
    expect(valid(ws, 'from', '2025-12-31')).toBe(false)
    expect(valid(ws, 'to', '1990-01-01')).toBe(true)
    expect(valid(ws, 'to', '2026-01-01')).toBe(false)
    expect(valid(ws, 'none', '1990-01-01')).toBe(true)
  })

  it('holds a relationship valid only while both endpoints are live (ADR 0014 §4)', () => {
    const ws = workspace(
      [
        app('live'),
        app('planned', { phaseIn: '2027-01-01' }),
        app('retired', { endOfLife: '2026-01-01' }),
      ],
      [
        rel('to-planned', 'live', 'planned'),
        rel('from-planned', 'planned', 'live'),
        rel('to-retired', 'live', 'retired'),
        rel('from-retired', 'retired', 'live'),
      ],
    )
    const state = modelAt(ws, day('2026-06-01'))
    expect(state.elements.get('live')).toBe('live')
    expect([...state.relationships]).toEqual([])
    const later = modelAt(ws, day('2027-06-01'))
    expect([...later.relationships].sort()).toEqual(['from-planned', 'to-planned'])
  })
})

// ── Entries ──────────────────────────────────────────────────────────────────

describe('change entries in the plan of record (ADR 0014 §2, §3)', () => {
  it('introduces an element on its date: planned the day before, live on the day', () => {
    const ws = workspace([
      app('new'),
      initiative('i', 'approved', [introduce('e', 'new', '2027-04-01')]),
    ])
    expect(stateOf(ws, 'new', '2027-03-31')).toBe('planned')
    expect(stateOf(ws, 'new', '2027-04-01')).toBe('live')
  })

  it('retires an element on its date', () => {
    const ws = workspace([
      app('old'),
      initiative('i', 'approved', [retire('e', 'old', '2027-04-01')]),
    ])
    expect(stateOf(ws, 'old', '2027-03-31')).toBe('live')
    expect(stateOf(ws, 'old', '2027-04-01')).toBe('retired')
  })

  it('replaces A with B on one date, and records the successor link from that date', () => {
    const ws = workspace([
      app('a'),
      app('b'),
      initiative('i', 'approved', [replace('e', 'a', 'b', '2027-04-01')]),
    ])
    const before = modelAt(ws, day('2027-03-31'))
    expect([before.elements.get('a'), before.elements.get('b')]).toEqual(['live', 'planned'])
    expect(before.successors).toEqual([])
    const after = modelAt(ws, day('2027-04-01'))
    expect([after.elements.get('a'), after.elements.get('b')]).toEqual(['retired', 'live'])
    expect(after.successors).toEqual([
      { predecessor: 'a', successor: 'b', date: '2027-04-01', initiative: 'i', entry: 'e' },
    ])
  })

  it('adds and removes a relationship on their dates', () => {
    const ws = workspace(
      [
        app('a'),
        app('b'),
        initiative('i', 'approved', [
          add('e1', 'r', '2027-01-01'),
          remove('e2', 'r', '2028-01-01'),
        ]),
      ],
      [rel('r', 'a', 'b')],
    )
    expect(valid(ws, 'r', '2026-12-31')).toBe(false)
    expect(valid(ws, 'r', '2027-01-01')).toBe(true)
    expect(valid(ws, 'r', '2027-12-31')).toBe(true)
    expect(valid(ws, 'r', '2028-01-01')).toBe(false)
  })

  it('takes a coarse date from the first day of its period', () => {
    const ws = workspace([
      app('a'),
      initiative('i', 'approved', [
        { id: 'e', kind: 'retire', subject: 'a', date: on('2027-04-01', 'quarter') },
      ]),
    ])
    expect(stateOf(ws, 'a', '2027-03-31')).toBe('live')
    expect(stateOf(ws, 'a', '2027-04-01')).toBe('retired')
  })

  it('lets an entry win over a stored date that is later than it, and one that is earlier', () => {
    // Introduction: the stored phase-in is a year late, then a year early.
    const late = workspace([
      app('a', { phaseIn: '2028-01-01' }),
      initiative('i', 'approved', [introduce('e', 'a', '2027-01-01')]),
    ])
    expect(stateOf(late, 'a', '2027-06-01')).toBe('live')
    const early = workspace([
      app('a', { phaseIn: '2026-01-01' }),
      initiative('i', 'approved', [introduce('e', 'a', '2027-01-01')]),
    ])
    expect(stateOf(early, 'a', '2026-06-01')).toBe('planned')
    // Retirement: the stored end of life is a year late, then a year early.
    const lateEnd = workspace([
      app('a', { endOfLife: '2029-01-01' }),
      initiative('i', 'approved', [retire('e', 'a', '2028-01-01')]),
    ])
    expect(stateOf(lateEnd, 'a', '2028-06-01')).toBe('retired')
    const earlyEnd = workspace([
      app('a', { endOfLife: '2027-01-01' }),
      initiative('i', 'approved', [retire('e', 'a', '2028-01-01')]),
    ])
    expect(stateOf(earlyEnd, 'a', '2027-06-01')).toBe('live')
  })

  it('lets an add or remove win over validFrom and validTo, on each side', () => {
    const ws = (profile: Relationship['profile'], change: InitiativeChange) =>
      workspace(
        [app('a'), app('b'), initiative('i', 'approved', [change])],
        [rel('r', 'a', 'b', profile)],
      )
    expect(
      valid(ws({ validFrom: '2028-01-01' }, add('e', 'r', '2027-01-01')), 'r', '2027-06-01'),
    ).toBe(true)
    expect(
      valid(ws({ validFrom: '2026-01-01' }, add('e', 'r', '2027-01-01')), 'r', '2026-06-01'),
    ).toBe(false)
    expect(
      valid(ws({ validTo: '2029-01-01' }, remove('e', 'r', '2028-01-01')), 'r', '2028-06-01'),
    ).toBe(false)
    expect(
      valid(ws({ validTo: '2027-01-01' }, remove('e', 'r', '2028-01-01')), 'r', '2027-06-01'),
    ).toBe(true)
  })

  it('keeps a stored end of life that no entry contradicts', () => {
    const ws = workspace([
      app('a', { endOfLife: '2029-01-01' }),
      initiative('i', 'approved', [introduce('e', 'a', '2027-01-01')]),
    ])
    expect(stateOf(ws, 'a', '2028-06-01')).toBe('live')
    expect(stateOf(ws, 'a', '2029-01-01')).toBe('retired')
  })

  it.each([
    ['later first', ['2028-01-01', '2027-01-01']],
    ['earlier first', ['2027-01-01', '2028-01-01']],
  ])('takes the earliest of two included entries that date one thing, listed %s', (_, dates) => {
    const ws = workspace([
      app('a'),
      initiative('i', 'approved', [retire('one', 'a', dates[0]!), retire('two', 'a', dates[1]!)]),
    ])
    expect(stateOf(ws, 'a', '2027-06-01')).toBe('retired')
  })

  it('leaves out an entry whose subject is missing, or is the wrong kind of object', () => {
    const ws = workspace(
      [
        app('a'),
        app('b'),
        initiative('i', 'approved', [
          retire('missing', 'ghost', '2027-01-01'),
          retire('a-relationship', 'r', '2027-01-01'),
          add('an-element', 'a', '2027-01-01'),
          replace('no-successor', 'a', 'ghost', '2027-01-01'),
        ]),
      ],
      [rel('r', 'a', 'b')],
    )
    const state = modelAt(ws, day('2027-06-01'))
    expect(state.elements.get('a')).toBe('live')
    expect(state.relationships.has('r')).toBe(true)
    expect(state.successors).toEqual([])
  })
})

describe('which initiatives a state includes (ADR 0014 §3)', () => {
  const included: Record<InitiativeStatus, boolean> = {
    idea: false,
    proposed: false,
    approved: true,
    inProgress: true,
    done: true,
    cancelled: false,
  }

  it.each(INITIATIVE_STATUSES)('status %s is in the plan of record as ADR 0014 says', (status) => {
    const ws = workspace([app('a'), initiative('i', status, [retire('e', 'a', '2027-01-01')])])
    expect(stateOf(ws, 'a', '2027-06-01')).toBe(included[status] ? 'retired' : 'live')
  })

  it('includes an initiative a scenario names, whatever its status', () => {
    const ws = workspace([app('a'), initiative('i', 'idea', [retire('e', 'a', '2027-01-01')])])
    expect(stateOf(ws, 'a', '2027-06-01', { include: ['i'] })).toBe('retired')
  })

  it('excludes an initiative a scenario names, whatever its status', () => {
    const ws = workspace([app('a'), initiative('i', 'approved', [retire('e', 'a', '2027-01-01')])])
    expect(stateOf(ws, 'a', '2027-06-01', { exclude: ['i'] })).toBe('live')
  })

  it('lets exclusion win when a scenario names an initiative both ways', () => {
    const ws = workspace([app('a'), initiative('i', 'idea', [retire('e', 'a', '2027-01-01')])])
    expect(stateOf(ws, 'a', '2027-06-01', { include: ['i'], exclude: ['i'] })).toBe('live')
  })
})

describe('an element or relationship dated only by entries (ADR 0014 §2)', () => {
  it('is absent from a state that leaves its introduction out', () => {
    const ws = workspace([
      app('new'),
      initiative('i', 'idea', [introduce('e', 'new', '2027-01-01')]),
    ])
    expect(modelAt(ws, day('2030-01-01')).elements.has('new')).toBe(false)
    expect(stateOf(ws, 'new', '2030-01-01', { include: ['i'] })).toBe('live')
  })

  it('is absent too when its introduction is the successor side of a replace', () => {
    const ws = workspace([
      app('a'),
      app('b'),
      initiative('i', 'proposed', [replace('e', 'a', 'b', '2027-01-01')]),
    ])
    expect(modelAt(ws, day('2030-01-01')).elements.has('b')).toBe(false)
    expect(stateOf(ws, 'a', '2030-01-01')).toBe('live')
  })

  it('is present, by its own dates, when it has a lifecycle date of its own', () => {
    const ws = workspace([
      app('new', { phaseIn: '2028-01-01' }),
      initiative('i', 'idea', [introduce('e', 'new', '2027-01-01')]),
    ])
    expect(stateOf(ws, 'new', '2027-06-01')).toBe('planned')
    expect(stateOf(ws, 'new', '2028-06-01')).toBe('live')
  })

  it('is not absent for being retired by an excluded entry', () => {
    const ws = workspace([app('a'), initiative('i', 'idea', [retire('e', 'a', '2027-01-01')])])
    expect(stateOf(ws, 'a', '2030-01-01')).toBe('live')
  })

  it('leaves a relationship absent while its only add is left out, unless it has a validFrom', () => {
    const ws = workspace(
      [
        app('a'),
        app('b'),
        initiative('i', 'idea', [
          add('e1', 'bare', '2027-01-01'),
          add('e2', 'dated', '2027-01-01'),
        ]),
      ],
      [rel('bare', 'a', 'b'), rel('dated', 'a', 'b', { validFrom: '2028-01-01' })],
    )
    expect(valid(ws, 'bare', '2030-01-01')).toBe(false)
    expect(valid(ws, 'dated', '2030-01-01')).toBe(true)
    expect(valid(ws, 'bare', '2030-01-01', { include: ['i'] })).toBe(true)
  })

  it('takes the relationships of an absent element with it', () => {
    const ws = workspace(
      [app('a'), app('new'), initiative('i', 'idea', [introduce('e', 'new', '2027-01-01')])],
      [rel('r', 'a', 'new')],
    )
    expect(valid(ws, 'r', '2030-01-01')).toBe(false)
    expect(valid(ws, 'r', '2030-01-01', { include: ['i'] })).toBe(true)
  })
})

describe('planned values (ADR 0014 §5)', () => {
  const fit = (id: string, value: 1 | 2 | 3 | 4, date: string): InitiativeChange => ({
    id,
    kind: 'modify',
    subject: 'a',
    field: 'technicalFit',
    value,
    date: on(date),
  })
  const element: Element = {
    ...app('a'),
    profile: { technicalFit: 1, timeClassification: 'Tolerate' },
  }

  it('holds the stored value before the first modify, and each planned value from its date', () => {
    const ws = workspace([
      element,
      initiative('i', 'approved', [fit('later', 4, '2028-01-01'), fit('first', 3, '2027-01-01')]),
    ])
    const at = (date: string) => valueAt(modelAt(ws, day(date)), element, 'technicalFit')
    expect(at('2026-12-31')).toBe(1)
    expect(at('2027-01-01')).toBe(3)
    expect(at('2028-01-01')).toBe(4)
    // A field no entry plans keeps its stored value.
    expect(valueAt(modelAt(ws, day('2029-01-01')), element, 'timeClassification')).toBe('Tolerate')
  })

  it('on one date, takes the entry of the initiative whose id sorts later', () => {
    // `b` holds the 2 and is written first; `a` holds the 4. Initiatives are
    // read in id order, so `b`'s entry is the later one and wins.
    const ws = workspace([
      element,
      initiative('b', 'approved', [fit('eb', 2, '2027-01-01')]),
      initiative('a', 'approved', [fit('ea', 4, '2027-01-01')]),
    ])
    expect(valueAt(modelAt(ws, day('2027-06-01')), element, 'technicalFit')).toBe(2)
  })

  it('ignores a modify a state leaves out', () => {
    const ws = workspace([element, initiative('i', 'idea', [fit('e', 4, '2027-01-01')])])
    expect(modelAt(ws, day('2027-06-01')).values.size).toBe(0)
  })
})

// ── Conflicts ────────────────────────────────────────────────────────────────

describe('planConflicts (ADR 0014 §6)', () => {
  const codes = (ws: Workspace, scenario?: Scenario) =>
    planConflicts(ws, scenario).map((conflict) => conflict.code)

  it('lists two included entries that retire or replace one element', () => {
    const ws = workspace([
      app('a'),
      app('b'),
      initiative('i', 'approved', [retire('e1', 'a', '2028-01-01')]),
      initiative('j', 'approved', [replace('e2', 'a', 'b', '2027-01-01')]),
    ])
    const [conflict] = planConflicts(ws)
    expect(conflict).toMatchObject({
      code: 'change.retired-twice',
      subject: 'a',
      entries: [
        { initiative: 'i', entry: 'e1' },
        { initiative: 'j', entry: 'e2' },
      ],
    })
    expect(conflict?.message).toContain('2027-01-01')
  })

  it('does not list a second retire the scenario leaves out', () => {
    const ws = workspace([
      app('a'),
      initiative('i', 'approved', [retire('e1', 'a', '2028-01-01')]),
      initiative('j', 'idea', [retire('e2', 'a', '2027-01-01')]),
    ])
    expect(codes(ws)).toEqual([])
    expect(codes(ws, { include: ['j'] })).toEqual(['change.retired-twice'])
  })

  it('lists a successor that goes live after its predecessor retires', () => {
    const ws = workspace([
      app('a'),
      app('b'),
      initiative('i', 'approved', [
        replace('e1', 'a', 'b', '2028-01-01'),
        retire('e2', 'a', '2027-01-01'),
      ]),
    ])
    expect(codes(ws)).toEqual(['change.retired-twice', 'change.successor-gap'])
    // The same replace, with the successor introduced before the early retire: no gap.
    const covered = workspace([
      app('a'),
      app('b'),
      initiative('i', 'approved', [
        replace('e1', 'a', 'b', '2028-01-01'),
        retire('e2', 'a', '2027-01-01'),
        introduce('e3', 'b', '2026-06-01'),
      ]),
    ])
    expect(codes(covered)).toEqual(['change.retired-twice'])
  })

  it('lists a stored date that disagrees with an entry, early or late', () => {
    const at = (lifecycle: LifecycleDates, change: InitiativeChange) =>
      codes(workspace([app('a', lifecycle), initiative('i', 'approved', [change])]))
    expect(at({ phaseIn: '2028-01-01' }, introduce('e', 'a', '2027-01-01'))).toEqual([
      'change.stored-date-disagrees',
    ])
    expect(at({ phaseIn: '2026-01-01' }, introduce('e', 'a', '2027-01-01'))).toEqual([
      'change.stored-date-disagrees',
    ])
    expect(at({ phaseIn: '2027-01-01' }, introduce('e', 'a', '2027-01-01'))).toEqual([])
    expect(at({ endOfLife: '2029-01-01' }, retire('e', 'a', '2028-01-01'))).toEqual([
      'change.stored-date-disagrees',
    ])
    expect(at({ endOfLife: '2027-01-01' }, retire('e', 'a', '2028-01-01'))).toEqual([
      'change.stored-date-disagrees',
    ])
    expect(at({ endOfLife: '2028-01-01' }, retire('e', 'a', '2028-01-01'))).toEqual([])
    // Live from the start by its lifecycle, and introduced by an entry, even
    // on the day its stored active phase starts: it was live before that.
    expect(at({ active: '2027-01-01' }, introduce('e', 'a', '2027-01-01'))).toEqual([
      'change.stored-date-disagrees',
    ])
    expect(at({ active: '2020-01-01' }, introduce('e', 'a', '2027-01-01'))).toEqual([
      'change.stored-date-disagrees',
    ])
  })

  it('lists a validFrom or validTo that disagrees with an add or remove', () => {
    const at = (profile: Relationship['profile'], change: InitiativeChange) =>
      codes(
        workspace(
          [app('a'), app('b'), initiative('i', 'approved', [change])],
          [rel('r', 'a', 'b', profile)],
        ),
      )
    expect(at({ validFrom: '2028-01-01' }, add('e', 'r', '2027-01-01'))).toEqual([
      'change.stored-date-disagrees',
    ])
    expect(at({ validFrom: '2027-01-01' }, add('e', 'r', '2027-01-01'))).toEqual([])
    expect(at({ validTo: '2026-01-01' }, remove('e', 'r', '2027-01-01'))).toEqual([
      'change.stored-date-disagrees',
    ])
    expect(at({ validTo: '2027-01-01' }, remove('e', 'r', '2027-01-01'))).toEqual([])
  })

  it('lists a relationship dated to stay valid after an endpoint retires, at either end', () => {
    const at = (relationship: Relationship) =>
      codes(workspace([app('a'), app('old', { endOfLife: '2027-01-01' })], [relationship]))
    expect(at(rel('r', 'a', 'old', { validTo: '2028-01-01' }))).toEqual([
      'change.relationship-outlives-endpoint',
    ])
    expect(at(rel('r', 'old', 'a', { validTo: '2028-01-01' }))).toEqual([
      'change.relationship-outlives-endpoint',
    ])
    expect(at(rel('r', 'a', 'old', { validTo: '2027-01-01' }))).toEqual([])
    // An open end says nothing about the endpoint: not a conflict.
    expect(at(rel('r', 'a', 'old'))).toEqual([])
  })

  it('reads an endpoint retirement from an entry as well as from a lifecycle', () => {
    const ws = workspace(
      [app('a'), app('b'), initiative('i', 'approved', [retire('e', 'b', '2027-01-01')])],
      [rel('r', 'a', 'b', { validTo: '2028-01-01' })],
    )
    expect(planConflicts(ws)).toEqual([
      expect.objectContaining({
        code: 'change.relationship-outlives-endpoint',
        subject: 'r',
        entries: [{ initiative: 'i', entry: 'e' }],
      }),
    ])
  })
})

// ── Properties ───────────────────────────────────────────────────────────────

/** A seeded generator, so a failing case can be replayed: mulberry32. */
function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const YEARS = ['2025', '2026', '2027', '2028', '2029']

/** A random workspace with random lifecycles, windows and initiatives of random status. */
function randomWorkspace(seed: number): Workspace {
  const next = random(seed)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
  const date = () => `${pick(YEARS)}-${pick(['01', '04', '07', '10'])}-01`
  const elements: Element[] = []
  for (let i = 0; i < 12; i++) {
    const lifecycle: LifecycleDates = {}
    if (next() < 0.5) {
      const dates = LIFECYCLE_PHASES.map(() => (next() < 0.5 ? date() : undefined))
      const sorted = dates.filter((d): d is string => d !== undefined).sort()
      let k = 0
      LIFECYCLE_PHASES.forEach((phase, index) => {
        if (dates[index]) lifecycle[phase] = sorted[k++]!
      })
    }
    elements.push(app(`e${i}`, Object.keys(lifecycle).length ? lifecycle : undefined))
  }
  const relationships: Relationship[] = []
  for (let i = 0; i < 24; i++) {
    const profile: Relationship['profile'] = {}
    if (next() < 0.3) profile.validFrom = date()
    if (next() < 0.3) profile.validTo = date()
    relationships.push(rel(`r${i}`, pick(elements).id, pick(elements).id, profile))
  }
  for (let i = 0; i < 4; i++) {
    const changes: InitiativeChange[] = []
    for (let j = 0; j < 5; j++) {
      const id = `c${i}-${j}`
      switch (pick(['introduce', 'retire', 'replace', 'add', 'remove'] as const)) {
        case 'introduce':
          changes.push(introduce(id, pick(elements).id, date()))
          break
        case 'retire':
          changes.push(retire(id, pick(elements).id, date()))
          break
        case 'replace':
          changes.push(replace(id, pick(elements).id, pick(elements).id, date()))
          break
        case 'add':
          changes.push(add(id, pick(relationships).id, date()))
          break
        case 'remove':
          changes.push(remove(id, pick(relationships).id, date()))
          break
      }
    }
    elements.push(initiative(`i${i}`, pick(INITIATIVE_STATUSES), changes))
  }
  return workspace(elements, relationships)
}

function snapshot(state: ModelState) {
  return {
    elements: [...state.elements].sort(),
    relationships: [...state.relationships].sort(),
    values: [...state.values].sort(),
    successors: state.successors,
  }
}

describe('modelAt properties, over 300 random workspaces (#61)', () => {
  const seeds = Array.from({ length: 300 }, (_, i) => i + 1)
  const probes = [
    '2024-06-01',
    '2025-01-01',
    '2026-07-01',
    '2027-04-01',
    '2028-10-01',
    '2030-01-01',
  ]

  it('never holds a relationship valid whose endpoint is absent or not live', () => {
    let validSeen = 0
    for (const seed of seeds) {
      const ws = randomWorkspace(seed)
      const byId = new Map(ws.relationships.map((r) => [r.id, r]))
      for (const probe of probes) {
        const state = modelAt(ws, day(probe))
        for (const id of state.relationships) {
          const relationship = byId.get(id)!
          const ends: (ElementState | undefined)[] = [
            state.elements.get(relationship.source),
            state.elements.get(relationship.target),
          ]
          expect(ends, `seed ${seed} @ ${probe}: ${id}`).toEqual(['live', 'live'])
          validSeen++
        }
      }
    }
    // The property is vacuous if nothing is ever valid.
    expect(validSeen).toBeGreaterThan(1_000)
  })

  it('returns the original state when an initiative is applied and then taken out again', () => {
    // Apply: include an initiative of status idea. Take out: exclude it. The
    // state without it is the state of the workspace that never had it.
    let changed = 0
    for (const seed of seeds) {
      const original = randomWorkspace(seed)
      const extra = randomWorkspace(seed + 10_000).elements.find(
        (element) => element.plan?.kind === 'initiative',
      )!
      const changes = extra.plan?.kind === 'initiative' ? extra.plan.changes : []
      // The extra initiative's entries, pointed at this workspace's ids.
      const applied = workspace(
        [...original.elements, initiative('extra', 'idea', changes)],
        original.relationships,
      )
      for (const probe of probes) {
        const before = snapshot(modelAt(original, day(probe)))
        // The initiative is an element too, which the original does not have.
        before.elements.push(['extra', 'live'])
        before.elements.sort()
        const withIt = snapshot(modelAt(applied, day(probe), { include: ['extra'] }))
        const without = snapshot(
          modelAt(applied, day(probe), { include: ['extra'], exclude: ['extra'] }),
        )
        if (JSON.stringify(withIt) !== JSON.stringify(before)) changed++
        // An element only `extra` introduces is absent from both, so they agree.
        expect(without, `seed ${seed} @ ${probe}`).toEqual(
          withoutIntroducedBy(before, applied, original),
        )
      }
    }
    // Applying it must have changed something, or taking it out proves nothing.
    expect(changed).toBeGreaterThan(300)
  })

  it('writes no state of the workspace it reads', () => {
    const ws = randomWorkspace(7)
    const before = JSON.stringify(ws)
    for (const probe of probes) modelAt(ws, day(probe), { include: ['i0', 'i1'] })
    planConflicts(ws, { include: ['i0'] })
    expect(JSON.stringify(ws)).toBe(before)
  })
})

/**
 * The original state, less what the added initiative's mere presence removes:
 * an element or relationship with no date of its own that it introduces is
 * absent while it is excluded (ADR 0014 §2), which the original, without it,
 * did not know.
 */
function withoutIntroducedBy(
  before: ReturnType<typeof snapshot>,
  applied: Workspace,
  original: Workspace,
): ReturnType<typeof snapshot> {
  const extra = applied.elements.find((element) => element.id === 'extra')!
  const changes = extra.plan?.kind === 'initiative' ? extra.plan.changes : []
  const already = new Set<string>()
  for (const element of original.elements) {
    if (element.plan?.kind !== 'initiative') continue
    for (const change of element.plan.changes) {
      if (change.kind === 'introduce' || change.kind === 'add') already.add(change.subject)
      if (change.kind === 'replace') already.add(change.successor)
    }
  }
  const newlyIntroduced = new Set<string>()
  for (const change of changes) {
    const id = change.kind === 'replace' ? change.successor : change.subject
    if (
      (change.kind === 'introduce' || change.kind === 'add' || change.kind === 'replace') &&
      !already.has(id)
    )
      newlyIntroduced.add(id)
  }
  const elementsById = new Map(original.elements.map((e) => [e.id, e]))
  const relationshipsById = new Map(original.relationships.map((r) => [r.id, r]))
  const absent = new Set(
    [...newlyIntroduced].filter((id) => {
      const element = elementsById.get(id)
      if (element) return element.profile?.lifecycle === undefined
      const relationship = relationshipsById.get(id)
      return relationship !== undefined && relationship.profile?.validFrom === undefined
    }),
  )
  // Before this initiative existed, an element it introduces counted as present.
  // A relationship to an element that is now absent is no longer valid either.
  const elements = before.elements.filter(([id]) => !absent.has(id))
  const present = new Set(elements.filter(([, state]) => state === 'live').map(([id]) => id))
  const relationships = before.relationships.filter((id) => {
    if (absent.has(id)) return false
    const relationship = relationshipsById.get(id)!
    return present.has(relationship.source) && present.has(relationship.target)
  })
  return { ...before, elements, relationships }
}

// ── Budget ───────────────────────────────────────────────────────────────────

describe('the modelAt budget (ADR 0014, Consequences)', () => {
  /**
   * 5,000 elements and 15,000 relationships, with the plan the rollout demo
   * brings at full scale: 1,600 entries (proposal §4.6). The budget is 10 ms
   * on the CI runner. The median of nine runs is asserted, after a warm-up,
   * so one descheduled run does not fail it and a regression still does.
   */
  function scaleWorkspace(): Workspace {
    const elements: Element[] = []
    for (let i = 0; i < 5_000; i++) {
      elements.push(
        app(
          `a${i}`,
          i % 3 === 0
            ? {
                phaseIn: '2025-01-01',
                active: '2026-01-01',
                phaseOut: '2029-01-01',
                endOfLife: '2031-01-01',
              }
            : undefined,
        ),
      )
    }
    const relationships: Relationship[] = []
    for (let i = 0; i < 15_000; i++) {
      relationships.push(
        rel(
          `r${i}`,
          `a${i % 5_000}`,
          `a${(i * 7 + 1) % 5_000}`,
          i % 4 === 0 ? { validFrom: '2026-01-01' } : undefined,
        ),
      )
    }
    const statuses: InitiativeStatus[] = ['approved', 'inProgress', 'idea', 'done']
    for (let i = 0; i < 16; i++) {
      const changes: InitiativeChange[] = []
      for (let j = 0; j < 100; j++) {
        const n = i * 100 + j
        const date = `${2026 + (n % 4)}-0${1 + (n % 9)}-01`
        if (n % 2) changes.push(retire(`c${n}`, `a${n}`, date))
        else changes.push(remove(`c${n}`, `r${n}`, date))
      }
      elements.push(initiative(`i${i}`, statuses[i % 4]!, changes))
    }
    return workspace(elements, relationships)
  }

  it('evaluates 5,000 elements and 15,000 relationships in 10 ms or less', () => {
    const ws = scaleWorkspace()
    const at = day('2028-06-01')
    let state = modelAt(ws, at)
    const runs: number[] = []
    for (let run = 0; run < 9; run++) {
      const start = performance.now()
      state = modelAt(ws, at)
      runs.push(performance.now() - start)
    }
    runs.sort((a, b) => a - b)
    // The work was done: every element is in the state, and the entries took
    // effect. A budget met by evaluating nothing proves nothing.
    expect(state.elements.size).toBe(5_016)
    const expected = expectedAtScale()
    expect(expected.retired).toBe(300)
    expect([...state.elements.values()].filter((s) => s === 'retired').length).toBe(
      expected.retired,
    )
    expect(state.relationships.size).toBe(expected.valid)
    expect(runs[4], `runs: ${runs.map((ms) => ms.toFixed(1)).join(', ')} ms`).toBeLessThanOrEqual(
      10,
    )
  })
})

/**
 * What the scale plan does at 2028-06-01, counted straight from how
 * `scaleWorkspace` builds it rather than read off `modelAt`: initiatives
 * `i2`, `i6`, `i10` and `i14` are ideas and left out; every other entry whose
 * date is reached takes effect.
 */
function expectedAtScale(): { retired: number; valid: number } {
  const reached = (n: number) => {
    const year = 2026 + (n % 4)
    return year < 2028 || (year === 2028 && 1 + (n % 9) <= 6)
  }
  const taken = (n: number) => Math.floor(n / 100) % 4 !== 2 && reached(n)
  const retired = new Set<number>()
  const removed = new Set<number>()
  for (let n = 0; n < 1_600; n++) {
    if (!taken(n)) continue
    if (n % 2) retired.add(n)
    else removed.add(n)
  }
  let valid = 0
  for (let k = 0; k < 15_000; k++) {
    if (removed.has(k) || retired.has(k % 5_000) || retired.has((k * 7 + 1) % 5_000)) continue
    valid++
  }
  return { retired: retired.size, valid }
}
