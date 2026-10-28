import { useEffect, useRef } from 'react'

/** Focus a dialog's first field as it opens, after the trap has recorded the opener. */
export function useInitialFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return ref
}
