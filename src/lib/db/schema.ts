// Drizzle schema — single source of truth for the MakingFlow database.
// `pnpm db:generate` to emit SQL migrations into ./drizzle, `pnpm db:migrate` to apply.
//
// Design notes (read before touching):
//
// 1. MULTI-TENANCY — `workspaces` is the tenant. Every domain row hangs off a
//    workspace (directly, or via its form). Queries MUST be scoped through
//    workspace membership (`getRequiredWorkspace`); `submissions` denormalizes
//    `workspace_id` so quota counting and tenant scoping never need a join.
// 2. SIGNUP — a signup creates a `users` row (id = Supabase auth uid), one
//    `workspaces` row, and an `owner` row in `workspace_members`. v1 ships
//    single-member workspaces, but members/invitations are modeled now so
//    teams land later without a schema rewrite.
// 3. FIELDS ARE ROWS, NOT A JSONB BLOB — per-question analytics (drop-off),
//    answers referencing a stable field id, and reordering all need field
//    identity. Multi-page forms use `page_break` blocks (Tally-style), not a
//    pages table. Fields soft-delete (`deleted_at`) so existing submissions
//    keep resolving their question.
// 4. AI DEGRADES GRACEFULLY — nothing in this schema requires AI to accept a
//    submission. AI artifacts (summary, score, follow-up answers, translation
//    cache) are all nullable/additive.
// 5. GDPR — respondent PII lives only in `submissions` + `answers` + `uploads`.
//    Deleting a submission cascades its answers; uploads are detached
//    (set null) so the app can delete the Cloudinary asset before removing
//    the row. Form events carry no PII and survive deletion as anonymous counts.
// 6. PLAN/BILLING — `workspaces.plan` is the single source of truth for
//    entitlements (updated by billing webhooks). Per-plan caps are code
//    constants (PLAN_LIMITS in src/lib/config), NOT database rows. Billing
//    provider is pending confirmation (likely Stripe) — rename stripe_* if
//    that changes.

import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const workspaceRoleEnum = pgEnum('workspace_role', ['owner', 'member'])

export const planEnum = pgEnum('plan', ['free', 'pro', 'business'])

export const invitationStatusEnum = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'revoked',
  'expired',
])

export const formStatusEnum = pgEnum('form_status', [
  'draft',
  'published',
  'closed', // manually closed or auto-closed (closes_at / submission_limit hit)
  'archived',
])

export const renderModeEnum = pgEnum('render_mode', ['classic', 'conversational'])

// Input fields + content/layout blocks. Postgres enums are append-only-friendly
// (ALTER TYPE ... ADD VALUE) — payment fields etc. get appended when validated.
export const fieldTypeEnum = pgEnum('field_type', [
  // text
  'short_text',
  'long_text',
  // contact
  'email',
  'phone',
  'url',
  'address',
  // choice
  'multiple_choice', // single answer, radio-style
  'dropdown',
  'multi_select', // multi answer, dropdown-style
  'checkboxes', // multi answer, list-style
  'yes_no',
  // opinion
  'rating',
  'scale',
  'nps',
  'ranking',
  // date & time
  'date',
  'time',
  // misc inputs
  'file_upload',
  'signature',
  'hidden', // populated from URL params / prefill, never rendered
  // content & layout blocks (no answers)
  'heading',
  'paragraph',
  'image',
  'embed',
  'page_break',
])

export const submissionStatusEnum = pgEnum('submission_status', [
  'partial', // respondent started, hasn't finished — basis for drop-off analytics
  'completed',
])

export const reviewStatusEnum = pgEnum('review_status', ['new', 'reviewing', 'done'])

export const integrationTypeEnum = pgEnum('integration_type', [
  'google_sheets',
  'webhook',
  'email',
])

export const connectionProviderEnum = pgEnum('connection_provider', ['google'])

export const formEventTypeEnum = pgEnum('form_event_type', [
  'view', // form rendered for a respondent
  'start', // first interaction (a submission row is created)
  'complete', // submission completed
])

// ---------------------------------------------------------------------------
// JSONB shapes
// ---------------------------------------------------------------------------

export type FormTheme = {
  primaryColor?: string
  backgroundColor?: string
  textColor?: string
  fontFamily?: string
  logoUrl?: string
  coverImageUrl?: string
  buttonRadius?: 'none' | 'sm' | 'md' | 'full'
}

export type FormSettings = {
  showProgressBar?: boolean
  submitButtonLabel?: string
  thankYouMessage?: string
  captchaEnabled?: boolean
}

export type FormAiConfig = {
  followUpsEnabled?: boolean // adaptive follow-up questions (conversational mode)
  clarifyVagueAnswers?: boolean
  screeningEnabled?: boolean
  screeningCriteria?: string // plain-language criteria the AI scores against
  summaryEnabled?: boolean
  persona?: string // tone/voice for conversational mode
}

export type FieldOption = {
  id: string
  label: string
  points?: number // calculations/scoring (quiz results, lead scores)
}

// Type-specific knobs. Only the keys relevant to the field's type are set.
export type FieldConfig = {
  minLength?: number
  maxLength?: number
  min?: number
  max?: number
  step?: number
  minLabel?: string
  maxLabel?: string
  ratingMax?: number
  ratingIcon?: 'star' | 'heart' | 'number'
  allowedFileTypes?: string[]
  maxFileSizeMb?: number
  maxFiles?: number
  includeTime?: boolean
  allowOther?: boolean
  randomizeOptions?: boolean
  defaultValue?: string // hidden fields / prefill
  imageUrl?: string // image block
  embedUrl?: string // embed block
}

export type FieldCondition = {
  fieldId: string
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'not_contains'
    | 'greater_than'
    | 'less_than'
    | 'is_empty'
    | 'is_not_empty'
  value?: string | number | boolean | string[]
}

// Visibility logic. Plain-English rules compile to this same structure
// (source: 'ai' keeps the original sentence for display/re-editing); the
// manual logic builder writes it directly (source: 'manual').
export type FieldLogic = {
  action: 'show' | 'hide'
  match: 'all' | 'any'
  conditions: FieldCondition[]
  source: 'manual' | 'ai'
  description?: string // the plain-English rule this was compiled from
}

export type AnswerValue =
  | string
  | number
  | boolean
  | string[]
  | Record<string, unknown>

export type SubmissionMeta = {
  urlParams?: Record<string, string>
  referrer?: string
  userAgent?: string
  device?: 'mobile' | 'tablet' | 'desktop'
  country?: string
}

export type WebhookIntegrationConfig = {
  url: string
  secret?: string // HMAC signing secret
}

export type GoogleSheetsIntegrationConfig = {
  connectionId: string // workspace_connections.id holding the OAuth grant
  spreadsheetId: string
  sheetName?: string
}

export type EmailIntegrationConfig = {
  recipients: string[]
  includeAnswers?: boolean
}

export type IntegrationConfig =
  | WebhookIntegrationConfig
  | GoogleSheetsIntegrationConfig
  | EmailIntegrationConfig

// Translated strings for one form+language, keyed by field id. Cached so we
// don't re-translate on every render; invalidated via source_hash.
export type FormTranslationContent = {
  form?: { title?: string; thankYouMessage?: string; submitButtonLabel?: string }
  fields?: Record<
    string,
    {
      label?: string
      description?: string
      placeholder?: string
      options?: Record<string, string> // option id -> translated label
    }
  >
}

export type TemplateContent = {
  form: {
    title: string
    renderMode?: 'classic' | 'conversational'
    theme?: FormTheme
    settings?: FormSettings
    aiConfig?: FormAiConfig
  }
  // `ref` lets logic conditions point at other template fields before real
  // ids exist; instantiation maps refs -> fresh field uuids.
  fields: Array<{
    ref: string
    type: (typeof fieldTypeEnum.enumValues)[number]
    label: string
    description?: string
    placeholder?: string
    required?: boolean
    options?: Array<Omit<FieldOption, 'id'> & { ref: string }>
    config?: FieldConfig
    logic?: Omit<FieldLogic, 'conditions'> & {
      conditions: Array<Omit<FieldCondition, 'fieldId'> & { fieldRef: string }>
    }
  }>
}

// ---------------------------------------------------------------------------
// Shared columns
// ---------------------------------------------------------------------------

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
}

// ---------------------------------------------------------------------------
// Identity & tenancy
// ---------------------------------------------------------------------------

// Mirrors Supabase auth.users — id IS the Supabase auth uid (no default).
// Row is created in the auth callback on first sign-in.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    avatarUrl: text('avatar_url'),
    ...timestamps,
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
)

// The tenant. All domain data is owned by a workspace, never by a user.
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logoUrl: text('logo_url'),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Entitlement SSOT — set by billing webhooks, read by plan gates.
    plan: planEnum('plan').notNull().default('free'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('workspaces_slug_idx').on(table.slug),
    uniqueIndex('workspaces_stripe_customer_idx').on(table.stripeCustomerId),
  ],
)

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRoleEnum('role').notNull().default('member'),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_idx').on(table.userId),
  ],
)

// Future team feature (not exposed in v1). Acceptance creates the
// workspace_members row and marks the invitation accepted.
export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: workspaceRoleEnum('role').notNull().default('member'),
    token: text('token').notNull(),
    status: invitationStatusEnum('status').notNull().default('pending'),
    invitedById: uuid('invited_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('workspace_invitations_token_idx').on(table.token),
    index('workspace_invitations_workspace_idx').on(table.workspaceId),
    index('workspace_invitations_email_idx').on(table.email),
  ],
)

// Workspace-level OAuth grants (e.g. one Google account powering Sheets
// integrations across many forms). Tokens encrypted at the app layer.
export const workspaceConnections = pgTable(
  'workspace_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: connectionProviderEnum('provider').notNull(),
    accountEmail: text('account_email').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    ...timestamps,
  },
  (table) => [index('workspace_connections_workspace_idx').on(table.workspaceId)],
)

// Monthly metering for the things that cost us. One row per workspace per
// calendar month (period_start = first of month), incremented atomically at
// submit/AI-call time. Storage is metered from uploads, not here.
export const workspaceUsage = pgTable(
  'workspace_usage',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    submissionsCount: integer('submissions_count').notNull().default(0),
    aiCallsCount: integer('ai_calls_count').notNull().default(0),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.periodStart] })],
)

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const forms = pgTable(
  'forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull().default('Untitled form'),
    // Short app-generated id for the public runtime URL (/f/[publicId]) —
    // unguessable, decoupled from the internal uuid.
    publicId: text('public_id').notNull(),
    status: formStatusEnum('status').notNull().default('draft'),
    renderMode: renderModeEnum('render_mode').notNull().default('classic'),
    // Multi-language: base is what the builder wrote; when autoTranslate is on
    // the runtime serves the respondent's language (cached in form_translations).
    baseLanguage: text('base_language').notNull().default('en'),
    autoTranslate: boolean('auto_translate').notNull().default(false),
    aiEnabled: boolean('ai_enabled').notNull().default(false),
    aiConfig: jsonb('ai_config').$type<FormAiConfig>(),
    theme: jsonb('theme').$type<FormTheme>(),
    settings: jsonb('settings').$type<FormSettings>(),
    // Submission controls — columns (not jsonb) because they're enforced
    // server-side on every submit.
    opensAt: timestamp('opens_at', { withTimezone: true }),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    submissionLimit: integer('submission_limit'),
    oneResponsePerPerson: boolean('one_response_per_person').notNull().default(false),
    redirectUrl: text('redirect_url'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // trash/restore
    ...timestamps,
  },
  (table) => [
    uniqueIndex('forms_public_id_idx').on(table.publicId),
    index('forms_workspace_idx').on(table.workspaceId),
  ],
)

// One row per block in the document editor — inputs AND content blocks.
// Order is `position` (resequenced on reorder; forms are small).
export const formFields = pgTable(
  'form_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    type: fieldTypeEnum('type').notNull(),
    label: text('label').notNull().default(''),
    description: text('description'), // help text under the label
    placeholder: text('placeholder'),
    required: boolean('required').notNull().default(false),
    position: integer('position').notNull(),
    // Stable handle for answer piping ({{key}}) and URL prefill (?key=value).
    key: text('key'),
    options: jsonb('options').$type<FieldOption[]>(),
    config: jsonb('config').$type<FieldConfig>(),
    logic: jsonb('logic').$type<FieldLogic>(),
    // Soft delete — answers and analytics keep resolving removed questions.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('form_fields_form_position_idx').on(table.formId, table.position),
    uniqueIndex('form_fields_form_key_idx').on(table.formId, table.key),
  ],
)

// AI translation cache (model-driven, no manual translation tables).
// source_hash fingerprints the base-language content that produced this row;
// mismatch = stale = re-translate.
export const formTranslations = pgTable(
  'form_translations',
  {
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    language: text('language').notNull(), // BCP 47 (e.g. 'it', 'pt-BR')
    content: jsonb('content').$type<FormTranslationContent>().notNull(),
    sourceHash: text('source_hash').notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.formId, table.language] })],
)

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

// A row is created when the respondent starts (status 'partial') and flipped
// to 'completed' on submit — partials power drop-off analytics and abandoned-
// response recovery. Completion time = completed_at - created_at.
export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    // Denormalized tenant key — quota counts and inbox queries skip the join.
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    status: submissionStatusEnum('status').notNull().default('partial'),
    mode: renderModeEnum('mode').notNull().default('classic'),
    language: text('language'), // language the respondent answered in
    // Hashed respondent identity (email or device fingerprint) for
    // one-response-per-person enforcement. Never the raw value.
    respondentKey: text('respondent_key'),
    meta: jsonb('meta').$type<SubmissionMeta>(),
    // Owner-side review workflow
    reviewStatus: reviewStatusEnum('review_status').notNull().default('new'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    // AI artifacts — always nullable, never required to accept a submission.
    aiSummary: text('ai_summary'),
    aiScore: integer('ai_score'), // screening score 0-100
    // Computed values from answer points (quiz result, lead score), keyed by
    // whatever the calculation defines.
    calculations: jsonb('calculations').$type<Record<string, number>>(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('submissions_form_created_idx').on(table.formId, table.createdAt),
    index('submissions_form_status_idx').on(table.formId, table.status),
    index('submissions_workspace_idx').on(table.workspaceId),
    index('submissions_form_respondent_idx').on(table.formId, table.respondentKey),
  ],
)

// One row per answered question. `question`/`type` are snapshots taken at
// answer time so a submission stays readable after the form is edited.
// field_id is NULL for AI follow-up questions (they don't exist in the form
// schema) — the unique index still holds because Postgres treats NULLs as
// distinct.
export const answers = pgTable(
  'answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id').references(() => formFields.id, {
      onDelete: 'set null',
    }),
    isAiFollowUp: boolean('is_ai_follow_up').notNull().default(false),
    question: text('question').notNull(),
    type: fieldTypeEnum('type').notNull(),
    // Normalized, owner-facing value (translated back to the form's base
    // language when the respondent answered in another one).
    value: jsonb('value').$type<AnswerValue>().notNull(),
    // What the respondent literally said, when it differs from `value`.
    originalValue: jsonb('original_value').$type<AnswerValue>(),
    originalLanguage: text('original_language'),
    ...timestamps,
  },
  (table) => [
    index('answers_submission_idx').on(table.submissionId),
    index('answers_field_idx').on(table.fieldId),
    uniqueIndex('answers_submission_field_idx').on(table.submissionId, table.fieldId),
  ],
)

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

// Append-only, anonymous counters: views vs starts vs completes drive the
// conversion funnel; drop-off-by-question derives from partial submissions'
// answers. visitor_key is a salted daily hash for unique-view dedup, not PII.
export const formEvents = pgTable(
  'form_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    type: formEventTypeEnum('type').notNull(),
    submissionId: uuid('submission_id').references(() => submissions.id, {
      onDelete: 'set null',
    }),
    visitorKey: text('visitor_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('form_events_form_type_created_idx').on(
      table.formId,
      table.type,
      table.createdAt,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

// Per-form integration instances. The focused set: Google Sheets, webhooks,
// email. A form may have several of the same type (e.g. two webhooks).
export const formIntegrations = pgTable(
  'form_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    formId: uuid('form_id')
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    type: integrationTypeEnum('type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').$type<IntegrationConfig>().notNull(),
    ...timestamps,
  },
  (table) => [index('form_integrations_form_idx').on(table.formId)],
)

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

// Every respondent upload (file_upload/signature fields) and builder asset
// (logo, cover). Answer values reference uploads.id. `bytes` sums into the
// workspace storage quota. Submission/form links are set-null so the row
// survives until the app deletes the Cloudinary asset, then the row.
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    formId: uuid('form_id').references(() => forms.id, { onDelete: 'set null' }),
    submissionId: uuid('submission_id').references(() => submissions.id, {
      onDelete: 'set null',
    }),
    storageKey: text('storage_key').notNull(), // Cloudinary public_id
    url: text('url').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('uploads_workspace_idx').on(table.workspaceId),
    index('uploads_submission_idx').on(table.submissionId),
  ],
)

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

// Global gallery (not workspace-scoped). `content` is a self-contained form
// definition instantiated into a real form + fields on "use template".
export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category').notNull(), // e.g. 'hiring', 'intake', 'survey'
    content: jsonb('content').$type<TemplateContent>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('templates_slug_idx').on(table.slug)],
)

// ---------------------------------------------------------------------------
// Relations (for the db.query relational API)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMembers),
}))

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [workspaces.createdById],
    references: [users.id],
  }),
  members: many(workspaceMembers),
  invitations: many(workspaceInvitations),
  connections: many(workspaceConnections),
  usage: many(workspaceUsage),
  forms: many(forms),
  submissions: many(submissions),
  uploads: many(uploads),
}))

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [workspaceMembers.userId],
    references: [users.id],
  }),
}))

export const workspaceInvitationsRelations = relations(
  workspaceInvitations,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceInvitations.workspaceId],
      references: [workspaces.id],
    }),
    invitedBy: one(users, {
      fields: [workspaceInvitations.invitedById],
      references: [users.id],
    }),
  }),
)

export const workspaceConnectionsRelations = relations(
  workspaceConnections,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceConnections.workspaceId],
      references: [workspaces.id],
    }),
  }),
)

export const workspaceUsageRelations = relations(workspaceUsage, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceUsage.workspaceId],
    references: [workspaces.id],
  }),
}))

export const formsRelations = relations(forms, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [forms.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [forms.createdById],
    references: [users.id],
  }),
  fields: many(formFields),
  translations: many(formTranslations),
  submissions: many(submissions),
  events: many(formEvents),
  integrations: many(formIntegrations),
}))

export const formFieldsRelations = relations(formFields, ({ one, many }) => ({
  form: one(forms, {
    fields: [formFields.formId],
    references: [forms.id],
  }),
  answers: many(answers),
}))

export const formTranslationsRelations = relations(formTranslations, ({ one }) => ({
  form: one(forms, {
    fields: [formTranslations.formId],
    references: [forms.id],
  }),
}))

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  form: one(forms, {
    fields: [submissions.formId],
    references: [forms.id],
  }),
  workspace: one(workspaces, {
    fields: [submissions.workspaceId],
    references: [workspaces.id],
  }),
  answers: many(answers),
  uploads: many(uploads),
}))

export const answersRelations = relations(answers, ({ one }) => ({
  submission: one(submissions, {
    fields: [answers.submissionId],
    references: [submissions.id],
  }),
  field: one(formFields, {
    fields: [answers.fieldId],
    references: [formFields.id],
  }),
}))

export const formEventsRelations = relations(formEvents, ({ one }) => ({
  form: one(forms, {
    fields: [formEvents.formId],
    references: [forms.id],
  }),
  submission: one(submissions, {
    fields: [formEvents.submissionId],
    references: [submissions.id],
  }),
}))

export const formIntegrationsRelations = relations(formIntegrations, ({ one }) => ({
  form: one(forms, {
    fields: [formIntegrations.formId],
    references: [forms.id],
  }),
  workspace: one(workspaces, {
    fields: [formIntegrations.workspaceId],
    references: [workspaces.id],
  }),
}))

export const uploadsRelations = relations(uploads, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [uploads.workspaceId],
    references: [workspaces.id],
  }),
  form: one(forms, {
    fields: [uploads.formId],
    references: [forms.id],
  }),
  submission: one(submissions, {
    fields: [uploads.submissionId],
    references: [submissions.id],
  }),
}))

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect
export type Workspace = typeof workspaces.$inferSelect
export type WorkspaceMember = typeof workspaceMembers.$inferSelect
export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect
export type WorkspaceConnection = typeof workspaceConnections.$inferSelect
export type WorkspaceUsage = typeof workspaceUsage.$inferSelect
export type Form = typeof forms.$inferSelect
export type FormField = typeof formFields.$inferSelect
export type FormTranslation = typeof formTranslations.$inferSelect
export type Submission = typeof submissions.$inferSelect
export type Answer = typeof answers.$inferSelect
export type FormEvent = typeof formEvents.$inferSelect
export type FormIntegration = typeof formIntegrations.$inferSelect
export type Upload = typeof uploads.$inferSelect
export type Template = typeof templates.$inferSelect

export type NewForm = typeof forms.$inferInsert
export type NewFormField = typeof formFields.$inferInsert
export type NewSubmission = typeof submissions.$inferInsert
export type NewAnswer = typeof answers.$inferInsert
