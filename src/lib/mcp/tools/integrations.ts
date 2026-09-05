import "server-only"

/**
 * Integration tools — where a form's responses go after they arrive.
 *
 * Three credentials live behind this surface, and each fails differently:
 *
 *   - a webhook signing secret lets anyone forge a delivery from us
 *   - a Discord webhook URL *is* the credential — holding it means posting
 *     into that channel as the integration
 *   - a Google/Notion token is the customer's whole account
 *
 * None of them appear in any output schema here. That is the defence, not a
 * convention: `defineTool` requires a closed Zod output schema with no
 * passthrough, so a field that later leaks one fails validation instead of
 * shipping to the model. The cores project at the query for the same reason.
 *
 * Two things a tool genuinely cannot finish are modelled honestly rather than
 * faked. `connect_provider` returns a consent URL for a human to open — OAuth
 * needs a browser and a person, and a tool that pretended otherwise would just
 * hang. `send_test_webhook` reports the endpoint's HTTP status, which is a
 * useful diagnostic and also, under a key a model drives, an SSRF probe; the
 * core's private-range denylist is what stops it pointing anywhere internal.
 */

import * as z from "zod"
import * as webhooksCore from "@/lib/core/webhooks"
import * as notificationsCore from "@/lib/core/notifications"
import * as integrationsCore from "@/lib/core/integrations"
import { defineTool, ToolError, type RegisteredMcpTool } from "@/lib/mcp/define-tool"

/** Core functions return a Result; a tool either succeeds or explains why not. */
function unwrap(result: { success: true } | { success: false; error: string }): void {
  if (!result.success) throw new ToolError(result.error)
}

const providerSchema = z.enum(["google", "notion"])

export const integrationTools: RegisteredMcpTool[] = [
  defineTool({
    name: "makingflow_list_integrations",
    title: "List integrations",
    description: [
      "Everything wired up to this workspace's forms: connected Google/Notion accounts, per-form Sheets and Notion syncs, webhooks, and email and Discord notifications.",
      "",
      "Secrets are never returned. Webhooks report `hasSecret` rather than the signing secret, and a Discord webhook URL is masked — the URL is itself the credential.",
      "Pass a formId to narrow the per-form sections to one form.",
    ].join("\n"),
    inputSchema: z.object({
      formId: z
        .string()
        .optional()
        .describe("Limit webhooks and notifications to this form. Omit for the whole workspace."),
    }),
    outputSchema: z.object({
      connections: z.array(
        z.object({
          provider: providerSchema,
          connected: z.boolean(),
          accountEmail: z.string().nullable(),
        }),
      ),
      syncs: z.array(
        z.object({
          formId: z.string(),
          type: z.enum(["google_sheets", "notion"]),
          enabled: z.boolean(),
          url: z.string().nullable(),
        }),
      ),
      webhooks: z.array(
        z.object({
          id: z.string(),
          formId: z.string(),
          url: z.string(),
          enabled: z.boolean(),
          hasSecret: z.boolean().describe("Whether deliveries are signed. The secret is never returned."),
        }),
      ),
      notifications: z.array(
        z.object({
          formId: z.string(),
          email: z.object({
            configured: z.boolean(),
            enabled: z.boolean(),
            recipients: z.array(z.string()),
            includeAnswers: z.boolean(),
          }),
          discord: z.object({
            configured: z.boolean(),
            enabled: z.boolean(),
            maskedUrl: z.string().nullable().describe("Recognisable, not usable."),
            includeAnswers: z.boolean(),
          }),
        }),
      ),
    }),
    scopes: ["forms:read"],
    readOnly: true,
    idempotent: true,
    async handler(ctx, args) {
      const [connections, syncs] = await Promise.all([
        integrationsCore.describeConnections(ctx),
        integrationsCore.describeFormSyncs(ctx),
      ])

      // Per-form sections need a form list. With no formId, derive it from the
      // syncs and let the caller narrow — enumerating every form's notification
      // config for a large workspace is a lot of round-trips for little value.
      const formIds = args.formId
        ? [args.formId]
        : [...new Set(syncs.map((s) => s.formId))]

      const perForm = await Promise.all(
        formIds.map(async (formId) => {
          const [webhooks, email, discord] = await Promise.all([
            webhooksCore.listWebhooks(ctx, formId),
            notificationsCore.getEmailNotification(ctx, formId),
            notificationsCore.getDiscordWebhook(ctx, formId),
          ])
          return { formId, webhooks, email, discord }
        }),
      )

      return {
        connections,
        syncs: args.formId ? syncs.filter((s) => s.formId === args.formId) : syncs,
        webhooks: perForm.flatMap((f) =>
          f.webhooks.map((w) => ({
            id: w.id,
            formId: f.formId,
            url: w.url,
            enabled: w.enabled,
            hasSecret: w.hasSecret,
          })),
        ),
        notifications: perForm.map((f) => ({
          formId: f.formId,
          email: f.email,
          discord: f.discord,
        })),
      }
    },
  }),

  defineTool({
    name: "makingflow_configure_integration",
    title: "Configure an integration",
    description: [
      "Turn a form's Google Sheets or Notion sync on or off, or set up its email and Discord notifications.",
      "",
      "Sheets and Notion need the provider connected first — use makingflow_connect_provider, which returns a link for the user to open. Enabling creates the spreadsheet or database; pausing stops syncing but leaves it in place.",
      "For Discord, pass the channel's webhook URL. Leave webhookUrl out to change only the other settings, since the stored URL is never returned to you.",
    ].join("\n"),
    inputSchema: z.object({
      formId: z.string(),
      target: z
        .enum(["google_sheets", "notion", "email", "discord"])
        .describe("Which integration to configure."),
      enabled: z.boolean().describe("Turn it on or off."),
      recipients: z
        .array(z.string())
        .optional()
        .describe("Email target only: who receives a notification per response."),
      webhookUrl: z
        .string()
        .optional()
        .describe("Discord target only: the channel webhook URL. Omit to keep the stored one."),
      includeAnswers: z
        .boolean()
        .optional()
        .describe("Email and Discord: include the response's answers in the notification."),
    }),
    outputSchema: z.object({
      formId: z.string(),
      target: z.enum(["google_sheets", "notion", "email", "discord"]),
      enabled: z.boolean(),
    }),
    scopes: ["integrations:write"],
    async handler(ctx, args) {
      switch (args.target) {
        case "google_sheets":
          unwrap(
            args.enabled
              ? await integrationsCore.enableFormSheet(ctx, args.formId)
              : await integrationsCore.pauseFormSheet(ctx, args.formId),
          )
          break

        case "notion":
          unwrap(
            args.enabled
              ? await integrationsCore.enableFormNotion(ctx, args.formId)
              : await integrationsCore.pauseFormNotion(ctx, args.formId),
          )
          break

        case "email": {
          if (!args.enabled) {
            unwrap(await notificationsCore.removeEmailNotification(ctx, args.formId))
            break
          }
          if (!args.recipients?.length) {
            throw new ToolError("Enabling email notifications needs at least one recipient.")
          }
          unwrap(
            await notificationsCore.saveEmailNotification(ctx, args.formId, {
              recipients: args.recipients,
              includeAnswers: args.includeAnswers ?? false,
              enabled: true,
            }),
          )
          break
        }

        case "discord": {
          if (!args.enabled && args.webhookUrl === undefined) {
            unwrap(await notificationsCore.removeDiscordWebhook(ctx, args.formId))
            break
          }
          // "" means "keep what is stored" — the core's own convention, and the
          // only way to toggle a URL the caller was never shown.
          unwrap(
            await notificationsCore.saveDiscordWebhook(ctx, args.formId, {
              webhookUrl: args.webhookUrl ?? "",
              includeAnswers: args.includeAnswers ?? false,
              enabled: args.enabled,
            }),
          )
          break
        }
      }

      return { formId: args.formId, target: args.target, enabled: args.enabled }
    },
  }),

  defineTool({
    name: "makingflow_manage_webhook",
    title: "Manage a webhook",
    description: [
      "Add, enable, disable, remove or test a webhook on a form. Each completed response is POSTed to the URL.",
      "",
      "A secret signs deliveries so the receiver can verify they came from us. It is stored write-only: no tool ever returns it, and listing reports only whether one is set.",
      "The URL must be a public https endpoint. Private, loopback and link-local addresses are refused — a webhook is a request made from our servers, so those would reach our own infrastructure rather than yours.",
      "`test` sends a sample payload immediately and reports the status the endpoint returned.",
    ].join("\n"),
    inputSchema: z.object({
      operation: z.enum(["add", "enable", "disable", "remove", "test"]),
      formId: z.string().optional().describe("Required for `add`."),
      webhookId: z.string().optional().describe("Required for everything except `add`."),
      url: z.string().optional().describe("Required for `add`. A public https endpoint."),
      secret: z
        .string()
        .optional()
        .describe("Optional signing secret for `add`. Stored, never returned."),
    }),
    outputSchema: z.object({
      operation: z.enum(["add", "enable", "disable", "remove", "test"]),
      webhooks: z
        .array(
          z.object({
            id: z.string(),
            url: z.string(),
            enabled: z.boolean(),
            hasSecret: z.boolean(),
          }),
        )
        .describe("The form's webhooks after the change. Empty for `remove` and `test`."),
      delivery: z
        .object({
          delivered: z.boolean(),
          status: z.number().int().nullable().describe("The HTTP status the endpoint returned."),
          error: z.string().nullable(),
        })
        .nullable()
        .describe("Only for `test`."),
    }),
    scopes: ["integrations:write"],
    async handler(ctx, args) {
      const empty = { webhooks: [], delivery: null }

      if (args.operation === "add") {
        if (!args.formId || !args.url) {
          throw new ToolError("Adding a webhook needs both formId and url.")
        }
        unwrap(await webhooksCore.addWebhook(ctx, args.formId, { url: args.url, secret: args.secret }))
        const webhooks = await webhooksCore.listWebhooks(ctx, args.formId)
        return { operation: args.operation, ...empty, webhooks }
      }

      if (!args.webhookId) {
        throw new ToolError(`\`${args.operation}\` needs a webhookId. List them first.`)
      }

      if (args.operation === "test") {
        const result = await webhooksCore.sendTestWebhook(ctx, args.webhookId)
        return {
          operation: args.operation,
          ...empty,
          delivery: {
            delivered: result.success,
            status: result.status ?? null,
            error: result.error ?? null,
          },
        }
      }

      if (args.operation === "remove") {
        unwrap(await webhooksCore.removeWebhook(ctx, args.webhookId))
        return { operation: args.operation, ...empty }
      }

      const enabled = args.operation === "enable"
      unwrap(await webhooksCore.toggleWebhook(ctx, args.webhookId, enabled))
      return { operation: args.operation, ...empty }
    },
  }),

  defineTool({
    name: "makingflow_connect_provider",
    title: "Connect or disconnect Google or Notion",
    description: [
      "Start connecting a Google or Notion account, or disconnect one.",
      "",
      "Connecting CANNOT be completed by a tool: OAuth needs the account holder in a browser. This returns a link for the user to open, and they must confirm before Sheets or Notion sync can be enabled. Show them the link; do not try to fetch it.",
      "Disconnecting takes effect immediately and pauses every form syncing through that provider.",
    ].join("\n"),
    inputSchema: z.object({
      provider: providerSchema,
      operation: z.enum(["connect", "disconnect"]),
    }),
    outputSchema: z.object({
      provider: providerSchema,
      operation: z.enum(["connect", "disconnect"]),
      connected: z.boolean().describe("State now. `connect` leaves this false until the user finishes."),
      authorizationUrl: z
        .string()
        .nullable()
        .describe("For `connect`: give this to the user to open in their browser."),
    }),
    scopes: ["integrations:write"],
    async handler(ctx, args) {
      if (args.operation === "disconnect") {
        unwrap(
          args.provider === "google"
            ? await integrationsCore.disconnectGoogle(ctx)
            : await integrationsCore.disconnectNotion(ctx),
        )
        return { ...args, connected: false, authorizationUrl: null }
      }

      const connections = await integrationsCore.describeConnections(ctx)
      const existing = connections.find((c) => c.provider === args.provider)
      if (existing?.connected) {
        // Already done — say so rather than sending the user through consent
        // again for no reason.
        return { ...args, connected: true, authorizationUrl: null }
      }

      return {
        ...args,
        connected: false,
        authorizationUrl: `${siteUrl()}/api/integrations/${args.provider}/connect`,
      }
    },
  }),
]

/** The public origin, for links a human is meant to open. */
function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000"
}
