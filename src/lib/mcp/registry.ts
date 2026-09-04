import "server-only"

/**
 * The MCP tool registry — the ONLY path from the transport to a handler.
 *
 * `src/app/api/mcp/route.ts` looks a tool up here and calls `run()`. There is
 * no other way in, which is what makes the scope and confirm gates in
 * `defineTool` unskippable rather than merely conventional.
 *
 * Order is stable and grouped by domain. `tools/list` SHOULD be deterministically
 * ordered — clients cache the list, and a list that reshuffles between calls
 * invalidates the model's prompt prefix cache for no reason.
 */

import type { Budget } from "@/lib/mcp/rate-limit"
import type { RegisteredMcpTool } from "@/lib/mcp/define-tool"
import { formTools } from "@/lib/mcp/tools/forms"
import { submissionTools } from "@/lib/mcp/tools/submissions"
import { analyticsTools } from "@/lib/mcp/tools/analytics"

export const TOOLS: readonly RegisteredMcpTool[] = [
  ...formTools,
  ...submissionTools,
  ...analyticsTools,
]

export const TOOLS_BY_NAME: ReadonlyMap<string, RegisteredMcpTool> = new Map(
  TOOLS.map((tool) => [tool.name, tool]),
)

/**
 * Tools that spend AI budget, and so draw on the tight bucket rather than the
 * ordinary write one. Everything here must also call `incrementAiCalls`.
 */
const AI_TOOLS = new Set<string>(["makingflow_analyze_submission"])

/** Reads are cheap, writes touch the database, AI costs real money. */
export function budgetFor(tool: RegisteredMcpTool): Budget {
  if (AI_TOOLS.has(tool.name)) return "ai"
  return tool.readOnly ? "read" : "write"
}
