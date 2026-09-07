import type { Metadata } from "next"
import {
  BACKOFF_SECONDS,
  JITTER_RATIO,
  MAX_ATTEMPTS,
  RETENTION_DAYS,
  TIMEOUT_MS,
  TIMESTAMP_TOLERANCE_SECONDS,
} from "@/lib/integrations/webhook-policy"

/**
 * Public reference for building a webhook receiver.
 *
 * WRITTEN FOR SOMEONE WHO DOES NOT HAVE A MAKINGFLOW ACCOUNT. The person who
 * adds a webhook has an easy job — paste a URL, hit Send test. The hard part is
 * in the receiving code, and that is usually written by a different person,
 * sometimes at a different company. So this is public and unauthenticated: it
 * is a link a form owner can send to their developer.
 *
 * Every number and string here is load-bearing and must match the
 * implementation. The signing string in particular (`${t}.${body}`, not the
 * body) is impossible to guess — get it wrong in this document and every
 * integration built from it fails verification with no useful error. Cross-check
 * against src/lib/integrations/webhook-signature.ts and webhook-delivery.ts
 * before editing.
 */

export const metadata: Metadata = {
  title: "Webhooks · MakingFlow",
  description:
    "Receive every MakingFlow form submission as a signed JSON POST. Payload, signature verification, retries and delivery guarantees.",
}

/** "30 seconds", "2 minutes", "6 hours" — for a reader, not a machine. */
function humanDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`
  if (seconds < 3600) {
    const minutes = seconds / 60
    return `${minutes} minute${minutes === 1 ? "" : "s"}`
  }
  const hours = seconds / 3600
  return `${hours} hour${hours === 1 ? "" : "s"}`
}

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"]

/**
 * Derived from the real schedule, never retyped.
 *
 * A hand-copied table drifts the first time someone tunes the backoff, and the
 * result is public documentation confidently describing behaviour the server
 * no longer has — which is worse than no table, because people build alerting
 * on it.
 */
const RETRIES = [
  { attempt: ORDINALS[0], when: "Immediately, as the response is stored" },
  ...BACKOFF_SECONDS.map((seconds, i) => ({
    attempt: ORDINALS[i + 1],
    when: `~${humanDelay(seconds)} later${i === BACKOFF_SECONDS.length - 1 ? " — the last one" : ""}`,
  })),
]

const HEADERS = [
  {
    name: "X-MakingFlow-Signature-V2",
    value: "t=1757246400,v1=5257a8...",
    note: "HMAC-SHA256 proving the delivery came from us. Only sent when the endpoint has a signing secret.",
  },
  {
    name: "X-MakingFlow-Delivery-Id",
    value: "550e8400-e29b-41d4-a716-446655440000",
    note: "Stable across every retry of this delivery. Deduplicate on it.",
  },
  { name: "X-MakingFlow-Event", value: "submission.created", note: "What happened." },
  { name: "Content-Type", value: "application/json", note: "" },
  { name: "User-Agent", value: "MakingFlow-Webhook/1.0", note: "" },
]

const PAYLOAD = `{
  "event": "submission.created",
  "form": {
    "id": "b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6a7b",
    "title": "Job Application",
    "publicId": "k7hqz2"
  },
  "submission": {
    "id": "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d",
    "submittedAt": "2026-09-07T14:22:31.004Z"
  },
  "answers": [
    { "fieldId": "0f1e2d3c-...", "question": "Full name",  "value": "Ada Lovelace" },
    { "fieldId": "4b5a6978-...", "question": "Years of experience", "value": 12 },
    { "fieldId": "8c9d0e1f-...", "question": "Languages",  "value": ["Go", "Rust"] },
    { "fieldId": "2a3b4c5d-...", "question": "Available?", "value": true }
  ]
}`

const NODE = `import crypto from "node:crypto"

// Express: capture the RAW body. Re-serialising the parsed object reorders
// keys and the signature will not match.
app.post("/webhooks/makingflow",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const raw = req.body.toString("utf8")
    const header = req.get("X-MakingFlow-Signature-V2") ?? ""

    const parts = Object.fromEntries(
      header.split(",").map((p) => p.split("=", 2)),
    )
    const timestamp = Number(parts.t)
    const signature = parts.v1

    // Reject replays. Without this check the timestamp is decoration.
    if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > ${TIMESTAMP_TOLERANCE_SECONDS}) {
      return res.status(400).send("stale")
    }

    const expected = crypto
      .createHmac("sha256", process.env.MAKINGFLOW_WEBHOOK_SECRET)
      .update(\`\${timestamp}.\${raw}\`)
      .digest("hex")

    // timingSafeEqual throws on a length mismatch, so check length first.
    const a = Buffer.from(signature ?? "", "utf8")
    const b = Buffer.from(expected, "utf8")
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).send("bad signature")
    }

    // Answer for the delivery FIRST, then do the slow part. We give up after
    // ${TIMEOUT_MS / 1000} seconds and retry, which for you means processing it twice.
    res.sendStatus(200)

    const deliveryId = req.get("X-MakingFlow-Delivery-Id")
    if (alreadyHandled(deliveryId)) return       // retries are normal
    handle(JSON.parse(raw))
  })`

const PYTHON = `import hmac, hashlib, time
from flask import request, abort

@app.post("/webhooks/makingflow")
def makingflow():
    raw = request.get_data()                       # bytes, not request.json
    header = request.headers.get("X-MakingFlow-Signature-V2", "")
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)

    timestamp, signature = parts.get("t"), parts.get("v1")
    if not timestamp or abs(time.time() - int(timestamp)) > ${TIMESTAMP_TOLERANCE_SECONDS}:
        abort(400)                                 # replay window

    expected = hmac.new(
        SECRET.encode(),
        f"{timestamp}.".encode() + raw,
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected, signature or ""):
        abort(401)

    if already_handled(request.headers["X-MakingFlow-Delivery-Id"]):
        return "", 200                             # retries are normal
    handle(request.get_json())
    return "", 200`

function Section({
  title,
  id,
  children,
}: {
  title: string
  id?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-8">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

function Code({ children }: { children: string }) {
  return (
    <pre className="thin-scroll overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  )
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border-l-2 border-foreground/40 bg-muted/50 py-2.5 pl-3.5 pr-3 text-sm text-foreground">
      {children}
    </p>
  )
}

export default function WebhookDocsPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-2xl font-semibold text-foreground">MakingFlow webhooks</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Every time someone completes one of your forms, MakingFlow POSTs the response to a URL you
        choose, as JSON. This page is everything you need to build the endpoint that receives it.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Webhooks are configured <strong className="text-foreground">per form</strong>, in
        MakingFlow under <strong className="text-foreground">the form → Integrations → Webhooks</strong>.
        A form can have several endpoints, and each one gets its own copy of every response.
      </p>

      <Section title="The short version">
        <ul className="ml-4 list-disc space-y-1.5 marker:text-border">
          <li>We POST JSON. Reply <strong className="text-foreground">2xx</strong> within {TIMEOUT_MS / 1000} seconds.</li>
          <li>
            If you set a secret, verify the signature over{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">timestamp.body</code> —
            not the body alone.
          </li>
          <li>
            Delivery is <strong className="text-foreground">at least once</strong>. Deduplicate on{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">X-MakingFlow-Delivery-Id</code>.
          </li>
          <li>Failures retry for about 8 hours, then stop.</li>
        </ul>
      </Section>

      <Section title="What we send" id="payload">
        <p>
          One POST per completed response, per endpoint. Only completed responses — a partially
          filled form that is never submitted does not fire.
        </p>
        <Code>{PAYLOAD}</Code>
        <p>
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">value</code> takes the
          shape of the field that produced it: a string, a number, a boolean, an array of strings
          for multi-select, or an object for structured fields like file uploads. Write your
          handler to tolerate all of them.
        </p>
        <p>
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">question</code> is the
          field&rsquo;s label at the time of submission, included so a delivery reads on its own.
          It changes if the form is edited, so key your logic on{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">fieldId</code>, which
          does not.
        </p>
        <Callout>
          Answers are written by whoever filled in your form. Treat every value as untrusted input:
          escape it before rendering, never pass it to a shell or a query without parameterising.
        </Callout>
      </Section>

      <Section title="Headers">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <tbody>
              {HEADERS.map((h) => (
                <tr key={h.name} className="border-b border-border/60 align-top">
                  <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap text-foreground">
                    {h.name}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{h.value}</td>
                  <td className="py-2">{h.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Verifying the signature" id="verify">
        <p>
          Optional but strongly recommended. Without it, anyone who learns your endpoint URL can
          post fake responses to it. Add a secret when you create the webhook, and we sign every
          delivery with it.
        </p>
        <Callout>
          The signature covers{" "}
          <code className="rounded bg-background px-1 py-0.5 font-mono text-xs">
            {"`${timestamp}.${body}`"}
          </code>{" "}
          — the timestamp from the header, a full stop, then the raw body. Signing the body alone
          is the single most common mistake, and it fails every time with no clue why.
        </Callout>
        <p>Two more things that will cost you an afternoon if missed:</p>
        <ul className="ml-4 list-disc space-y-1.5 marker:text-border">
          <li>
            <strong className="text-foreground">Use the raw request body.</strong> Parsing the JSON
            and re-serialising it reorders keys and changes whitespace, so the HMAC will not match
            even though the data is identical.
          </li>
          <li>
            <strong className="text-foreground">Check the timestamp.</strong> Reject anything more
            than {TIMESTAMP_TOLERANCE_SECONDS / 60} minutes old. Skip this and a captured delivery can be replayed at you forever,
            which is the entire reason the timestamp is in there.
          </li>
        </ul>
        <p className="pt-1 font-medium text-foreground">Node</p>
        <Code>{NODE}</Code>
        <p className="pt-1 font-medium text-foreground">Python</p>
        <Code>{PYTHON}</Code>
      </Section>

      <Section title="Retries, and why you may see a delivery twice" id="retries">
        <p>
          Anything that is not a 2xx is retried. A 3xx counts as a failure — we do not follow
          redirects, so point the webhook at its final URL.
        </p>
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <tbody>
              {RETRIES.map((r) => (
                <tr key={r.attempt} className="border-b border-border/60">
                  <td className="py-2 pr-4 whitespace-nowrap text-foreground">{r.attempt}</td>
                  <td className="py-2">{r.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Intervals are jittered by up to {JITTER_RATIO * 100}% so that a receiver coming back up is not hit by every
          queued delivery in the same instant. After attempt {MAX_ATTEMPTS} we stop and mark the
          delivery failed; the form owner can still resend it by hand.
        </p>
        <Callout>
          Delivery is <strong>at least once</strong>, not exactly once. If you accept a delivery but
          your response is slow enough for us to time out, we will retry one you already processed.
          Keep a record of handled <code className="font-mono text-xs">X-MakingFlow-Delivery-Id</code>{" "}
          values and ignore repeats — the id is stable across retries, and across a manual resend.
        </Callout>
        <p>
          <strong className="text-foreground">Order is not guaranteed.</strong> A delivery that
          needed three attempts arrives after one that succeeded first time, even if it was
          submitted earlier. Sort by{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">submission.submittedAt</code>{" "}
          rather than arrival order.
        </p>
      </Section>

      <Section title="Responding">
        <p>
          Reply <strong className="text-foreground">2xx</strong> as soon as you have the delivery
          safely stored, then do the real work. We wait{" "}
          <strong className="text-foreground">{TIMEOUT_MS / 1000} seconds</strong> and treat anything slower as a
          failure — so an endpoint that finishes the job before replying gets retried, and processes
          everything twice.
        </p>
        <p>
          Your response body is kept and shown to the form owner, truncated, so a short error
          message here is the fastest way to tell them what went wrong.
        </p>
      </Section>

      <Section title="Testing your endpoint">
        <p>
          <strong className="text-foreground">Send test</strong> in the webhook settings posts a
          sample payload immediately and shows the status you returned. The test body carries an
          extra{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">&quot;test&quot;: true</code>{" "}
          field and is signed exactly like a real delivery, so it exercises your verification code
          properly. It is not recorded as a delivery and is never retried.
        </p>
        <p>
          While developing, a request-inspector service such as webhook.site gives you a public URL
          you can point at and watch. Note the next section before reaching for a tunnel to your
          laptop.
        </p>
      </Section>

      <Section title="Which URLs we can reach">
        <p>
          The request comes from our servers, not from the browser of the person filling in your
          form. So the URL has to be reachable from the public internet: a{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">localhost</code> address
          points at our machine, not yours, and private and link-local ranges are refused outright.
        </p>
        <p>
          For local development, use a tunnel that gives you a public hostname. And plan without a
          firewall allowlist: we run on serverless infrastructure with no fixed egress addresses, so
          there is no stable set of IPs to permit.
        </p>
      </Section>

      <Section title="What we don&rsquo;t do yet">
        <p>Stated plainly so you can design around it rather than discover it:</p>
        <ul className="ml-4 list-disc space-y-1.5 marker:text-border">
          <li>
            <strong className="text-foreground">One event.</strong>{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">submission.created</code>{" "}
            is all we send. Publishing a form, editing one, or deleting a response fire nothing.
          </li>
          <li>
            <strong className="text-foreground">Per form, not per workspace.</strong> A form created
            later starts with no webhooks — it does not inherit them.
          </li>
          <li>
            <strong className="text-foreground">No delivery API.</strong> Delivery history is
            visible in the app; there is no endpoint to poll for it.
          </li>
          <li>
            Delivery records, including the body we sent, are kept for{" "}
            <strong className="text-foreground">{RETENTION_DAYS} days</strong>. Deleting a response deletes its
            delivery records with it, so a resend is no longer possible.
          </li>
        </ul>
      </Section>

      <Section title="A note on the older signature">
        <p>
          Deliveries currently carry a second header,{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">X-MakingFlow-Signature</code>
          , in the format{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">sha256=&lt;hex&gt;</code>,
          signing the body alone. It exists only so integrations built before the timestamped format
          keep working, and it will be removed.
        </p>
        <p>
          Do not build against it. It cannot express a replay window, so a delivery captured once
          can be replayed at your endpoint indefinitely. If you are verifying it today, move to{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">X-MakingFlow-Signature-V2</code>
          , which is already being sent alongside.
        </p>
      </Section>
    </main>
  )
}
