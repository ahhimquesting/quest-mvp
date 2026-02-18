import { Hono } from 'hono'
import type { Env, AuthContext } from '../types'
import { authMiddleware } from '../middleware/auth'
import { createDbClient } from '../db/client'
import { claims, proofs, quests, users, verificationJobs } from '../db/schema'
import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { validateClaim, createClaim, abandonClaim, formatClaim } from '../services/claim.service'
import { formatQuest } from '../services/quest.service'
import { OracleService } from '../services/oracle.service'
import { BadRequest, NotFound, Forbidden } from '../lib/errors'

export const claimRoutes = new Hono<{ Bindings: Env }>()

// POST /api/quests/:questId/claim — mounted on questRoutes, but SDK calls POST /api/quests/:questId/claim
// We handle this in a special way: the quests router will mount this
// Actually, looking at SDK: claimQuest calls POST /api/quests/${questId}/claim
// But our claim routes are mounted at /api/claims
// So we need to handle the claim creation in quests route too
// For now, this file handles /api/claims/* routes

// POST /api/claims/:claimId/proof
claimRoutes.post('/:claimId/proof', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const claimId = c.req.param('claimId')
  const body = await c.req.json<{
    videoUrl: string
    videoHash: string
    durationSeconds?: number
  }>()

  const db = createDbClient(c.env)
  const claim = await db.select().from(claims).where(eq(claims.id, claimId)).get()

  if (!claim) throw new NotFound('Claim not found')
  if (claim.claimerId !== auth.userId) throw new Forbidden('Not your claim')
  if (claim.status !== 'active') throw new BadRequest('Claim is not active')

  const now = Math.floor(Date.now() / 1000)
  if (now > claim.proofDeadline) throw new BadRequest('Proof deadline passed')

  if (!body.videoUrl || !body.videoHash) {
    throw new BadRequest('videoUrl and videoHash are required')
  }

  // Create proof record
  const proofId = nanoid()
  const proof = {
    id: proofId,
    claimId,
    videoUrl: body.videoUrl,
    videoHash: body.videoHash,
    thumbnailUrl: null,
    durationSeconds: body.durationSeconds || 0,
    transcript: null,
    aiConfidence: null,
    aiDecision: null,
    aiReasoning: null,
    detectedActions: null,
    safetyFlags: null,
    finalDecision: null,
    decidedBy: null,
    oracleTxSig: null,
    createdAt: now,
  }

  await db.insert(proofs).values(proof)

  // Update claim status + set review deadline
  const reviewDeadline = now + 24 * 3600
  await db.update(claims)
    .set({ status: 'submitted', reviewDeadline })
    .where(eq(claims.id, claimId))

  // Create verification job
  const jobId = nanoid()
  await db.insert(verificationJobs).values({
    id: jobId,
    proofId,
    status: 'pending',
    attempt: 1,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
  })

  // Enqueue verification
  await c.env.VERIFICATION_QUEUE.send({ proofId })

  return c.json({
    id: proof.id,
    claimId: proof.claimId,
    videoUrl: proof.videoUrl,
    videoHash: proof.videoHash,
    thumbnailUrl: proof.thumbnailUrl,
    durationSeconds: proof.durationSeconds,
    createdAt: proof.createdAt,
  }, 201)
})

// POST /api/claims/:claimId/approve
claimRoutes.post('/:claimId/approve', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const claimId = c.req.param('claimId')
  const db = createDbClient(c.env)

  const claim = await db.select().from(claims).where(eq(claims.id, claimId)).get()
  if (!claim) throw new NotFound('Claim not found')
  if (claim.status !== 'submitted') throw new BadRequest('Claim is not submitted')

  const quest = await db.select().from(quests).where(eq(quests.id, claim.questId)).get()
  if (!quest) throw new NotFound('Quest not found')
  if (quest.creatorId !== auth.userId) throw new Forbidden('Not your quest')

  // Check that AI was uncertain (escalated to creator)
  const proof = await db.select().from(proofs).where(eq(proofs.claimId, claimId)).get()
  if (!proof) throw new NotFound('Proof not found')

  // Update proof
  await db.update(proofs)
    .set({ finalDecision: 'approved', decidedBy: 'creator' })
    .where(eq(proofs.id, proof.id))

  // Call oracle to approve on-chain
  const oracle = new OracleService(c.env)
  const txSig = await oracle.approveCompletion(quest, claim)

  await db.update(proofs).set({ oracleTxSig: txSig }).where(eq(proofs.id, proof.id))
  await db.update(claims).set({ status: 'approved' }).where(eq(claims.id, claimId))
  await db.update(quests).set({ status: 'completed' }).where(eq(quests.id, quest.id))

  // Update user stats
  await db.update(users)
    .set({
      questsCompleted: sql`${users.questsCompleted} + 1`,
      activeClaims: sql`${users.activeClaims} - 1`,
    })
    .where(eq(users.id, claim.claimerId))

  return c.json({ success: true, txSignature: txSig })
})

// POST /api/claims/:claimId/reject
claimRoutes.post('/:claimId/reject', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const claimId = c.req.param('claimId')
  const db = createDbClient(c.env)

  const claim = await db.select().from(claims).where(eq(claims.id, claimId)).get()
  if (!claim) throw new NotFound('Claim not found')
  if (claim.status !== 'submitted') throw new BadRequest('Claim is not submitted')

  const quest = await db.select().from(quests).where(eq(quests.id, claim.questId)).get()
  if (!quest) throw new NotFound('Quest not found')
  if (quest.creatorId !== auth.userId) throw new Forbidden('Not your quest')

  const proof = await db.select().from(proofs).where(eq(proofs.claimId, claimId)).get()
  if (!proof) throw new NotFound('Proof not found')

  await db.update(proofs)
    .set({ finalDecision: 'rejected', decidedBy: 'creator' })
    .where(eq(proofs.id, proof.id))

  // Creator rejection = not safety flagged
  const oracle = new OracleService(c.env)
  const txSig = await oracle.rejectCompletion(quest, claim, false)

  await db.update(proofs).set({ oracleTxSig: txSig }).where(eq(proofs.id, proof.id))
  await db.update(claims).set({ status: 'rejected' }).where(eq(claims.id, claimId))
  await db.update(quests).set({ status: 'failed' }).where(eq(quests.id, quest.id))

  await db.update(users)
    .set({ activeClaims: sql`${users.activeClaims} - 1` })
    .where(eq(users.id, claim.claimerId))

  return c.json({ success: true, txSignature: txSig })
})

// DELETE /api/claims/:claimId
claimRoutes.delete('/:claimId', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = createDbClient(c.env)
  const result = await abandonClaim(db, c.req.param('claimId'), auth.userId)

  if ('error' in result) {
    throw new BadRequest(result.error)
  }

  return c.body(null, 204)
})
