import { waveHeading, type WaveColumn } from './rollout-data'

/**
 * A wave's heading: its label in mono, which is a code, or its name in the
 * interface face when the label is empty, which is human-authored (#223).
 */
export function WaveHeading({
  wave,
  className,
}: {
  wave: Pick<WaveColumn, 'element' | 'plan'>
  className?: string
}) {
  const heading = waveHeading(wave)
  const classes = [className, heading.code ? 'mono' : undefined].filter(Boolean).join(' ')
  return <span className={classes || undefined}>{heading.text}</span>
}
