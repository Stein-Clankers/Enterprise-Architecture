import { Link } from 'react-router-dom'
import { FINDING_SEVERITIES, type Finding, type FindingSeverity } from '@/model'
import { useModelStoreContext } from '@/store'
import type { RolloutData } from './rollout-data'
import '@/ui/validator/validator.css'

/**
 * The rollout's plan checks (#214, proposal §6 item 8) at the screen's time
 * point, by severity: what a planner fixes (warnings), then what the checks
 * could not judge and why (advice). Each finding opens its subject, a site's
 * Location, a wave or the rollout, on its fact sheet; one whose subject is no
 * longer in the model is listed and opens nothing. The list is the validator's
 * (`validator.css`): the message in Space Grotesk, its code in mono.
 */

const TITLES: Record<FindingSeverity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  advice: 'Advice',
}

export function PlanChecks({ data }: { data: RolloutData }) {
  const { store } = useModelStoreContext()
  const sections = FINDING_SEVERITIES.map((severity) => ({
    severity,
    findings: data.checks.filter((finding) => finding.severity === severity),
  })).filter((section) => section.findings.length > 0)

  return (
    <section className="rollout-checks" aria-label="Plan checks">
      <p className="rollout-checks__summary mono" data-testid="plan-check-summary">
        {summary(data.checks)}
      </p>
      {!sections.length && (
        <p className="validator__empty">No plan check finds anything at this time point.</p>
      )}
      {sections.map((section) => (
        <section
          key={section.severity}
          className="validator__section"
          aria-labelledby={`plan-checks-${section.severity}`}
        >
          <h2 className="validator__h2" id={`plan-checks-${section.severity}`}>
            <span>{TITLES[section.severity]}</span>
            <span className="validator__count mono">{section.findings.length}</span>
          </h2>
          <ul className="validator__list">
            {section.findings.map((finding, index) => {
              const subject =
                finding.subjectId === undefined ? undefined : store.element(finding.subjectId)
              const body = (
                <>
                  <span className="validator__message">{finding.message}</span>
                  <span className="validator__meta mono">
                    {finding.code}
                    {finding.subjectId !== undefined && ` · ${finding.subjectId}`}
                    {finding.subjectId !== undefined && !subject && ' · no longer in the model'}
                  </span>
                </>
              )
              return (
                <li key={`${finding.code}:${finding.subjectId ?? ''}:${index}`}>
                  {subject ? (
                    <Link
                      className="validator__finding"
                      to={`/element/${subject.id}`}
                      aria-label={`${finding.message} Opens the fact sheet of ${subject.name || subject.id}.`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="validator__finding validator__finding--inert">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </section>
  )
}

/** "2 warnings · 1 advice", or "0 findings". */
export function summary(findings: readonly Finding[]): string {
  if (!findings.length) return '0 findings'
  return FINDING_SEVERITIES.map((severity) => {
    const count = findings.filter((finding) => finding.severity === severity).length
    if (severity === 'advice') return `${count} advice`
    const noun = severity === 'error' ? 'error' : 'warning'
    return `${count} ${noun}${count === 1 ? '' : 's'}`
  })
    .filter((part) => !part.startsWith('0 '))
    .join(' · ')
}
