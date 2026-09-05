import "server-only"

/**
 * Team and custom-domain tools — the owner-only surface.
 *
 * Two gates apply here and neither can override the other. `scopes: ["team:write"]`
 * constrains the KEY: a credential minted without that scope cannot touch
 * membership at all. `action: "manage_team"` constrains the PERSON, through the
 * same OWNER_ONLY table the browser consults, read live from `workspace_members`
 * on every request. A member's key holding every scope in the system still
 * cannot invite anyone, and a key minted by an owner who has since been demoted
 * loses owner powers the moment they do.
 *
 * THE INVITE LINK IS DELIBERATELY ABSENT from every output schema in this file.
 * `/invite/<token>` grants workspace membership to whoever opens it — the token
 * *is* the authorization. That is fine in a browser, where the link goes to the
 * person who typed the email address. Handed to a language model it may end up
 * quoted into a summary, a commit message or a shared chat log, and anyone who
 * reads it joins the workspace. `core/team` returns it because the web app
 * genuinely needs it; redacting at this boundary is what keeps it out of a model
 * context, and the closed output schema is what makes that structural rather
 * than something every future edit has to remember.
 *
 * Member emails ARE returned. They are PII, but they are the only way to name a
 * person in the follow-up call, and the workspace's owner already sees them.
 */

import * as z from "zod"
import * as teamCore from "@/lib/core/team"
import * as domainsCore from "@/lib/core/domains"
import { getTeam } from "@/lib/data/team"
import { getWorkspaceDomains } from "@/lib/data/domains"
import { defineTool, ToolError, type RegisteredMcpTool } from "@/lib/mcp/define-tool"

function unwrap(result: { success: true } | { success: false; error: string }): void {
  if (!result.success) throw new ToolError(result.error)
}

const roleSchema = z.enum(["owner", "member"])

export const workspaceTools: RegisteredMcpTool[] = [
  defineTool({
    name: "makingflow_list_team",
    title: "List members and invitations",
    description: [
      "Everyone in this workspace and every invitation still outstanding.",
      "",
      "Invite links are never returned. The link is a bearer credential — anyone who opens it joins the workspace — so it goes only to the invited address by email.",
      "Member email addresses are personal data. Use them to identify who you are acting on, not for anything else.",
    ].join("\n"),
    inputSchema: z.object({}),
    outputSchema: z.object({
      members: z.array(
        z.object({
          userId: z.string(),
          email: z.string(),
          name: z.string().nullable(),
          role: roleSchema,
          joinedAt: z.string().nullable(),
        }),
      ),
      invitations: z.array(
        z.object({
          id: z.string(),
          email: z.string(),
          role: roleSchema,
          invitedAt: z.string().nullable(),
          expiresAt: z.string().nullable(),
        }),
      ),
      ownerCount: z.number().int().describe("A workspace must always keep at least one owner."),
    }),
    scopes: ["team:write"],
    action: "manage_team",
    readOnly: true,
    idempotent: true,
    async handler(ctx) {
      // getTeam takes the workspace explicitly and does no session lookup of
      // its own, so it is already safe for a bearer caller. The tenancy check
      // happened when the context was built.
      const team = await getTeam(ctx.workspaceId)

      return {
        members: team.members.map((m) => ({
          userId: m.userId,
          email: m.email,
          name: m.name,
          role: m.role === "owner" ? ("owner" as const) : ("member" as const),
          joinedAt: m.joinedAt.toISOString(),
        })),
        invitations: team.invitations.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role === "owner" ? ("owner" as const) : ("member" as const),
          invitedAt: i.invitedAt.toISOString(),
          expiresAt: i.expiresAt.toISOString(),
        })),
        ownerCount: team.members.filter((m) => m.role === "owner").length,
      }
    },
  }),

  defineTool({
    name: "makingflow_manage_team",
    title: "Invite, remove or change a member's role",
    description: [
      "Invite someone to the workspace, revoke or resend an invitation, remove a member, or change a member's role. Owners only.",
      "",
      "Inviting emails the person a join link. The link is NOT returned to you: it grants membership to whoever opens it, so it goes to the invited address and nowhere else. Inviting the same address twice re-sends the existing invitation rather than creating a second one.",
      "A workspace must always keep at least one owner, so the last owner cannot be removed or demoted. You cannot remove yourself.",
      "Removal takes effect immediately: the person loses access to every form and response in this workspace.",
    ].join("\n"),
    inputSchema: z.object({
      operation: z.enum(["invite", "revoke_invitation", "resend_invitation", "remove", "change_role"]),
      email: z.string().optional().describe("Required for `invite`."),
      userId: z.string().optional().describe("Required for `remove` and `change_role`."),
      invitationId: z
        .string()
        .optional()
        .describe("Required for `revoke_invitation` and `resend_invitation`."),
      role: roleSchema
        .optional()
        .describe("The role to invite at or change to. Defaults to `member` for `invite`."),
    }),
    outputSchema: z.object({
      operation: z.enum(["invite", "revoke_invitation", "resend_invitation", "remove", "change_role"]),
      emailed: z
        .boolean()
        .describe(
          "Whether the invitation email went out. If false, email is not configured on this deployment and an owner must send the link from the web app.",
        ),
      message: z.string().describe("What happened, in words you can relay to the user."),
    }),
    scopes: ["team:write"],
    action: "manage_team",
    async handler(ctx, args) {
      switch (args.operation) {
        case "invite": {
          if (!args.email) throw new ToolError("Inviting someone needs their email address.")
          const result = await teamCore.inviteMember(ctx, args.email, args.role ?? "member")
          if (!result.success) throw new ToolError(result.error)
          // result.inviteLink is deliberately dropped here — see the file header.
          return {
            operation: args.operation,
            emailed: result.emailed,
            message: result.emailed
              ? `Invited ${args.email} as ${args.role ?? "member"}. They've been emailed a join link.`
              : `Invitation created for ${args.email}, but email isn't configured on this deployment — an owner needs to send the link from the workspace settings page.`,
          }
        }

        case "resend_invitation": {
          if (!args.invitationId) throw new ToolError("Resending needs the invitationId.")
          const result = await teamCore.resendInvitation(ctx, args.invitationId)
          if (!result.success) throw new ToolError(result.error)
          return {
            operation: args.operation,
            emailed: result.emailed,
            message: result.emailed
              ? "Invitation re-sent."
              : "Email isn't configured on this deployment, so nothing was sent.",
          }
        }

        case "revoke_invitation": {
          if (!args.invitationId) throw new ToolError("Revoking needs the invitationId.")
          unwrap(await teamCore.revokeInvitation(ctx, args.invitationId))
          return { operation: args.operation, emailed: false, message: "Invitation revoked." }
        }

        case "remove": {
          if (!args.userId) throw new ToolError("Removing someone needs their userId.")
          unwrap(await teamCore.removeMember(ctx, args.userId))
          return {
            operation: args.operation,
            emailed: false,
            message: "Removed from the workspace. They no longer have access to any of its forms.",
          }
        }

        case "change_role": {
          if (!args.userId) throw new ToolError("Changing a role needs the userId.")
          if (!args.role) throw new ToolError("Changing a role needs the new role.")
          unwrap(await teamCore.changeMemberRole(ctx, args.userId, args.role))
          return { operation: args.operation, emailed: false, message: `Role changed to ${args.role}.` }
        }
      }
    },
  }),

  defineTool({
    name: "makingflow_manage_domain",
    title: "Manage custom domains",
    description: [
      "List the workspace's custom domains, add one, re-check a pending one, remove one, or put a form on a domain at a chosen path.",
      "",
      "Adding CANNOT be finished by a tool. The domain stays `pending` until the user creates the DNS records this returns, at their registrar. Show them the records, then call `check` to see whether they have propagated — that can take anything from minutes to a day.",
      "Only subdomains are supported (forms.yourbrand.com, not yourbrand.com). A domain can belong to one workspace only.",
      "`attach` needs an ACTIVE domain. Two forms cannot share a path on the same domain. Pass customDomainId: null to put a form back on its default link.",
    ].join("\n"),
    inputSchema: z.object({
      operation: z.enum(["list", "add", "check", "remove", "attach"]),
      domain: z.string().optional().describe("Required for `add`, e.g. forms.yourbrand.com."),
      customDomainId: z
        .string()
        .nullable()
        .optional()
        .describe("Required for `check` and `remove`. For `attach`, null clears the form's domain."),
      formId: z.string().optional().describe("Required for `attach`."),
      path: z
        .string()
        .optional()
        .describe("For `attach`: the path on the domain, e.g. `feedback`. Slugified."),
    }),
    outputSchema: z.object({
      operation: z.enum(["list", "add", "check", "remove", "attach"]),
      configured: z
        .boolean()
        .describe("False when this deployment has no domain host set up — nothing can be added."),
      cnameTarget: z.string().describe("What a CNAME for the domain should point at."),
      domains: z.array(
        z.object({
          id: z.string(),
          domain: z.string(),
          status: z.string().describe("`pending` until DNS verifies, then `active`."),
          formsCount: z.number().int(),
          dnsRecords: z
            .array(
              z.object({
                type: z.string(),
                name: z.string(),
                value: z.string(),
                reason: z.string(),
              }),
            )
            .describe("What the user must create at their registrar. Empty once active."),
        }),
      ),
      attached: z
        .object({
          formId: z.string(),
          url: z.string().nullable().describe("The form's public address, or null if cleared."),
        })
        .nullable(),
    }),
    scopes: ["forms:write"],
    async handler(ctx, args) {
      // The domain list is the useful answer to almost every operation here —
      // after adding, it carries the DNS records; after checking, the new
      // status — so it is read once at the end rather than per branch.
      let attached: { formId: string; url: string | null } | null = null

      switch (args.operation) {
        case "list":
          break

        case "add": {
          if (!args.domain) throw new ToolError("Adding a domain needs the domain name.")
          unwrap(await domainsCore.addCustomDomain(ctx, args.domain))
          break
        }

        case "check": {
          if (!args.customDomainId) throw new ToolError("Checking needs the customDomainId.")
          unwrap(await domainsCore.checkCustomDomain(ctx, args.customDomainId))
          break
        }

        case "remove": {
          if (!args.customDomainId) throw new ToolError("Removing needs the customDomainId.")
          unwrap(await domainsCore.removeCustomDomain(ctx, args.customDomainId))
          break
        }

        case "attach": {
          if (!args.formId) throw new ToolError("Attaching needs the formId.")
          const result = await domainsCore.setFormDomain(ctx, args.formId, {
            customDomainId: args.customDomainId ?? null,
            slug: args.path ?? null,
          })
          if (!result.success) throw new ToolError(result.error)
          attached = {
            formId: args.formId,
            url: result.domain && result.slug ? `https://${result.domain}/${result.slug}` : null,
          }
          break
        }
      }

      const data = await getWorkspaceDomains(ctx.workspaceId)
      return {
        operation: args.operation,
        configured: data?.configured ?? false,
        cnameTarget: data?.cnameTarget ?? "",
        domains: (data?.domains ?? []).map((d) => ({
          id: d.id,
          domain: d.domain,
          status: d.status,
          formsCount: d.formsCount,
          dnsRecords: (d.verification ?? []).map((v) => ({
            type: v.type,
            name: v.domain,
            value: v.value,
            reason: v.reason,
          })),
        })),
        attached,
      }
    },
  }),
]
