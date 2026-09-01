"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

/**
 * Run `reset` when the route changes.
 *
 * With `cacheComponents: true` Next wraps routes in React's `<Activity>`, so
 * navigating away HIDES a page rather than unmounting it — components keep their
 * state and are shown again as they were. A dialog left open, or a half-filled
 * confirmation, is therefore still open when the user comes back.
 *
 * Implemented as a render-phase update (React's "adjusting state when a prop
 * changes" pattern) rather than an effect: an effect that calls setState fires an
 * extra render pass, and the React Compiler lint rules reject it outright.
 */
export function useResetOnNavigate(reset: () => void) {
  const pathname = usePathname()
  const [lastPath, setLastPath] = React.useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    reset()
  }
}
