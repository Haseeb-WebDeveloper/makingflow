"use client"

import { useState } from "react"
import { ExportDialog } from "@/components/forms/export-dialog"
import type { FilterColumn } from "@/lib/submissions/filter"

/**
 * /sandbox/export — dev-only harness for the Export dialog, so its layout can
 * be looked at without a logged-in session and a form with responses. Not
 * linked from anywhere.
 */

const COLUMNS: FilterColumn[] = [
  { id: "f1", label: "Full name", type: "short_text", options: null },
  { id: "f2", label: "Email address", type: "email", options: null },
  { id: "f3", label: "Phone", type: "phone", options: null },
  { id: "f4", label: "Which city are you based in?", type: "dropdown", options: null },
  { id: "f5", label: "Years of paid-media experience", type: "scale", options: null },
  { id: "f6", label: "Upload your CV", type: "file_upload", options: null },
  { id: "f7", label: "Portfolio link", type: "url", options: null },
  { id: "f8", label: "Tell us about a campaign you are proud of", type: "long_text", options: null },
  { id: "f9", label: "Expected monthly salary", type: "short_text", options: null },
  { id: "f10", label: "Notice period", type: "dropdown", options: null },
  { id: "f11", label: "Are you willing to work on site?", type: "yes_no", options: null },
  { id: "f12", label: "How did you hear about this role?", type: "multiple_choice", options: null },
  { id: "f13", label: "Anything else?", type: "long_text", options: null },
]

export default function ExportSandbox() {
  const [plain, setPlain] = useState(false)
  const [filtered, setFiltered] = useState(false)

  return (
    <div className="mx-auto max-w-xl space-y-4 p-10">
      <h1 className="text-lg font-semibold text-foreground">Export dialog</h1>
      <p className="text-sm text-muted-foreground">
        Two states: nothing filtered, and a live search plus one filter.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setPlain(true)}
          className="h-9 rounded-md border border-border px-3 text-sm font-medium"
        >
          Open (nothing filtered)
        </button>
        <button
          type="button"
          onClick={() => setFiltered(true)}
          className="h-9 rounded-md border border-border px-3 text-sm font-medium"
        >
          Open (filtered)
        </button>
      </div>

      <ExportDialog
        formId="00000000-0000-0000-0000-000000000000"
        open={plain}
        onOpenChange={setPlain}
        columns={COLUMNS}
        live={{ search: "", filters: [], match: "all" }}
        totalCompleted={3}
      />
      <ExportDialog
        formId="00000000-0000-0000-0000-000000000000"
        open={filtered}
        onOpenChange={setFiltered}
        columns={COLUMNS}
        live={{
          search: "karachi",
          filters: [{ fieldId: "f5", operator: "greater_than", value: "3" }],
          match: "all",
        }}
        totalCompleted={412}
      />
    </div>
  )
}
