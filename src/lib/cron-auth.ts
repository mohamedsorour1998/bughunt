import { Receiver } from "@upstash/qstash"
import type { NextRequest } from "next/server"

let receiver: Receiver | null = null

function getReceiver(): Receiver | null {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY
  if (!currentSigningKey || !nextSigningKey) return null
  receiver ??= new Receiver({ currentSigningKey, nextSigningKey })
  return receiver
}

/**
 * Authorizes a cron route invocation. Accepts either:
 * - a QStash-signed request (Upstash-Signature header, verified against the body)
 * - a manual trigger with `Authorization: Bearer <CRON_SECRET>` (ops/local use)
 */
export async function verifyCronRequest(req: NextRequest, body: string): Promise<boolean> {
  const bearer = req.headers.get("authorization")?.replace("Bearer ", "")
  if (bearer && process.env.CRON_SECRET && bearer === process.env.CRON_SECRET) {
    return true
  }

  const signature = req.headers.get("upstash-signature")
  const r = getReceiver()
  if (signature && r) {
    try {
      return await r.verify({ signature, body })
    } catch {
      return false
    }
  }

  return false
}
