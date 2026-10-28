import { rolloutPlanOf, wavePlanOf } from './plan'
import type { Finding } from './validate'
import type { Element, Workspace } from './workspace'

/**
 * Referential integrity of rollouts, waves and site plans (#209).
 *
 * A site plan is keyed by a Location id, and deleting that Location leaves the
 * plan where it is: a plan holds the wave, dates, actuals and notes someone
 * entered, and dropping it quietly with the Location would lose all of that
 * (#209). It is reported here instead, against its rollout, so it can be
 * reassigned or removed on purpose. The same goes for the other references a
 * site plan or a wave holds: a wave, an archetype, a milestone, a wave's
 * rollout, the milestones a wave dates (#213). The references in a rollout's template (a change's subject and
 * successor, its applicability, a date's anchor, an archetype's durations) are
 * not checked yet: #214, which owns plan checks, reports them.
 *
 * These are integrity findings, not the plan checks of #214 (a wave over
 * capacity, a cutover in a blackout): those judge a plan, these say it points
 * at something that is not there.
 */
export function planFindings(
  workspace: Workspace,
  elementsById: ReadonlyMap<string, Element>,
  findings: Finding[],
): void {
  for (const element of workspace.elements) {
    const wave = wavePlanOf(element)
    const waveRollout = wave && rolloutPlanOf(elementsById.get(wave.rollout))
    if (wave && !waveRollout) {
      findings.push({
        severity: 'warning',
        code: 'plan.wave-rollout-missing',
        message: `Wave “${element.name}” belongs to rollout "${wave.rollout}", which is not a rollout in the model.`,
        subjectId: element.id,
        subjectKind: 'element',
      })
    }
    if (wave && waveRollout) {
      const known = new Set(waveRollout.milestones.map((milestone) => milestone.id))
      const unknown = Object.keys(wave.milestones ?? {}).filter((id) => !known.has(id))
      if (unknown.length) {
        findings.push({
          severity: 'warning',
          code: 'plan.wave-milestone-unknown',
          message: `Wave “${element.name}” has dates for ${unknown.map((id) => `"${id}"`).join(', ')}, which ${unknown.length === 1 ? 'is not a milestone' : 'are not milestones'} of its rollout.`,
          subjectId: element.id,
          subjectKind: 'element',
        })
      }
    }

    const plan = rolloutPlanOf(element)
    if (!plan) continue
    const rollout = element.name || element.id
    const milestones = new Set(plan.milestones.map((milestone) => milestone.id))
    const archetypes = new Set(plan.archetypes.map((archetype) => archetype.id))
    const finding = (code: string, message: string): Finding => ({
      severity: 'warning',
      code,
      message,
      subjectId: element.id,
      subjectKind: 'element',
    })

    for (const site of plan.sites) {
      const location = elementsById.get(site.location)
      if (!location) {
        findings.push(
          finding(
            'plan.site-location-missing',
            `Rollout “${rollout}” has a site plan for "${site.location}", which is no longer in the model. The plan is kept until it is reassigned or removed.`,
          ),
        )
      } else if (location.type !== 'Location') {
        findings.push(
          finding(
            'plan.site-not-a-location',
            `Rollout “${rollout}” has a site plan for “${location.name}”, which is a ${location.type}, not a Location.`,
          ),
        )
      }
      const siteName = location?.name ?? site.location
      if (
        site.wave !== undefined &&
        wavePlanOf(elementsById.get(site.wave))?.rollout !== element.id
      ) {
        findings.push(
          finding(
            'plan.site-wave-unknown',
            `Site “${siteName}” in rollout “${rollout}” is assigned to "${site.wave}", which is not a wave of this rollout.`,
          ),
        )
      }
      if (site.archetype !== undefined && !archetypes.has(site.archetype)) {
        findings.push(
          finding(
            'plan.site-archetype-unknown',
            `Site “${siteName}” in rollout “${rollout}” has archetype "${site.archetype}", which the rollout does not define.`,
          ),
        )
      }
      const unknown = [
        ...new Set([...Object.keys(site.milestones ?? {}), ...Object.keys(site.actuals ?? {})]),
      ].filter((id) => !milestones.has(id))
      if (unknown.length) {
        findings.push(
          finding(
            'plan.site-milestone-unknown',
            `Site “${siteName}” in rollout “${rollout}” has dates for ${unknown.map((id) => `"${id}"`).join(', ')}, which ${unknown.length === 1 ? 'is not a milestone' : 'are not milestones'} of the rollout.`,
          ),
        )
      }
    }
  }
}
