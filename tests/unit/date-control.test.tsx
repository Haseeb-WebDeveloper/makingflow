/**
 * `config.includeTime` was declared in the schema, offered to the AI, and
 * documented in its prompt — but no renderer read it. Asking the AI for "a date
 * and time" got a confident "done" and a date-only picker. These pin the
 * rendering and, more importantly, the shape of what gets STORED.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { Field } from "@/components/forms/field-control"
import type { PublicField } from "@/lib/data/public-form"
import type { AnswerValue } from "@/lib/db/schema"

afterEach(cleanup)

function dateField(includeTime: boolean): PublicField {
  return {
    id: "d1",
    type: "date",
    label: "Pick a slot",
    required: false,
    config: includeTime ? { includeTime: true } : undefined,
  } as PublicField
}

function renderDate(includeTime: boolean, value?: AnswerValue) {
  const onChange = vi.fn()
  const utils = render(
    <Field field={dateField(includeTime)} value={value} onChange={onChange} />,
  )
  return { ...utils, onChange }
}

const timeBox = () => screen.queryByLabelText("Time") as HTMLInputElement | null

describe("date field", () => {
  test("shows no time box unless the field asks for one", () => {
    renderDate(false)
    expect(timeBox()).toBeNull()
  })

  test("shows a time box when config.includeTime is set", () => {
    renderDate(true)
    expect(timeBox()).not.toBeNull()
  })

  test("composes the two halves into one sortable string", () => {
    const { onChange } = renderDate(true, "2026-09-21")
    fireEvent.change(timeBox()!, { target: { value: "14:30" } })
    expect(onChange).toHaveBeenCalledWith("2026-09-21T14:30")
  })

  test("a time typed before any date is kept on screen, not silently dropped", () => {
    // The answer cannot hold a time without a date, so it stays empty — but the
    // box must not wipe itself while someone is typing in it.
    const { onChange } = renderDate(true, undefined)
    fireEvent.change(timeBox()!, { target: { value: "14:30" } })

    expect(onChange).toHaveBeenCalledWith("")
    expect(timeBox()!.value).toBe("14:30")
  })

  test("clearing the time falls back to a date-only answer", () => {
    const { onChange } = renderDate(true, "2026-09-21T14:30")
    fireEvent.change(timeBox()!, { target: { value: "" } })
    expect(onChange).toHaveBeenCalledWith("2026-09-21")
  })

  test("a stored date-time shows its time and only its date on the trigger", () => {
    renderDate(true, "2026-09-21T14:30")
    expect(timeBox()!.value).toBe("14:30")
    // "PPP" — the trigger shows the date, the time has its own box.
    expect(screen.getByText(/September 21st, 2026/)).toBeInTheDocument()
  })

  test("a date-only field ignores a stray time in the stored value", () => {
    const { onChange } = renderDate(false, "2026-09-21")
    expect(screen.getByText(/September 21st, 2026/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
