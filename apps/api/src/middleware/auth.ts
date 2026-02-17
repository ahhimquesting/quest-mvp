import { Context, Next } from 'hono'
import type { Env, AuthContext } from '../types'
import { verifyPrivyToken } from '../lib/privy'
import { createDbClient } from '../db/client'
import { users } from '../db/schema'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization' }, 401)
  }

  const token = authHeader.slice(7)

  try {
    const payload = await verifyPrivyToken(token, c.env)
    const pubkey = extractSolanaWallet(payload)

    if (!pubkey) {
      return c.json({ error: 'No Solana wallet linked' }, 401)
    }

    const db = createDbClient(c.env)
    let user = await db.select().from(users)
      .where(eq(users.privyUserId, payload.sub as string))
      .get()

    if (!user) {
      const now = Math.floor(Date.now() / 1000)
      user = {
        id: nanoid(),
        privyUserId: payload.sub as string,
        pubkey,
        username: pubkey.slice(0, 8) + '...',
        avatarUrl: null,
        questsCompleted: 0,
        questsPosted: 0,
        activeClaims: 0,
        flags: 0,
        createdAt: now,
      }
      await db.insert(users).values(user)
    }

    if (user.flags >= 3) {
      return c.json({ error: 'Account suspended' }, 403)
    }

    c.set('auth', {
      userId: user.id,
      pubkey: user.pubkey,
      privyUserId: user.privyUserId,
    } satisfies AuthContext)

    await next()
  } catch (err) {
    console.error('Auth error:', err)
    return c.json({ error: 'Invalid token' }, 401)
  }
}

export async function optionalAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    c.set('auth', null)
    await next()
    return
  }

  try {
    const token = authHeader.slice(7)
    const payload = await verifyPrivyToken(token, c.env)
    const pubkey = extractSolanaWallet(payload)

    if (pubkey) {
      const db = createDbClient(c.env)
      const user = await db.select().from(users)
        .where(eq(users.privyUserId, payload.sub as string))
        .get()

      if (user && user.flags < 3) {
        c.set('auth', {
          userId: user.id,
          pubkey: user.pubkey,
          privyUserId: user.privyUserId,
        } satisfies AuthContext)
      } else {
        c.set('auth', null)
      }
    } else {
      c.set('auth', null)
    }
  } catch {
    c.set('auth', null)
  }

  await next()
}

function extractSolanaWallet(payload: any): string | null {
  const linked = payload.linked_accounts as Array<{
    type: string
    address: string
    chain_type: string
  }> | undefined

  const solana = linked?.find(
    (a) => a.type === 'wallet' && a.chain_type === 'solana',
  )

  return solana?.address || null
}
