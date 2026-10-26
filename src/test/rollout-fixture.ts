import type { Element, PlanDate, Relationship, SitePlan, Workspace } from '@/model'
import { smallWorkspace } from './fixtures'

export const ROLLOUT_ID = 'wp-rollout-data'
export const WAVE_COUNT = 5

/** The id of wave `w` of the rollout fixture; wave 0 is the pilot. */
export function waveId(w: number): string {
  return `wp-wave-${w}`
}

/** The Location id of site `n`, 1-based. */
export function siteId(n: number): string {
  return `loc-site-${String(n).padStart(3, '0')}`
}

/**
 * A data-migration rollout across `siteCount` sites (#209): the scale of the
 * first programme, 160 sites, by default.
 *
 * Every field a plan can hold is set somewhere: milestone overrides at each
 * precision, actuals, RAG, notes with characters XML has to escape, unassigned
 * sites, both archetypes, every kind of template change, both kinds of entry
 * date and every applicability rule. Deterministic, built from the site number
 * alone, so a round trip that changes one byte is a real change.
 */
export function rolloutWorkspace(siteCount = 160): Workspace {
  const base = smallWorkspace()
  const elements: Element[] = [
    ...base.elements,
    { id: 'sys-local-store', type: 'SystemSoftware', name: 'Local file store', properties: {} },
    { id: 'sys-central-store', type: 'SystemSoftware', name: 'Central data lake', properties: {} },
    { id: 'loc-emea', type: 'Location', name: 'EMEA', properties: {} },
  ]
  const relationships: Relationship[] = [...base.relationships]

  const sites: SitePlan[] = []
  elements.push({
    id: ROLLOUT_ID,
    type: 'WorkPackage',
    name: 'Local data to the central lake',
    documentation: 'Moves every site’s local data into the central stores.',
    properties: { owner: 'Data Office' },
    plan: {
      kind: 'rollout',
      templateVersion: 2,
      milestones: [
        { id: 'mappingSignedOff', label: 'Mapping signed off', startsPhase: 'preparing' },
        { id: 'freezeStart', label: 'Freeze starts', startsPhase: 'cutover' },
        {
          id: 'reconciliationSignedOff',
          label: 'Reconciliation signed off',
          startsPhase: 'hypercare',
        },
        { id: 'hypercareEnd', label: 'Hypercare ends', startsPhase: 'migrated' },
        { id: 'legacyDecommissioned', label: 'Legacy decommissioned', startsPhase: 'done' },
      ],
      template: [
        {
          id: 'tc-replace-store',
          kind: 'replace',
          subject: 'sys-local-store',
          successor: 'sys-central-store',
          date: { anchor: 'freezeStart', offsetDays: 0 },
          applicability: { kind: 'aggregating', element: 'sys-local-store' },
        },
        {
          id: 'tc-retire-store',
          kind: 'retire',
          subject: 'sys-local-store',
          date: { anchor: 'hypercareEnd', offsetDays: 30 },
          applicability: { kind: 'archetypes', archetypes: ['plant'] },
        },
        {
          id: 'tc-introduce-lake',
          kind: 'introduce',
          subject: 'sys-central-store',
          date: { date: '2027-01-01', precision: 'quarter' },
          applicability: { kind: 'all' },
        },
        {
          id: 'tc-eliminate',
          kind: 'modify',
          subject: 'sys-local-store',
          field: 'timeClassification',
          value: 'Eliminate',
          date: { anchor: 'mappingSignedOff', offsetDays: -14 },
          applicability: { kind: 'all' },
        },
        {
          id: 'tc-fit',
          kind: 'modify',
          subject: 'sys-central-store',
          field: 'technicalFit',
          value: 4,
          date: { date: '2027-05-03', precision: 'week' },
          applicability: { kind: 'all' },
        },
        {
          id: 'tc-add-serving',
          kind: 'add',
          subject: 'rel-k8s-app',
          date: { date: '2027-06-01', precision: 'month' },
          applicability: { kind: 'all' },
        },
        {
          id: 'tc-remove-access',
          kind: 'remove',
          subject: 'rel-app-obj',
          date: { date: '2027-06-15', precision: 'day' },
          applicability: { kind: 'archetypes', archetypes: ['office', 'plant'] },
        },
      ],
      constraints: {
        blackouts: [
          { id: 'bo-year-end', label: 'Year-end close', start: '2027-12-15', end: '2028-01-10' },
          { id: 'bo-audit', start: '2027-09-01', end: '2027-09-05' },
        ],
        defaultCapacity: Math.ceil(siteCount / (WAVE_COUNT - 1)),
      },
      archetypes: [
        { id: 'plant', label: 'Plant', durations: { freezeStart: 42, hypercareEnd: 28 } },
        { id: 'office', label: 'Office' },
      ],
      sites,
    },
  })

  for (let w = 0; w < WAVE_COUNT; w += 1) {
    const month = (w % 4) * 3 + 1
    const year = 2027 + Math.floor(w / 4)
    const start: PlanDate = { date: `${year}-${pad(month)}-01`, precision: 'month' }
    elements.push({
      id: waveId(w),
      type: 'WorkPackage',
      name: w === 0 ? 'Pilot wave' : `Wave ${w}`,
      properties: {},
      plan: {
        kind: 'wave',
        rollout: ROLLOUT_ID,
        label: w === 0 ? 'Pilot' : `W${w}`,
        order: w,
        // The last wave is planned to the quarter only, and has no end yet.
        window:
          w === WAVE_COUNT - 1
            ? { start: { ...start, precision: 'quarter' } }
            : { start, end: { date: `${year}-${pad(month + 2)}-01`, precision: 'month' } },
        ...(w === 0 ? { capacity: 5 } : {}),
        templateVersion: w === 0 ? 1 : 2,
      },
    })
    relationships.push({
      id: `rel-rollout-wave-${w}`,
      type: 'Aggregation',
      source: ROLLOUT_ID,
      target: waveId(w),
      properties: {},
    })
  }

  for (let n = 1; n <= siteCount; n += 1) {
    const code = String(n).padStart(3, '0')
    const location = siteId(n)
    elements.push({
      id: location,
      type: 'Location',
      name: `Site ${code}`,
      properties: { 'archipelago.site.code': code },
    })
    relationships.push({
      id: `rel-emea-${code}`,
      type: 'Aggregation',
      source: 'loc-emea',
      target: location,
      properties: {},
    })
    const site: SitePlan = { location }
    if (n % 17 !== 0) site.wave = waveId(n <= 2 ? 0 : 1 + (n % (WAVE_COUNT - 1)))
    if (n % 3 !== 0) site.archetype = n % 2 === 0 ? 'plant' : 'office'
    const milestones: Record<string, PlanDate> = {}
    if (n % 4 === 0) milestones.freezeStart = { date: '2027-05-10', precision: 'week' }
    if (n % 6 === 0) {
      milestones.mappingSignedOff = { date: '2027-03-01', precision: 'month' }
      milestones.hypercareEnd = { date: `2027-07-${pad((n % 28) + 1)}`, precision: 'day' }
    }
    if (Object.keys(milestones).length) site.milestones = milestones
    if (n <= 2) site.actuals = { mappingSignedOff: '2027-02-12', freezeStart: `2027-03-0${n + 1}` }
    if (n % 5 === 0) site.rag = n % 10 === 0 ? 'amber' : 'green'
    if (n === 7) site.rag = 'red'
    if (n % 11 === 0) {
      site.notes = `Site ${code}: HR files stay <local> & "on site"\nuntil the works council agrees.`
    }
    sites.push(site)
  }

  return {
    ...base,
    id: 'ws-rollout',
    name: 'Data migration rollout',
    elements,
    relationships,
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
