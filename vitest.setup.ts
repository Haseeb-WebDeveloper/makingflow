import '@testing-library/jest-dom/vitest'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.test', quiet: true })

/**
 * Browser APIs jsdom doesn't implement, stubbed so component tests can render
 * the real runtime rather than a stripped-down stand-in.
 *
 * These are environment gaps, not behaviour under test: framer-motion reads
 * `matchMedia` for reduced-motion, the runtimes scroll to keep the current
 * question in view, and the success screen's Lottie observes intersection.
 * Without them a test fails for reasons that have nothing to do with the code
 * it is checking.
 *
 * Guarded on `window` because this file is shared with the integration project,
 * which runs in a node environment.
 */
if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia

  // Assigned rather than defaulted: jsdom DOES define these, as stubs that log
  // "Not implemented" on every call. The runtimes scroll on every question, so
  // leaving them in place buries real output under hundreds of those lines.
  window.scrollTo = (() => {}) as typeof window.scrollTo
  Element.prototype.scrollIntoView = function scrollIntoView() {}

  globalThis.IntersectionObserver ??= class {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: number[] = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
