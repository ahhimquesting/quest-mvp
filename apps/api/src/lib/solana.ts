import { Connection, PublicKey, Keypair } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import type { Env } from '../types'

export function getConnection(env: Env): Connection {
  return new Connection(env.SOLANA_RPC_URL, 'confirmed')
}

export function getOracleKeypair(env: Env): Keypair {
  const bytes = Uint8Array.from(atob(env.ORACLE_KEYPAIR), (c) => c.charCodeAt(0))
  return Keypair.fromSecretKey(bytes)
}

export function getProgramId(env: Env): PublicKey {
  return new PublicKey(env.QUEST_PROGRAM_ID)
}

// PDA derivation matching contract seeds

export function deriveConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)
}

export function deriveQuestPda(programId: PublicKey, questId: bigint): [PublicKey, number] {
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64LE(questId)
  return PublicKey.findProgramAddressSync([Buffer.from('quest'), buf], programId)
}

export function deriveEscrowPda(programId: PublicKey, questPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), questPda.toBuffer()],
    programId,
  )
}

export function deriveClaimPda(
  programId: PublicKey,
  questPda: PublicKey,
  claimer: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('claim'), questPda.toBuffer(), claimer.toBuffer()],
    programId,
  )
}

export function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner)
}
