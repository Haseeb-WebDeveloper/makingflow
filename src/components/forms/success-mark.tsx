"use client"

import dynamic from "next/dynamic"

// The Lottie WASM player only appears on the post-submit success screen — code-
// split it so it never loads while the respondent is filling the form.
const Lottie = dynamic(() => import("../builder/lottie").then((m) => m.Lottie), {
  ssr: false,
})

/**
 * Where the success animation stops and stays.
 *
 * public/lottie/success.json is authored to loop, so it ends by animating
 * itself back OUT: frames 70-89 scale the ring and the tick down to nothing,
 * and playing it end to end finishes on an empty canvas — indistinguishable
 * from the animation never having run. Frame 55 sits inside the file's own hold
 * (frames 40-70), after the tick has finished drawing and before the exit
 * begins, so the checkmark stays put.
 */
const HOLD_FRAME = 55

/** The animated checkmark both runtimes show after a submission: plays once,
 *  then holds. */
export function SuccessMark({ className }: { className?: string }) {
  return <Lottie name="success" loop={false} segment={[0, HOLD_FRAME]} className={className} />
}
