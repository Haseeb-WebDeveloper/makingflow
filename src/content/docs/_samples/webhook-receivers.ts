/**
 * The copyable webhook receivers.
 *
 * THESE CANNOT BE FENCED CODE BLOCKS, and that is the reason this file exists.
 * MDX treats a fence as literal text, so `${TIMESTAMP_TOLERANCE_SECONDS}`
 * written inside one publishes those fourteen characters to the internet
 * instead of the number. As template literals in a .ts module they interpolate
 * exactly as they did on the old page, and `<CodeBlock source={…} />` renders
 * them.
 *
 * That matters more here than anywhere else in the docs: a reader pastes these
 * into their own server. A sample that checks a different replay window than
 * the one we enforce teaches everyone who copies it to write a receiver that
 * rejects live deliveries — and they have no way to discover why.
 *
 * Underscore-prefixed directory so Next never treats it as content.
 */

import { TIMEOUT_MS, TIMESTAMP_TOLERANCE_SECONDS } from "@/lib/integrations/webhook-policy"
import {
  DELIVERY_ID_HEADER,
  SIGNATURE_HEADER,
  SUBMISSION_CREATED_EVENT,
} from "@/lib/integrations/webhook-signature"

export const PAYLOAD_SAMPLE = `{
  "event": "${SUBMISSION_CREATED_EVENT}",
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

export const NODE_RECEIVER = `import crypto from "node:crypto"

// Express: capture the RAW body. Re-serialising the parsed object reorders
// keys and the signature will not match.
app.post("/webhooks/makingflow",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const raw = req.body.toString("utf8")
    const header = req.get("${SIGNATURE_HEADER}") ?? ""

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

    const deliveryId = req.get("${DELIVERY_ID_HEADER}")
    if (alreadyHandled(deliveryId)) return       // retries are normal
    handle(JSON.parse(raw))
  })`

export const PYTHON_RECEIVER = `import hmac, hashlib, time
from flask import request, abort

@app.post("/webhooks/makingflow")
def makingflow():
    raw = request.get_data()                       # bytes, not request.json
    header = request.headers.get("${SIGNATURE_HEADER}", "")
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

    if already_handled(request.headers["${DELIVERY_ID_HEADER}"]):
        return "", 200                             # retries are normal
    handle(request.get_json())
    return "", 200`
