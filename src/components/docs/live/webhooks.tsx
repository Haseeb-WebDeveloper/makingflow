import { CodeBlock } from "@/components/docs/mdx/code-block"
import {
  DocRow,
  DocTable,
  DocTableBody,
  DocTableHead,
  Td,
  Th,
} from "@/components/docs/mdx/doc-table"
import {
  NODE_RECEIVER,
  PAYLOAD_SAMPLE,
  PYTHON_RECEIVER,
} from "@/content/docs/_samples/webhook-receivers"
import { humanDelay } from "@/lib/docs/values"
import { BACKOFF_SECONDS, MAX_ATTEMPTS } from "@/lib/integrations/webhook-policy"
import {
  DELIVERY_ID_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  SUBMISSION_CREATED_EVENT,
  USER_AGENT,
} from "@/lib/integrations/webhook-signature"

/**
 * The parts of the webhook documentation that must never be typed by hand.
 *
 * Everything here reads the module that owns the fact. That is not tidiness —
 * the page is read by developers at other companies who cannot see our code and
 * have no way to check what it claims, so a stale number here becomes a
 * receiver that fails in production and looks like our bug from their side.
 *
 * Synchronous server components, so they prerender into static HTML and stay
 * renderable by `renderToStaticMarkup` in the tests that hold them to the
 * policy.
 */

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"]

/**
 * Built from the real schedule.
 *
 * The ordinal list is longer than the current ladder needs on purpose: it used
 * to have exactly enough entries, which meant adding a sixth backoff rung would
 * have rendered `undefined` in the table and given two rows the same React key.
 */
export function WebhookRetryTable() {
  const rows = [
    { attempt: ORDINALS[0], when: "Immediately, as the response is stored" },
    ...BACKOFF_SECONDS.map((seconds, i) => ({
      attempt: ORDINALS[i + 1] ?? `${i + 2}th`,
      when: `~${humanDelay(seconds)} later${
        i === BACKOFF_SECONDS.length - 1 ? " — the last one" : ""
      }`,
    })),
  ]

  return (
    <DocTable>
      <DocTableHead>
        <Th>Attempt</Th>
        <Th>When</Th>
      </DocTableHead>
      <DocTableBody>
        {rows.map((row) => (
          <DocRow key={row.attempt}>
            <Td nowrap emphasis>
              {row.attempt}
            </Td>
            <Td>{row.when}</Td>
          </DocRow>
        ))}
      </DocTableBody>
    </DocTable>
  )
}

/** Sanity: the table must have one row per attempt the sender actually makes. */
export const RETRY_ROW_COUNT = MAX_ATTEMPTS

/**
 * The headers we send, named from the constants the sender uses.
 *
 * All five used to be retyped here as string literals while the sender read
 * them from `webhook-signature.ts` — so renaming one in code would have left
 * this page telling readers to look for a header that never arrives.
 */
export function WebhookHeadersTable() {
  const headers = [
    {
      name: SIGNATURE_HEADER,
      value: "t=1757246400,v1=5257a8...",
      note: "HMAC-SHA256 proving the delivery came from us. Only sent when the endpoint has a signing secret.",
    },
    {
      name: DELIVERY_ID_HEADER,
      value: "550e8400-e29b-41d4-a716-446655440000",
      note: "Stable across every retry of this delivery. Deduplicate on it.",
    },
    { name: EVENT_HEADER, value: SUBMISSION_CREATED_EVENT, note: "What happened." },
    { name: "Content-Type", value: "application/json", note: "" },
    { name: "User-Agent", value: USER_AGENT, note: "" },
  ]

  return (
    <DocTable>
      <DocTableHead>
        <Th>Header</Th>
        <Th>Example</Th>
        <Th>Notes</Th>
      </DocTableHead>
      <DocTableBody>
        {headers.map((header) => (
          <DocRow key={header.name}>
            <Td mono nowrap emphasis>
              {header.name}
            </Td>
            <Td mono nowrap>
              {header.value}
            </Td>
            <Td>{header.note}</Td>
          </DocRow>
        ))}
      </DocTableBody>
    </DocTable>
  )
}

export function WebhookPayloadSample() {
  return <CodeBlock source={PAYLOAD_SAMPLE} lang="json" filename="POST body" />
}

/** The two copyable receivers. `runtime` picks which. */
export function WebhookReceiver({ runtime }: { runtime: "node" | "python" }) {
  return runtime === "node" ? (
    <CodeBlock source={NODE_RECEIVER} lang="typescript" filename="Node — Express" />
  ) : (
    <CodeBlock source={PYTHON_RECEIVER} lang="python" filename="Python — Flask" />
  )
}
