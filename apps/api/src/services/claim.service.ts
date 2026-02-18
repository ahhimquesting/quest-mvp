import { eq, and, sql, inArray, gt } from 'drizzle-orm'
import { claims, quests, users } from '../db/schema'
import type { Database } from '../db/client'
import { nanoid } from 'nanoid'
import { PublicKey } from '@solana/web3.js'
import { deriveQuestPda, deriveClaimPda } from '../lib/solana'

const PROOF_DEADLINE_HOURS = 24
const REVIEW_DEADLINE_HOURS = 24
const MIN_STAKE_BPS = 500 // 5%
const MAX_ACTIVE_CLAIMS = 5

export async function validateClaim(
  db: Database,
  questId: string,
  claimerId: string,
  claimerPubkey: string,
  stakeAmount: number,
) {
  const quest = await db.select().from(quests).where(eq(quests.id, questId)).get()
  if (!quest) return { error: 'Quest not found' }
  if (quest.status !== 'active') return { error: 'Quest is not active' }
  if (quest.currentClaimers >= quest.maxClaimers) return { error: 'Quest is full' }
  if (quest.creatorId === claimerId) return { error: 'Cannot claim your own quest' }

  // Check active claims limit
  const activeCount = await db.select({ count: sql<number>`count(*)` })
    .from(claims)
    .where(and(eq(claims.claimerId, claimerId), eq(claims.status, 'active')))
    .get()

  if ((activeCount?.count ?? 0) >= MAX_ACTIVE_CLAIMS) {
    return { error: 'Max 5 active claims' }
  }

  // Check abuse: 2+ expired/abandoned in last 7 days
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400
  const abuseCount = await db.select({ count: sql<number>`count(*)` })
    .from(claims)
    .where(and(
      eq(claims.claimerId, claimerId),
      inArray(claims.status, ['expired', 'abandoned']),
      gt(claims.claimedAt, sevenDaysAgo),
    ))
    .get()

  if ((abuseCount?.count ?? 0) >= 2) {
    return { error: 'Too many expired/abandoned claims recently' }
  }

  // Check minimum stake (5% of reward)
  const minStake = Math.ceil(quest.rewardAmount * MIN_STAKE_BPS / 10000)
  if (stakeAmount < minStake) {
    return { error: `Stake too low (minimum ${minStake})` }
  }

  // Check direct quest targeting
  if (quest.questType === 'direct' && quest.targetPubkey !== claimerPubkey) {
    return { error: 'This quest is not for you' }
  }

  return { quest }
}

export async function createClaim(
  db: Database,
  questId: string,
  claimerId: string,
  claimerPubkey: string,
  stakeAmount: number,
  programId: string,
) {
  const now = Math.floor(Date.now() / 1000)
  const id = nanoid()

  const quest = await db.select().from(quests).where(eq(quests.id, questId)).get()
  if (!quest) throw new Error('Quest not found')

  // Derive claim PDA
  const pid = new PublicKey(programId)
  const [questPda] = deriveQuestPda(pid, BigInt(quest.onchainId))
  const [claimPda] = deriveClaimPda(pid, questPda, new PublicKey(claimerPubkey))

  const claim = {
    id,
    questId,
    claimerId,
    status: 'active' as const,
    stakeAmount,
    proofDeadline: now + PROOF_DEADLINE_HOURS * 3600,
    reviewDeadline: null,
    claimPda: claimPda.toBase58(),
    txSignature: null,
    claimedAt: now,
  }

  await db.insert(claims).values(claim)

  // Update quest
  const newClaimers = quest.currentClaimers + 1
  const newStatus = newClaimers >= quest.maxClaimers ? 'claimed' : 'active'
  await db.update(quests)
    .set({ currentClaimers: newClaimers, status: newStatus as any })
    .where(eq(quests.id, questId))

  // Increment user's active claims
  await db.update(users)
    .set({ activeClaims: sql`${users.activeClaims} + 1` })
    .where(eq(users.id, claimerId))

  return claim
}

export async function abandonClaim(db: Database, claimId: string, claimerId: string) {
  const claim = await db.select().from(claims).where(eq(claims.id, claimId)).get()
  if (!claim) return { error: 'Claim not found' }
  if (claim.claimerId !== claimerId) return { error: 'Not your claim' }
  if (claim.status !== 'active') return { error: 'Claim is not active' }

  await db.update(claims).set({ status: 'abandoned' }).where(eq(claims.id, claimId))

  // Re-open quest slot
  const quest = await db.select().from(quests).where(eq(quests.id, claim.questId)).get()
  if (quest) {
    const newClaimers = Math.max(0, quest.currentClaimers - 1)
    await db.update(quests)
      .set({
        currentClaimers: newClaimers,
        status: quest.status === 'claimed' ? 'active' : quest.status as any,
      })
      .where(eq(quests.id, quest.id))
  }

  // Decrement active claims
  await db.update(users)
    .set({ activeClaims: sql`${users.activeClaims} - 1` })
    .where(eq(users.id, claimerId))

  return { success: true }
}

export function formatClaim(claim: typeof claims.$inferSelect) {
  return {
    id: claim.id,
    questId: claim.questId,
    claimerId: claim.claimerId,
    status: claim.status,
    stakeAmount: claim.stakeAmount,
    proofDeadline: claim.proofDeadline,
    reviewDeadline: claim.reviewDeadline,
    claimedAt: claim.claimedAt,
  }
}
