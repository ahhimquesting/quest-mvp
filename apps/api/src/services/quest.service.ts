import { eq, desc, and, sql } from 'drizzle-orm'
import { quests, users } from '../db/schema'
import type { Database } from '../db/client'
import { nanoid } from 'nanoid'
import { PublicKey } from '@solana/web3.js'
import { deriveQuestPda, deriveEscrowPda } from '../lib/solana'

export interface CreateQuestInput {
  creatorId: string
  creatorPubkey: string
  description: string
  rewardAmount: number
  rewardMint: string
  questType: 'direct' | 'open'
  targetPubkey?: string
  maxClaimers?: number
  timeLimitHours?: number
  programId: string
}

export async function createQuest(db: Database, input: CreateQuestInput) {
  const now = Math.floor(Date.now() / 1000)
  const id = nanoid()

  // Get next onchain ID from quest count
  // In production this would come from reading the config account
  // For now we use a DB-level counter
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(quests).get()
  const onchainId = (countResult?.count ?? 0).toString()

  // Compute description hash
  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(input.description))
  const descriptionHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Derive PDAs
  const programId = new PublicKey(input.programId)
  const [questPda] = deriveQuestPda(programId, BigInt(onchainId))
  const [escrowPda] = deriveEscrowPda(programId, questPda)

  const deadline = input.timeLimitHours ? now + input.timeLimitHours * 3600 : null

  const quest = {
    id,
    onchainId,
    creatorId: input.creatorId,
    description: input.description,
    descriptionHash,
    questType: input.questType,
    status: 'active' as const,
    rewardAmount: input.rewardAmount,
    rewardMint: input.rewardMint,
    targetPubkey: input.targetPubkey || null,
    maxClaimers: input.maxClaimers || 1,
    currentClaimers: 0,
    deadline,
    escrowPda: escrowPda.toBase58(),
    questPda: questPda.toBase58(),
    txSignature: null,
    createdAt: now,
  }

  await db.insert(quests).values(quest)

  // Increment creator's quests_posted
  await db.update(users)
    .set({ questsPosted: sql`${users.questsPosted} + 1` })
    .where(eq(users.id, input.creatorId))

  return quest
}

export async function getQuestById(db: Database, id: string) {
  return db.select().from(quests).where(eq(quests.id, id)).get()
}

export async function listQuests(
  db: Database,
  filters: {
    status?: string
    questType?: string
    creator?: string
    limit?: number
    offset?: number
  },
) {
  const conditions = []

  if (filters.status) {
    conditions.push(eq(quests.status, filters.status as any))
  }
  if (filters.questType) {
    conditions.push(eq(quests.questType, filters.questType as any))
  }
  if (filters.creator) {
    conditions.push(eq(quests.creatorId, filters.creator))
  }

  const limit = Math.min(filters.limit || 20, 50)
  const offset = filters.offset || 0

  const where = conditions.length > 0 ? and(...conditions) : undefined

  return db.select()
    .from(quests)
    .where(where)
    .orderBy(desc(quests.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
}

export function formatQuest(quest: typeof quests.$inferSelect) {
  return {
    id: quest.id,
    onchainId: quest.onchainId,
    creatorId: quest.creatorId,
    description: quest.description,
    questType: quest.questType,
    status: quest.status,
    rewardAmount: quest.rewardAmount,
    rewardMint: quest.rewardMint,
    targetPubkey: quest.targetPubkey,
    maxClaimers: quest.maxClaimers,
    currentClaimers: quest.currentClaimers,
    deadline: quest.deadline,
    escrowPda: quest.escrowPda,
    createdAt: quest.createdAt,
  }
}
