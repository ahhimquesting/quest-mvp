import { Context, Next } from 'hono'
import type { Env } from '../types'

const WINDOW_MS = 60_000
const MAX_REQUESTS = 100

export async function rateLimitMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const identifier = c.req.header('cf-connecting-ip') || 'unknown'
  const kv = c.env.RATE_LIMIT_KV
  const key = `rl:${identifier}`
  const now = Date.now()

  const stored = await kv.get(key)
  let timestamps: number[] = stored ? JSON.parse(stored) : []
  timestamps = timestamps.filter((t) => t > now - WINDOW_MS)

  if (timestamps.length >= MAX_REQUESTS) {
    return c.json({ error: 'Rate limit exceeded' }, 429)
  }

  timestamps.push(now)
  await kv.put(key, JSON.stringify(timestamps), {
    expirationTtl: Math.ceil(WINDOW_MS / 1000) + 60,
  })

  await next()
}

export async function checkQuestCreateLimit(kv: KVNamespace, pubkey: string): Promise<boolean> {
  const key = `rl:quests:${pubkey}`
  const now = Date.now()
  const dayMs = 86_400_000

  const stored = await kv.get(key)
  let timestamps: number[] = stored ? JSON.parse(stored) : []
  timestamps = timestamps.filter((t) => t > now - dayMs)

  if (timestamps.length >= 10) return false

  timestamps.push(now)
  await kv.put(key, JSON.stringify(timestamps), { expirationTtl: 86400 + 60 })
  return true
}
