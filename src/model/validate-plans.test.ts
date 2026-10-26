import { describe, expect, it } from 'vitest'
import { ROLLOUT_ID, rolloutWorkspace, siteId, waveId } from '@/test/rollout-fixture'
import { rolloutPlanOf, type SitePlan, type WavePlan } from './plan'
import { validate } from './validate'
import type { Workspace } from './workspace'

/**
 * A plan's references, reported by `validate()` (#209). Each case breaks one
 * reference of a fixture that has no findings, and expects exactly one.
 */

function workspaceWith(change: (workspace: Workspace, site: SitePlan) => void): Workspace {
  const workspace = rolloutWorkspace(12)
  const plan = rolloutPlanOf(workspace.elements.find((element) => element.id === ROLLOUT_ID))!
  change(
    workspace,
    plan.sites.find((site) => site.location === siteId(4))!,
  )
  return workspace
}

function planCodes(workspace: Workspace): string[] {
  return validate(workspace)
    .findings.map((finding) => finding.code)
    .filter((code) => code.startsWith('plan.'))
}

describe('validate() on rollouts (#209)', () => {
  it('finds nothing wrong with a rollout whose references all hold', () => {
    expect(validate(rolloutWorkspace(12)).findings).toEqual([])
  })

  it('reports a site plan whose Location was deleted, against its rollout', () => {
    const workspace = workspaceWith((ws) => {
      ws.elements = ws.elements.filter((element) => element.id !== siteId(4))
    })
    const findings = validate(workspace).findings.filter((f) => f.code.startsWith('plan.'))
    expect(findings).toEqual([
      expect.objectContaining({
        code: 'plan.site-location-missing',
        subjectId: ROLLOUT_ID,
        subjectKind: 'element',
        message: expect.stringContaining(siteId(4)),
      }),
    ])
  })

  it('reports a site plan keyed by an element that is not a Location', () => {
    expect(planCodes(workspaceWith((_, site) => (site.location = 'app-claims')))).toEqual([
      'plan.site-not-a-location',
    ])
  })

  it('reports a site in a wave that is not one of the rollout’s', () => {
    expect(planCodes(workspaceWith((_, site) => (site.wave = 'wp-nope')))).toEqual([
      'plan.site-wave-unknown',
    ])
    // A real wave, of another rollout.
    const other = workspaceWith((ws, site) => {
      const wave = ws.elements.find((element) => element.id === waveId(2))!
      ;(wave.plan as WavePlan).rollout = 'wp-elsewhere'
      site.wave = waveId(2)
    })
    expect(planCodes(other)).toContain('plan.site-wave-unknown')
  })

  it('reports an archetype the rollout does not define', () => {
    expect(planCodes(workspaceWith((_, site) => (site.archetype = 'warehouse')))).toEqual([
      'plan.site-archetype-unknown',
    ])
  })

  it('reports a planned or actual date for a milestone the rollout does not have', () => {
    expect(
      planCodes(
        workspaceWith((_, site) => {
          site.milestones = { goLive: { date: '2027-05-12', precision: 'day' } }
        }),
      ),
    ).toEqual(['plan.site-milestone-unknown'])
    expect(
      planCodes(workspaceWith((_, site) => (site.actuals = { goLive: '2027-05-12' }))),
    ).toEqual(['plan.site-milestone-unknown'])
  })

  it('reports a wave whose rollout is not in the model', () => {
    // The rollout deleted on its own, as the inventory's Delete would: its five waves stay.
    const workspace = workspaceWith((ws) => {
      ws.elements = ws.elements.filter((element) => element.id !== ROLLOUT_ID)
      ws.relationships = ws.relationships.filter((r) => r.source !== ROLLOUT_ID)
    })
    expect(planCodes(workspace)).toEqual(Array(5).fill('plan.wave-rollout-missing'))
  })
})
