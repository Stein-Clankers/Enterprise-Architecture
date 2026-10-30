import { rolloutPlanOf, wavePlanOf, type ChangeEntry, type ChangeKind } from './plan'
import type { Finding } from './validate'
import type { Element, Relationship, Workspace } from './workspace'

/**
 * Referential integrity of rollouts, waves and site plans (#209).
 *
 * A site plan is keyed by a Location id, and deleting that Location leaves the
 * plan where it is: a plan holds the wave, dates, actuals and notes someone
 * entered, and dropping it quietly with the Location would lose all of that
 * (#209). It is reported here instead, against its rollout, so it can be
 * reassigned or removed on purpose. The same goes for the other references a
 * site plan or a wave holds: a wave, an archetype, a milestone, a wave's
 * rollout, the milestones a wave dates (#213), and a site's exceptions and
 * dependencies (#214).
 *
 * **The template's references** (#214, #222): a change's subject (an element,
 * or for `add` and `remove` a relationship) and successor, its applicability's
 * element and archetypes, its date's anchor, and the milestones an
 * archetype's durations are keyed by. A site's own changes (`add` exceptions)
 * are change entries too, and are checked the same way.
 *
 * These are integrity findings, not the plan checks of `plan-checks.ts` (a
 * wave over capacity, a cutover in a blackout): those judge a plan at a time
 * point, these say it points at something that is not there.
 */
export function planFindings(
  workspace: Workspace,
  elementsById: ReadonlyMap<string, Element>,
  findings: Finding[],
): void {
  const relationshipIds = new Set(workspace.relationships.map((r: Relationship) => r.id))
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
    const changes = new Map(plan.template.map((change) => [change.id, change]))
    const siteIds = new Set(plan.sites.map((site) => site.location))
    const refs: EntryReferences = {
      elements: elementsById,
      relationships: relationshipIds,
      milestones,
    }
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

      // A site's exceptions (#214): a skip or modify names a template change;
      // an add is a change entry of the site's own.
      for (const exception of site.exceptions ?? []) {
        const what = `Exception "${exception.id}" of site “${siteName}” in rollout “${rollout}”`
        if (exception.kind === 'add') {
          for (const [code, message] of entryReferences(exception.change, refs)) {
            findings.push(
              finding(`plan.exception-${code}`, `${what} adds a change that ${message}`),
            )
          }
          continue
        }
        const change = changes.get(exception.change)
        if (!change) {
          findings.push(
            finding(
              'plan.exception-change-unknown',
              `${what} ${exception.kind === 'skip' ? 'skips' : 'modifies'} "${exception.change}", which is not a change of the rollout’s template.`,
            ),
          )
        } else if (
          exception.kind === 'modify' &&
          exception.offsetDays !== undefined &&
          !('anchor' in change.date)
        ) {
          findings.push(
            finding(
              'plan.exception-offset-unanchored',
              `${what} gives template change "${change.id}" another offset, but that change is dated on its own, not from a milestone, so it has no offset to change.`,
            ),
          )
        }
      }

      // A site's dependencies (#214): each is another site of this rollout.
      for (const other of site.dependsOn ?? []) {
        if (other === site.location) {
          findings.push(
            finding(
              'plan.site-dependency-self',
              `Site “${siteName}” in rollout “${rollout}” depends on itself.`,
            ),
          )
        } else if (!siteIds.has(other)) {
          findings.push(
            finding(
              'plan.site-dependency-unknown',
              `Site “${siteName}” in rollout “${rollout}” depends on "${other}", which is not a site of the rollout.`,
            ),
          )
        }
      }
    }

    // The template's references (#214, #222).
    for (const change of plan.template) {
      const what = `Template change "${change.id}" of rollout “${rollout}”`
      for (const [code, message] of entryReferences(change, refs)) {
        findings.push(finding(`plan.template-${code}`, `${what} ${message}`))
      }
      const applicability = change.applicability
      if (applicability.kind === 'aggregating' && !elementsById.has(applicability.element)) {
        findings.push(
          finding(
            'plan.template-applicability-unknown',
            `${what} applies to the sites that aggregate "${applicability.element}", which is not an element in the model.`,
          ),
        )
      }
      if (applicability.kind === 'archetypes') {
        const missing = applicability.archetypes.filter((id) => !archetypes.has(id))
        if (missing.length) {
          findings.push(
            finding(
              'plan.template-archetype-unknown',
              `${what} applies to archetypes ${missing.map((id) => `"${id}"`).join(', ')}, which the rollout does not define.`,
            ),
          )
        }
      }
    }
    for (const archetype of plan.archetypes) {
      const unknownDurations = Object.keys(archetype.durations ?? {}).filter(
        (id) => !milestones.has(id),
      )
      if (unknownDurations.length) {
        findings.push(
          finding(
            'plan.archetype-duration-unknown',
            `Archetype "${archetype.id}" of rollout “${rollout}” has durations for ${unknownDurations.map((id) => `"${id}"`).join(', ')}, which ${unknownDurations.length === 1 ? 'is not a milestone' : 'are not milestones'} of the rollout.`,
          ),
        )
      }
    }
  }
}

const VERBS: Record<ChangeKind, string> = {
  introduce: 'introduces',
  retire: 'retires',
  replace: 'replaces',
  add: 'adds',
  remove: 'removes',
  modify: 'modifies',
}

/** What a change entry's references are checked against. */
export interface EntryReferences {
  elements: ReadonlyMap<string, Element>
  relationships: ReadonlySet<string>
  milestones: ReadonlySet<string>
}

/**
 * The references of a change entry that do not hold, each as a code suffix
 * and the end of a sentence. An `add` or `remove` dates a relationship, every
 * other kind an element (ADR 0014 §2); `replace` names its successor; an
 * anchored date names a milestone of the rollout.
 */
export function entryReferences(entry: ChangeEntry, refs: EntryReferences): [string, string][] {
  const out: [string, string][] = []
  const datesRelationship = entry.kind === 'add' || entry.kind === 'remove'
  const subjectHolds = datesRelationship
    ? refs.relationships.has(entry.subject)
    : refs.elements.has(entry.subject)
  if (!subjectHolds) {
    out.push([
      'subject-unknown',
      `${VERBS[entry.kind]} "${entry.subject}", which is not ${datesRelationship ? 'a relationship' : 'an element'} in the model.`,
    ])
  }
  if (entry.kind === 'replace' && !refs.elements.has(entry.successor)) {
    out.push([
      'successor-unknown',
      `replaces its subject with "${entry.successor}", which is not an element in the model.`,
    ])
  }
  if ('anchor' in entry.date && !refs.milestones.has(entry.date.anchor)) {
    out.push([
      'anchor-unknown',
      `is dated from "${entry.date.anchor}", which is not a milestone of the rollout.`,
    ])
  }
  return out
}
