import { and, eq, lt, isNotNull, sql } from 'drizzle-orm'
import { claims, quests, proofs, users } from '../db/schema'
import { createDbClient } from '../db/client'
import { OracleService } from '../services/oracle.service'
import type { Env } from '../types'

export async function runCrank(env: Env): Promise<void> {
  const db = createDbClient(env)
  const now = Math.floor(Date.now() / 1000)

  // 1. Expire claims past proof_deadline that are still 'active'
  const expiredClaims = await db.select()
    .from(claims)
    .where(and(
      eq(claims.status, 'active'),
      lt(claims.proofDeadline, now),
    ))
    .all()

  for (const claim of expiredClaims) {
    try {
      const quest = await db.select().from(quests).where(eq(quests.id, claim.questId)).get()
      if (!quest) continue

      // Call permissionless expire_claim on-chain
      try {
        const oracle = new OracleService(env)
        await oracle.expireClaim(quest, claim)
      } catch (err) {
        console.error(`On-chain expire_claim failed for ${claim.id}:`, err)
        // Update DB anyway — the on-chain state may already be expired
      }

      await db.update(claims).set({ status: 'expired' }).where(eq(claims.id, claim.id))

      // Re-open quest slot
      const newClaimers = Math.max(0, quest.currentClaimers - 1)
      await db.update(quests)
        .set({
          currentClaimers: newClaimers,
          status: quest.status === 'claimed' ? 'active' : quest.status as any,
        })
        .where(eq(quests.id, quest.id))

      await db.update(users)
        .set({ activeClaims: sql`${users.activeClaims} - 1` })
        .where(eq(users.id, claim.claimerId))

      console.log(`Expired claim ${claim.id}`)
    } catch (err) {
      console.error(`Failed to expire claim ${claim.id}:`, err)
    }
  }

  // 2. Auto-approve claims past review_deadline (creator didn't respond)
  const autoApproveClaims = await db.select()
    .from(claims)
    .where(and(
      eq(claims.status, 'submitted'),
      isNotNull(claims.reviewDeadline),
      lt(claims.reviewDeadline, now),
    ))
    .all()

  for (const claim of autoApproveClaims) {
    try {
      const quest = await db.select().from(quests).where(eq(quests.id, claim.questId)).get()
      if (!quest) continue

      // Call permissionless auto_approve on-chain
      try {
        const oracle = new OracleService(env)
        const txSig = await oracle.autoApprove(quest, claim)

        // Update proof
        await db.update(proofs)
          .set({ finalDecision: 'approved', decidedBy: 'timeout', oracleTxSig: txSig })
          .where(eq(proofs.claimId, claim.id))
      } catch (err) {
        console.error(`On-chain auto_approve failed for ${claim.id}:`, err)
      }

      await db.update(claims).set({ status: 'approved' }).where(eq(claims.id, claim.id))
      await db.update(quests).set({ status: 'completed' }).where(eq(quests.id, quest.id))

      await db.update(users)
        .set({
          questsCompleted: sql`${users.questsCompleted} + 1`,
          activeClaims: sql`${users.activeClaims} - 1`,
        })
        .where(eq(users.id, claim.claimerId))

      console.log(`Auto-approved claim ${claim.id}`)
    } catch (err) {
      console.error(`Failed to auto-approve claim ${claim.id}:`, err)
    }
  }
}
