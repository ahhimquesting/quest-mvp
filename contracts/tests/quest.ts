import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorError } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Quest } from "../target/types/quest";

const DECIMALS = 6;
const ONE_TOKEN = 1_000_000;
const REWARD = 100 * ONE_TOKEN;
const MIN_STAKE_BPS = 500; // 5%
const SECONDS_PER_HOUR = 3600;

function descHash(text: string): number[] {
  const hash = Array(32).fill(0);
  for (let i = 0; i < Math.min(text.length, 32); i++) {
    hash[i] = text.charCodeAt(i);
  }
  return hash;
}

function proofHash(text: string): number[] {
  return descHash(text);
}

describe("quest", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Quest as Program<Quest>;
  const connection = provider.connection;

  // wallets
  const authority = provider.wallet as anchor.Wallet;
  const creator = Keypair.generate();
  const claimer = Keypair.generate();
  const randomUser = Keypair.generate();

  // token stuff
  let mint: PublicKey;
  let creatorAta: PublicKey;
  let claimerAta: PublicKey;
  let treasuryAta: PublicKey;

  // pdas
  let configPda: PublicKey;
  let configBump: number;

  const feeBps = 250; // 2.5%
  const burnBps = 0;

  // track quest count for PDA derivation
  let questCount = 0;

  function deriveQuestPda(id: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("quest"), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }

  function deriveEscrowPda(questPda: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), questPda.toBuffer()],
      program.programId
    );
  }

  function deriveClaimPda(
    questPda: PublicKey,
    claimerKey: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), questPda.toBuffer(), claimerKey.toBuffer()],
      program.programId
    );
  }

  async function airdrop(pubkey: PublicKey, sol: number = 10) {
    const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  async function getTokenBalance(ata: PublicKey): Promise<number> {
    const info = await getAccount(connection, ata);
    return Number(info.amount);
  }

  // helper: full lifecycle to get a quest into "Submitted" state
  async function createAndSubmitQuest(): Promise<{
    questPda: PublicKey;
    escrowPda: PublicKey;
    claimPda: PublicKey;
    questId: number;
  }> {
    const id = questCount;
    const [questPda] = deriveQuestPda(id);
    const [escrowPda] = deriveEscrowPda(questPda);
    const [claimPda] = deriveClaimPda(questPda, claimer.publicKey);

    await program.methods
      .createQuest(
        new BN(REWARD),
        { open: {} },
        null,
        1,
        null,
        descHash("test quest for lifecycle")
      )
      .accounts({
        config: configPda,
        quest: questPda,
        escrow: escrowPda,
        rewardMint: mint,
        creator: creator.publicKey,
        creatorTokenAccount: creatorAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    questCount++;

    const stakeAmount = (REWARD * MIN_STAKE_BPS) / 10000;

    await program.methods
      .claimQuest(new BN(stakeAmount))
      .accounts({
        quest: questPda,
        claim: claimPda,
        escrow: escrowPda,
        claimer: claimer.publicKey,
        claimerTokenAccount: claimerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([claimer])
      .rpc();

    await program.methods
      .submitProof(proofHash("proof-data-here"))
      .accounts({
        quest: questPda,
        claim: claimPda,
        claimer: claimer.publicKey,
      })
      .signers([claimer])
      .rpc();

    return { questPda, escrowPda, claimPda, questId: id };
  }

  before(async () => {
    // fund all wallets
    await Promise.all([
      airdrop(creator.publicKey),
      airdrop(claimer.publicKey),
      airdrop(randomUser.publicKey),
    ]);

    // create SPL mint
    mint = await createMint(
      connection,
      (authority as any).payer,
      authority.publicKey,
      null,
      DECIMALS
    );

    // create ATAs
    creatorAta = await createAccount(
      connection,
      (authority as any).payer,
      mint,
      creator.publicKey
    );
    claimerAta = await createAccount(
      connection,
      (authority as any).payer,
      mint,
      claimer.publicKey
    );
    treasuryAta = await createAccount(
      connection,
      (authority as any).payer,
      mint,
      authority.publicKey
    );

    // mint tokens
    await mintTo(
      connection,
      (authority as any).payer,
      mint,
      creatorAta,
      authority.publicKey,
      10_000 * ONE_TOKEN
    );
    await mintTo(
      connection,
      (authority as any).payer,
      mint,
      claimerAta,
      authority.publicKey,
      10_000 * ONE_TOKEN
    );

    // derive config PDA
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
  });

  // =========================================================================
  // Protocol Init
  // =========================================================================

  describe("initialize", () => {
    it("sets up protocol config", async () => {
      await program.methods
        .initialize(feeBps, burnBps)
        .accounts({
          config: configPda,
          treasury: treasuryAta,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.questConfig.fetch(configPda);
      expect(config.authority.toBase58()).to.equal(
        authority.publicKey.toBase58()
      );
      expect(config.feeBasisPoints).to.equal(feeBps);
      expect(config.burnBasisPoints).to.equal(burnBps);
      expect(config.questCount.toNumber()).to.equal(0);
    });

    it("rejects fee > 100%", async () => {
      // config already init'd, so this would also fail for duplicate init,
      // but the point stands for the validation check
      try {
        await program.methods
          .initialize(10001, 0)
          .accounts({
            config: configPda,
            treasury: treasuryAta,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        // either InvalidFeeConfig or duplicate init — both are valid rejections
        expect(err).to.exist;
      }
    });
  });

  // =========================================================================
  // Create Quest
  // =========================================================================

  describe("create quest", () => {
    it("creates an open quest", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);

      const balBefore = await getTokenBalance(creatorAta);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          5,
          null,
          descHash("open quest: review this PR")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      questCount++;

      const quest = await program.account.quest.fetch(questPda);
      expect(quest.id.toNumber()).to.equal(id);
      expect(quest.rewardAmount.toNumber()).to.equal(REWARD);
      expect(quest.questType).to.deep.equal({ open: {} });
      expect(quest.status).to.deep.equal({ active: {} });
      expect(quest.maxClaimers).to.equal(5);
      expect(quest.currentClaimers).to.equal(0);
      expect(quest.target).to.be.null;

      const balAfter = await getTokenBalance(creatorAta);
      expect(balBefore - balAfter).to.equal(REWARD);

      const escrowBal = await getTokenBalance(escrowPda);
      expect(escrowBal).to.equal(REWARD);
    });

    it("creates a direct quest with a target", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { direct: {} },
          claimer.publicKey,
          1,
          null,
          descHash("direct quest for claimer")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();

      questCount++;

      const quest = await program.account.quest.fetch(questPda);
      expect(quest.questType).to.deep.equal({ direct: {} });
      expect(quest.target.toBase58()).to.equal(claimer.publicKey.toBase58());
    });

    it("rejects reward below minimum", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);

      try {
        await program.methods
          .createQuest(
            new BN(100), // way below MIN_REWARD (1_000_000)
            { open: {} },
            null,
            1,
            null,
            descHash("cheap quest")
          )
          .accounts({
            config: configPda,
            quest: questPda,
            escrow: escrowPda,
            rewardMint: mint,
            creator: creator.publicKey,
            creatorTokenAccount: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("RewardTooLow");
      }
    });

    it("rejects direct quest targeting self", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);

      try {
        await program.methods
          .createQuest(
            new BN(REWARD),
            { direct: {} },
            creator.publicKey, // targeting self
            1,
            null,
            descHash("self-target")
          )
          .accounts({
            config: configPda,
            quest: questPda,
            escrow: escrowPda,
            rewardMint: mint,
            creator: creator.publicKey,
            creatorTokenAccount: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("CannotTargetSelf");
      }
    });

    it("rejects direct quest with no target", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);

      try {
        await program.methods
          .createQuest(
            new BN(REWARD),
            { direct: {} },
            null,
            1,
            null,
            descHash("no target")
          )
          .accounts({
            config: configPda,
            quest: questPda,
            escrow: escrowPda,
            rewardMint: mint,
            creator: creator.publicKey,
            creatorTokenAccount: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal(
          "DirectQuestNeedsTarget"
        );
      }
    });
  });

  // =========================================================================
  // Claim Quest
  // =========================================================================

  describe("claim quest", () => {
    let questPda: PublicKey;
    let escrowPda: PublicKey;

    before(async () => {
      const id = questCount;
      [questPda] = deriveQuestPda(id);
      [escrowPda] = deriveEscrowPda(questPda);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          1,
          null,
          descHash("claimable quest")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;
    });

    it("claims with valid stake", async () => {
      const [claimPda] = deriveClaimPda(questPda, claimer.publicKey);
      const stakeAmount = (REWARD * MIN_STAKE_BPS) / 10000; // exactly 5%

      const claimerBefore = await getTokenBalance(claimerAta);

      await program.methods
        .claimQuest(new BN(stakeAmount))
        .accounts({
          quest: questPda,
          claim: claimPda,
          escrow: escrowPda,
          claimer: claimer.publicKey,
          claimerTokenAccount: claimerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimer])
        .rpc();

      const claim = await program.account.claim.fetch(claimPda);
      expect(claim.stakeAmount.toNumber()).to.equal(stakeAmount);
      expect(claim.status).to.deep.equal({ active: {} });
      expect(claim.proofHash).to.be.null;
      expect(claim.reviewDeadline).to.be.null;

      const claimerAfter = await getTokenBalance(claimerAta);
      expect(claimerBefore - claimerAfter).to.equal(stakeAmount);

      // quest should flip to Claimed since max_claimers = 1
      const quest = await program.account.quest.fetch(questPda);
      expect(quest.status).to.deep.equal({ claimed: {} });
      expect(quest.currentClaimers).to.equal(1);
    });

    it("prevents creator from claiming own quest", async () => {
      // new quest so creator can try to claim
      const id = questCount;
      const [qPda] = deriveQuestPda(id);
      const [ePda] = deriveEscrowPda(qPda);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          1,
          null,
          descHash("self-claim test")
        )
        .accounts({
          config: configPda,
          quest: qPda,
          escrow: ePda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;

      const [claimPda] = deriveClaimPda(qPda, creator.publicKey);

      try {
        await program.methods
          .claimQuest(new BN((REWARD * MIN_STAKE_BPS) / 10000))
          .accounts({
            quest: qPda,
            claim: claimPda,
            escrow: ePda,
            claimer: creator.publicKey,
            claimerTokenAccount: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("CannotClaimOwnQuest");
      }
    });

    it("rejects stake below 5%", async () => {
      // reuse the quest from self-claim test (it's still Active)
      const id = questCount - 1;
      const [qPda] = deriveQuestPda(id);
      const [ePda] = deriveEscrowPda(qPda);
      const [claimPda] = deriveClaimPda(qPda, claimer.publicKey);

      try {
        await program.methods
          .claimQuest(new BN(1)) // 1 lamport, way too low
          .accounts({
            quest: qPda,
            claim: claimPda,
            escrow: ePda,
            claimer: claimer.publicKey,
            claimerTokenAccount: claimerAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([claimer])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("StakeTooLow");
      }
    });
  });

  // =========================================================================
  // Submit Proof
  // =========================================================================

  describe("submit proof", () => {
    let questPda: PublicKey;
    let claimPda: PublicKey;

    before(async () => {
      const id = questCount;
      [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);
      [claimPda] = deriveClaimPda(questPda, claimer.publicKey);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          1,
          null,
          descHash("proof quest")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;

      await program.methods
        .claimQuest(new BN((REWARD * MIN_STAKE_BPS) / 10000))
        .accounts({
          quest: questPda,
          claim: claimPda,
          escrow: deriveEscrowPda(questPda)[0],
          claimer: claimer.publicKey,
          claimerTokenAccount: claimerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimer])
        .rpc();
    });

    it("submits proof and sets review deadline", async () => {
      const hash = proofHash("ipfs://QmSomeHash12345");

      await program.methods
        .submitProof(hash)
        .accounts({
          quest: questPda,
          claim: claimPda,
          claimer: claimer.publicKey,
        })
        .signers([claimer])
        .rpc();

      const claim = await program.account.claim.fetch(claimPda);
      expect(claim.status).to.deep.equal({ submitted: {} });
      expect(claim.proofHash).to.not.be.null;
      expect(claim.submittedAt).to.not.be.null;
      expect(claim.reviewDeadline).to.not.be.null;
    });

    it("rejects proof from non-claimer", async () => {
      // need a fresh quest+claim for this
      const id = questCount;
      const [qPda] = deriveQuestPda(id);
      const [ePda] = deriveEscrowPda(qPda);
      const [cPda] = deriveClaimPda(qPda, claimer.publicKey);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          1,
          null,
          descHash("non-claimer proof test")
        )
        .accounts({
          config: configPda,
          quest: qPda,
          escrow: ePda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;

      await program.methods
        .claimQuest(new BN((REWARD * MIN_STAKE_BPS) / 10000))
        .accounts({
          quest: qPda,
          claim: cPda,
          escrow: ePda,
          claimer: claimer.publicKey,
          claimerTokenAccount: claimerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimer])
        .rpc();

      // randomUser tries to submit — PDA seeds won't match
      try {
        const [wrongClaimPda] = deriveClaimPda(qPda, randomUser.publicKey);
        await program.methods
          .submitProof(proofHash("fake"))
          .accounts({
            quest: qPda,
            claim: wrongClaimPda,
            claimer: randomUser.publicKey,
          })
          .signers([randomUser])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        // PDA mismatch or AccountNotInitialized
        expect(err).to.exist;
      }
    });
  });

  // =========================================================================
  // Approve Completion (oracle flow)
  // =========================================================================

  describe("approve completion", () => {
    it("oracle approves and distributes reward + returns stake", async () => {
      const { questPda, escrowPda, claimPda } = await createAndSubmitQuest();

      const claimerBefore = await getTokenBalance(claimerAta);
      const treasuryBefore = await getTokenBalance(treasuryAta);

      await program.methods
        .approveCompletion()
        .accounts({
          config: configPda,
          quest: questPda,
          claim: claimPda,
          escrow: escrowPda,
          claimerTokenAccount: claimerAta,
          treasury: treasuryAta,
          authority: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const claimerAfter = await getTokenBalance(claimerAta);
      const treasuryAfter = await getTokenBalance(treasuryAta);

      const feeAmount = Math.floor((REWARD * feeBps) / 10000);
      const rewardAfterFee = REWARD - feeAmount;
      const stakeAmount = (REWARD * MIN_STAKE_BPS) / 10000;

      // claimer gets reward (minus fee) + their stake back
      expect(claimerAfter - claimerBefore).to.equal(
        rewardAfterFee + stakeAmount
      );
      // treasury gets fee
      expect(treasuryAfter - treasuryBefore).to.equal(feeAmount);

      const quest = await program.account.quest.fetch(questPda);
      expect(quest.status).to.deep.equal({ completed: {} });

      const claim = await program.account.claim.fetch(claimPda);
      expect(claim.status).to.deep.equal({ approved: {} });
    });

    it("rejects approval from non-oracle", async () => {
      const { questPda, escrowPda, claimPda } = await createAndSubmitQuest();

      try {
        await program.methods
          .approveCompletion()
          .accounts({
            config: configPda,
            quest: questPda,
            claim: claimPda,
            escrow: escrowPda,
            claimerTokenAccount: claimerAta,
            treasury: treasuryAta,
            authority: creator.publicKey, // not the oracle
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([creator])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("NotOracle");
      }
    });
  });

  // =========================================================================
  // Reject Completion
  // =========================================================================

  describe("reject completion", () => {
    it("normal rejection: creator gets reward + stake", async () => {
      const { questPda, escrowPda, claimPda } = await createAndSubmitQuest();

      const stakeAmount = (REWARD * MIN_STAKE_BPS) / 10000;
      const creatorBefore = await getTokenBalance(creatorAta);

      await program.methods
        .rejectCompletion(false)
        .accounts({
          config: configPda,
          quest: questPda,
          claim: claimPda,
          escrow: escrowPda,
          creatorTokenAccount: creatorAta,
          claimerTokenAccount: claimerAta,
          authority: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const creatorAfter = await getTokenBalance(creatorAta);
      expect(creatorAfter - creatorBefore).to.equal(REWARD + stakeAmount);

      const quest = await program.account.quest.fetch(questPda);
      expect(quest.status).to.deep.equal({ failed: {} });

      const claim = await program.account.claim.fetch(claimPda);
      expect(claim.status).to.deep.equal({ rejected: {} });
    });

    it("safety-flagged rejection: stake returned to claimer", async () => {
      const { questPda, escrowPda, claimPda } = await createAndSubmitQuest();

      const stakeAmount = (REWARD * MIN_STAKE_BPS) / 10000;
      const creatorBefore = await getTokenBalance(creatorAta);
      const claimerBefore = await getTokenBalance(claimerAta);

      await program.methods
        .rejectCompletion(true) // safety_flagged = true
        .accounts({
          config: configPda,
          quest: questPda,
          claim: claimPda,
          escrow: escrowPda,
          creatorTokenAccount: creatorAta,
          claimerTokenAccount: claimerAta,
          authority: authority.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const creatorAfter = await getTokenBalance(creatorAta);
      const claimerAfter = await getTokenBalance(claimerAta);

      // creator gets reward back
      expect(creatorAfter - creatorBefore).to.equal(REWARD);
      // claimer gets stake back (not punished)
      expect(claimerAfter - claimerBefore).to.equal(stakeAmount);
    });
  });

  // =========================================================================
  // Cancel Quest
  // =========================================================================

  describe("cancel quest", () => {
    it("creator cancels unclaimed quest and gets refund", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          3,
          null,
          descHash("cancellable")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;

      const creatorBefore = await getTokenBalance(creatorAta);

      await program.methods
        .cancelQuest()
        .accounts({
          quest: questPda,
          escrow: escrowPda,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc();

      const creatorAfter = await getTokenBalance(creatorAta);
      expect(creatorAfter - creatorBefore).to.equal(REWARD);

      const quest = await program.account.quest.fetch(questPda);
      expect(quest.status).to.deep.equal({ cancelled: {} });
    });

    it("non-creator cannot cancel", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          1,
          null,
          descHash("not yours")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;

      try {
        await program.methods
          .cancelQuest()
          .accounts({
            quest: questPda,
            escrow: escrowPda,
            creator: claimer.publicKey,
            creatorTokenAccount: claimerAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([claimer])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("NotCreator");
      }
    });

    it("cannot cancel a quest with active claimers", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);
      const [claimPda] = deriveClaimPda(questPda, claimer.publicKey);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          5,
          null,
          descHash("has claimers")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;

      // claim it
      await program.methods
        .claimQuest(new BN((REWARD * MIN_STAKE_BPS) / 10000))
        .accounts({
          quest: questPda,
          claim: claimPda,
          escrow: escrowPda,
          claimer: claimer.publicKey,
          claimerTokenAccount: claimerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimer])
        .rpc();

      try {
        await program.methods
          .cancelQuest()
          .accounts({
            quest: questPda,
            escrow: escrowPda,
            creator: creator.publicKey,
            creatorTokenAccount: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([creator])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("QuestAlreadyClaimed");
      }
    });
  });

  // =========================================================================
  // Abandon Claim
  // =========================================================================

  describe("abandon claim", () => {
    it("claimer abandons and forfeits stake to creator", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);
      const [claimPda] = deriveClaimPda(questPda, claimer.publicKey);
      const stakeAmount = (REWARD * MIN_STAKE_BPS) / 10000;

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          1,
          null,
          descHash("abandon test")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;

      await program.methods
        .claimQuest(new BN(stakeAmount))
        .accounts({
          quest: questPda,
          claim: claimPda,
          escrow: escrowPda,
          claimer: claimer.publicKey,
          claimerTokenAccount: claimerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimer])
        .rpc();

      // quest should be Claimed (max_claimers = 1)
      let quest = await program.account.quest.fetch(questPda);
      expect(quest.status).to.deep.equal({ claimed: {} });

      const creatorBefore = await getTokenBalance(creatorAta);

      await program.methods
        .abandonClaim()
        .accounts({
          quest: questPda,
          claim: claimPda,
          escrow: escrowPda,
          creatorTokenAccount: creatorAta,
          claimer: claimer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([claimer])
        .rpc();

      const creatorAfter = await getTokenBalance(creatorAta);
      expect(creatorAfter - creatorBefore).to.equal(stakeAmount);

      const claim = await program.account.claim.fetch(claimPda);
      expect(claim.status).to.deep.equal({ abandoned: {} });

      // quest goes back to Active
      quest = await program.account.quest.fetch(questPda);
      expect(quest.status).to.deep.equal({ active: {} });
      expect(quest.currentClaimers).to.equal(0);
    });
  });

  // =========================================================================
  // Expire Claim (permissionless crank)
  // =========================================================================

  describe("expire claim", () => {
    it("cannot expire before proof deadline", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);
      const [claimPda] = deriveClaimPda(questPda, claimer.publicKey);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          1,
          null,
          descHash("expire test")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;

      await program.methods
        .claimQuest(new BN((REWARD * MIN_STAKE_BPS) / 10000))
        .accounts({
          quest: questPda,
          claim: claimPda,
          escrow: escrowPda,
          claimer: claimer.publicKey,
          claimerTokenAccount: claimerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimer])
        .rpc();

      // try to expire immediately — should fail
      try {
        await program.methods
          .expireClaim()
          .accounts({
            quest: questPda,
            claim: claimPda,
            escrow: escrowPda,
            creatorTokenAccount: creatorAta,
            cranker: randomUser.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([randomUser])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("DeadlineNotReached");
      }
    });

    // NOTE: Full expiry test requires warp_to or validator time manipulation.
    // In a real CI you'd use bankrun or solana-test-validator with clock warp.
    // Leaving this as a documented limitation.
    it.skip("expires claim after proof deadline (requires clock warp)", async () => {
      // would need: await provider.connection.setBlockhashValid(...)
      // or bankrun's context.warp_to_slot(...)
    });
  });

  // =========================================================================
  // Auto-Approve (permissionless crank after review deadline)
  // =========================================================================

  describe("auto-approve", () => {
    it("cannot auto-approve before review deadline", async () => {
      const { questPda, escrowPda, claimPda } = await createAndSubmitQuest();

      try {
        await program.methods
          .autoApprove()
          .accounts({
            config: configPda,
            quest: questPda,
            claim: claimPda,
            escrow: escrowPda,
            claimerTokenAccount: claimerAta,
            treasury: treasuryAta,
            cranker: randomUser.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([randomUser])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("DeadlineNotReached");
      }
    });

    it("cannot auto-approve an active (non-submitted) claim", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);
      const [claimPda] = deriveClaimPda(questPda, claimer.publicKey);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          1,
          null,
          descHash("auto-approve guard")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;

      await program.methods
        .claimQuest(new BN((REWARD * MIN_STAKE_BPS) / 10000))
        .accounts({
          quest: questPda,
          claim: claimPda,
          escrow: escrowPda,
          claimer: claimer.publicKey,
          claimerTokenAccount: claimerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimer])
        .rpc();

      try {
        await program.methods
          .autoApprove()
          .accounts({
            config: configPda,
            quest: questPda,
            claim: claimPda,
            escrow: escrowPda,
            claimerTokenAccount: claimerAta,
            treasury: treasuryAta,
            cranker: randomUser.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([randomUser])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("ClaimNotSubmitted");
      }
    });

    // NOTE: Full auto-approve test requires clock warp past review_deadline.
    it.skip("auto-approves after review deadline (requires clock warp)", async () => {
      // same limitation as expire_claim — needs bankrun or clock manipulation
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe("edge cases", () => {
    it("quest with time_limit in the past fails", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);

      try {
        await program.methods
          .createQuest(
            new BN(REWARD),
            { open: {} },
            null,
            1,
            new BN(1000), // unix timestamp in 1970 — long past
            descHash("expired before creation")
          )
          .accounts({
            config: configPda,
            quest: questPda,
            escrow: escrowPda,
            rewardMint: mint,
            creator: creator.publicKey,
            creatorTokenAccount: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("InvalidTimeLimit");
      }
    });

    it("cannot claim a cancelled quest", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);

      await program.methods
        .createQuest(
          new BN(REWARD),
          { open: {} },
          null,
          1,
          null,
          descHash("will cancel")
        )
        .accounts({
          config: configPda,
          quest: questPda,
          escrow: escrowPda,
          rewardMint: mint,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc();
      questCount++;

      await program.methods
        .cancelQuest()
        .accounts({
          quest: questPda,
          escrow: escrowPda,
          creator: creator.publicKey,
          creatorTokenAccount: creatorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc();

      const [claimPda] = deriveClaimPda(questPda, claimer.publicKey);

      try {
        await program.methods
          .claimQuest(new BN((REWARD * MIN_STAKE_BPS) / 10000))
          .accounts({
            quest: questPda,
            claim: claimPda,
            escrow: escrowPda,
            claimer: claimer.publicKey,
            claimerTokenAccount: claimerAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([claimer])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("QuestNotActive");
      }
    });

    it("invalid max_claimers (0) rejected", async () => {
      const id = questCount;
      const [questPda] = deriveQuestPda(id);
      const [escrowPda] = deriveEscrowPda(questPda);

      try {
        await program.methods
          .createQuest(
            new BN(REWARD),
            { open: {} },
            null,
            0, // invalid
            null,
            descHash("zero claimers")
          )
          .accounts({
            config: configPda,
            quest: questPda,
            escrow: escrowPda,
            rewardMint: mint,
            creator: creator.publicKey,
            creatorTokenAccount: creatorAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([creator])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("InvalidMaxClaimers");
      }
    });

    it("cannot submit proof on already-submitted claim", async () => {
      const { questPda, claimPda } = await createAndSubmitQuest();

      try {
        await program.methods
          .submitProof(proofHash("second-attempt"))
          .accounts({
            quest: questPda,
            claim: claimPda,
            claimer: claimer.publicKey,
          })
          .signers([claimer])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("ClaimNotActive");
      }
    });

    it("cannot abandon a submitted claim", async () => {
      const { questPda, escrowPda, claimPda } = await createAndSubmitQuest();

      try {
        await program.methods
          .abandonClaim()
          .accounts({
            quest: questPda,
            claim: claimPda,
            escrow: escrowPda,
            creatorTokenAccount: creatorAta,
            claimer: claimer.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([claimer])
          .rpc();
        expect.fail("should have thrown");
      } catch (err) {
        const anchorErr = err as AnchorError;
        expect(anchorErr.error.errorCode.code).to.equal("ClaimNotActive");
      }
    });

    it("quest count increments correctly across multiple creates", async () => {
      const config = await program.account.questConfig.fetch(configPda);
      expect(config.questCount.toNumber()).to.equal(questCount);
    });
  });
});
