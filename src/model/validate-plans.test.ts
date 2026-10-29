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

  it('reports a wave’s date for a milestone its rollout does not have (#213)', () => {
    const workspace = workspaceWith((ws) => {
      const wave = ws.elements.find((element) => element.id === 'wp-wave-2')!
      if (wave.plan?.kind === 'wave') {
        wave.plan.milestones = { goLive: { date: '2027-05-12', precision: 'day' } }
      }
    })
    expect(planCodes(workspace)).toEqual(['plan.wave-milestone-unknown'])
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

describe('validate() on a rollout’s template, exceptions and dependencies (#214, #222)', () => {
  const planOf = (workspace: Workspace) =>
    rolloutPlanOf(workspace.elements.find((element) => element.id === ROLLOUT_ID))!
  const changeOf = (workspace: Workspace, id: string) =>
    planOf(workspace).template.find((change) => change.id === id)!

  /** The workspace with one template change edited. */
  const withChange = (id: string, edit: (change: Record<string, unknown>) => void) =>
    workspaceWith((ws) => edit(changeOf(ws, id) as unknown as Record<string, unknown>))

  it.each([
    ['introduce', 'tc-introduce-lake', 'sys-gone'],
    ['retire', 'tc-retire-store', 'sys-gone'],
    ['replace', 'tc-replace-store', 'sys-gone'],
    ['modify', 'tc-fit', 'sys-gone'],
    // A relationship's kinds: an element id is not one.
    ['add', 'tc-add-serving', 'sys-local-store'],
    ['remove', 'tc-remove-access', 'sys-local-store'],
  ])('reports a %s whose subject is not in the model', (_, id, subject) => {
    const workspace = withChange(id, (change) => (change.subject = subject))
    expect(planCodes(workspace)).toEqual(['plan.template-subject-unknown'])
  })

  it('takes a relationship id as the subject of an add, and not of a retire', () => {
    expect(planCodes(withChange('tc-add-serving', (c) => (c.subject = 'rel-app-obj')))).toEqual([])
    expect(planCodes(withChange('tc-retire-store', (c) => (c.subject = 'rel-app-obj')))).toEqual([
      'plan.template-subject-unknown',
    ])
  })

  it('reports a replace’s successor that is not in the model', () => {
    const workspace = withChange('tc-replace-store', (change) => (change.successor = 'sys-gone'))
    expect(planCodes(workspace)).toEqual(['plan.template-successor-unknown'])
  })

  it('reports a date anchored on a milestone the rollout does not have', () => {
    const workspace = withChange('tc-retire-store', (change) => {
      change.date = { anchor: 'goLive', offsetDays: 0 }
    })
    expect(planCodes(workspace)).toEqual(['plan.template-anchor-unknown'])
  })

  it('reports an aggregating rule for an element that is not in the model', () => {
    const workspace = withChange('tc-replace-store', (change) => {
      change.applicability = { kind: 'aggregating', element: 'sys-gone' }
    })
    expect(planCodes(workspace)).toEqual(['plan.template-applicability-unknown'])
  })

  it('reports an archetype rule naming an archetype the rollout does not define', () => {
    const workspace = withChange('tc-remove-access', (change) => {
      change.applicability = { kind: 'archetypes', archetypes: ['office', 'warehouse'] }
    })
    expect(planCodes(workspace)).toEqual(['plan.template-archetype-unknown'])
    expect(validate(workspace).findings[0]!.message).toContain('"warehouse"')
    expect(validate(workspace).findings[0]!.message).not.toContain('"office"')
  })

  it('reports an archetype’s duration keyed by a milestone the rollout does not have', () => {
    const workspace = workspaceWith((ws) => {
      planOf(ws).archetypes[0]!.durations = { freezeStart: 42, goLive: 7 }
    })
    expect(planCodes(workspace)).toEqual(['plan.archetype-duration-unknown'])
    expect(validate(workspace).findings[0]!.message).toContain('"goLive"')
  })

  it('reports a skip or a modify of a change the template does not have', () => {
    const skip = workspaceWith((_, site) => {
      site.exceptions = [{ id: 'ex-1', kind: 'skip', change: 'tc-gone', class: 'legal' }]
    })
    expect(planCodes(skip)).toEqual(['plan.exception-change-unknown'])
    expect(validate(skip).findings[0]!.message).toContain('skips "tc-gone"')
    const modify = workspaceWith((_, site) => {
      site.exceptions = [
        { id: 'ex-1', kind: 'modify', change: 'tc-gone', disposition: 'archive', class: 'legal' },
      ]
    })
    expect(planCodes(modify)).toEqual(['plan.exception-change-unknown'])
    expect(validate(modify).findings[0]!.message).toContain('modifies "tc-gone"')
  })

  it('reports another offset for a change dated on its own, and not another disposition', () => {
    const offset = workspaceWith((_, site) => {
      site.exceptions = [
        { id: 'ex-1', kind: 'modify', change: 'tc-fit', offsetDays: 7, class: 'legal' },
      ]
    })
    expect(planCodes(offset)).toEqual(['plan.exception-offset-unanchored'])
    const disposition = workspaceWith((_, site) => {
      site.exceptions = [
        { id: 'ex-1', kind: 'modify', change: 'tc-fit', disposition: 'retain', class: 'legal' },
      ]
    })
    expect(planCodes(disposition)).toEqual([])
    const anchored = workspaceWith((_, site) => {
      site.exceptions = [
        { id: 'ex-1', kind: 'modify', change: 'tc-retire-store', offsetDays: 7, class: 'legal' },
      ]
    })
    expect(planCodes(anchored)).toEqual([])
  })

  it.each([
    [{ subject: 'sys-gone' }, 'plan.exception-subject-unknown'],
    [{ successor: 'sys-gone' }, 'plan.exception-successor-unknown'],
    [{ date: { anchor: 'goLive', offsetDays: 0 } }, 'plan.exception-anchor-unknown'],
  ])('reports a site’s own change whose reference does not hold: %o', (broken, code) => {
    const workspace = workspaceWith((_, site) => {
      site.exceptions = [
        {
          id: 'ex-1',
          kind: 'add',
          change: {
            id: 'site-replace',
            kind: 'replace',
            subject: 'sys-local-store',
            successor: 'sys-central-store',
            date: { anchor: 'freezeStart', offsetDays: 0 },
            ...broken,
          },
          class: 'legal',
        },
      ]
    })
    expect(planCodes(workspace)).toEqual([code])
  })

  it('reports a dependency on the site itself, or on a site the rollout does not have', () => {
    expect(planCodes(workspaceWith((_, site) => (site.dependsOn = [siteId(4)])))).toEqual([
      'plan.site-dependency-self',
    ])
    expect(planCodes(workspaceWith((_, site) => (site.dependsOn = ['loc-emea'])))).toEqual([
      'plan.site-dependency-unknown',
    ])
    expect(planCodes(workspaceWith((_, site) => (site.dependsOn = [siteId(9)])))).toEqual([])
  })
})
