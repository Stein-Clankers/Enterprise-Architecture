import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { smallWorkspace, syntheticWorkspace } from '@/test/fixtures'
import { buildWorkspaceJsonSchema, workspaceJsonSchemaText } from './json-schema'
import { toCanonicalJson } from './canonical-json'
import { loadDemoWorkspace } from './demo'

const SCHEMA_PATH = join(process.cwd(), 'design', 'archipelago-workspace.schema.json')

function validator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true })
  addFormats(ajv)
  return ajv.compile(buildWorkspaceJsonSchema())
}

/** What a workspace looks like once it has been through canonical JSON. */
function canonical(workspace: Parameters<typeof toCanonicalJson>[0]): unknown {
  return JSON.parse(toCanonicalJson(workspace))
}

describe('published JSON Schema', () => {
  it('matches the checked-in copy in design/', () => {
    const onDisk = readFileSync(SCHEMA_PATH, 'utf8')
    expect(onDisk, 'design/archipelago-workspace.schema.json is stale — run `npm run schema`').toBe(
      workspaceJsonSchemaText(),
    )
  })

  it('accepts the canonical form of a real workspace', () => {
    const validate = validator()
    expect(validate(canonical(smallWorkspace())), JSON.stringify(validate.errors)).toBe(true)
  })

  it('accepts the bundled demo', () => {
    const validate = validator()
    expect(validate(canonical(loadDemoWorkspace())), JSON.stringify(validate.errors)).toBe(true)
  })

  it('accepts a 500-element synthetic workspace', () => {
    const validate = validator()
    expect(validate(canonical(syntheticWorkspace(500))), JSON.stringify(validate.errors)).toBe(true)
  })

  it('rejects an unknown element type', () => {
    const validate = validator()
    expect(
      validate({
        schemaVersion: 1,
        id: 'ws',
        name: 'W',
        elements: [{ id: 'a', type: 'Microservice', name: 'A' }],
        relationships: [],
      }),
    ).toBe(false)
  })

  it('rejects an id that would not survive the exchange format', () => {
    const validate = validator()
    expect(
      validate({
        schemaVersion: 1,
        id: 'ws',
        name: 'W',
        elements: [{ id: '9-starts-with-a-digit', type: 'Capability', name: 'A' }],
        relationships: [],
      }),
    ).toBe(false)
  })

  it('rejects a fit level outside 1–4', () => {
    const validate = validator()
    expect(
      validate({
        schemaVersion: 1,
        id: 'ws',
        name: 'W',
        elements: [
          { id: 'a', type: 'ApplicationComponent', name: 'A', profile: { functionalFit: 7 } },
        ],
        relationships: [],
      }),
    ).toBe(false)
  })

  it('accepts a junction with an and/or kind, and rejects any other kind', () => {
    const validate = validator()
    const workspace = (junctionKind: string) => ({
      schemaVersion: 1,
      id: 'ws',
      name: 'W',
      elements: [{ id: 'j', type: 'Junction', name: 'Split', junctionKind }],
      relationships: [],
    })
    expect(validate(workspace('or')), JSON.stringify(validate.errors)).toBe(true)
    expect(validate(workspace('xor'))).toBe(false)
  })

  it('accepts a plan on a Work Package, and rejects the same plan on any other element', () => {
    const validate = validator()
    const workspace = (type: string) => ({
      schemaVersion: 6,
      id: 'ws',
      name: 'W',
      elements: [
        {
          id: 'w1',
          type,
          name: 'Wave 1',
          plan: { kind: 'wave', rollout: 'r', label: 'W1', order: 1, templateVersion: 1 },
        },
      ],
      relationships: [],
    })
    expect(validate(workspace('WorkPackage')), JSON.stringify(validate.errors)).toBe(true)
    expect(validate(workspace('Location'))).toBe(false)
    expect(validate.errors).toContainEqual(
      expect.objectContaining({
        instancePath: '/elements/0/type',
        params: { allowedValue: 'WorkPackage' },
      }),
    )
  })

  it('requires the fields an agent would need to write a valid file', () => {
    const validate = validator()
    expect(validate({ id: 'ws', name: 'W' })).toBe(false)
    expect(validate.errors?.some((e) => e.message?.includes('schemaVersion'))).toBe(true)
  })
})
