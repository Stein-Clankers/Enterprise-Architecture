import { isFitLevel, isTimeClassification, type FitLevel, type TimeClassification } from './profile'
import type { Element } from './workspace'

/**
 * Rollouts, waves and site plans (#209, ADR 0013).
 *
 * A **rollout** is a Work Package whose plan profile has `kind: 'rollout'`: it
 * holds the scope template, the milestone set, the constraints, the archetypes
 * and one **site plan** per Location. A **wave** is a Work Package with
 * `kind: 'wave'`, aggregated by its rollout. Site plans are records inside the
 * rollout, keyed by Location id (ADR 0013 point 3), not elements: 160 of them
 * would bury the ten Work Packages that matter in the inventory.
 *
 * This module holds the shapes and their type guards, and the calendar
 * arithmetic of plan dates. Date inheritance and the derived site phase are
 * `site-phase.ts` (#213), the presets `presets.ts`; exceptions, dependencies
 * and plan checks are #214. Every guard here is strict:
 * it accepts exactly the shape, with no key it does not know, so a value it
 * passes is one canonical JSON writes back unchanged and the published schema
 * accepts. The store calls them on the write path, the readers on the read path.
 */

// ── Plan dates ───────────────────────────────────────────────────────────────

/** How precise a plan date is, coarsest first (ADR 0013 point 5). */
export const PLAN_DATE_PRECISIONS = ['quarter', 'month', 'week', 'day'] as const
export type PlanDatePrecision = (typeof PLAN_DATE_PRECISIONS)[number]

/**
 * A date with a precision: "2027-Q2", "May 2027", "week 19 of 2027" or a day.
 *
 * `date` is an ISO day, and it is the **first day of the period** the precision
 * names: the first day of the quarter or month, the Monday of an ISO week, or
 * the day itself. One period therefore has one spelling, so two plans that say
 * the same thing write the same bytes (ADR 0004), and `isPlanDate` refuses a
 * day that does not start its period rather than guessing which one was meant
 * (ADR 0015 point 1).
 */
export interface PlanDate {
  date: string
  precision: PlanDatePrecision
}

export function isPlanDatePrecision(value: unknown): value is PlanDatePrecision {
  return typeof value === 'string' && (PLAN_DATE_PRECISIONS as readonly string[]).includes(value)
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

/** A UTC midnight; `setUTCFullYear` because `Date.UTC` reads 0–99 as 1900–1999. */
function utcDay(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

function isoDayOf(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** A real calendar day written `YYYY-MM-DD`: `2027-02-30` is not one. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_DAY.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return isoDayOf(utcDay(year, month, day)) === value
}

function parts(day: string): { year: number; month: number; date: Date } {
  const [year, month, dayOfMonth] = day.split('-').map(Number) as [number, number, number]
  return { year, month, date: utcDay(year, month, dayOfMonth) }
}

/** Monday is 0. */
function weekday(date: Date): number {
  return (date.getUTCDay() + 6) % 7
}

/** The ISO 8601 week a day falls in: the week of its Thursday. */
function isoWeekOf(date: Date): { year: number; week: number } {
  const thursday = new Date(date.getTime() + (3 - weekday(date)) * DAY_MS)
  const year = thursday.getUTCFullYear()
  const week = Math.floor((thursday.getTime() - utcDay(year, 1, 1).getTime()) / DAY_MS / 7) + 1
  return { year, week }
}

/** The Monday of ISO week `week` of `year`; week 1 is the one holding 4 January. */
function mondayOfIsoWeek(year: number, week: number): Date {
  const fourth = utcDay(year, 1, 4)
  return new Date(fourth.getTime() + ((week - 1) * 7 - weekday(fourth)) * DAY_MS)
}

/** Does `day` (an ISO day) start a period of `precision`? */
function startsPeriod(day: string, precision: PlanDatePrecision): boolean {
  const { month, date } = parts(day)
  switch (precision) {
    case 'quarter':
      return date.getUTCDate() === 1 && (month - 1) % 3 === 0
    case 'month':
      return date.getUTCDate() === 1
    case 'week':
      return weekday(date) === 0
    case 'day':
      return true
  }
}

/** Exactly `{ date, precision }`, with the date the first day of its period. */
export function isPlanDate(value: unknown): value is PlanDate {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['date', 'precision']) &&
    isPlanDatePrecision(value.precision) &&
    isIsoDay(value.date) &&
    startsPeriod(value.date, value.precision)
  )
}

/**
 * The write path's door for a plan date: a form's day and precision, as a
 * `PlanDate` or `undefined`. An empty field, a precision the select does not
 * offer, or a day that does not start its period yields `undefined`, never a
 * value the schema rejects (CLAUDE.md, type guards on the write path).
 */
export function toPlanDate(date: unknown, precision: unknown): PlanDate | undefined {
  const candidate = { date, precision }
  return isPlanDate(candidate) ? candidate : undefined
}

/**
 * A plan date as people write it, and as the exchange format and the rollout
 * workbook carry it: `2027-Q2`, `2027-05`, `2027-W19` or `2027-05-12`.
 */
export function formatPlanDate(value: PlanDate): string {
  const { year, month, date } = parts(value.date)
  switch (value.precision) {
    case 'quarter':
      return `${pad(year, 4)}-Q${Math.floor((month - 1) / 3) + 1}`
    case 'month':
      return value.date.slice(0, 7)
    case 'week': {
      const week = isoWeekOf(date)
      return `${pad(week.year, 4)}-W${pad(week.week)}`
    }
    case 'day':
      return value.date
  }
}

/**
 * The inverse of `formatPlanDate`: read by its form, never guessed. Anything
 * else, a week 53 in a year that has none included, is `undefined`.
 */
export function parsePlanDate(text: string): PlanDate | undefined {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(text)
  if (quarter) {
    const month = (Number(quarter[2]) - 1) * 3 + 1
    return { date: `${quarter[1]}-${pad(month)}-01`, precision: 'quarter' }
  }
  const month = /^(\d{4})-(\d{2})$/.exec(text)
  if (month) {
    const candidate = `${month[1]}-${month[2]}-01`
    return isIsoDay(candidate) ? { date: candidate, precision: 'month' } : undefined
  }
  const week = /^(\d{4})-W(\d{2})$/.exec(text)
  if (week) {
    const candidate: PlanDate = {
      date: isoDayOf(mondayOfIsoWeek(Number(week[1]), Number(week[2]))),
      precision: 'week',
    }
    return formatPlanDate(candidate) === text ? candidate : undefined
  }
  return isIsoDay(text) ? { date: text, precision: 'day' } : undefined
}

/**
 * The period of `precision` that the ISO day `day` falls in, as a plan date:
 * 2027-05-12 at week precision is the week of Monday 2027-05-10. The one door
 * from an arbitrary day to a plan date (ADR 0015 point 1): forms snap through
 * it, and so does a date spaced from another by days (#213).
 */
export function periodOf(day: string, precision: PlanDatePrecision): PlanDate {
  const { year, month, date } = parts(day)
  switch (precision) {
    case 'quarter':
      return { date: isoDayOf(utcDay(year, month - ((month - 1) % 3), 1)), precision }
    case 'month':
      return { date: isoDayOf(utcDay(year, month, 1)), precision }
    case 'week':
      return { date: isoDayOf(new Date(date.getTime() - weekday(date) * DAY_MS)), precision }
    case 'day':
      return { date: day, precision }
  }
}

/** The ISO day `days` whole days after `day`; negative is before it. */
export function addDays(day: string, days: number): string {
  return isoDayOf(new Date(parts(day).date.getTime() + days * DAY_MS))
}

/** UTC midnight of an ISO day, in ms: when a plan date's period starts. */
export function dayStart(day: string): number {
  return parts(day).date.getTime()
}

/**
 * The first day after the period a plan date names, as an ISO day: the
 * period's end, exclusive. `2027-Q2` runs to the day before `2027-07-01`.
 */
export function dayAfterPeriod(value: PlanDate): string {
  const { year, month, date } = parts(value.date)
  switch (value.precision) {
    case 'quarter':
      return isoDayOf(utcDay(year, month + 3, 1))
    case 'month':
      return isoDayOf(utcDay(year, month + 1, 1))
    case 'week':
      return isoDayOf(new Date(date.getTime() + 7 * DAY_MS))
    case 'day':
      return isoDayOf(new Date(date.getTime() + DAY_MS))
  }
}

/**
 * Whether a window ending in period `end` can start at `start`: the end's
 * period must run past the start's first day. Comparing first days refuses a
 * window from `2027-W14` (5 April) to `2027-Q2` (first day 1 April), though
 * the quarter runs to June (#223).
 */
export function isWindowInOrder(start: PlanDate, end: PlanDate): boolean {
  return dayAfterPeriod(end) > start.date
}

// ── Site phases and milestones ───────────────────────────────────────────────

/**
 * The fixed set of site phases (ADR 0013 point 6). A site's phase is derived
 * from its milestones and never stored (#213); the set is here because each
 * milestone names the phase it starts.
 */
export const SITE_PHASES = [
  'unplanned',
  'planned',
  'preparing',
  'cutover',
  'hypercare',
  'migrated',
  'done',
] as const
export type SitePhase = (typeof SITE_PHASES)[number]

export const SITE_PHASE_LABELS: Record<SitePhase, string> = {
  unplanned: 'Unplanned',
  planned: 'Planned',
  preparing: 'Preparing',
  cutover: 'Cutover',
  hypercare: 'Hypercare',
  migrated: 'Migrated',
  done: 'Done',
}

/** A milestone starts any phase but Unplanned, which is a site in no wave. */
export type MilestonePhase = Exclude<SitePhase, 'unplanned'>
export const MILESTONE_PHASES: readonly MilestonePhase[] = SITE_PHASES.filter(
  (phase): phase is MilestonePhase => phase !== 'unplanned',
)

export function isMilestonePhase(value: unknown): value is MilestonePhase {
  return (MILESTONE_PHASES as readonly unknown[]).includes(value)
}

/** One milestone of a rollout's ordered set: data, never code (ADR 0013 point 6). */
export interface Milestone {
  id: string
  label: string
  startsPhase: MilestonePhase
  /**
   * The rollout's own date for this milestone: what a site inherits when
   * neither it nor its wave sets one (ADR 0013 point 5, ADR 0016).
   */
  date?: PlanDate
}

export function isMilestone(value: unknown): value is Milestone {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'label', 'startsPhase', 'date']) &&
    isId(value.id) &&
    typeof value.label === 'string' &&
    isMilestonePhase(value.startsPhase) &&
    (value.date === undefined || isPlanDate(value.date))
  )
}

// ── Change entries (ADR 0014 §2) ─────────────────────────────────────────────

/** What a change entry does at its date (ADR 0014 §2). */
export const CHANGE_KINDS = ['introduce', 'retire', 'replace', 'add', 'remove', 'modify'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]

/** The fields a `modify` entry may plan a value for (ADR 0014 §5), until #70 adds custom fields. */
export const PLANNABLE_FIELDS = ['functionalFit', 'technicalFit', 'timeClassification'] as const
export type PlannableField = (typeof PLANNABLE_FIELDS)[number]

export function isPlannableField(value: unknown): value is PlannableField {
  return (PLANNABLE_FIELDS as readonly unknown[]).includes(value)
}

/**
 * A date its owner resolves: a milestone of the rollout plus a number of days,
 * such as "cutover + 30". For a rollout's template the milestone is the site's
 * (ADR 0013 point 4). Nothing resolves one yet (#213, R3).
 */
export interface AnchoredDate {
  /** A milestone id of the owning rollout. */
  anchor: string
  /** Whole days after the anchor; negative is before it. */
  offsetDays: number
}

export function isAnchoredDate(value: unknown): value is AnchoredDate {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['anchor', 'offsetDays']) &&
    isId(value.anchor) &&
    Number.isSafeInteger(value.offsetDays)
  )
}

/** An entry's date: a plan date, or a reference its owner resolves (ADR 0014 §2). */
export type EntryDate = PlanDate | AnchoredDate

export function isEntryDate(value: unknown): value is EntryDate {
  return isPlanDate(value) || isAnchoredDate(value)
}

interface ChangeEntryBase {
  id: string
  /** The element (introduce, retire, replace, modify) or relationship (add, remove) it dates. */
  subject: string
  date: EntryDate
}

/**
 * A change entry, as ADR 0014 §2 defines it: it dates something that exists
 * in the model and never holds a model object. Initiatives (#60) own a list of
 * these; a rollout's template is a list of them with an applicability rule.
 */
export type ChangeEntry =
  | (ChangeEntryBase & { kind: 'introduce' | 'retire' | 'add' | 'remove' })
  | (ChangeEntryBase & { kind: 'replace'; successor: string })
  | (ChangeEntryBase & { kind: 'modify'; field: 'functionalFit' | 'technicalFit'; value: FitLevel })
  | (ChangeEntryBase & { kind: 'modify'; field: 'timeClassification'; value: TimeClassification })

const ENTRY_KEYS = ['id', 'kind', 'subject', 'date'] as const

/** `extra` names the keys beside the entry's own that the caller allows. */
function isChangeEntryWith(value: unknown, extra: readonly string[]): value is ChangeEntry {
  if (!isRecord(value)) return false
  if (!isId(value.id) || !isId(value.subject) || !isEntryDate(value.date)) return false
  switch (value.kind) {
    case 'introduce':
    case 'retire':
    case 'add':
    case 'remove':
      return hasOnlyKeys(value, [...ENTRY_KEYS, ...extra])
    case 'replace':
      return hasOnlyKeys(value, [...ENTRY_KEYS, 'successor', ...extra]) && isId(value.successor)
    case 'modify':
      return (
        hasOnlyKeys(value, [...ENTRY_KEYS, 'field', 'value', ...extra]) &&
        (value.field === 'timeClassification'
          ? isTimeClassification(value.value)
          : isPlannableField(value.field) && isFitLevel(value.value))
      )
    default:
      return false
  }
}

export function isChangeEntry(value: unknown): value is ChangeEntry {
  return isChangeEntryWith(value, [])
}

/** Which sites a template change applies to (ADR 0013 point 4). */
export type Applicability =
  | { kind: 'all' }
  | { kind: 'archetypes'; archetypes: string[] }
  /** Sites whose Location aggregates this element. */
  | { kind: 'aggregating'; element: string }

export function isApplicability(value: unknown): value is Applicability {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case 'all':
      return hasOnlyKeys(value, ['kind'])
    case 'archetypes':
      return (
        hasOnlyKeys(value, ['kind', 'archetypes']) &&
        Array.isArray(value.archetypes) &&
        value.archetypes.length > 0 &&
        value.archetypes.every(isId) &&
        new Set(value.archetypes).size === value.archetypes.length
      )
    case 'aggregating':
      return hasOnlyKeys(value, ['kind', 'element']) && isId(value.element)
    default:
      return false
  }
}

/** One change of a rollout's scope template: a change entry written relative to a site. */
export type TemplateChange = ChangeEntry & { applicability: Applicability }

export function isTemplateChange(value: unknown): value is TemplateChange {
  return (
    isRecord(value) &&
    isApplicability(value.applicability) &&
    isChangeEntryWith(value, ['applicability'])
  )
}

// ── Archetypes and constraints ───────────────────────────────────────────────

/**
 * A kind of site, such as Plant or Office. Which template changes apply to it
 * is said by each change's applicability, so it is said once.
 */
export interface Archetype {
  id: string
  label: string
  /**
   * Default days from the previous milestone to each milestone, keyed by
   * milestone id. A site of this archetype whose milestone neither it, its
   * wave nor the rollout dates is spaced from its neighbour by these
   * (`resolveSiteMilestones`, ADR 0016).
   */
  durations?: Record<string, number>
}

export function isArchetype(value: unknown): value is Archetype {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'label', 'durations']) &&
    isId(value.id) &&
    typeof value.label === 'string' &&
    (value.durations === undefined || isRecordOf(value.durations, isDayCount))
  )
}

/** A period no cutover should fall in, both days inclusive. */
export interface Blackout {
  id: string
  label?: string
  start: string
  end: string
}

export function isBlackout(value: unknown): value is Blackout {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['id', 'label', 'start', 'end']) &&
    isId(value.id) &&
    (value.label === undefined || typeof value.label === 'string') &&
    isIsoDay(value.start) &&
    isIsoDay(value.end) &&
    value.start <= value.end
  )
}

/** Rollout-wide constraints (ADR 0013 point 1); sites add their own blackouts later. */
export interface RolloutConstraints {
  blackouts?: Blackout[]
  /** Sites per wave, for a wave that sets no capacity of its own. */
  defaultCapacity?: number
}

export function isRolloutConstraints(value: unknown): value is RolloutConstraints {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['blackouts', 'defaultCapacity']) &&
    (value.blackouts === undefined || isUniqueList(value.blackouts, isBlackout)) &&
    (value.defaultCapacity === undefined || isPositiveInteger(value.defaultCapacity))
  )
}

// ── Site plans ───────────────────────────────────────────────────────────────

/** A human judgement of a site's health, never derived (proposal §4.5). */
export const SITE_RAGS = ['green', 'amber', 'red'] as const
export type SiteRag = (typeof SITE_RAGS)[number]

export function isSiteRag(value: unknown): value is SiteRag {
  return (SITE_RAGS as readonly unknown[]).includes(value)
}

/**
 * The decision taken at a site's go/no-go gate (proposal §5, L3): a human
 * decision, recorded as the PMO returns it in the workbook, never derived.
 * Absent means not decided yet. It does not move the phase: a milestone's
 * actual day does (#215).
 */
export const GO_NO_GO_DECISIONS = ['go', 'no-go'] as const
export type GoNoGo = (typeof GO_NO_GO_DECISIONS)[number]

export function isGoNoGo(value: unknown): value is GoNoGo {
  return (GO_NO_GO_DECISIONS as readonly unknown[]).includes(value)
}

/**
 * One Location's plan within one rollout (proposal §4.4). Exceptions and
 * dependencies arrive with #214. The actual days, the RAG and the go/no-go
 * decision are what the PMO returns in the rollout workbook (#215).
 */
export interface SitePlan {
  /** The Location element's id: the key of the record within its rollout. */
  location: string
  /** A wave of the same rollout; absent means not yet assigned. */
  wave?: string
  /** An archetype id of the same rollout. */
  archetype?: string
  /** Overrides only, keyed by milestone id; the rest inherit (#213). */
  milestones?: Record<string, PlanDate>
  /** ISO day each milestone was actually reached, keyed by milestone id. */
  actuals?: Record<string, string>
  rag?: SiteRag
  /** The go/no-go decision, when it has been taken (#215). */
  goNoGo?: GoNoGo
  notes?: string
}

export function isSitePlan(value: unknown): value is SitePlan {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'location',
      'wave',
      'archetype',
      'milestones',
      'actuals',
      'rag',
      'goNoGo',
      'notes',
    ]) &&
    isId(value.location) &&
    (value.wave === undefined || isId(value.wave)) &&
    (value.archetype === undefined || isId(value.archetype)) &&
    (value.milestones === undefined || isRecordOf(value.milestones, isPlanDate)) &&
    (value.actuals === undefined || isRecordOf(value.actuals, isIsoDay)) &&
    (value.rag === undefined || isSiteRag(value.rag)) &&
    (value.goNoGo === undefined || isGoNoGo(value.goNoGo)) &&
    (value.notes === undefined || typeof value.notes === 'string')
  )
}

// ── Plan profiles ────────────────────────────────────────────────────────────

/** The plan profile of a rollout Work Package (ADR 0013 point 1). */
export interface RolloutPlan {
  kind: 'rollout'
  /** Bumped when the template changes; each wave records the one it is locked to. */
  templateVersion: number
  /** Ordered: phase derivation walks it in this order (#213). */
  milestones: Milestone[]
  /** Ordered, as the author wrote it. */
  template: TemplateChange[]
  constraints?: RolloutConstraints
  archetypes: Archetype[]
  /** One per Location, sorted by location id. */
  sites: SitePlan[]
}

/** A wave's start and end. Either may be unset while the plan is coarse. */
export interface WaveWindow {
  start?: PlanDate
  end?: PlanDate
}

/** The plan profile of a wave Work Package (ADR 0013 point 2). */
export interface WavePlan {
  kind: 'wave'
  /** The rollout Work Package that aggregates this wave. */
  rollout: string
  /** Short label: Pilot, W1, W2. The element's name stays the full name. */
  label: string
  /** Position among the rollout's waves, ascending. */
  order: number
  window?: WaveWindow
  /** Maximum number of sites. */
  capacity?: number
  /** The template version this wave is locked to. */
  templateVersion: number
  /**
   * The dates its sites inherit, keyed by milestone id (proposal §4.3): a site
   * that sets none of its own takes the wave's (ADR 0013 point 5).
   */
  milestones?: Record<string, PlanDate>
}

export type PlanProfile = RolloutPlan | WavePlan

/** Only a Work Package carries a plan profile (ADR 0013 points 1 and 2). */
export const PLAN_ELEMENT_TYPE = 'WorkPackage' as const

export function isWaveWindow(value: unknown): value is WaveWindow {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['start', 'end']) &&
    (value.start === undefined || isPlanDate(value.start)) &&
    (value.end === undefined || isPlanDate(value.end))
  )
}

export function isRolloutPlan(value: unknown): value is RolloutPlan {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'kind',
      'templateVersion',
      'milestones',
      'template',
      'constraints',
      'archetypes',
      'sites',
    ]) &&
    value.kind === 'rollout' &&
    isPositiveInteger(value.templateVersion) &&
    isUniqueList(value.milestones, isMilestone) &&
    isUniqueList(value.template, isTemplateChange) &&
    (value.constraints === undefined || isRolloutConstraints(value.constraints)) &&
    isUniqueList(value.archetypes, isArchetype) &&
    Array.isArray(value.sites) &&
    value.sites.every(isSitePlan) &&
    new Set(value.sites.map((site: SitePlan) => site.location)).size === value.sites.length
  )
}

export function isWavePlan(value: unknown): value is WavePlan {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'kind',
      'rollout',
      'label',
      'order',
      'window',
      'capacity',
      'templateVersion',
      'milestones',
    ]) &&
    value.kind === 'wave' &&
    isId(value.rollout) &&
    typeof value.label === 'string' &&
    Number.isSafeInteger(value.order) &&
    (value.window === undefined || isWaveWindow(value.window)) &&
    (value.capacity === undefined || isPositiveInteger(value.capacity)) &&
    isPositiveInteger(value.templateVersion) &&
    (value.milestones === undefined || isRecordOf(value.milestones, isPlanDate))
  )
}

export function isPlanProfile(value: unknown): value is PlanProfile {
  return isRolloutPlan(value) || isWavePlan(value)
}

// ── Reading plans off the model ──────────────────────────────────────────────

/** The rollout plan of `element`, when it is a rollout. */
export function rolloutPlanOf(element: Element | undefined): RolloutPlan | undefined {
  return element?.plan?.kind === 'rollout' ? element.plan : undefined
}

/** The wave plan of `element`, when it is a wave. */
export function wavePlanOf(element: Element | undefined): WavePlan | undefined {
  return element?.plan?.kind === 'wave' ? element.plan : undefined
}

/** The waves of a rollout, by order and then id, so ties cannot reorder between runs. */
export function wavesOf(elements: Iterable<Element>, rolloutId: string): Element[] {
  const waves: { element: Element; order: number }[] = []
  for (const element of elements) {
    const plan = wavePlanOf(element)
    if (plan?.rollout === rolloutId) waves.push({ element, order: plan.order })
  }
  return waves
    .sort(
      (a, b) =>
        a.order - b.order ||
        (a.element.id < b.element.id ? -1 : a.element.id > b.element.id ? 1 : 0),
    )
    .map((wave) => wave.element)
}

/**
 * The write path's door for a wave: `value` as a wave id of `rolloutId`, or
 * `undefined`. A `<select>`'s empty option, an id that is not in the model, and
 * a wave of another rollout all fail here, so none of them can be stored.
 */
export function waveIdOf(
  value: unknown,
  rolloutId: string,
  element: (id: string) => Element | undefined,
): string | undefined {
  // `typeof` is for the compiler: an id that is no wave of the rollout, `''`
  // included, fails the membership check, which is what refuses at run time.
  const wave = typeof value === 'string' ? element(value) : undefined
  return wavePlanOf(wave)?.rollout === rolloutId ? wave?.id : undefined
}

/** The write path's door for an archetype: an archetype id of `plan`, or `undefined`. */
export function archetypeIdOf(value: unknown, plan: RolloutPlan): string | undefined {
  return plan.archetypes.find((archetype) => archetype.id === value)?.id
}

/** Code-unit order: collation depends on the machine's locale (ADR 0004). */
export function byLocation(a: SitePlan, b: SitePlan): number {
  return a.location < b.location ? -1 : a.location > b.location ? 1 : 0
}

// ── Guard helpers ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every own key is one of `keys`: a guard that ignores a key lets it be dropped unseen. */
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

/** A reference or key: any non-empty text. */
function isId(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** A whole number from 1: a template version, a capacity. Shared with the readers, so they cannot drift. */
export function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1
}

function isDayCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isRecordOf<T>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is Record<string, T> {
  return isRecord(value) && Object.entries(value).every(([key, item]) => key !== '' && guard(item))
}

/** A list of `guard`-passing items with distinct ids. */
function isUniqueList<T extends { id: string }>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is T[] {
  return (
    Array.isArray(value) &&
    value.every(guard) &&
    new Set(value.map((item: T) => item.id)).size === value.length
  )
}
