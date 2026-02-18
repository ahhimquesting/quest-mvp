import { Hono } from 'hono'
import type { Env, AuthContext } from '../types'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { createDbClient } from '../db/client'
import { quests, claims } from '../db/schema'
import { eq, desc } from 'drizzle-orm'
import { formatQuest } from '../services/quest.service'
import { formatClaim } from '../services/claim.service'

export const feedRoutes = new Hono<{ Bindings: Env }>()

// GET /api/feed — public open quests
feedRoutes.get('/', optionalAuthMiddleware, async (c) => {
  const db = createDbClient(c.env)
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50)
  const offset = parseInt(c.req.query('offset') || '0')

  const results = await db.select()
    .from(quests)
    .where(eq(quests.status, 'active'))
    .orderBy(desc(quests.createdAt))
    .limit(limit)
    .offset(offset)
    .all()

  return c.json(results.map(formatQuest))
})

// GET /api/feed/mine — user's quests + claims
feedRoutes.get('/mine', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = createDbClient(c.env)

  const myQuests = await db.select()
    .from(quests)
    .where(eq(quests.creatorId, auth.userId))
    .orderBy(desc(quests.createdAt))
    .all()

  const myClaims = await db.select()
    .from(claims)
    .where(eq(claims.claimerId, auth.userId))
    .orderBy(desc(claims.claimedAt))
    .all()

  return c.json({
    quests: myQuests.map(formatQuest),
    claims: myClaims.map(formatClaim),
  })
})
