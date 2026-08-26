import { describe, expect, test } from "vitest"
import {
  applyOperations,
  matchSimpleEdit,
  toEditContext,
  resolveOpRefs,
  isRebuildRequest,
  type EditorForm,
} from "@/lib/builder/form-model"
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

  test("placement top/bottom put the field at the very start / very end", () => {
    const top = apply({
      op: "add_field",
      field: { type: "paragraph", label: "About our platform" },
      placement: { mode: "top" },
    })
    expect(top.fields.map((f) => f.label)).toEqual([
      "About our platform",
      "Full name",
      "Tech?",
      "Subscribe?",
    ])

    const bottom = apply({
      op: "add_field",
      field: { type: "email", label: "Email" },
      placement: { mode: "bottom" },
    })
    expect(bottom.fields.map((f) => f.label)).toEqual(["Full name", "Tech?", "Subscribe?", "Email"])
  })

  test("placement before/after a ref inserts adjacent to it", () => {
    const before = apply({
      op: "add_field",
      field: { type: "email", label: "Email" },
      placement: { mode: "before", ref: "f-tech" },
    })
    expect(before.fields.map((f) => f.label)).toEqual(["Full name", "Email", "Tech?", "Subscribe?"])

    const after = apply({
      op: "add_field",
      field: { type: "email", label: "Email" },
      placement: { mode: "after", ref: "f-tech" },
    })
    expect(after.fields.map((f) => f.label)).toEqual(["Full name", "Tech?", "Email", "Subscribe?"])
  })

  test("placement takes precedence over legacy `after`; unknown ref appends", () => {
    // placement wins even if a stale `after` is also present
    const out = apply({
      op: "add_field",
      after: "f-confirm",
      field: { type: "email", label: "Email" },
      placement: { mode: "top" },
    })
    expect(out.fields[0].label).toBe("Email")

    const unknown = apply({
      op: "add_field",
      field: { type: "email", label: "Email" },
      placement: { mode: "after", ref: "nope" },
    })
    expect(unknown.fields[unknown.fields.length - 1].label).toBe("Email")
  })

  test("move_field with placement resolves against the array after removal", () => {
    // move the first field to just after the last-but-one — must land correctly
    const out = apply({
      op: "move_field",
      target: "f-name",
      placement: { mode: "after", ref: "f-tech" },
    })
    expect(out.fields.map((f) => f.id)).toEqual(["f-tech", "f-name", "f-confirm"])

    const toTop = apply({ op: "move_field", target: "f-confirm", placement: { mode: "top" } })
    expect(toTop.fields.map((f) => f.id)).toEqual(["f-confirm", "f-name", "f-tech"])
  })

  test("update_field tolerates the model putting the new label in `to`/`label`", () => {
    // Exactly what Gemini emitted for "number each question": label in `to`,
    // plus hallucinated toIndex/title — set was missing entirely.
    const viaTo = apply({
      op: "update_field",
      target: "f-name",
      to: "1. Full Name",
      toIndex: 0,
      title: "ignored",
    } as AiOperation)
    expect(field(viaTo, "f-name").label).toBe("1. Full Name")

    const viaLabel = apply({ op: "update_field", target: "f-name", label: "2. Full Name" })
    expect(field(viaLabel, "f-name").label).toBe("2. Full Name")

    // A real `set` still wins over the fallback.
    const viaSet = apply({
      op: "update_field",
      target: "f-name",
      set: { label: "Real" },
      to: "Ignored",
    })
    expect(field(viaSet, "f-name").label).toBe("Real")
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

  test("set_required with no targets marks ALL answerable fields", () => {
    const out = apply({ op: "set_required", set: { required: true } })
    expect(out.fields.map((f) => f.required)).toEqual([true, true, true])
  })

  test("set_required can clear required on all fields", () => {
    const out = apply({ op: "set_required", set: { required: false } })
    expect(out.fields.map((f) => f.required)).toEqual([false, false, false])
  })

  test("set_required with targets only touches those fields", () => {
    const out = apply({ op: "set_required", targets: ["f-tech"], set: { required: true } })
    expect(field(out, "f-name").required).toBe(true) // unchanged (was already true)
    expect(field(out, "f-tech").required).toBe(true) // flipped
    expect(field(out, "f-confirm").required).toBe(false) // unchanged
  })

  test("update_settings merges only the provided keys, carrying the rest through", () => {
    const form: EditorForm = {
      title: "X",
      fields: [],
      settings: { thankYouMessage: "old", submitButtonLabel: "Send" },
    }
    const out = applyOperations(form, [
      { op: "update_settings", settings: { thankYouMessage: "Thanks!" } },
    ])
    expect(out.settings).toEqual({ thankYouMessage: "Thanks!", submitButtonLabel: "Send" })
  })

  test("update_settings can set fields on a form that had no settings yet", () => {
    const form: EditorForm = { title: "X", fields: [] }
    const out = applyOperations(form, [
      { op: "update_settings", settings: { redirectUrl: "https://acme.com/thanks" } },
    ])
    expect(out.settings).toEqual({ redirectUrl: "https://acme.com/thanks" })
  })

  test("set_required skips content blocks (they can never be required)", () => {
    const withHeading: EditorForm = {
      title: "X",
      fields: [
        { id: "h1", type: "heading", label: "Section", required: false },
        { id: "q1", type: "short_text", label: "Name", required: false },
      ],
    }
    const out = applyOperations(withHeading, [{ op: "set_required", set: { required: true } }])
    expect(out.fields.find((f) => f.id === "h1")?.required).toBe(false) // heading untouched
    expect(out.fields.find((f) => f.id === "q1")?.required).toBe(true)
  })
})

describe("matchSimpleEdit (deterministic required/optional fast path)", () => {
  // A form whose labels carry question numbers, like the real failing case.
  const numbered = (): EditorForm => ({
    title: "Application",
    fields: [
      { id: "h1", type: "heading", label: "Candidate Information", required: false },
      { id: "f-name", type: "short_text", label: "1. Full Name", required: true },
      { id: "f-email", type: "email", label: "2. Email Address", required: true },
      { id: "f-phone", type: "phone", label: "3. Phone Number", required: false },
    ],
  })
  const run = (s: string, form = numbered()) => matchSimpleEdit(s, form)

  test("'make Email optional' → set_required false on that field, despite the number prefix", () => {
    const out = run("make Email optional")
    expect(out).not.toBeNull()
    expect(out!.operations).toEqual([
      { op: "set_required", targets: ["f-email"], set: { required: false } },
    ])
    // and it actually applies
    const applied = applyOperations(numbered(), out!.operations)
    expect(applied.fields.find((f) => f.id === "f-email")?.required).toBe(false)
    expect(out!.summary).toContain("optional")
  })

  test("required verbs and variants all resolve to required=true", () => {
    for (const s of [
      "make Phone Number required",
      "make phone number require", // the typo we saw in the wild
      "set Phone Number as required",
      "mark phone number mandatory",
    ]) {
      const out = run(s)
      expect(out?.operations[0]).toMatchObject({
        op: "set_required",
        targets: ["f-phone"],
        set: { required: true },
      })
    }
  })

  test("'make all fields required' → set_required with no targets", () => {
    const out = run("make all fields required")
    expect(out!.operations).toEqual([{ op: "set_required", set: { required: true } }])
  })

  test("multiple fields via 'and' / comma", () => {
    const out = run("make Email and Phone Number optional")
    expect(out!.operations[0]).toMatchObject({
      op: "set_required",
      set: { required: false },
    })
    expect((out!.operations[0].targets ?? []).sort()).toEqual(["f-email", "f-phone"])
    expect(out!.summary).toContain("and")
  })

  test("unknown or ambiguous field defers to the AI (returns null)", () => {
    expect(run("make Nickname required")).toBeNull() // no such field
    expect(run("make the section required")).toBeNull() // 'section' → heading, not answerable
  })

  test("non-required-toggle instructions are not hijacked (return null)", () => {
    expect(run("add a phone number field")).toBeNull()
    expect(run("rename the form to Careers")).toBeNull()
    expect(run("make the title bigger")).toBeNull()
  })

  test("'move Email above Full Name' → move_field before, and applies correctly", () => {
    const form = numbered()
    const out = run("move Email above Full Name", form)
    expect(out!.operations).toEqual([
      { op: "move_field", target: "f-email", placement: { mode: "before", ref: "f-name" } },
    ])
    const applied = applyOperations(form, out!.operations)
    expect(applied.fields.map((f) => f.id)).toEqual(["h1", "f-email", "f-name", "f-phone"])
    expect(out!.summary).toBe("Moved **2. Email Address** before **1. Full Name**.")
  })

  test("filler words are stripped: 'move the email above the name input'", () => {
    const out = run("move the email above the name input")
    expect(out!.operations[0]).toMatchObject({
      op: "move_field",
      target: "f-email",
      placement: { mode: "before", ref: "f-name" },
    })
  })

  test("below/after → move_field after", () => {
    const out = run("move Full Name below Phone Number")
    expect(out!.operations[0]).toMatchObject({
      op: "move_field",
      target: "f-name",
      placement: { mode: "after", ref: "f-phone" },
    })
  })

  test("move to the top / bottom need no anchor", () => {
    expect(run("move Phone Number to the top")!.operations[0]).toEqual({
      op: "move_field",
      target: "f-phone",
      placement: { mode: "top" },
    })
    expect(run("move Full Name to the bottom")!.operations[0]).toEqual({
      op: "move_field",
      target: "f-name",
      placement: { mode: "bottom" },
    })
  })

  test("unknown/ambiguous anchor or field defers to the AI", () => {
    expect(run("move Email above Nickname")).toBeNull() // no such anchor
    expect(run("move Sidebar to the top")).toBeNull() // no such field
  })

  test("settings: title vs message map to the right field (matching the editor labels)", () => {
    // "message / body / description" → successBody (the "Message" field)
    const msg = run("change the thank you message to We got it, thanks!")
    expect(msg!.operations).toEqual([
      { op: "update_settings", settings: { successBody: "We got it, thanks!" } },
    ])
    const body = run("set the thank-you body to More details here")
    expect(body!.operations[0]).toMatchObject({
      op: "update_settings",
      settings: { successBody: "More details here" },
    })

    // "title / heading" → thankYouMessage (the "Title" field)
    const title = run("change the thank you title to Thanks!")
    expect(title!.operations[0]).toMatchObject({
      op: "update_settings",
      settings: { thankYouMessage: "Thanks!" },
    })
  })

  test("settings: submit button and redirect", () => {
    const submit = run('set the submit button to "Send it"')
    expect(submit!.operations[0]).toMatchObject({
      op: "update_settings",
      settings: { submitButtonLabel: "Send it" },
    })

    const redirect = run("set the redirect url to https://acme.com/thanks")
    expect(redirect!.operations[0]).toMatchObject({
      op: "update_settings",
      settings: { redirectUrl: "https://acme.com/thanks" },
    })
  })

  test("settings edits without an explicit new value defer to the AI", () => {
    expect(run("make the thank you message shorter")).toBeNull()
    expect(run("improve the thank you message")).toBeNull()
  })
})

describe("short refs (toEditContext + resolveOpRefs)", () => {
  test("context carries a 1-based pos on every field", () => {
    const { context } = toEditContext(base())
    expect(context.fields.map((f) => f.pos)).toEqual([1, 2, 3])
  })

  test("resolveOpRefs translates placement.ref, leaves top/bottom mode alone", () => {
    const { refs } = toEditContext(base())
    const op = resolveOpRefs(
      { op: "add_field", field: { type: "email", label: "Email" }, placement: { mode: "after", ref: "f2" } },
      refs,
    )
    expect(op.placement).toEqual({ mode: "after", ref: "f-tech" })

    const top = resolveOpRefs(
      { op: "add_field", field: { type: "email", label: "Email" }, placement: { mode: "top" } },
      refs,
    )
    expect(top.placement).toEqual({ mode: "top", ref: undefined })
  })

  test("context uses short, sequential refs mapped back to real ids", () => {
    const { context, refs } = toEditContext(base())
    expect(context.fields.map((f) => f.ref)).toEqual(["f1", "f2", "f3"])
    // option refs are scoped to their field
    const tech = context.fields[1] as { options: { ref: string; label: string }[] }
    expect(tech.options.map((o) => o.ref)).toEqual(["f2o1", "f2o2", "f2o3"])
    // and the map points back to the real ids
    expect(refs).toMatchObject({ f1: "f-name", f2: "f-tech", f3: "f-confirm", f2o2: "o2" })
  })

  test("resolveOpRefs maps short refs in ref-bearing fields, leaves text alone", () => {
    const { refs } = toEditContext(base())
    // target (field ref) + from (option ref) translated; `to` (new text) untouched
    const op = resolveOpRefs(
      { op: "rename_option", target: "f2", from: "f2o3", to: "Something else" },
      refs,
    )
    expect(op.target).toBe("f-tech")
    expect(op.from).toBe("o3")
    expect(op.to).toBe("Something else")
  })

  test("a short-ref op survives translation + applyOperations end to end", () => {
    const form = base()
    const { refs } = toEditContext(form)
    // model returns short refs; we translate then apply
    const op = resolveOpRefs({ op: "remove_option", target: "f2", label: "f2o2" }, refs)
    const out = applyOperations(form, [op])
    expect(field(out, "f-tech").options?.map((o) => o.label)).toEqual(["React", "Other"])
  })

  test("non-ref placement tokens like 'start' pass through untranslated", () => {
    const { refs } = toEditContext(base())
    const op = resolveOpRefs({ op: "move_field", target: "f3", after: "start" }, refs)
    expect(op.target).toBe("f-confirm")
    expect(op.after).toBe("start")
  })

  test("resolveOpRefs translates the set_required targets array", () => {
    const { refs } = toEditContext(base())
    const op = resolveOpRefs(
      { op: "set_required", targets: ["f1", "f3"], set: { required: true } },
      refs,
    )
    expect(op.targets).toEqual(["f-name", "f-confirm"])
  })
})

/**
 * The builder AI could only reach fields, options, logic and four post-submit
 * settings. Asked to "use this as the logo" it answered "I can't upload files
 * directly" — truthfully: no operation wrote FormTheme, no operation wrote
 * FieldConfig, and the attachment's hosted URL was dropped before the model saw
 * it. These cover the operations added to close that.
 */
describe("set_theme", () => {
  test("sets the logo without disturbing the banner", () => {
    const form: EditorForm = { ...base(), theme: { coverImageUrl: "https://cdn/banner.png" } }
    const out = applyOperations(form, [
      { op: "set_theme", theme: { logoUrl: "https://cdn/logo.png" } },
    ])
    expect(out.theme).toEqual({
      coverImageUrl: "https://cdn/banner.png",
      logoUrl: "https://cdn/logo.png",
    })
  })

  test("an empty string removes an asset", () => {
    const form: EditorForm = {
      ...base(),
      theme: { logoUrl: "https://cdn/logo.png", coverImageUrl: "https://cdn/banner.png" },
    }
    const out = applyOperations(form, [{ op: "set_theme", theme: { coverImageUrl: "" } }])
    expect(out.theme?.coverImageUrl).toBeUndefined()
    expect(out.theme?.logoUrl).toBe("https://cdn/logo.png")
  })

  test("branding survives an unrelated edit", () => {
    const form: EditorForm = { ...base(), theme: { logoUrl: "https://cdn/logo.png" } }
    const out = applyOperations(form, [
      { op: "update_field", target: "f-name", set: { label: "Name" } },
    ])
    expect(out.theme?.logoUrl).toBe("https://cdn/logo.png")
  })
})

describe("field config", () => {
  test("update_field MERGES config instead of replacing it", () => {
    const form: EditorForm = {
      ...base(),
      fields: [
        {
          id: "f-rate",
          type: "rating",
          label: "How was it?",
          required: false,
          config: { ratingMax: 5, ratingIcon: "star" },
        },
      ],
    }
    // "make it out of 10" sends only ratingMax — the icon beside it must survive.
    const out = applyOperations(form, [
      { op: "update_field", target: "f-rate", set: { config: { ratingMax: 10 } } },
    ])
    expect(out.fields[0].config).toEqual({ ratingMax: 10, ratingIcon: "star" })
  })

  test("add_field carries config through", () => {
    const out = apply({
      op: "add_field",
      field: { type: "heading", label: "Section two", config: { headingLevel: "h1" } },
      placement: { mode: "top" },
    })
    expect(out.fields[0].config).toEqual({ headingLevel: "h1" })
  })

  test("an edit that touches nothing leaves config intact", () => {
    const form: EditorForm = {
      ...base(),
      fields: [
        {
          id: "f-file",
          type: "file_upload",
          label: "CV",
          required: true,
          config: { allowedFileTypes: ["pdf"], maxFiles: 2 },
        },
      ],
    }
    const out = applyOperations(form, [
      { op: "set_required", targets: ["f-file"], set: { required: false } },
    ])
    expect(out.fields[0].config).toEqual({ allowedFileTypes: ["pdf"], maxFiles: 2 })
  })

  test("the model can read current config back", () => {
    const form: EditorForm = {
      ...base(),
      fields: [
        {
          id: "f-rate",
          type: "rating",
          label: "How was it?",
          required: false,
          config: { ratingMax: 5 },
        },
        { id: "f-plain", type: "short_text", label: "Name", required: false },
      ],
    }
    const { context } = toEditContext(form)
    expect(context.fields[0]).toMatchObject({ config: { ratingMax: 5 } })
    // Omitted when empty, so the context stays small.
    expect(context.fields[1]).not.toHaveProperty("config")
  })
})

describe("update_settings — the newly reachable keys", () => {
  test("applies progress bar, chooser style and render mode", () => {
    const out = apply({
      op: "update_settings",
      settings: { showProgressBar: true, chooserStyle: "list", renderMode: "conversational" },
    })
    expect(out.settings).toMatchObject({
      showProgressBar: true,
      chooserStyle: "list",
      renderMode: "conversational",
    })
  })

  test("only the keys sent change", () => {
    const form: EditorForm = {
      ...base(),
      settings: { thankYouMessage: "Thanks!", showProgressBar: true },
    }
    const out = applyOperations(form, [
      { op: "update_settings", settings: { renderMode: "conversational" } },
    ])
    expect(out.settings).toEqual({
      thankYouMessage: "Thanks!",
      showProgressBar: true,
      renderMode: "conversational",
    })
  })

  test("the current values are visible to the model", () => {
    const { context } = toEditContext({ ...base(), settings: { showProgressBar: true } })
    expect(context.settings).toMatchObject({
      showProgressBar: true,
      chooserStyle: "cards", // defaulted, so "not set" is legible rather than absent
      renderMode: "classic",
    })
    expect(context.theme).toEqual({ logoUrl: "", coverImageUrl: "" })
  })
})

describe("isRebuildRequest", () => {
  test("placing an image is never a rebuild", () => {
    // The bug: any attachment forced full regeneration, so this rebuilt the
    // entire form from a picture of a logo.
    for (const t of [
      "upload this as logo",
      "use this as the logo",
      "set this as our banner",
      "add this image as a cover",
      "make this the header image",
    ]) {
      expect(isRebuildRequest(t), t).toBe(false)
    }
  })

  test("an explicit rebuild still regenerates", () => {
    for (const t of [
      "recreate this form from the screenshot",
      "rebuild the form from this image",
      "replicate this design",
      "copy this form",
      "build a form from this screenshot",
    ]) {
      expect(isRebuildRequest(t), t).toBe(true)
    }
  })

  test("ordinary edits are not rebuilds", () => {
    for (const t of [
      "make email required",
      "add a phone number field",
      "change the thank-you title to Thanks!",
      "make the rating out of 10",
    ]) {
      expect(isRebuildRequest(t), t).toBe(false)
    }
  })
})

/**
 * Read-only facts in the edit context.
 *
 * Asked "what's the form link?" the model had nothing to answer with — the
 * context carried only title/settings/fields — while its summary instructions
 * pushed it to always report something specific. That combination invites a
 * fabricated URL, which is worse than "I don't know" because it gets pasted to
 * real respondents.
 */
describe("toEditContext — about", () => {
  test("carries the share link and status when published", () => {
    const { context } = toEditContext(base(), {
      shareUrl: "https://forms.acme.com/apply",
      status: "published",
    })
    expect(context.about).toMatchObject({
      shareUrl: "https://forms.acme.com/apply",
      status: "published",
    })
  })

  test("an unpublished form reports no link, rather than omitting the key", () => {
    // Present-but-empty is the point: an absent key is what invites a guess.
    const { context } = toEditContext(base())
    expect(context.about.shareUrl).toBe("")
    expect(context.about.status).toBe("draft")
  })

  test("counts answerable questions apart from content blocks", () => {
    const form: EditorForm = {
      ...base(),
      fields: [
        { id: "h", type: "heading", label: "Welcome", required: false },
        { id: "p", type: "paragraph", label: "Intro", required: false },
        { id: "q1", type: "short_text", label: "Name", required: true },
        { id: "br", type: "page_break", label: "", required: false },
        { id: "q2", type: "email", label: "Email", required: true },
      ],
    }
    const { context } = toEditContext(form)
    expect(context.about.fieldCount).toBe(2)
    expect(context.about.totalBlocks).toBe(5)
  })
})
