# MakingFlow — Product Specification

> **Read this first.** This is the source-of-truth product brief for MakingFlow. Anyone (human or AI agent) building, designing, or extending this product should read this document before writing code or copy. It defines _what_ MakingFlow is, _who_ it's for, _what_ we are building, and _what we are deliberately NOT building_.

---

## 1. One-liner

**MakingFlow is an AI form builder SaaS that combines the calm, document-style editing and form-filling UX of Tally with the AI-adaptive intelligence of Deformity.**

You describe a form in plain language; MakingFlow builds it. Respondents get a form that adapts to them in real time, in their own language. You get clean submissions, AI summaries, and built-in analytics.

A form is a form — whether it's a job application, a customer survey, a lead-capture flow, or an event RSVP, it's the same primitive: input fields + (optionally) an AI that asks the questions. So MakingFlow is **general-purpose**, not locked to any single industry. Agency workflows (hiring, client intake, team/HR) are first-class _example_ use cases and great launch templates — but they are examples, not the boundary.

---

## 2. Why this exists

Existing tools force a trade-off:

- **Tally** has a beautiful, frictionless editor and form-filling UX — but the logic and intelligence are static. It collects answers; it doesn't _understand_ them.
- **Deformity** has powerful AI/adaptive features — but it's a sprawling, do-everything product with a heavy surface area and a busier feel.

MakingFlow takes **Tally's UX** + **Deformity's intelligence**, keeps the product focused and calm, and ships it as a clean SaaS anyone can sign up for and use.

---

## 3. Design philosophy (non-negotiable principles)

1. **Document-first editing.** Building a form should feel like writing a doc, not configuring software. Start typing on a blank page, press `/` to insert a field block, drag to reorder. Notion/Tally-style. No modal-heavy, settings-panel-heavy builders.
2. **Calm, minimal interface.** Generous whitespace, weight-not-color contrast, restrained palette. No visual noise. The form is the hero; the chrome disappears.
3. **AI is the differentiator, but degrades gracefully.** AI helps you _build_ forms faster and helps forms _adapt_ to respondents. But a form must always work as a plain, predictable form if AI is unavailable. AI is additive, never a hard dependency for the basics.
4. **Focused, not endless.** We pick a tight, high-quality feature set and a few integrations that matter — not a 7,000-integration kitchen sink. Depth over breadth.
5. **Respondent experience matters as much as builder experience.** Forms must be fast, mobile-first, accessible, and feel human to fill out — one question at a time when conversational, clean and skimmable when classic.

---

## 4. Target users

MakingFlow is a self-serve SaaS. Anyone who needs to collect structured input is a potential user.

| User                  | Role                   | What they do in MakingFlow                                          |
| --------------------- | ---------------------- | ------------------------------------------------------------------- |
| **Creator / builder** | Builds forms           | Describes or composes a form, customizes, publishes, shares         |
| **Team member**       | Collaborates / reviews | Reads submissions, filters, exports, acts on data                   |
| **Respondent**        | Fills forms            | Completes a form (classic or conversational), in their own language |

**Example creator segments** (who we'd market to and template for):

- Agencies & studios — hiring, client intake briefs, feedback/approval, onboarding (Figmenta's own use case).
- Startups & SMBs — lead capture, customer feedback, surveys, applications.
- HR / People teams — job applications, employee onboarding, internal pulse surveys.
- Event organizers, educators, freelancers, support teams — RSVPs, quizzes, intake, requests.

Primary buyer persona at launch: small teams (1–50 people) that want polished, intelligent forms without standing up heavyweight tooling.

---

## 5. Example use cases (illustrative, NOT the scope boundary)

MakingFlow handles any form. These are strong templates to seed the gallery and prove the AI value — but the product is not limited to them.

- **Hiring / recruiting** — job applications, freelancer intake, portfolio submissions. _AI:_ adaptive follow-ups, candidate screening/scoring, per-candidate summary.
- **Client / project intake** — creative briefs, onboarding questionnaires, feedback & approval. _AI:_ turn a vague free-text brief into a structured one; clarify weak answers; summarize for the team.
- **Surveys & feedback** — customer satisfaction, NPS, market research, pulse checks. _AI:_ conversational depth that captures the "why," not just a rating.
- **Lead capture & qualification** — contact/demo requests, qualification flows. _AI:_ adaptive questions that route and score leads.
- **HR / team / internal** — employee onboarding, leave requests, expenses. _AI:_ friendlier conversational fill for long forms, auto-summaries.
- **Events, education, applications** — RSVPs, quizzes, grant/program applications.

---

## 6. Core features (MUST HAVE)

These six are the heart of the product. Everything else supports them.

1. **AI-generated adaptive flows** — forms adjust dynamically to each respondent. Describe the form in plain language and MakingFlow drafts it; at fill time the form can ask natural follow-ups, clarify vague answers, and skip irrelevant questions based on what the respondent says.
2. **Conditional logic in plain English** — describe branching conditions naturally ("if they're a returning customer, skip the intro and ask about their last order") instead of wiring up rule trees by hand. (A visual/manual logic fallback also exists for precision.)
3. **Automatic multi-language** — forms are available in the respondent's language automatically, powered by the AI model. _The set of supported languages is whatever the chosen AI model supports_ — we do not maintain manual translation tables. Respondent answers are normalized back for the form owner.
4. **Focused integrations** — **Google Sheets**, **webhooks**, and **email** (notifications + response delivery). Deliberately a small, high-value set. Others only if clearly justified later.
5. **Rich question types** — text (short/long), multiple-choice, dropdown, multi-select, checkboxes, yes/no, contact (name/email/phone/address/URL), rating/scale/NPS/ranking, date/time, file upload, e-signature, hidden fields, and layout/content blocks (headings, text, images, embeds). Payment fields are a later add (only when validated).
6. **Built-in analytics** — submission counts over time, completion/conversion rate, drop-off by question (where respondents abandon), average completion time, and per-question breakdowns. Surfaced in a simple, readable dashboard.

> **Guardrail:** AI features must degrade gracefully. If AI is unavailable, forms still render, submit, and store data as classic forms.

---

## 7. Supporting features

### 7.1 The editor (Tally-inspired)

- Blank-page, document-style editor. Type to add text; `/` command menu to insert field blocks.
- Drag-to-reorder blocks; keyboard-friendly.
- Inline, lightweight field configuration (label, placeholder, required, help text) — no heavy side panels.
- Multi-page / multi-step forms with progress indication.
- Live preview / instant publish.

### 7.2 Smart behavior (beyond AI)

- **Answer piping** — reference earlier answers later ("Thanks {{name}}…").
- **Calculations / scoring** — compute values from answers (e.g. quiz result, lead score).
- **Pre-population** — fill fields from URL parameters or known data.
- **Submission controls** — open/close dates, response caps, redirect-after-submit, one-response-per-person.

### 7.3 Submissions & review

- Submissions inbox: list + detail view, with AI summary up top.
- Filter / search / tag submissions.
- Export (CSV) and per-submission view.
- Optional lightweight status tagging (e.g. new / reviewing / done).

### 7.4 Design & branding

- Per-form theming: colors, fonts, logo, cover image.
- Mobile-first responsive layouts by default.
- White-label feel — forms look like the creator's brand.
- Share via link, embed (website/popup), and custom domain (later phase).

### 7.5 Render modes (respondent runtime)

- **Classic mode** — multi-step, Tally-like form.
- **Conversational mode** — adaptive, one-question-at-a-time AI chat (Deformity-like).
- Toggle per form.

---

## 8. SaaS platform requirements

Because MakingFlow is a public, self-serve SaaS (not an internal tool), the platform layer matters:

- **Auth & accounts** — sign up / sign in (email + OAuth), email verification, password reset.
- **Workspaces / multi-tenancy** — each account is an isolated tenant; data never leaks across tenants. Support inviting teammates into a workspace (roles: owner / member at minimum).
- **Billing & plans** — free tier + paid plans; meter the things that cost us (AI usage, submissions, file storage). Plan gates enforced server-side.
- **Usage limits** — per-plan caps on forms, monthly submissions, AI calls, file storage; clear upgrade prompts at the cap.
- **Data & privacy** — forms may collect sensitive PII (CVs, contact info). GDPR-minded: data export, deletion, and clear ownership. EU data residency is a likely requirement (Figmenta is EU-based).
- **Reliability** — forms must accept submissions even under load; AI failures must not block submission.

---

## 9. Positioning

- **vs. Tally:** same lovely editor and fill experience, but forms are _intelligent_ — they adapt, translate, screen, and summarize.
- **vs. Deformity:** same AI power, but focused and calm — a tighter feature set, cleaner UX, no sprawl.
- **vs. Typeform/Jotform:** AI-native from the ground up, not bolted on; conversational depth plus a modern, minimal builder.

**Tagline candidates** (placeholder, refine later): _"Forms that think."_ / _"Describe it. Done."_ / _"Beautiful forms, smart answers."_

---

## 10. Product surfaces (what we will actually build)

1. **Marketing site + auth** — landing, pricing, sign-up/sign-in.
2. **Builder** — the document-style editor (§7.1) + **AI panel** (generate form, describe logic).
3. **Respondent runtime** — classic + conversational render modes, mobile-first, multi-language.
4. **Submissions dashboard** — inbox, detail, AI summaries, filtering, export.
5. **Analytics dashboard** — submissions, conversion, drop-off, completion time (§6.6).
6. **Form settings** — branding, logic, submission controls, integrations, sharing/embed.
7. **Workspace & account** — team, billing, usage, profile.
8. **Templates gallery** — pre-built forms across the §5 example use cases.

---

## 11. Suggested build phases (roadmap)

> Phasing is a recommendation, not a contract. Validate scope with the operator before each phase.

**Phase 1 — Core SaaS + classic forms (MVP)**

- Auth, workspace, basic billing/free-tier limits.
- Document editor, rich field types, multi-page, manual conditional logic, answer piping.
- Classic respondent runtime (mobile-first), theming basics, share link + embed.
- Submissions inbox + CSV export.
- A handful of templates across use cases.

**Phase 2 — AI layer + analytics + integrations**

- AI form generation from a prompt.
- Plain-English conditional logic.
- AI submission summaries; optional screening/scoring + tagging.
- Built-in analytics (conversion, drop-off, completion time).
- Integrations: Google Sheets, webhooks, email.

**Phase 3 — Conversational, multi-language & scale**

- Conversational adaptive render mode.
- Automatic multi-language (model-driven).
- Paid plan tiers + usage metering hardening, custom domain, e-signature.
- Payment fields (only if validated by real demand).

---

## 12. Non-goals (explicitly OUT of scope)

MakingFlow is general-purpose for _forms_, but it is **not**:

- A full **ATS / CRM / HRIS / payroll** system — we collect and lightly organize data; we don't replace systems of record.
- A **website / page builder.**
- A **BI / deep statistical analytics** suite — analytics stay focused and readable (§6.6), not a data-science tool.
- A **7,000-integration marketplace** — we deliberately pick a focused set (§6.4).
- A **marketing-automation / email-campaign** platform.

If a request lands in one of these areas, push back and confirm it genuinely strengthens the core form product before building.

---

## 13. Glossary (for AI agents & new contributors)

- **MakingFlow** — this product. An AI form builder SaaS.
- **Figmenta** — the creative agency / company building and operating MakingFlow.
- **Form** — a collection of field blocks the builder creates.
- **Block / field** — a single input or content element in a form.
- **Classic mode** — multi-step, Tally-style render of a form.
- **Conversational mode** — adaptive, one-question-at-a-time AI render of a form.
- **Adaptive flow** — a form whose questions change per respondent based on their answers.
- **Respondent** — the person filling out a form.
- **Submission** — one completed response to a form.
- **Workspace / tenant** — an isolated account containing forms, submissions, and members.
- **Screening/scoring** — AI evaluation of a submission against described criteria.
- **Piping** — injecting an earlier answer into later question text or messages.
- **Conversion rate** — % of people who start a form and complete it.
- **Drop-off** — where respondents abandon a form (per-question).

---

## 14. Open questions (resolve with operator before/early in build)

- [ ] Tech stack & hosting (likely Next.js + Supabase — confirm).
- [ ] AI provider/model (default to latest Claude models unless decided otherwise; note: this also defines our supported languages — see §6.3).
- [ ] Billing provider (Stripe?) and the initial plan/pricing structure.
- [ ] Free-tier limits (forms / monthly submissions / AI calls / storage).
- [ ] Public product brand & visual identity for "MakingFlow."
- [ ] Data residency / compliance specifics (GDPR, EU hosting for PII).

---

_Document owner: Figmenta / Goku. Status: v2 draft — repositioned as a general-purpose AI form builder SaaS. Update this file as decisions are made; it is the canonical brief._
