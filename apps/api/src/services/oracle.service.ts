import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  getConnection,
  getOracleKeypair,
  getProgramId,
  deriveConfigPda,
  deriveQuestPda,
  deriveEscrowPda,
  deriveClaimPda,
  getAta,
} from '../lib/solana'
import type { Env } from '../types'
import type { quests, claims } from '../db/schema'

type Quest = typeof quests.$inferSelect
type Claim = typeof claims.$inferSelect

export class OracleService {
  private connection: Connection
  private keypair: Keypair
  private programId: PublicKey

  constructor(private env: Env) {
    this.connection = getConnection(env)
    this.keypair = getOracleKeypair(env)
    this.programId = getProgramId(env)
  }

  async approveCompletion(quest: Quest, claim: Claim): Promise<string> {
    const [configPda] = deriveConfigPda(this.programId)
    const [questPda] = deriveQuestPda(this.programId, BigInt(quest.onchainId))
    const [escrowPda] = deriveEscrowPda(this.programId, questPda)
    const claimerPubkey = await this.resolveClaimerPubkey(claim)
    const [claimPda] = deriveClaimPda(this.programId, questPda, claimerPubkey)

    const rewardMint = new PublicKey(quest.rewardMint)
    const claimerAta = getAta(rewardMint, claimerPubkey)
    const treasuryPubkey = new PublicKey(this.env.TREASURY_TOKEN_ACCOUNT)

    // Build the approve_completion instruction
    // Using raw transaction construction since we don't have the Anchor IDL loaded as a Program
    // In production, this would use the Anchor Program instance
    const ix = await this.buildInstruction('approve_completion', {
      config: configPda,
      quest: questPda,
      claim: claimPda,
      escrow: escrowPda,
      claimerTokenAccount: claimerAta,
      treasury: treasuryPubkey,
      authority: this.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })

    const tx = new Transaction().add(ix)
    tx.feePayer = this.keypair.publicKey
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash

    const sig = await sendAndConfirmTransaction(this.connection, tx, [this.keypair])
    return sig
  }

  async rejectCompletion(quest: Quest, claim: Claim, safetyFlagged: boolean): Promise<string> {
    const [configPda] = deriveConfigPda(this.programId)
    const [questPda] = deriveQuestPda(this.programId, BigInt(quest.onchainId))
    const [escrowPda] = deriveEscrowPda(this.programId, questPda)
    const claimerPubkey = await this.resolveClaimerPubkey(claim)
    const [claimPda] = deriveClaimPda(this.programId, questPda, claimerPubkey)

    const rewardMint = new PublicKey(quest.rewardMint)
    const creatorPubkey = new PublicKey(quest.creatorId) // Will need to resolve from users table
    const claimerAta = getAta(rewardMint, claimerPubkey)
    const creatorAta = getAta(rewardMint, creatorPubkey)

    const ix = await this.buildInstruction('reject_completion', {
      config: configPda,
      quest: questPda,
      claim: claimPda,
      escrow: escrowPda,
      creatorTokenAccount: creatorAta,
      claimerTokenAccount: claimerAta,
      authority: this.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    }, { safetyFlagged })

    const tx = new Transaction().add(ix)
    tx.feePayer = this.keypair.publicKey
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash

    const sig = await sendAndConfirmTransaction(this.connection, tx, [this.keypair])
    return sig
  }

  async expireClaim(quest: Quest, claim: Claim): Promise<string> {
    const [questPda] = deriveQuestPda(this.programId, BigInt(quest.onchainId))
    const [escrowPda] = deriveEscrowPda(this.programId, questPda)
    const claimerPubkey = await this.resolveClaimerPubkey(claim)
    const [claimPda] = deriveClaimPda(this.programId, questPda, claimerPubkey)

    const rewardMint = new PublicKey(quest.rewardMint)
    const creatorPubkey = new PublicKey(quest.creatorId)
    const creatorAta = getAta(rewardMint, creatorPubkey)

    const ix = await this.buildInstruction('expire_claim', {
      quest: questPda,
      claim: claimPda,
      escrow: escrowPda,
      creatorTokenAccount: creatorAta,
      cranker: this.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })

    const tx = new Transaction().add(ix)
    tx.feePayer = this.keypair.publicKey
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash

    const sig = await sendAndConfirmTransaction(this.connection, tx, [this.keypair])
    return sig
  }

  async autoApprove(quest: Quest, claim: Claim): Promise<string> {
    const [configPda] = deriveConfigPda(this.programId)
    const [questPda] = deriveQuestPda(this.programId, BigInt(quest.onchainId))
    const [escrowPda] = deriveEscrowPda(this.programId, questPda)
    const claimerPubkey = await this.resolveClaimerPubkey(claim)
    const [claimPda] = deriveClaimPda(this.programId, questPda, claimerPubkey)

    const rewardMint = new PublicKey(quest.rewardMint)
    const claimerAta = getAta(rewardMint, claimerPubkey)
    const treasuryPubkey = new PublicKey(this.env.TREASURY_TOKEN_ACCOUNT)

    const ix = await this.buildInstruction('auto_approve', {
      config: configPda,
      quest: questPda,
      claim: claimPda,
      escrow: escrowPda,
      claimerTokenAccount: claimerAta,
      treasury: treasuryPubkey,
      cranker: this.keypair.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    })

    const tx = new Transaction().add(ix)
    tx.feePayer = this.keypair.publicKey
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash

    const sig = await sendAndConfirmTransaction(this.connection, tx, [this.keypair])
    return sig
  }

  // Placeholder — in production, use Anchor Program.methods.X().instruction()
  // For now this builds the instruction manually using the IDL discriminator
  private async buildInstruction(
    method: string,
    accounts: Record<string, PublicKey>,
    args?: Record<string, any>,
  ) {
    // This is a simplified instruction builder.
    // In production, import the IDL and use:
    //   const program = new Program(IDL, programId, provider)
    //   return program.methods[method](...args).accounts(accounts).instruction()
    //
    // For now we construct a minimal TransactionInstruction
    const { TransactionInstruction } = await import('@solana/web3.js')

    const keys = Object.entries(accounts).map(([name, pubkey]) => ({
      pubkey,
      isSigner: name === 'authority' || name === 'cranker',
      isWritable: !['tokenProgram', 'systemProgram', 'rent'].includes(name),
    }))

    // Anchor instruction discriminator = first 8 bytes of sha256("global:<method_name>")
    const encoder = new TextEncoder()
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(`global:${method}`))
    const discriminator = new Uint8Array(hash).slice(0, 8)

    // Encode args if present
    let data = discriminator
    if (args?.safetyFlagged !== undefined) {
      const buf = new Uint8Array(9)
      buf.set(discriminator)
      buf[8] = args.safetyFlagged ? 1 : 0
      data = buf
    }

    return new TransactionInstruction({
      programId: this.programId,
      keys,
      data: Buffer.from(data),
    })
  }

  private async resolveClaimerPubkey(claim: Claim): Promise<PublicKey> {
    // In production, join with users table to get the pubkey
    // For now, we derive from the claim PDA (which embeds the claimer pubkey)
    // This is a simplification — the real implementation should look up the user
    // For the oracle service, we need the claimer's actual wallet pubkey
    // This will come from the users table via claim.claimerId -> users.pubkey
    // The caller should pass this in. For now, return a placeholder that should be
    // replaced when integrating with the DB properly.
    throw new Error('resolveClaimerPubkey: must be called with DB context — pass pubkey directly')
  }
}
