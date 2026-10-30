import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  emptyWorkspace,
  initiativePlanOf,
  validate,
  type Element,
  type InitiativeChange,
  type Workspace,
} from '@/model'
import { fromCanonicalJson, toCanonicalJson } from './canonical-json'
import { exportExchange, importExchangeXml } from './exchange-format'
import { buildWorkspaceJsonSchema } from './json-schema'
import { PLAN_KEYS } from './plan-exchange'

/**
 * Initiatives and their change entries through both formats (#61, ADR 0014
 * §2): canonical JSON holds the plan as it is, and the exchange format carries
 * the status as a property and the changes as canonical JSON in another,
 * naming model ids in the file's spelling.
 */

const day = (date: string) => ({ date, precision: 'day' as const })

const LEGACY = 'app-legacy'

/** Every change kind, in an order no sort would produce. */
const CHANGES: InitiativeChange[] = [
  { id: 'z-retire', kind: 'retire', subject: LEGACY, date: day('2027-06-01') },
  { id: 'a-introduce', kind: 'introduce', subject: 'app-new', date: day('2027-01-04') },
  {
    id: 'm-replace',
    kind: 'replace',
    subject: LEGACY,
    successor: 'app-new',
    date: { date: '2027-04-01', precision: 'quarter' },
  },
  // The legacy id is a successor here, so a rewrite must reach successors too.
  {
    id: 'n-replace',
    kind: 'replace',
    subject: 'app-portal',
    successor: LEGACY,
    date: day('2029-01-01'),
  },
  { id: 'b-add', kind: 'add', subject: 'rel-new', date: day('2027-01-04') },
  { id: 'c-remove', kind: 'remove', subject: 'rel-old', date: day('2027-06-01') },
  {
    id: 'd-modify',
    kind: 'modify',
    subject: 'app-new',
    field: 'technicalFit',
    value: 4,
    date: { date: '2028-01-01', precision: 'month' },
  },
  {
    id: 'e-modify',
    kind: 'modify',
    subject: LEGACY,
    field: 'timeClassification',
    value: 'Eliminate',
    date: day('2027-01-04'),
  },
]

/** `legacy` is the legacy CRM's id: the exchange test gives it one the writer must rewrite. */
function initiativesWorkspace(legacy = LEGACY): Workspace {
  const app = (id: string, name: string): Element => ({
    id,
    type: 'ApplicationComponent',
    name,
    properties: {},
  })
  return {
    ...emptyWorkspace('ws', 'Initiatives'),
    elements: [
      app(legacy, 'Legacy CRM'),
      app('app-new', 'New CRM'),
      app('app-portal', 'Portal'),
      {
        id: 'init-crm',
        type: 'WorkPackage',
        name: 'CRM consolidation',
        properties: {},
        plan: {
          kind: 'initiative',
          status: 'inProgress',
          changes: renameSubject(CHANGES, LEGACY, legacy),
        },
      },
      {
        id: 'init-idea',
        type: 'WorkPackage',
        name: 'An idea',
        properties: {},
        plan: { kind: 'initiative', status: 'idea', changes: [] },
      },
    ],
    relationships: [
      {
        id: 'rel-old',
        type: 'Serving',
        source: legacy,
        target: 'app-portal',
        properties: {},
      },
      { id: 'rel-new', type: 'Serving', source: 'app-new', target: 'app-portal', properties: {} },
    ],
  }
}

/** `changes` with every reference to `from`, subject or successor, renamed `to`. */
function renameSubject(changes: InitiativeChange[], from: string, to: string): InitiativeChange[] {
  return structuredClone(changes).map((change) => {
    if (change.subject === from) change.subject = to
    if (change.kind === 'replace' && change.successor === from) change.successor = to
    return change
  })
}

function fromXml(xml: string): { workspace: Workspace; codes: string[] } {
  const result = importExchangeXml(xml)
  if (!result.workspace) throw new Error(JSON.stringify(result.problems))
  return { workspace: result.workspace, codes: result.problems.map((p) => p.code) }
}

function plan(workspace: Workspace | undefined, id = 'init-crm') {
  return initiativePlanOf(workspace?.elements.find((element) => element.id === id))
}

describe('initiatives in canonical JSON (#61)', () => {
  const workspace = initiativesWorkspace()

  it('has nothing for validate() to report', () => {
    expect(validate(workspace).findings).toEqual([])
  })

  it('round-trips byte for byte, with nothing to report (ADR 0004)', () => {
    const first = toCanonicalJson(workspace)
    const result = fromCanonicalJson(first)
    expect(result.problems).toEqual([])
    expect(toCanonicalJson(result.workspace!)).toBe(first)
    expect(plan(result.workspace)).toEqual(plan(workspace))
    // The changes are in the file, not lost on the way to a stable empty one.
    expect(first).toContain('"id": "m-replace"')
  })

  it('keeps the changes in the order their author gave them', () => {
    const reversed = structuredClone(workspace)
    plan(reversed)!.changes.reverse()
    const read = fromCanonicalJson(toCanonicalJson(reversed)).workspace
    expect(plan(read)!.changes.map((change) => change.id)).toEqual(
      [...CHANGES].reverse().map((change) => change.id),
    )
  })

  it('validates against the published schema, which refuses an anchored date or an unknown status', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true })
    addFormats(ajv)
    const check = ajv.compile(buildWorkspaceJsonSchema())
    const file = JSON.parse(toCanonicalJson(workspace))
    expect(check(file), JSON.stringify(check.errors)).toBe(true)
    const crm = () => file.elements.find((element: Element) => element.id === 'init-crm')
    const anchored = structuredClone(file)
    anchored.elements.find((e: Element) => e.id === 'init-crm').plan.changes[0].date = {
      anchor: 'cutover',
      offsetDays: 0,
    }
    expect(check(anchored)).toBe(false)
    const status = structuredClone(file)
    status.elements.find((e: Element) => e.id === 'init-crm').plan.status = 'in progress'
    expect(check(status)).toBe(false)
    expect(crm().plan.status).toBe('inProgress')
  })
})

describe('reading an initiative leniently from canonical JSON (#61)', () => {
  type Raw = { elements: { id: string; plan?: Record<string, unknown> }[] }
  const json = (edit: (plan: Record<string, unknown>) => void) => {
    const raw = JSON.parse(toCanonicalJson(initiativesWorkspace())) as Raw
    edit(raw.elements.find((element) => element.id === 'init-crm')!.plan!)
    return JSON.stringify(raw)
  }

  it.each([
    ['no status', (p: Record<string, unknown>) => delete p.status, 'status undefined'],
    [
      'a status it does not know',
      (p: Record<string, unknown>) => (p.status = 'paused'),
      'status "paused"',
    ],
  ])('drops a plan with %s whole, and says so', (_, edit, part) => {
    const { workspace, problems } = fromCanonicalJson(json(edit))
    expect(plan(workspace)).toBeUndefined()
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'json.invalid-plan',
        message: expect.stringContaining(part),
      }),
    ])
  })

  it.each([
    [
      'a change with an anchored date',
      (p: Record<string, unknown>) =>
        ((p.changes as Record<string, unknown>[])[1]!.date = { anchor: 'cutover', offsetDays: 3 }),
      'changes[1]',
    ],
    [
      'a second change with an id already read',
      (p: Record<string, unknown>) =>
        ((p.changes as Record<string, unknown>[])[1]!.id = 'z-retire'),
      'changes[1], a second "z-retire"',
    ],
    ['changes that are not a list', (p: Record<string, unknown>) => (p.changes = {}), 'changes'],
    ['a key it does not know', (p: Record<string, unknown>) => (p.owner = 'PMO'), 'owner'],
  ])('keeps the plan with %s, and names what it dropped', (_, edit, part) => {
    const { workspace, problems } = fromCanonicalJson(json(edit))
    expect(plan(workspace)?.status).toBe('inProgress')
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'json.invalid-plan',
        message: expect.stringContaining(`dropped: ${part}`),
      }),
    ])
  })
})

describe('initiatives in the exchange format (#61)', () => {
  // An id that is no xs:ID, as an Archi import can leave: the writer rewrites
  // it, and the changes must name it the way the file does.
  const workspace = initiativesWorkspace('7 legacy crm')

  it('comes back intact, reporting only the id it rewrote', () => {
    const { xml, problems } = exportExchange(workspace)
    expect(problems.map((p) => [p.code, p.subject])).toEqual([
      ['exchange.id-rewritten', '7 legacy crm'],
    ])
    const { workspace: back, codes } = fromXml(xml)
    expect(codes).toEqual([])
    // The rewritten id comes back as the file spelled it, and the changes follow it.
    const legacy = back.elements.find((element) => element.name === 'Legacy CRM')!
    expect(legacy.id).not.toBe('7 legacy crm')
    const renamed = renameSubject(CHANGES, LEGACY, legacy.id)
    expect(plan(back)).toEqual({ kind: 'initiative', status: 'inProgress', changes: renamed })
    expect(plan(back, 'init-idea')).toEqual({ kind: 'initiative', status: 'idea', changes: [] })
    // No plan property is left behind as an ordinary one.
    const crm = back.elements.find((element) => element.id === 'init-crm')!
    expect(Object.keys(crm.properties)).toEqual([])
  })

  it('writes the status and the changes as properties readable in Archi', () => {
    const { xml } = exportExchange(workspace)
    expect(xml).toContain(PLAN_KEYS.status)
    expect(xml).toContain('inProgress')
    expect(xml).toContain(PLAN_KEYS.changes)
  })

  it('exports, imports and exports byte for byte', () => {
    const first = exportExchange(workspace).xml
    expect(exportExchange(fromXml(first).workspace).xml).toBe(first)
  })

  it('keeps an unreadable changes property as an ordinary property, and says so', () => {
    const { xml } = exportExchange(workspace)
    const broken = xml.replace(/(<value xml:lang="en">)\[\{[^<]*(<\/value>)/, '$1[not json$2')
    expect(broken).not.toBe(xml)
    const { workspace: back, codes } = fromXml(broken)
    expect(codes).toEqual(['exchange.plan-unreadable'])
    const crm = back.elements.find((element) => element.id === 'init-crm')!
    expect(plan(back)).toEqual({ kind: 'initiative', status: 'inProgress', changes: [] })
    expect(crm.properties[PLAN_KEYS.changes]).toBe('[not json')
  })
})

describe('validate() on an initiative’s references (#61)', () => {
  const codes = (changes: InitiativeChange[]) => {
    const workspace = initiativesWorkspace()
    plan(workspace)!.changes = changes
    return validate(workspace).findings.map((finding) => finding.code)
  }

  it('reports a subject that is not there, and one of the wrong kind', () => {
    expect(codes([{ id: 'x', kind: 'retire', subject: 'ghost', date: day('2027-01-04') }])).toEqual(
      ['plan.initiative-subject-unknown'],
    )
    expect(codes([{ id: 'x', kind: 'add', subject: 'app-new', date: day('2027-01-04') }])).toEqual([
      'plan.initiative-subject-unknown',
    ])
    expect(
      codes([{ id: 'x', kind: 'retire', subject: 'rel-old', date: day('2027-01-04') }]),
    ).toEqual(['plan.initiative-subject-unknown'])
  })

  it('reports a replace of an element by itself, and not as a missing successor', () => {
    expect(
      codes([
        {
          id: 'x',
          kind: 'replace',
          subject: 'app-new',
          successor: 'app-new',
          date: day('2027-01-04'),
        },
      ]),
    ).toEqual(['plan.initiative-replace-self'])
  })

  it('reports a successor that is not there', () => {
    expect(
      codes([
        {
          id: 'x',
          kind: 'replace',
          subject: 'app-new',
          successor: 'ghost',
          date: day('2027-01-04'),
        },
      ]),
    ).toEqual(['plan.initiative-successor-unknown'])
  })
})
