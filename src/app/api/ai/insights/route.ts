import { streamText, type ModelMessage } from "ai"
import { geminiModel, NO_THINKING } from "@/lib/ai/provider"
import { getOptionalUser, getDefaultWorkspace } from "@/lib/auth/session"
import { getFormShell, getFormSubmissions } from "@/lib/data/forms"
import type { AnswerValue } from "@/lib/db/schema"

export const maxDuration = 60

// Cap rows fed to the model so a busy form doesn't blow the context window.
const MAX_ROWS = 100

type Body = {
  formId?: string
  question?: string
  history?: { role: "user" | "assistant"; text: string }[]
}

function formatValue(v: AnswerValue | undefined): string {
  if (v == null) return ""
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

/**
 * Form-scoped AI analyst. Answers questions about a form and its submissions
 * (summaries, counts, aggregates) from the data we pass as context. Streams
 * plain text back to the floating assistant. Workspace-scoped via getFormShell.
 */
export async function POST(request: Request) {
  const user = await getOptionalUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  const { formId, question, history }: Body = await request.json()
  if (!formId || !question?.trim()) {
    return new Response("Provide a formId and a question", { status: 400 })
  }

  const workspace = await getDefaultWorkspace()
  if (!workspace) return new Response("No workspace", { status: 403 })

  // Independent reads — run them together rather than back-to-back (the DB is
  // far from the function, so each serial await is a full round-trip).
  const [shell, data] = await Promise.all([
    getFormShell(formId, workspace.id),
    getFormSubmissions(formId, 200),
  ])
  if (!shell) return new Response("Form not found", { status: 404 })
  const columns = data?.columns ?? []
  const rows = data?.rows ?? []
  const sample = rows.slice(0, MAX_ROWS).map((r) => {
    const o: Record<string, string> = {}
    for (const c of columns) o[c.label] = formatValue(r.values[c.id])
    o._submittedAt = r.submittedAt.toISOString()
    return o
  })

  const context = {
    form: {
      title: shell.title,
      status: shell.status,
      fields: columns.map((c) => ({ label: c.label, type: c.type })),
    },
    totalSubmissions: rows.length,
    truncated: rows.length > sample.length,
    submissions: sample,
  }

  const system = `You are the AI analyst for the form titled "${shell.title}". Answer the user's question using ONLY the form structure and submission data given as JSON.
- Be concise and specific. Use numbers, short bullet lists, or compact tables where they help.
- When asked to summarize or aggregate, compute from the data (counts, distributions, averages).
- If there are no submissions, say so plainly. If the data can't answer the question, say what's missing rather than guessing.
- Never invent submissions or values that aren't in the data.${context.truncated ? `\n- Only the most recent ${MAX_ROWS} of ${rows.length} submissions are included; note this if it affects the answer.` : ""}`

  const messages: ModelMessage[] = []
  for (const h of history ?? []) {
    if (h?.text) messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.text })
  }
  messages.push({
    role: "user",
    content: `${question.trim()}\n\nFORM + SUBMISSIONS DATA (JSON):\n${JSON.stringify(context)}`,
  })

  const result = streamText({
    model: geminiModel,
    system,
    messages,
    providerOptions: NO_THINKING,
  })
  return result.toTextStreamResponse()
}
