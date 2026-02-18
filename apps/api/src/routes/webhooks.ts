import { Hono } from 'hono'
import type { Env } from '../types'
import { Unauthorized } from '../lib/errors'

export const webhookRoutes = new Hono<{ Bindings: Env }>()

// POST /api/webhooks/verification-complete
// Internal webhook — verification results are processed directly in the queue consumer
// This endpoint exists for external integrations or manual retriggers
webhookRoutes.post('/verification-complete', async (c) => {
  // Verify HMAC signature
  const signature = c.req.header('x-webhook-signature')
  if (!signature) throw new Unauthorized('Missing webhook signature')

  const body = await c.req.text()
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(c.env.WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  if (signature !== expected) {
    throw new Unauthorized('Invalid webhook signature')
  }

  // Re-enqueue verification for the given proof
  const payload = JSON.parse(body) as { proofId: string }
  await c.env.VERIFICATION_QUEUE.send({ proofId: payload.proofId })

  return c.json({ queued: true })
})
