import { describe, expect, it } from 'vitest'
import { validate } from './validate'
import { emptyWorkspace, type Relationship, type Workspace } from './workspace'

function workspace(over: Partial<Workspace> = {}): Workspace {
  return {
    ...emptyWorkspace('ws-test', 'Test'),
    elements: [
      { id: 'app-crm', type: 'ApplicationComponent', name: 'CRM System', properties: {} },
      { id: 'proc-claim', type: 'BusinessProcess', name: 'Handle Claim', properties: {} },
      { id: 'obj-policy', type: 'DataObject', name: 'Policy Data', properties: {} },
    ],
    ...over,
  }
}

function relationship(over: Partial<Relationship> = {}): Relationship {
  return {
    id: 'rel-1',
    type: 'Serving',
    source: 'app-crm',
    target: 'proc-claim',
    properties: {},
    ...over,
  }
}

describe('workspace validation', () => {
  it('passes a clean model', () => {
    const report = validate(workspace({ relationships: [relationship()] }))
    expect(report.valid).toBe(true)
    expect(report.findings).toHaveLength(0)
  })

  it('reports dangling relationship endpoints', () => {
    const report = validate(
      workspace({ relationships: [relationship({ source: 'ghost', target: 'phantom' })] }),
    )
    expect(report.valid).toBe(false)
    expect(report.errors.map((f) => f.code)).toEqual([
      'relationship.dangling-source',
      'relationship.dangling-target',
    ])
  })

  it('reports relationships the validity matrix rejects, with the reason', () => {
    const report = validate(
      workspace({
        relationships: [relationship({ type: 'Access', source: 'obj-policy', target: 'app-crm' })],
      }),
    )
    expect(report.valid).toBe(false)
    const finding = report.errors[0]
    expect(finding?.code).toBe('relationship.invalid')
    expect(finding?.message).toContain('Access')
    expect(finding?.message).toContain('Access is allowed the other way')
  })

  it('holds a junction to Archi’s junction rules, as Archi’s validator does (#129)', () => {
    const base = workspace()
    const junction = { id: 'j', type: 'Junction' as const, name: '', properties: {} }
    const report = validate({
      ...base,
      elements: [...base.elements, junction],
      relationships: [
        relationship({ id: 'r-in', type: 'Serving', source: 'app-crm', target: 'j' }),
        // Two types on one junction: each is a legal cell of the matrix on its own.
        relationship({ id: 'r-out', type: 'Flow', source: 'j', target: 'proc-claim' }),
      ],
    })
    expect(report.errors.map((f) => `${f.subjectId} ${f.code}`)).toEqual([
      'r-in relationship.invalid',
      'r-out relationship.invalid',
    ])
    expect(report.errors[0]?.message).toMatch(/already joins Flow relationships/)
  })

  it('reports duplicate ids', () => {
    const base = workspace()
    const duplicated = workspace({
      elements: [...base.elements, { ...base.elements[0]!, name: 'Copy' }],
    })
    expect(validate(duplicated).errors.map((f) => f.code)).toContain('element.duplicate-id')
  })

  it('warns about unnamed elements without failing the model', () => {
    const report = validate(
      workspace({
        elements: [{ id: 'x', type: 'Capability', name: '  ', properties: {} }],
      }),
    )
    expect(report.valid).toBe(true)
    expect(report.warnings.map((f) => f.code)).toEqual(['element.no-name'])
  })

  it('warns about lifecycle dates that run backwards or will not parse', () => {
    const report = validate(
      workspace({
        elements: [
          {
            id: 'app-legacy',
            type: 'ApplicationComponent',
            name: 'Legacy',
            properties: {},
            profile: { lifecycle: { active: '2020-01-01', phaseOut: '2015-01-01' } },
          },
          {
            id: 'app-odd',
            type: 'ApplicationComponent',
            name: 'Odd',
            properties: {},
            profile: { lifecycle: { active: 'whenever' } },
          },
        ],
      }),
    )
    expect(report.warnings.map((f) => f.code)).toEqual([
      'element.lifecycle-out-of-order',
      'element.unparseable-date',
    ])
    expect(report.valid).toBe(true)
  })

  it('warns about a relationship bound that will not parse, on each side, and not about a real one (#246)', () => {
    const bounds = (profile: { validFrom?: string; validTo?: string }) =>
      validate(workspace({ relationships: [relationship({ profile })] })).warnings.map((f) => [
        f.code,
        f.message.includes(Object.keys(profile)[0]!),
      ])
    expect(bounds({ validFrom: '2027-13-01' })).toEqual([['relationship.unparseable-date', true]])
    expect(bounds({ validTo: 'soon' })).toEqual([['relationship.unparseable-date', true]])
    expect(bounds({ validFrom: '2026-01-01', validTo: '2027-01-01' })).toEqual([])
  })

  it('warns about self-referencing relationships except association', () => {
    const selfServe = validate(
      workspace({ relationships: [relationship({ source: 'app-crm', target: 'app-crm' })] }),
    )
    expect(selfServe.warnings.map((f) => f.code)).toContain('relationship.self-reference')

    const selfAssociate = validate(
      workspace({
        relationships: [
          relationship({ type: 'Association', source: 'app-crm', target: 'app-crm' }),
        ],
      }),
    )
    expect(selfAssociate.findings).toHaveLength(0)
  })

  it('rejects unknown types coming in from a bad import', () => {
    const report = validate(
      workspace({
        elements: [{ id: 'x', type: 'Microservice' as never, name: 'X', properties: {} }],
        relationships: [
          relationship({ type: 'Consumes' as never, source: 'x', target: 'proc-claim' }),
        ],
      }),
    )
    expect(report.errors.map((f) => f.code)).toEqual([
      'element.unknown-type',
      'relationship.unknown-type',
    ])
  })
})
