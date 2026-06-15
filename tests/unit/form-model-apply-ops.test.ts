import { describe, expect, test } from "vitest"
import { applyOperations, type EditorForm } from "@/lib/builder/form-model"
import type { AiOperation } from "@/lib/ai/form-schema"

const base = (): EditorForm => ({
  title: "Survey",
  fields: [
    { id: "f-name", type: "short_text", label: "Full name", required: true },
    {
      id: "f-tech",
      type: "checkboxes",
      label: "Tech?",
      required: false,
      options: [
        { id: "o1", label: "React" },
        { id: "o2", label: "Vue" },
        { id: "o3", label: "Other" },
      ],
    },
    { id: "f-confirm", type: "yes_no", label: "Subscribe?", required: false },
  ],
})

const apply = (...ops: AiOperation[]) => applyOperations(base(), ops)
const field = (f: EditorForm, id: string) => f.fields.find((x) => x.id === id)!

describe("applyOperations", () => {
  test("remove_option deletes only that option and keeps the rest + ids", () => {
    const out = apply({ op: "remove_option", target: "f-tech", label: "Vue" })
    expect(field(out, "f-tech").options).toEqual([
      { id: "o1", label: "React" },
      { id: "o3", label: "Other" },
    ])
    // other fields untouched
    expect(out.fields.map((f) => f.id)).toEqual(["f-name", "f-tech", "f-confirm"])
  })

  test("add_field places after a ref; remove_field; move_field to start", () => {
    const added = apply({
      op: "add_field",
      after: "f-name",
      field: { type: "email", label: "Email" },
    })
    expect(added.fields.map((f) => f.label)).toEqual(["Full name", "Email", "Tech?", "Subscribe?"])

    const removed = apply({ op: "remove_field", target: "f-name" })
    expect(removed.fields.map((f) => f.id)).toEqual(["f-tech", "f-confirm"])

    const moved = apply({ op: "move_field", target: "f-confirm", after: "start" })
    expect(moved.fields.map((f) => f.id)).toEqual(["f-confirm", "f-name", "f-tech"])
  })

  test("update_field changes props; a type change away from choice drops options", () => {
    const req = apply({ op: "update_field", target: "f-confirm", set: { required: true } })
    expect(field(req, "f-confirm").required).toBe(true)

    const retyped = apply({ op: "update_field", target: "f-tech", set: { type: "short_text" } })
    expect(field(retyped, "f-tech").type).toBe("short_text")
    expect(field(retyped, "f-tech").options).toBeUndefined()
  })

  test("option ops: add / rename (keeps id) / move / set_options", () => {
    const added = apply({ op: "add_option", target: "f-tech", label: "Svelte" })
    expect(field(added, "f-tech").options?.map((o) => o.label)).toEqual([
      "React",
      "Vue",
      "Other",
      "Svelte",
    ])

    const renamed = apply({ op: "rename_option", target: "f-tech", from: "React", to: "ReactJS" })
    const react = field(renamed, "f-tech").options?.find((o) => o.label === "ReactJS")
    expect(react?.id).toBe("o1") // id preserved across rename

    const movedOpt = apply({ op: "move_option", target: "f-tech", label: "Other", toIndex: 0 })
    expect(field(movedOpt, "f-tech").options?.map((o) => o.label)).toEqual(["Other", "React", "Vue"])

    const setOpts = apply({ op: "set_options", target: "f-tech", options: ["React", "Angular"] })
    expect(field(setOpts, "f-tech").options?.map((o) => o.label)).toEqual(["React", "Angular"])
    expect(field(setOpts, "f-tech").options?.find((o) => o.label === "React")?.id).toBe("o1")
  })

  test("set_logic resolves the trigger label to its id; remove_logic clears", () => {
    const withLogic = apply({
      op: "set_logic",
      target: "f-tech",
      logic: {
        action: "show",
        conditions: [{ fieldLabel: "Subscribe?", operator: "equals", value: "Yes" }],
      },
    })
    expect(field(withLogic, "f-tech").logic?.conditions[0].fieldId).toBe("f-confirm")

    const cleared = applyOperations(withLogic, [{ op: "remove_logic", target: "f-tech" }])
    expect(field(cleared, "f-tech").logic).toBeUndefined()
  })

  test("replace_form swaps everything but preserves ids by matching label", () => {
    const out = apply({
      op: "replace_form",
      title: "New title",
      fields: [{ type: "checkboxes", label: "Tech?", options: ["React", "Vue"] }],
    })
    expect(out.title).toBe("New title")
    expect(out.fields).toHaveLength(1)
    expect(field(out, "f-tech")).toBeTruthy() // id preserved (matched type+label)
    expect(field(out, "f-tech").options?.find((o) => o.label === "React")?.id).toBe("o1")
  })

  test("remove_option resolves by ref, and by a paraphrased (substring) label", () => {
    // by option ref (id)
    const byRef = apply({ op: "remove_option", target: "f-tech", label: "o2" })
    expect(field(byRef, "f-tech").options?.map((o) => o.label)).toEqual(["React", "Other"])
    // by a non-exact label the model paraphrased ("react" -> "React")
    const bySub = apply({ op: "remove_option", target: "f-tech", label: "react" })
    expect(field(bySub, "f-tech").options?.map((o) => o.label)).toEqual(["Vue", "Other"])
  })

  test("rename_option targets by ref", () => {
    const out = apply({ op: "rename_option", target: "f-tech", from: "o3", to: "Something else" })
    expect(field(out, "f-tech").options?.map((o) => o.label)).toEqual([
      "React",
      "Vue",
      "Something else",
    ])
  })

  test("tolerates the model putting the value in `to` instead of `label`", () => {
    // Exactly what Gemini emitted in the wild: new text + the ref both in `to`.
    const out = apply(
      { op: "add_option", target: "f-tech", to: "Svelte" },
      { op: "remove_option", target: "f-tech", to: "o2" },
    )
    expect(field(out, "f-tech").options?.map((o) => o.label)).toEqual(["React", "Other", "Svelte"])
  })

  test("an unknown target is skipped, not fatal", () => {
    const out = apply({ op: "remove_field", target: "does-not-exist" })
    expect(out.fields.map((f) => f.id)).toEqual(["f-name", "f-tech", "f-confirm"])
  })
})
