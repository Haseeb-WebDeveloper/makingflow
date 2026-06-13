# MakingFlow — Form Builder & AI Architecture

> The form builder is the product. This doc is the build plan for it. Read `PRODUCT.md` first (what we're building) and `CODING_GUIDE.md` (Next 16 rules) — this doc is _how the builder and the AI layer work_. Grounded in the live schema (`src/lib/db/schema.ts`) and the Claude API (see the `claude-api` skill before writing model code).

---

## 0. The one idea everything hangs off: a form is an op log

A form is **a list of field rows** (`form_fields`), ordered by `position`. Every mutation — whether a human drags a block, the AI generates a form, or the AI edits an existing one — is the **same small set of operations** applied to that list:

```
addField(type, afterId?, partial)      removeField(id)
updateField(id, patch)                 moveField(id, afterId)
setOptions(id, options)                setLogic(id, logic)
```

This **op vocabulary is the spine of the whole builder.** It is, simultaneously:

- the **editor's** action set (slash-menu insert, drag-reorder, inline edit),
- the **AI's tool surface** (Claude calls these ops to generate/edit a form — see §4),
- the **autosave protocol** (each op → one `form_fields` mutation via a Server Action),
- the **undo/redo** unit (each op has an inverse).

One protocol, four consumers. Generate, edit, and hand-editing converge on the same code path — that's what keeps an "AI-native" builder from becoming two disconnected products (a generator and an editor) bolted together.

---

## 1. Data model (already in the schema — don't re-invent)

- **`forms`** — title, `publicId` (runtime URL), `status` (draft→published→closed), `renderMode` (classic|conversational), `aiEnabled` + `aiConfig` (`FormAiConfig`), `theme`, `settings`, submission controls.
- **`form_fields`** — one row per block (inputs **and** content blocks like `heading`/`page_break`). Key columns: `type` (the `field_type` enum — the closed set the AI may emit), `label`, `position`, `key` (stable handle for piping/prefill), `options` (`FieldOption[]`), `config` (`FieldConfig`), `logic` (`FieldLogic`), `deletedAt` (soft delete so old submissions keep resolving).
- **`FieldLogic`** already models AI + manual logic identically: `{action, match, conditions[], source: 'manual'|'ai', description}`. Plain-English logic compiles **into this shape** with `source:'ai'` and keeps the original sentence in `description` (editable later). No separate AI-logic table.
- **`FormAiConfig`** — `followUpsEnabled`, `clarifyVagueAnswers`, `screeningEnabled/Criteria`, `summaryEnabled`, `persona`. The AI runtime reads this; nothing here is required for a form to work.

**The "form spec"** the AI produces/consumes = a serializable projection of `forms` + ordered `form_fields` (no PII, no submissions). It's the single object passed to/from every AI call.

---

## 2. The editor (client) — Tally feel

**Build, don't buy.** Form blocks are _structured field rows_, not rich text — so a custom block canvas beats a ProseMirror/TipTap editor. Libraries already installed do the heavy lifting:

- **`@dnd-kit/core` + `@dnd-kit/modifiers`** — drag-to-reorder blocks (emits `moveField`).
- **`cmdk`** — the `/` slash-command menu to insert field blocks (emits `addField`).
- **`radix-ui` / shadcn primitives** — inline field config (label, required, help, options) with no heavy side panels.

**Editor state = a normalized client store** (`{form, fieldsById, order[]}`) with an **op-based reducer**. Every UI action dispatches an op; the reducer updates state optimistically and the op is queued for autosave. This is also where undo/redo lives (keep an inverse-op stack).

> Add a tiny client store lib (`zustand` or `jotai`) for the editor document — `useReducer`+context creaks at this size (autosave + optimistic + undo + AI ops landing concurrently). Recommend **zustand** (one store, no provider tree, easy to mutate from both UI and the AI stream).

**Autosave & ordering**

- Debounce op flushing (~400ms), batch into one Server Action call. Server applies ops in order, scoped to the workspace (tenancy rule — every mutation re-checks membership; see CODING_GUIDE §7).
- Ordering: `position` is a plain integer the schema resequences on reorder (forms are small — a full renumber of N≤~200 rows is trivial and avoids fractional-index complexity). Keep it.
- Optimistic UI: apply locally, reconcile on the Action's return; on failure, roll back via the inverse op + toast.

---

## 3. The respondent runtime — two renderers, one spec

Both read the same published form spec from `getPublishedForm(publicId)` (cached — see CODING_GUIDE §4). They live at the public `/f/[publicId]` route (unauthenticated; gated out of the dashboard).

- **Classic** — Tally-style: render field rows, evaluate `FieldLogic` client-side for show/hide, paginate on `page_break`, support answer piping (`{{key}}`) and URL prefill. **No AI required** — this is the graceful-degradation floor.
- **Conversational** — the adaptive AI runtime (§4.4). One question at a time, follow-ups, clarification, skips. If the AI call fails at any point, it **falls back to classic** for the remaining required fields. A submission is never blocked by AI being down.

A `submissions` row is created `partial` on first interaction (drop-off analytics) and flipped `completed` on submit; `answers` reference a stable `fieldId`.

---

## 4. The AI layer — the differentiator

> **Provider: Google Gemini** (we have a Gemini API key, not a Claude one). **SDK:** `@google/genai` (TypeScript — supports Zod schemas, function calling, structured output, and streaming natively). **Models:** **Gemini 3 Pro** for the quality paths (generate / edit / conversational); **Gemini 3 Flash** for the cheap, high-volume paths (logic-compile / screening / summaries). Confirm exact model IDs against the live model list at implementation — the Gemini lineup moves. Key is `GEMINI_API_KEY`, **server-only**.
>
> **Everything in this section is written against an `AIProvider` adapter, not Gemini directly.** Put one thin interface in `src/lib/ai/provider.ts` (`streamFormOps`, `compileLogic`, `runConversationalTurn`, `summarize`, `screen`) with a Gemini implementation behind it. The whole builder talks to the interface, so swapping to Claude later (if a key appears) is one file, not a rewrite. The architecture below is provider-neutral; where it names a Claude-ism, the Gemini equivalent applies:
>
> | Capability | Claude term (in prose) | Gemini equivalent (`@google/genai`) |
> |---|---|---|
> | Streamed generation | `messages.stream` | `generateContentStream` |
> | Tools / ops | `betaZodTool` + tool-runner | function declarations (Zod schemas) + `functionCallingConfig` |
> | Structured output | `output_config.format` | `responseMimeType: 'application/json'` + `responseSchema` (Zod) |
> | Reasoning control | adaptive thinking / effort | `thinkingConfig` (thinking budget) |
> | Cache stable prefix | `cache_control` | Gemini **context caching** (cached content) |
> | System prompt | `system` | `systemInstruction` |
>
> Gemini's Pro/Flash split makes the cheap-path decision natural: **Flash** is fast and cheap for logic-compile / screening / summaries; **Pro** for the generation and conversational quality paths.

Four capabilities, two mechanisms:

### 4.1 Generate a form (prompt → form) — **tool-streaming, progressive build**

The "wow." User types _"a job application for a senior motion designer, ask for a showreel and rate expectations"_ → the form **assembles live** as Claude streams ops onto the canvas.

- Define the **op vocabulary from §0 as Claude tools** (`betaZodTool`), with `type` constrained to the `field_type` enum and `strict: true` so invalid fields are rejected and retried at the tool layer — Claude can only emit a valid form.
- **Stream** the run (`client.messages.stream` / tool-runner with `stream:true`); apply each tool call to the editor store as it arrives → the user watches blocks appear. AI ops flow through the _same reducer_ as human ops, so the result is immediately hand-editable. AI drafts, human owns.
- Cache the big stable system prefix (field-type catalog + authoring rules + examples) with `cache_control` so every generation after the first is cheap/fast (claude-api → prompt-caching: stable prefix first, the user's prompt last).

### 4.2 Edit-as-patch ("make changes" in the builder)

Same tools as 4.1, but the current form spec is in context and the instruction is an edit (_"make Q3 optional", "add a file upload for their CV", "friendlier tone"_). Claude emits a **patch = a sequence of ops**, streamed and applied (and therefore undoable, since each op has an inverse). Generate and edit are the _same call_ with a different opening message.

### 4.3 Plain-English logic → `FieldLogic`

_"if they're a returning customer, skip the intro"_ → one **structured-output** call (`output_config.format` + a Zod schema matching `FieldLogic`), no tools, `effort:'low'`. Store with `source:'ai'` and keep the sentence in `description`. The manual logic builder reads/writes the **same** `FieldLogic` shape, so AI-compiled rules are editable by hand and vice-versa.

### 4.4 Conversational adaptive runtime (fill time)

A server-side **tool-use loop** per respondent turn:

- **System:** form goal + the `FormAiConfig` persona + the remaining unanswered/required fields + the base language.
- **Tools:** `ask(fieldId | adHocFollowUp, kind)`, `skip(fieldId, reason)`, `finish()`. Claude decides the next question, asks natural follow-ups, clarifies vague answers, and skips irrelevant fields based on answers so far.
- **Loop:** Claude calls `ask` → we render it and collect the respondent's answer → send the answer back as the tool result → Claude decides the next `ask`/`skip`/`finish`. Answers still map to stable `fieldId`s so analytics and exports are identical to classic.
- **Multi-language** falls out of the model: ask/clarify in the respondent's language, normalize stored answers to the base language. Supported languages = whatever `claude-opus-4-8` supports (no translation tables — `form_translations` only caches static UI strings, invalidated by `sourceHash`).
- **Degrade:** any failure → finish the remaining required fields in classic mode.

### 4.5 Post-submission (Phase 2+)

`summarizeSubmission` and `screenSubmission` (score/tag against `aiConfig.screeningCriteria`) — single structured-output calls, run async after submit (never block the respondent). Results land in the nullable AI columns on `submissions`.

### Transport rule

- **Streaming AI** (generate, edit, conversational) → **Route Handlers** (`app/api/ai/*/route.ts`) returning a `ReadableStream`. CODING_GUIDE §8: route handlers are for SSE/streaming; Server Components/Actions don't stream tokens.
- **Non-streaming AI** (logic-compile, summary, screen) → Server Actions (`src/lib/actions/`), or a route handler if invoked from the client.
- **All form mutations** (apply ops, publish, settings) → Server Actions.
- The Gemini key (`GEMINI_API_KEY`) is server-only; the browser never sees it. AI route handlers verify workspace membership before doing anything.

---

## 5. Guardrails (non-negotiable)

1. **AI degrades gracefully.** Generate/edit/conversational can all fail; the form still builds, renders, submits, and stores as a plain classic form. Nothing in the schema requires AI.
2. **Closed set.** The AI can only emit fields in the `field_type` enum (enforced by `strict` tool schemas) — no hallucinated field types.
3. **Tenancy.** Every builder mutation and every AI route re-checks workspace membership; never trust a `workspaceId`/`formId` from the client.
4. **Cost & latency.** Cache the stable system prefix; stream anything long; run post-submission AI async; meter `aiConfig`-gated calls against `workspace_usage.aiCallsCount`.
5. **No PII to the model on build paths.** Generate/edit/logic operate on the form spec only. Submission summaries (which do see answers) are a separate, workspace-gated path.

---

## 6. Build phases

**Phase A — Classic builder (no AI).** Editor store + op reducer + the 6 ops; dnd-kit reorder; cmdk slash menu; core field types; inline config; autosave Server Action; `/f/[publicId]` classic renderer with logic + piping + pagination; publish. _Ships a usable Tally-class product with zero AI._

**Phase B — AI generate + edit.** Op vocabulary as Claude tools; streaming route handler; progressive canvas application; prompt-cached system prefix. Plain-English logic compile.

**Phase C — Conversational runtime + multi-language.** The fill-time tool loop; classic fallback; respondent-language ask/clarify with normalized storage.

**Phase D — Intelligence on submissions.** Summaries, screening/scoring, analytics (conversion, drop-off via `partial` rows, completion time).

Validate scope with the operator before each phase.

---

## 7. Open decisions (confirm before/early in Phase B)

- [ ] **Generation mechanism:** op-based **tool-streaming with progressive build** (recommended — unifies generate/edit/hand-edit, best UX) vs. a simpler one-shot structured-output form spec (less wow, less code).
- [ ] **Cheap-path model:** all **Gemini 3 Pro** (simplest, best quality) vs. **Pro for generate/edit/conversational + Gemini 3 Flash** for high-volume logic-compile/screening/summaries (cheaper/faster at scale; recommended).
- [ ] **Editor store lib:** `zustand` (recommended) vs. `jotai` vs. hand-rolled reducer+context.
- [ ] **Streaming wire format:** SSE vs. a plain chunked `ReadableStream` of op JSON (either works; SSE gives reconnect semantics).

---

## 8. Implementation status

**Shipped (Phase B headline — AI generate + edit + live preview):**

- **Provider:** Gemini via the **Vercel AI SDK** (`ai`, `@ai-sdk/google`, `@ai-sdk/react`). Adapter at `src/lib/ai/provider.ts` (reads `GEMINI_API_KEY`, model via `GEMINI_MODEL`, default `gemini-2.5-flash`).
- **Form spec + system prompt:** `src/lib/ai/form-schema.ts` (Zod, shared by server + client; a render-ready subset of `field_type`).
- **Streaming route:** `src/app/api/ai/form/route.ts` — `streamObject` → `toTextStreamResponse()`; auth-gated; generate (no `current`) vs edit (with `current`).
- **UI:** `src/components/builder/form-builder.tsx` (`experimental_useObject` → live partial object) + `form-preview.tsx` (renders each field type, streams in live). Empty "describe your form" state → split edit panel + live canvas. Entry at `/forms/new`.

**Deliberate simplification vs §0–4:** generate/edit currently stream the **whole form object** (`streamObject`/`useObject`) rather than the op-by-op tool stream. This nails the requested real-time build/edit UX with far less surface area, and Gemini's structured-output streaming is excellent. The **op log (§0) is still the target** for: hand-editing in the canvas, undo/redo, persistence (`aiForm` → `forms`/`form_fields`), and granular/undoable AI patches. Those land next.

**Not yet built:** persistence/Save (button shows a toast), the classic + conversational respondent runtimes (§3/§4.4), plain-English logic compile (§4.3), submissions/analytics (§4.5).
