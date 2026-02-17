import { Hono } from 'hono'
import type { Env, AuthContext } from '../types'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { createDbClient } from '../db/client'
import { quests } from '../db/schema'
import { eq } from 'drizzle-orm'
import { createQuest, getQuestById, listQuests, formatQuest } from '../services/quest.service'
import { isDescriptionAllowed } from '../services/moderation.service'
import { checkQuestCreateLimit } from '../middleware/rate-limit'
import { validateClaim, createClaim, formatClaim } from '../services/claim.service'
import { BadRequest, NotFound, Forbidden, RateLimited } from '../lib/errors'

export const questRoutes = new Hono<{ Bindings: Env }>()

// POST /api/quests
questRoutes.post('/', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const body = await c.req.json<{
    description: string
    rewardAmount: number
    rewardMint: string
    questType: 'direct' | 'open'
    targetPubkey?: string
    maxClaimers?: number
    timeLimitHours?: number
  }>()

  // Validate description
  const modCheck = isDescriptionAllowed(body.description)
  if (!modCheck.allowed) {
    throw new BadRequest(modCheck.reason!)
  }

  // Validate quest type
  if (!['direct', 'open'].includes(body.questType)) {
    throw new BadRequest('Invalid quest type')
  }

  if (body.questType === 'direct' && !body.targetPubkey) {
    throw new BadRequest('Direct quests require a target')
  }

  if (body.questType === 'direct' && body.targetPubkey === auth.pubkey) {
    throw new BadRequest('Cannot target yourself')
  }

  // Validate reward
  if (!body.rewardAmount || body.rewardAmount < 1_000_000) {
    throw new BadRequest('Reward too low (minimum 1 token)')
  }

  // Validate max claimers
  if (body.maxClaimers && (body.maxClaimers < 1 || body.maxClaimers > 100)) {
    throw new BadRequest('Max claimers must be 1-100')
  }

  // Rate limit
  const allowed = await checkQuestCreateLimit(c.env.RATE_LIMIT_KV, auth.pubkey)
  if (!allowed) {
    throw new RateLimited('Max 10 quests per day')
  }

  const db = createDbClient(c.env)
  const quest = await createQuest(db, {
    creatorId: auth.userId,
    creatorPubkey: auth.pubkey,
    description: body.description,
    rewardAmount: body.rewardAmount,
    rewardMint: body.rewardMint,
    questType: body.questType,
    targetPubkey: body.targetPubkey,
    maxClaimers: body.maxClaimers,
    timeLimitHours: body.timeLimitHours,
    programId: c.env.QUEST_PROGRAM_ID,
  })

  return c.json(formatQuest(quest), 201)
})

// GET /api/quests
questRoutes.get('/', optionalAuthMiddleware, async (c) => {
  const db = createDbClient(c.env)
  const results = await listQuests(db, {
    status: c.req.query('status'),
    questType: c.req.query('type'),
    creator: c.req.query('creator'),
    limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
    offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
  })

  return c.json(results.map(formatQuest))
})

// GET /api/quests/:questId
questRoutes.get('/:questId', optionalAuthMiddleware, async (c) => {
  const db = createDbClient(c.env)
  const quest = await getQuestById(db, c.req.param('questId'))
  if (!quest) throw new NotFound('Quest not found')
  return c.json(formatQuest(quest))
})

// DELETE /api/quests/:questId
questRoutes.delete('/:questId', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = createDbClient(c.env)
  const quest = await getQuestById(db, c.req.param('questId'))

  if (!quest) throw new NotFound('Quest not found')
  if (quest.creatorId !== auth.userId) throw new Forbidden('Not your quest')
  if (quest.status !== 'active') throw new BadRequest('Quest is not active')
  if (quest.currentClaimers > 0) throw new BadRequest('Quest has active claims')

  await db.update(quests)
    .set({ status: 'cancelled' })
    .where(eq(quests.id, quest.id))

  return c.body(null, 204)
})

// POST /api/quests/:questId/claim
questRoutes.post('/:questId/claim', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const questId = c.req.param('questId')
  const body = await c.req.json<{ stakeAmount: number }>()

  if (!body.stakeAmount) {
    throw new BadRequest('stakeAmount is required')
  }

  const db = createDbClient(c.env)
  const validation = await validateClaim(db, questId, auth.userId, auth.pubkey, body.stakeAmount)

  if ('error' in validation) {
    throw new BadRequest(validation.error!)
  }

  const claim = await createClaim(
    db,
    questId,
    auth.userId,
    auth.pubkey,
    body.stakeAmount,
    c.env.QUEST_PROGRAM_ID,
  )

  return c.json(formatClaim(claim), 201)
})
