import type { Archetype, Milestone } from './plan'

/**
 * Rollout presets (#213, proposal §4.8, ADR 0013 point 6): a preset is
 * **data**, a milestone set and default durations between its milestones,
 * never code. ERP, network or workplace rollouts are more entries here.
 *
 * The milestone sets are the proposal's: the generic one from §4.5's table,
 * where cutover starts Hypercare, and the data-migration one from §4.8's. The
 * durations are **our own** defaults, not taken from any source: they are
 * starting points a rollout edits, nothing more.
 *
 * A rollout made from a preset gets its milestones, and one archetype,
 * Standard, holding the durations: spacing is an archetype's (ADR 0016), so a
 * site takes these defaults once it is a Standard site. Its label says the
 * durations are placeholders (`STANDARD_ARCHETYPE_LABEL`), so every screen
 * that shows a site's archetype says so too, until an archetype editor lets
 * a programme replace them (#229 review, ADR 0016 point 7).
 */

export const ROLLOUT_PRESET_IDS = ['generic', 'dataMigration'] as const
export type RolloutPresetId = (typeof ROLLOUT_PRESET_IDS)[number]

/**
 * A site's data residency (proposal §4.8): its data may go anywhere, must
 * stay in its region, or must stay in its country.
 */
export const RESIDENCY_CLASSES = ['none', 'region', 'country'] as const
export type ResidencyClass = (typeof RESIDENCY_CLASSES)[number]

export function isResidencyClass(value: unknown): value is ResidencyClass {
  return (RESIDENCY_CLASSES as readonly unknown[]).includes(value)
}

/** The site field a site's residency class is kept in, until #70's custom fields (ADR 0013 point 8). */
export const RESIDENCY_FIELD = 'archipelago.site.residency'

/**
 * The checks a preset adds to every rollout's (proposal §4.8, `plan-checks.ts`),
 * as data: each names the milestones it reads by id. A rollout made from the
 * preset may since have deleted one; the check then says it cannot run.
 */
export interface PresetChecks {
  /** Mock loads: each of these milestones is reached before cutover. */
  mockLoads?: readonly string[]
  /** The freeze runs from `start` to `end` and must stay clear of every blackout. */
  freeze?: { start: string; end: string }
  /** Reconciliation: `signedOff` is reached before `before`. */
  reconciliation?: { signedOff: string; before: string }
  /** Residency: a site's class is its `field`; its data moves to each `replace`'s successor. */
  residency?: { field: string }
}

export interface RolloutPreset {
  id: RolloutPresetId
  label: string
  description: string
  milestones: Milestone[]
  /** Days from the previous milestone, by milestone id: ours, not sourced. */
  durations: Record<string, number>
  checks: PresetChecks
}

export const ROLLOUT_PRESETS: Record<RolloutPresetId, RolloutPreset> = {
  generic: {
    id: 'generic',
    label: 'Generic',
    description: 'Readiness, go/no-go, cutover, hypercare end, legacy retired.',
    milestones: [
      { id: 'readiness', label: 'Readiness starts', startsPhase: 'preparing' },
      { id: 'goNoGo', label: 'Go/no-go', startsPhase: 'preparing' },
      { id: 'cutover', label: 'Cutover', startsPhase: 'hypercare' },
      { id: 'hypercareEnd', label: 'Hypercare ends', startsPhase: 'migrated' },
      { id: 'legacyRetired', label: 'Legacy retired', startsPhase: 'done' },
    ],
    durations: { goNoGo: 28, cutover: 7, hypercareEnd: 28, legacyRetired: 90 },
    checks: {},
  },
  dataMigration: {
    id: 'dataMigration',
    label: 'Data migration',
    description:
      'Mapping, two mock loads, dress rehearsal, freeze, reconciliation, hypercare and decommissioning.',
    milestones: [
      { id: 'mappingSignedOff', label: 'Mapping signed off', startsPhase: 'preparing' },
      { id: 'mockLoad1', label: 'Mock load 1', startsPhase: 'preparing' },
      { id: 'mockLoad2', label: 'Mock load 2', startsPhase: 'preparing' },
      { id: 'dressRehearsal', label: 'Dress rehearsal', startsPhase: 'preparing' },
      { id: 'goNoGo', label: 'Go/no-go', startsPhase: 'preparing' },
      { id: 'freezeStart', label: 'Freeze starts', startsPhase: 'cutover' },
      {
        id: 'reconciliationSignedOff',
        label: 'Reconciliation signed off',
        startsPhase: 'hypercare',
      },
      { id: 'hypercareEnd', label: 'Hypercare ends', startsPhase: 'migrated' },
      { id: 'legacyReadOnly', label: 'Legacy read-only', startsPhase: 'migrated' },
      { id: 'legacyDecommissioned', label: 'Legacy decommissioned', startsPhase: 'done' },
    ],
    durations: {
      mockLoad1: 21,
      mockLoad2: 21,
      dressRehearsal: 14,
      goNoGo: 7,
      freezeStart: 3,
      reconciliationSignedOff: 4,
      hypercareEnd: 28,
      legacyReadOnly: 1,
      legacyDecommissioned: 90,
    },
    // Proposal §4.8, "Checks only this preset adds": the freeze runs from its
    // start to reconciliation, which signs the migrated data off.
    checks: {
      mockLoads: ['mockLoad1', 'mockLoad2'],
      freeze: { start: 'freezeStart', end: 'reconciliationSignedOff' },
      reconciliation: { signedOff: 'reconciliationSignedOff', before: 'hypercareEnd' },
      residency: { field: RESIDENCY_FIELD },
    },
  },
}

export function isRolloutPresetId(value: unknown): value is RolloutPresetId {
  return (ROLLOUT_PRESET_IDS as readonly unknown[]).includes(value)
}

/** The archetype a preset's durations are stored in. */
export const STANDARD_ARCHETYPE_ID = 'standard'

/**
 * Its label: the durations are ours, not a programme's, and a site whose
 * dates are spaced by them shows "inherited" dates nobody planned. Short
 * enough that the register's archetype column shows all of it in two lines:
 * "Standard (placeholder durations)" was cut to "Standard (pla…", hiding the
 * one word it is there for (#235 review).
 */
export const STANDARD_ARCHETYPE_LABEL = 'Standard (placeholder)'

/**
 * What a rollout made from `preset` starts with: fresh copies, so no edit
 * reaches the preset, and the preset's id, for the checks it adds (#214).
 */
export function presetPlan(preset: RolloutPreset): {
  preset: RolloutPresetId
  milestones: Milestone[]
  archetypes: Archetype[]
} {
  return {
    preset: preset.id,
    milestones: preset.milestones.map((milestone) => ({ ...milestone })),
    archetypes: [
      {
        id: STANDARD_ARCHETYPE_ID,
        label: STANDARD_ARCHETYPE_LABEL,
        durations: { ...preset.durations },
      },
    ],
  }
}
