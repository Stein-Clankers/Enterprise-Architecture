import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { rolloutPlanOf, validate, wavePlanOf, type Workspace } from '@/model'
import { ROLLOUT_ID, rolloutWorkspace, siteId, waveId } from '@/test/rollout-fixture'
import { fromCanonicalJson, toCanonicalJson } from './canonical-json'
import { exportExchange, importExchangeXml } from './exchange-format'
import { buildWorkspaceJsonSchema } from './json-schema'

/**
 * Rollouts, waves and site plans through both formats (#209), at the scale of
 * the first programme: 160 sites.
 */

function fromXml(xml: string): { workspace: Workspace; codes: string[] } {
  const result = importExchangeXml(xml)
  if (!result.workspace) throw new Error(JSON.stringify(result.problems))
  return { workspace: result.workspace, codes: result.problems.map((p) => p.code) }
}

describe('a 160-site rollout round trip (#209)', () => {
  const workspace = rolloutWorkspace(160)

  it('holds what the acceptance criteria need: 160 sites, waves, and every field', () => {
    const plan = rolloutPlanOf(workspace.elements.find((element) => element.id === ROLLOUT_ID))
    expect(plan?.sites).toHaveLength(160)
    expect(plan?.sites.filter((site) => site.wave === undefined).length).toBeGreaterThan(0)
    expect(plan?.sites.filter((site) => site.notes !== undefined).length).toBeGreaterThan(0)
    expect(workspace.elements.filter((element) => wavePlanOf(element))).toHaveLength(5)
    expect(validate(workspace).findings).toEqual([])
  })

  it('canonical JSON: export → import → export is byte-identical (ADR 0004)', () => {
    const first = toCanonicalJson(workspace)
    const result = fromCanonicalJson(first)
    expect(result.problems).toEqual([])
    expect(toCanonicalJson(result.workspace!)).toBe(first)
    // The plan is in the file, not lost on the way to a stable empty one.
    expect(first).toContain('"location": "loc-site-160"')
  })

  it('writes the site plans sorted by location, whatever order the model holds them in', () => {
    const shuffled = structuredClone(workspace)
    const plan = rolloutPlanOf(shuffled.elements.find((element) => element.id === ROLLOUT_ID))!
    plan.sites.reverse()
    plan.archetypes.reverse()
    plan.constraints!.blackouts!.reverse()
    expect(toCanonicalJson(shuffled)).toBe(toCanonicalJson(workspace))
  })

  it('the canonical file validates against the published schema', () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true })
    addFormats(ajv)
    const check = ajv.compile(buildWorkspaceJsonSchema())
    expect(check(JSON.parse(toCanonicalJson(workspace))), JSON.stringify(check.errors)).toBe(true)
  })

  it('exchange XML: the plan comes back intact, with no problems', () => {
    const { xml, problems } = exportExchange(workspace)
    expect(problems).toEqual([])
    const { workspace: back, codes } = fromXml(xml)
    expect(codes).toEqual([])
    expect(toCanonicalJson(back)).toBe(toCanonicalJson(workspace))
  })

  it('exchange XML: writes the site plans by location, whatever order the model holds them in', () => {
    const reversed = structuredClone(workspace)
    const plan = rolloutPlanOf(reversed.elements.find((element) => element.id === ROLLOUT_ID))!
    plan.sites.reverse()
    // The fixture numbers its sites in order, so only a reversed copy can test the sort.
    expect(plan.sites[0]?.location).toBe(siteId(160))
    expect(exportExchange(reversed).xml).toBe(exportExchange(workspace).xml)
  })

  it('exchange XML: export → import → export is byte-identical', () => {
    const first = exportExchange(workspace).xml
    expect(exportExchange(fromXml(first).workspace).xml).toBe(first)
  })

  it('writes each site plan as a Work Package aggregated by its wave and associated with its Location', () => {
    const { xml } = exportExchange(workspace)
    const id = `${ROLLOUT_ID}.site.${siteId(3)}`
    expect(xml).toContain(`<element identifier="${id}" xsi:type="WorkPackage">`)
    const site3 = rolloutPlanOf(
      workspace.elements.find((element) => element.id === ROLLOUT_ID),
    )!.sites.find((site) => site.location === siteId(3))!
    expect(xml).toContain(`source="${site3.wave}" target="${id}" xsi:type="Aggregation"`)
    expect(xml).toContain(`source="${id}" target="${siteId(3)}" xsi:type="Association"`)
    // An unassigned site is aggregated by the rollout.
    const unassigned = `${ROLLOUT_ID}.site.${siteId(17)}`
    expect(xml).toContain(`source="${ROLLOUT_ID}" target="${unassigned}" xsi:type="Aggregation"`)
    // The waves are model elements, written as ever, with their plan as properties.
    expect(xml).toContain(`<element identifier="${waveId(0)}" xsi:type="WorkPackage">`)
  })

  it('adds no element to the model for a site plan: 160 plans, 160 Locations', () => {
    const back = fromXml(exportExchange(workspace).xml).workspace
    expect(back.elements).toHaveLength(workspace.elements.length)
    expect(back.relationships).toHaveLength(workspace.relationships.length)
  })
})
