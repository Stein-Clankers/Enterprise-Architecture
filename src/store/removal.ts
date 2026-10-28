import { rolloutPlanOf, wavePlanOf } from '@/model'
import type { Command } from './commands'

/**
 * What deleting some elements does, read off the commands that delete them
 * (#223). `ModelStore.removalPreview` hands a confirmation the summary of the
 * very commands `removeElement` dispatches, so a dialog cannot say less than
 * the delete does: when the cascade grows, the wording grows with it.
 */
export interface RemovalSummary {
  /** Relationships that go, each counted once. */
  relationships: number
  /** Waves that go though they were not asked for: a rollout's own. */
  waves: number
  /** Site plans that go with a rollout. */
  sitePlans: number
  /** Sites taken out of a wave that goes. They stay in their rollout. */
  unassigned: number
  /** Waves among the elements asked for. */
  askedWaves: number
}

export function removalSummary(
  requested: Iterable<string>,
  commands: readonly Command[],
): RemovalSummary {
  const asked = new Set(requested)
  const summary: RemovalSummary = {
    relationships: 0,
    waves: 0,
    sitePlans: 0,
    unassigned: 0,
    askedWaves: 0,
  }
  for (const command of commands) {
    if (command.kind === 'remove-element') {
      summary.relationships += command.cascaded.length
      if (wavePlanOf(command.element)) {
        if (asked.has(command.element.id)) summary.askedWaves += 1
        else summary.waves += 1
      }
      summary.sitePlans += rolloutPlanOf(command.element)?.sites.length ?? 0
    } else if (command.kind === 'update-element') {
      const before = rolloutPlanOf(command.before)
      const after = rolloutPlanOf(command.after)
      if (!before || !after) continue
      const waveAfter = new Map(after.sites.map((site) => [site.location, site.wave]))
      for (const site of before.sites) {
        if (site.wave !== undefined && waveAfter.get(site.location) === undefined) {
          summary.unassigned += 1
        }
      }
    }
  }
  return summary
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/**
 * What a delete does to plans, as the sentences a confirmation (`'asked'`)
 * or the notice after it (`'done'`) says; empty for an element with no plan.
 * The wave board's Delete wave and the fact sheet's and canvas's Delete from
 * model all say it through here (#223).
 */
export function planCascadeText(summary: RemovalSummary, when: 'asked' | 'done'): string {
  const sentences: string[] = []
  const { waves, sitePlans, unassigned } = summary
  const rollout: string[] = []
  if (waves > 0) {
    rollout.push(
      `${waves} wave${plural(waves, '', 's')} ${
        when === 'asked' ? plural(waves, 'goes', 'go') : 'went'
      } with it`,
    )
  }
  if (sitePlans > 0) {
    const verb =
      when === 'asked' ? plural(sitePlans, 'is', 'are') : plural(sitePlans, 'was', 'were')
    rollout.push(`${sitePlans} site plan${plural(sitePlans, '', 's')} ${verb} removed`)
  }
  if (rollout.length) sentences.push(`Its ${rollout.join(', and its ')}.`)
  if (unassigned > 0) {
    sentences.push(
      `Its ${unassigned} site${plural(unassigned, '', 's')} ${plural(unassigned, 'stays', 'stay')} in the rollout, unassigned, with ${plural(unassigned, 'its', 'their')} dates.`,
    )
  } else if (summary.askedWaves > 0 && when === 'asked') {
    sentences.push('No site is in it.')
  }
  return sentences.join(' ')
}
