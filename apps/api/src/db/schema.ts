import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ── Users ──────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  privyUserId: text('privy_user_id').notNull(),
  pubkey: text('pubkey').notNull(),
  username: text('username').notNull(),
  avatarUrl: text('avatar_url'),
  questsCompleted: integer('quests_completed').notNull().default(0),
  questsPosted: integer('quests_posted').notNull().default(0),
  activeClaims: integer('active_claims').notNull().default(0),
  flags: integer('flags').notNull().default(0),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  pubkeyIdx: uniqueIndex('users_pubkey_idx').on(table.pubkey),
  privyIdx: uniqueIndex('users_privy_idx').on(table.privyUserId),
}))

// ── Quests ─────────────────────────────────────

export const quests = sqliteTable('quests', {
  id: text('id').primaryKey(),
  onchainId: text('onchain_id').notNull(),
  creatorId: text('creator_id').notNull().references(() => users.id),
  description: text('description').notNull(),
  descriptionHash: text('description_hash').notNull(),
  questType: text('quest_type', { enum: ['direct', 'open'] }).notNull(),
  status: text('status', { enum: ['active', 'claimed', 'completed', 'failed', 'cancelled', 'expired'] }).notNull(),
  rewardAmount: integer('reward_amount').notNull(),
  rewardMint: text('reward_mint').notNull(),
  targetPubkey: text('target_pubkey'),
  maxClaimers: integer('max_claimers').notNull(),
  currentClaimers: integer('current_claimers').notNull().default(0),
  deadline: integer('deadline'),
  escrowPda: text('escrow_pda').notNull(),
  questPda: text('quest_pda').notNull(),
  txSignature: text('tx_signature'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  statusIdx: index('quests_status_idx').on(table.status),
  creatorIdx: index('quests_creator_idx').on(table.creatorId),
  createdAtIdx: index('quests_created_at_idx').on(table.createdAt),
}))

// ── Claims ─────────────────────────────────────

export const claims = sqliteTable('claims', {
  id: text('id').primaryKey(),
  questId: text('quest_id').notNull().references(() => quests.id),
  claimerId: text('claimer_id').notNull().references(() => users.id),
  status: text('status', { enum: ['active', 'submitted', 'approved', 'rejected', 'abandoned', 'expired'] }).notNull(),
  stakeAmount: integer('stake_amount').notNull(),
  proofDeadline: integer('proof_deadline').notNull(),
  reviewDeadline: integer('review_deadline'),
  claimPda: text('claim_pda').notNull(),
  txSignature: text('tx_signature'),
  claimedAt: integer('claimed_at').notNull(),
}, (table) => ({
  questIdx: index('claims_quest_idx').on(table.questId),
  claimerIdx: index('claims_claimer_idx').on(table.claimerId),
  statusIdx: index('claims_status_idx').on(table.status),
  proofDeadlineIdx: index('claims_proof_deadline_idx').on(table.proofDeadline),
  reviewDeadlineIdx: index('claims_review_deadline_idx').on(table.reviewDeadline),
}))

// ── Proofs ─────────────────────────────────────

export const proofs = sqliteTable('proofs', {
  id: text('id').primaryKey(),
  claimId: text('claim_id').notNull().references(() => claims.id),
  videoUrl: text('video_url').notNull(),
  videoHash: text('video_hash').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  durationSeconds: integer('duration_seconds').notNull(),
  transcript: text('transcript'),
  aiConfidence: integer('ai_confidence'),
  aiDecision: text('ai_decision', { enum: ['APPROVE', 'REJECT', 'UNCERTAIN'] }),
  aiReasoning: text('ai_reasoning'),
  detectedActions: text('detected_actions'),
  safetyFlags: text('safety_flags'),
  finalDecision: text('final_decision', { enum: ['approved', 'rejected'] }),
  decidedBy: text('decided_by', { enum: ['ai', 'creator', 'timeout'] }),
  oracleTxSig: text('oracle_tx_sig'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  claimIdx: uniqueIndex('proofs_claim_idx').on(table.claimId),
}))

// ── Verification Jobs ──────────────────────────

export const verificationJobs = sqliteTable('verification_jobs', {
  id: text('id').primaryKey(),
  proofId: text('proof_id').notNull().references(() => proofs.id),
  status: text('status', { enum: ['pending', 'transcribing', 'analyzing', 'deciding', 'complete', 'failed'] }).notNull(),
  attempt: integer('attempt').notNull().default(1),
  errorMessage: text('error_message'),
  startedAt: integer('started_at'),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
}, (table) => ({
  proofIdx: index('vjobs_proof_idx').on(table.proofId),
  statusIdx: index('vjobs_status_idx').on(table.status),
}))
