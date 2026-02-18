import { eq, sql } from 'drizzle-orm'
import { proofs, claims, quests, users, verificationJobs } from '../db/schema'
import { createDbClient, type Database } from '../db/client'
import { StorageService } from './storage.service'
import { OracleService } from './oracle.service'
import { transcribeAudio, analyzeFrames, type AIVerificationResult } from '../lib/openai'
import type { Env } from '../types'

export async function processVerificationJob(env: Env, proofId: string): Promise<void> {
  const db = createDbClient(env)
  const storage = new StorageService(env.R2, env.R2_PUBLIC_URL)

  const proof = await db.select().from(proofs).where(eq(proofs.id, proofId)).get()
  if (!proof) throw new Error(`Proof ${proofId} not found`)

  const claim = await db.select().from(claims).where(eq(claims.id, proof.claimId)).get()
  if (!claim) throw new Error(`Claim ${proof.claimId} not found`)

  const quest = await db.select().from(quests).where(eq(quests.id, claim.questId)).get()
  if (!quest) throw new Error(`Quest ${claim.questId} not found`)

  // Update job status
  await updateJobStatus(db, proofId, 'transcribing')

  // Step 1: Transcription
  let transcript = ''
  try {
    const videoKey = storage.videoKeyFromUrl(proof.videoUrl)
    const videoBlob = await storage.getVideoBlob(videoKey)
    if (videoBlob) {
      transcript = await transcribeAudio(videoBlob, env)
    }
  } catch (err) {
    console.error('Transcription failed (non-fatal):', err)
  }

  await db.update(proofs).set({ transcript }).where(eq(proofs.id, proofId))

  // Step 2: Fetch frames
  await updateJobStatus(db, proofId, 'analyzing')
  const frames = await storage.getFrames(claim.id)

  if (frames.length === 0) {
    // No frames uploaded — use a single frame approach or fail gracefully
    console.warn(`No frames found for claim ${claim.id}, proceeding with transcript only`)
  }

  // Step 3: Vision analysis
  let aiResult: AIVerificationResult
  try {
    aiResult = await analyzeFrames(quest.description, transcript, frames, env)
  } catch (err) {
    console.error('Vision analysis failed:', err)
    // On failure, escalate to creator review
    aiResult = {
      confidence: 50,
      decision: 'UNCERTAIN',
      reasoning: 'AI analysis failed. Escalated to creator review.',
      detected_actions: [],
      matches_description: false,
      safety_flags: [],
    }
  }

  // Step 4: Save AI results
  await db.update(proofs).set({
    aiConfidence: aiResult.confidence,
    aiDecision: aiResult.decision,
    aiReasoning: aiResult.reasoning,
    detectedActions: JSON.stringify(aiResult.detected_actions),
    safetyFlags: JSON.stringify(aiResult.safety_flags),
  }).where(eq(proofs.id, proofId))

  // Step 5: Apply threshold decision
  await updateJobStatus(db, proofId, 'deciding')
  await applyDecision(db, env, proofId, aiResult, quest, claim)

  await updateJobStatus(db, proofId, 'complete')
}

async function applyDecision(
  db: Database,
  env: Env,
  proofId: string,
  aiResult: AIVerificationResult,
  quest: typeof quests.$inferSelect,
  claim: typeof claims.$inferSelect,
): Promise<void> {
  const hasSafetyFlags = aiResult.safety_flags && aiResult.safety_flags.length > 0

  if (aiResult.confidence >= 80 && !hasSafetyFlags) {
    // Auto-approve
    await db.update(proofs)
      .set({ finalDecision: 'approved', decidedBy: 'ai' })
      .where(eq(proofs.id, proofId))

    try {
      const oracle = new OracleService(env)
      const txSig = await oracle.approveCompletion(quest, claim)
      await db.update(proofs).set({ oracleTxSig: txSig }).where(eq(proofs.id, proofId))
    } catch (err) {
      console.error('Oracle approve failed:', err)
      // Leave as AI-approved in DB, retry oracle tx in crank
    }

    await db.update(claims).set({ status: 'approved' }).where(eq(claims.id, claim.id))
    await db.update(quests).set({ status: 'completed' }).where(eq(quests.id, quest.id))

    await db.update(users)
      .set({
        questsCompleted: sql`${users.questsCompleted} + 1`,
        activeClaims: sql`${users.activeClaims} - 1`,
      })
      .where(eq(users.id, claim.claimerId))

  } else if (aiResult.confidence <= 20 || hasSafetyFlags) {
    // Auto-reject
    await db.update(proofs)
      .set({ finalDecision: 'rejected', decidedBy: 'ai' })
      .where(eq(proofs.id, proofId))

    try {
      const oracle = new OracleService(env)
      const txSig = await oracle.rejectCompletion(quest, claim, hasSafetyFlags)
      await db.update(proofs).set({ oracleTxSig: txSig }).where(eq(proofs.id, proofId))
    } catch (err) {
      console.error('Oracle reject failed:', err)
    }

    await db.update(claims).set({ status: 'rejected' }).where(eq(claims.id, claim.id))
    await db.update(quests).set({ status: 'failed' }).where(eq(quests.id, quest.id))

    await db.update(users)
      .set({ activeClaims: sql`${users.activeClaims} - 1` })
      .where(eq(users.id, claim.claimerId))

    // If safety flagged, increment user flags
    if (hasSafetyFlags) {
      await db.update(users)
        .set({ flags: sql`${users.flags} + 1` })
        .where(eq(users.id, claim.claimerId))
    }

  } else {
    // UNCERTAIN — escalate to creator review
    // claim.reviewDeadline is already set (24h from proof submission)
    // Creator can call POST /api/claims/:id/approve or /reject
    // If they don't respond, crank calls auto_approve
    console.log(`Claim ${claim.id}: AI uncertain (confidence ${aiResult.confidence}), escalated to creator`)
  }
}

async function updateJobStatus(db: Database, proofId: string, status: string) {
  const now = Math.floor(Date.now() / 1000)
  const updates: Record<string, any> = { status }

  if (status === 'transcribing') updates.startedAt = now
  if (status === 'complete' || status === 'failed') updates.completedAt = now

  await db.update(verificationJobs)
    .set(updates)
    .where(eq(verificationJobs.proofId, proofId))
}
