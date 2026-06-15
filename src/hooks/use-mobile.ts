import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * True on viewports narrower than the mobile breakpoint. Backed by
 * `useSyncExternalStore` so the value is read straight from `matchMedia`
 * (hydration-safe, no setState-in-effect).
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false, // server snapshot — assume desktop until hydrated
  )
}
