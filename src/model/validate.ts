import { isElementType, typeLabel } from './element-types'
import {
  TYPE_SPECIFIC_ATTRIBUTES,
  isRelationshipType,
  misplacedAttributes,
} from './relationship-types'
import { checkModel, invalidRelations, runChecks, type CheckId, type CheckModel } from './checks'
import { LIFECYCLE_PHASES } from './profile'
import { parseLifecycleDate } from './lifecycle'
import type { Workspace } from './workspace'
import { validateViewsAndFolders } from './validate-views'
import { planFindings } from './validate-plans'

/**
 * Whole-model validation. Findings are structured rather than thrown so the UI
 * can list them against the element or relationship they concern, and so an
 * import can report problems without refusing the file.
 */

/** Archi's three issue types (`ErrorType`, `WarningType`, `AdviceType`), most severe first. */
export type FindingSeverity = 'error' | 'warning' | 'advice'

export const FINDING_SEVERITIES: readonly FindingSeverity[] = ['error', 'warning', 'advice']

/** A view's shape is a `node`, its line a `connection`; both name their view in `viewId`. */
export type FindingSubjectKind =
  'element' | 'relationship' | 'view' | 'node' | 'connection' | 'folder' | 'workspace'

export interface Finding {
  severity: FindingSeverity
  /** Stable machine code, e.g. `relationship.dangling-source`. */
  code: string
  message: string
  /** What the finding concerns, when it concerns one thing. */
  subjectId?: string
  subjectKind?: FindingSubjectKind
  /** The view a `node` or `connection` subject is in. */
  viewId?: string
  /** The Archi check that found it (#193). Absent on Archipelago's own findings. */
  check?: CheckId
}

export interface ValidationReport {
  findings: Finding[]
  errors: Finding[]
  warnings: Finding[]
  advice: Finding[]
  valid: boolean
}

/**
 * Whole-model validation as the importers and the tests ask it: Archipelago's
 * own findings, and Archi's check for relationships ArchiMate does not allow.
 */
export function validate(workspace: Workspace): ValidationReport {
  const model = checkModel(workspace)
  return report([...integrityFindings(workspace, model), ...invalidRelations(model)])
}

/**
 * The validator screen's run (#193): Archipelago's own findings, which cannot
 * be switched off, then each of Archi's checks in `enabled`.
 */
export function runValidator(workspace: Workspace, enabled?: ReadonlySet<CheckId>): Finding[] {
  const model = checkModel(workspace)
  return [...integrityFindings(workspace, model), ...runChecks(workspace, enabled, model)]
}

function report(findings: Finding[]): ValidationReport {
  const errors = findings.filter((f) => f.severity === 'error')
  const warnings = findings.filter((f) => f.severity === 'warning')
  const advice = findings.filter((f) => f.severity === 'advice')
  return { findings, errors, warnings, advice, valid: errors.length === 0 }
}

/**
 * Archipelago's own checks: what Archi's model cannot hold and ours can (a
 * dangling reference, a duplicate id, an unparseable date), so no Archi
 * check finds it.
 */
export function integrityFindings(
  workspace: Workspace,
  model: CheckModel = checkModel(workspace),
): Finding[] {
  const findings: Finding[] = []
  const seenElementIds = new Set<string>()
  const seenRelationshipIds = new Set<string>()

  for (const element of workspace.elements) {
    if (seenElementIds.has(element.id)) {
      findings.push({
        severity: 'error',
        code: 'element.duplicate-id',
        message: `Two elements share the id "${element.id}".`,
        subjectId: element.id,
        subjectKind: 'element',
      })
    }
    seenElementIds.add(element.id)

    if (!isElementType(element.type)) {
      findings.push({
        severity: 'error',
        code: 'element.unknown-type',
        message: `"${element.type}" is not an ArchiMate 3.2 element type.`,
        subjectId: element.id,
        subjectKind: 'element',
      })
    }

    if (!element.name.trim()) {
      findings.push({
        severity: 'warning',
        code: 'element.no-name',
        message: `Element ${element.id} has no name.`,
        subjectId: element.id,
        subjectKind: 'element',
      })
    }

    const dates = element.profile?.lifecycle
    if (dates) {
      for (const phase of LIFECYCLE_PHASES) {
        const raw = dates[phase]
        if (raw !== undefined && Number.isNaN(parseLifecycleDate(raw))) {
          findings.push({
            severity: 'warning',
            code: 'element.unparseable-date',
            message: `"${raw}" is not a usable date for the ${phase} phase of ${element.name || element.id}.`,
            subjectId: element.id,
            subjectKind: 'element',
          })
        }
      }
      // Dates that run backwards make the derived phase meaningless.
      const ordered = LIFECYCLE_PHASES.map((phase) => parseLifecycleDate(dates[phase])).filter(
        (ms) => !Number.isNaN(ms),
      )
      for (let i = 1; i < ordered.length; i += 1) {
        const previous = ordered[i - 1]
        const current = ordered[i]
        if (previous !== undefined && current !== undefined && current < previous) {
          findings.push({
            severity: 'warning',
            code: 'element.lifecycle-out-of-order',
            message: `Lifecycle dates on ${element.name || element.id} are out of order — the derived phase will not be meaningful.`,
            subjectId: element.id,
            subjectKind: 'element',
          })
          break
        }
      }
    }
  }

  // Indexed once: endpoint lookup is the hot path at 5,000 elements.
  const { elementsById } = model

  for (const relationship of workspace.relationships) {
    if (seenRelationshipIds.has(relationship.id)) {
      findings.push({
        severity: 'error',
        code: 'relationship.duplicate-id',
        message: `Two relationships share the id "${relationship.id}".`,
        subjectId: relationship.id,
        subjectKind: 'relationship',
      })
    }
    seenRelationshipIds.add(relationship.id)

    if (!isRelationshipType(relationship.type)) {
      findings.push({
        severity: 'error',
        code: 'relationship.unknown-type',
        message: `"${relationship.type}" is not an ArchiMate 3.2 relationship type.`,
        subjectId: relationship.id,
        subjectKind: 'relationship',
      })
      continue
    }

    for (const attribute of misplacedAttributes(relationship)) {
      findings.push({
        severity: 'error',
        code: 'relationship.misplaced-attribute',
        message: `Relationship ${relationship.id} is a ${relationship.type} but carries ${attribute}, which only a ${TYPE_SPECIFIC_ATTRIBUTES[attribute]} relationship has.`,
        subjectId: relationship.id,
        subjectKind: 'relationship',
      })
    }

    const source = elementsById.get(relationship.source)
    const target = elementsById.get(relationship.target)

    if (!source) {
      findings.push({
        severity: 'error',
        code: 'relationship.dangling-source',
        message: `Relationship ${relationship.id} points from "${relationship.source}", which is not in the model.`,
        subjectId: relationship.id,
        subjectKind: 'relationship',
      })
    }
    if (!target) {
      findings.push({
        severity: 'error',
        code: 'relationship.dangling-target',
        message: `Relationship ${relationship.id} points to "${relationship.target}", which is not in the model.`,
        subjectId: relationship.id,
        subjectKind: 'relationship',
      })
    }
    if (!source || !target) continue

    if (source.id === target.id && relationship.type !== 'Association') {
      findings.push({
        severity: 'warning',
        code: 'relationship.self-reference',
        message: `${typeLabel(source.type)} "${source.name}" has a ${relationship.type} relationship to itself.`,
        subjectId: relationship.id,
        subjectKind: 'relationship',
      })
    }
  }

  validateViewsAndFolders(workspace, findings)
  planFindings(workspace, elementsById, findings)

  if (workspace.schemaVersion <= 0) {
    findings.push({
      severity: 'error',
      code: 'workspace.bad-schema-version',
      message: `Schema version ${workspace.schemaVersion} is not usable.`,
      subjectKind: 'workspace',
    })
  }

  return findings
}
