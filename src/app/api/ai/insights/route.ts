import { streamText, type ModelMessage } from "ai"
import { db } from "@/lib/db"
import { aiModel } from "@/lib/ai/provider"
import { formChatMessages, type AnswerValue } from "@/lib/db/schema"
import { getOptionalUser, getDefaultWorkspace } from "@/lib/auth/session"
import { getFormShell, getFormSubmissions, getFormSubmissionCounts } from "@/lib/data/forms"
import { getFormChat } from "@/lib/data/form-chat"

export const maxDuration = 60

// Cap rows fed to the model so a busy form doesn't blow the context window.
// This is a SAMPLE, never the total — see the counts passed alongside it.
const MAX_ROWS = 100

// Turns of prior conversation replayed as context. The row sample is re-sent on
// every request, so an unbounded thread would grow the prompt without bound.
const MAX_HISTORY = 20

type Body = {
  formId?: string
  question?: string
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
 * plain text back to the Ask-AI sheet. Workspace-scoped via getFormShell.
 *
 * The thread is persisted (surface 'insights') and read back from the database,
 * NOT taken from the request body: it is shared with the workspace, so the
 * model must see the same history everyone else sees, and a client can't forge
 * an assistant turn to steer the answer.
 */
export async function POST(request: Request) {
  const user = await getOptionalUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  const { formId, question }: Body = await request.json()
  if (!formId || !question?.trim()) {
    return new Response("Provide a formId and a question", { status: 400 })
  }
  const asked = question.trim()

  const workspace = await getDefaultWorkspace()
  if (!workspace) return new Response("No workspace", { status: 403 })

  // Independent reads — run them together rather than back-to-back (the DB is
  // far from the function, so each serial await is a full round-trip).
  const [shell, data, counts, thread] = await Promise.all([
    getFormShell(formId, workspace.id),
    getFormSubmissions(formId, MAX_ROWS),
    getFormSubmissionCounts(formId, workspace.id),
    getFormChat(formId, "insights"),
  ])
  if (!shell) return new Response("Form not found", { status: 404 })

  const columns = data?.columns ?? []
  const rows = data?.rows ?? []
  const sample = rows.map((r) => {
    const o: Record<string, string> = {}
    for (const c of columns) o[c.label] = formatValue(r.values[c.id])
    o._submittedAt = r.submittedAt.toISOString()
    return o
  })

  // The totals are counted across the whole table; `sample` is only the newest
  // MAX_ROWS. Conflating the two is how "how many responses?" got answered with
  // the page size instead of the real number.
  const totalCompleted = counts?.completed ?? sample.length
  const totalPartial = counts?.partial ?? 0
  const truncated = totalCompleted > sample.length

  const context = {
    form: {
      title: shell.title,
      status: shell.status,
      fields: columns.map((c) => ({ label: c.label, type: c.type })),
    },
    totalCompletedSubmissions: totalCompleted,
    totalPartialSubmissions: totalPartial,
    includedInSample: sample.length,
    truncated,
    submissions: sample,
  }

  const system = `You are the AI analyst for the form titled "${shell.title}". Answer the user's question using ONLY the form structure and submission data given as JSON.
- Be concise and specific. Use numbers, short bullet lists, or compact tables where they help.
- When asked to summarize or aggregate, compute from the data (counts, distributions, averages).
- For "how many responses" and any other total, use totalCompletedSubmissions — NOT the length of the submissions array, which is only a sample. totalPartialSubmissions counts people who started and never finished; mention it only when it is relevant to the question.
- If there are no submissions, say so plainly. If the data can't answer the question, say what's missing rather than guessing.
- Never invent submissions or values that aren't in the data.${
    truncated
      ? `\n- Only the ${sample.length} most recent of ${totalCompleted} completed submissions are included, so any per-response breakdown covers that sample only — say so when it affects the answer.`
      : ""
  }`

  const messages: ModelMessage[] = []
  for (const m of thread.slice(-MAX_HISTORY)) {
    if (m.text) messages.push({ role: m.role, content: m.text })
  }
  messages.push({
    role: "user",
    // The data dump rides along with the question for the model, but only the
    // question itself is persisted — the JSON is regenerated fresh each turn.
    content: `${asked}\n\nFORM + SUBMISSIONS DATA (JSON):\n${JSON.stringify(context)}`,
  })

  // Ownership is already proven above, so these writes go straight to the table
  // rather than through `appendFormChatMessage` — that action re-derives the
  // session, and the assistant turn is written from inside a stream callback,
  // after the response headers have gone out.
  const remember = (role: "user" | "assistant", text: string) =>
    db
      .insert(formChatMessages)
      .values({
        formId,
        surface: "insights",
        role,
        userId: role === "user" ? user.id : null,
        text: text.slice(0, 8000),
      })
      .catch((err) => console.error("[ai/insights] could not persist turn", err))

  // Saved before the model runs, so a failed or abandoned answer still leaves a
  // record of what was asked.
  await remember("user", asked)

  const result = streamText({
    model: aiModel,
    system,
    messages,
    onFinish: ({ text }) => {
      if (text.trim()) void remember("assistant", text)
    },
    // A half-streamed answer is not persisted: a truncated analysis saved
    // without any marker reads as a complete one. The question stays in the
    // thread unanswered, which is the honest record.
    onAbort: () => console.warn("[ai/insights] stream aborted; answer not saved"),
    onError: ({ error }) => console.error("[ai/insights] stream failed", error),
  })
  return result.toTextStreamResponse()
}
