/**
 * The date field, on three fronts that were all broken or missing:
 *
 *   1. `config.includeTime` was declared in the schema, offered to the AI and
 *      documented in its prompt — and read by nothing, so asking for "a date and
 *      time" got a confident "done" and a date-only picker.
 *   2. There was no way to type a date. A calendar is the slow path for anyone
 *      who already knows the date, and the worst possible path for a birthday.
 *   3. There were no limits at all, so a booking form happily took last Tuesday.
 *
 * What gets STORED matters as much as what renders: the answer has to stay a
 * plain, sortable, local string.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { Field } from "@/components/forms/field-control"
import type { PublicField } from "@/lib/data/public-form"
import type { AnswerValue } from "@/lib/db/schema"

afterEach(cleanup)

function renderDate(config?: Record<string, unknown>, value?: AnswerValue) {
  const onChange = vi.fn()
  const field = {
    id: "d1",
    type: "date",
    label: "Pick a slot",
    required: false,
    config,
  } as PublicField
  const utils = render(<Field field={field} value={value} onChange={onChange} />)
  return { ...utils, onChange }
}

const timeBox = () => screen.queryByLabelText("Time") as HTMLInputElement | null
const dateBox = () => screen.getByPlaceholderText("DD/MM/YYYY") as HTMLInputElement
const type = (text: string) => fireEvent.change(dateBox(), { target: { value: text } })

/** ISO for today / an offset from it, matching how the control resolves bounds. */
function isoDay(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

describe("time half", () => {
  test("no time box unless the field asks for one", () => {
    renderDate()
    expect(timeBox()).toBeNull()
  })

  test("a time box appears for config.includeTime", () => {
    renderDate({ includeTime: true })
    expect(timeBox()).not.toBeNull()
  })

  test("composes the halves into one sortable string", () => {
    const { onChange } = renderDate({ includeTime: true }, "2026-09-21")
    fireEvent.change(timeBox()!, { target: { value: "14:30" } })
    expect(onChange).toHaveBeenCalledWith("2026-09-21T14:30")
  })

  test("a time typed before any date is kept on screen, not silently dropped", () => {
    const { onChange } = renderDate({ includeTime: true })
    fireEvent.change(timeBox()!, { target: { value: "14:30" } })
    expect(onChange).toHaveBeenCalledWith("")
    expect(timeBox()!.value).toBe("14:30")
  })

  test("clearing the time falls back to a date-only answer", () => {
    const { onChange } = renderDate({ includeTime: true }, "2026-09-21T14:30")
    fireEvent.change(timeBox()!, { target: { value: "" } })
    expect(onChange).toHaveBeenCalledWith("2026-09-21")
  })

  test("a stored date-time fills both boxes", () => {
    renderDate({ includeTime: true }, "2026-09-21T14:30")
    expect(timeBox()!.value).toBe("14:30")
    expect(dateBox().value).toBe("21/09/2026")
  })
})

describe("typing a date", () => {
  test("shows the stored answer in the editable format", () => {
    renderDate(undefined, "2026-09-21")
    expect(dateBox().value).toBe("21/09/2026")
  })

  test("accepts the stated format and stores ISO", () => {
    const { onChange } = renderDate()
    type("21/09/2026")
    expect(onChange).toHaveBeenLastCalledWith("2026-09-21")
  })

  test("also accepts ISO, dashes and dots", () => {
    for (const text of ["2026-09-21", "21-09-2026", "21.09.2026"]) {
      cleanup()
      const { onChange } = renderDate()
      type(text)
      expect(onChange).toHaveBeenLastCalledWith("2026-09-21")
    }
  })

  test("REJECTS the US order rather than silently swapping day and month", () => {
    // 09/21 has no 21st month. Failing loudly beats storing the 9th of a month
    // nobody meant — a wrong date that looks right is the worst outcome here.
    const { onChange } = renderDate()
    type("09/21/2026")
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(dateBox())
    expect(screen.getByRole("alert")).toHaveTextContent("Use DD/MM/YYYY.")
  })

  test("rejects a 2-digit year instead of reading it as year 26 AD", () => {
    const { onChange } = renderDate()
    type("21/09/26")
    expect(onChange).not.toHaveBeenCalled()
  })

  test("rejects a day that does not exist", () => {
    const { onChange } = renderDate()
    type("31/02/2026")
    expect(onChange).not.toHaveBeenCalled()
  })

  test("does not nag mid-typing, only on blur", () => {
    renderDate()
    type("21/0")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("clearing the box clears the answer", () => {
    const { onChange } = renderDate(undefined, "2026-09-21")
    type("")
    expect(onChange).toHaveBeenLastCalledWith("")
  })
})

describe("allowed window", () => {
  test("refuses a date before minDate", () => {
    const { onChange } = renderDate({ minDate: "2026-06-01" })
    type("21/05/2026")
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("on or after 1 Jun 2026")
  })

  test("refuses a date after maxDate", () => {
    const { onChange } = renderDate({ maxDate: "2026-06-30" })
    type("21/07/2026")
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("on or before 30 Jun 2026")
  })

  test("accepts a date inside the window", () => {
    const { onChange } = renderDate({ minDate: "2026-06-01", maxDate: "2026-06-30" })
    type("15/06/2026")
    expect(onChange).toHaveBeenLastCalledWith("2026-06-15")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("disablePast is relative to the day it is FILLED, not the day it was built", () => {
    // A booking form published in January must still refuse yesterday in June.
    // That only holds because the bound resolves at fill time.
    const { onChange } = renderDate({ disablePast: true })
    const [y, m, d] = isoDay(-1).split("-")
    type(`${d}/${m}/${y}`)
    expect(onChange).not.toHaveBeenCalled()

    const [ty, tm, td] = isoDay(1).split("-")
    type(`${td}/${tm}/${ty}`)
    expect(onChange).toHaveBeenLastCalledWith(isoDay(1))
  })

  test("disableFuture refuses tomorrow and takes yesterday", () => {
    const { onChange } = renderDate({ disableFuture: true })
    const [y, m, d] = isoDay(1).split("-")
    type(`${d}/${m}/${y}`)
    expect(onChange).not.toHaveBeenCalled()

    const [py, pm, pd] = isoDay(-1).split("-")
    type(`${pd}/${pm}/${py}`)
    expect(onChange).toHaveBeenLastCalledWith(isoDay(-1))
  })
})
