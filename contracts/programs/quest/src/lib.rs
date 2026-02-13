use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("QUESTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

const MIN_REWARD: u64 = 1_000_000; // 1 token (assuming 6 decimals)
const MIN_STAKE_BPS: u64 = 500; // 5% = 500 basis points
const DEFAULT_PROOF_DEADLINE_HOURS: u8 = 24;
const DEFAULT_REVIEW_DEADLINE_HOURS: u8 = 24;
const SECONDS_PER_HOUR: i64 = 3600;

#[program]
pub mod quest {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        fee_basis_points: u16,
        burn_basis_points: u16,
    ) -> Result<()> {
        require!(fee_basis_points <= 10000, QuestError::InvalidFeeConfig);
        require!(burn_basis_points <= 10000, QuestError::InvalidFeeConfig);

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.treasury = ctx.accounts.treasury.key();
        config.fee_basis_points = fee_basis_points;
        config.burn_basis_points = burn_basis_points;
        config.quest_count = 0;
        config.bump = ctx.bumps.config;

        emit!(ProtocolInitialized {
            authority: config.authority,
            treasury: config.treasury,
            fee_basis_points,
        });

        Ok(())
    }

    pub fn create_quest(
        ctx: Context<CreateQuest>,
        reward_amount: u64,
        quest_type: QuestType,
        target: Option<Pubkey>,
        max_claimers: u8,
        time_limit: Option<i64>,
        description_hash: [u8; 32],
    ) -> Result<()> {
        require!(reward_amount >= MIN_REWARD, QuestError::RewardTooLow);
        require!(max_claimers > 0 && max_claimers <= 100, QuestError::InvalidMaxClaimers);

        if quest_type == QuestType::Direct {
            let t = target.ok_or(QuestError::DirectQuestNeedsTarget)?;
            require!(t != ctx.accounts.creator.key(), QuestError::CannotTargetSelf);
        }

        if let Some(limit) = time_limit {
            require!(
                limit > Clock::get()?.unix_timestamp,
                QuestError::InvalidTimeLimit
            );
        }

        let config = &mut ctx.accounts.config;
        let quest = &mut ctx.accounts.quest;

        quest.id = config.quest_count;
        quest.creator = ctx.accounts.creator.key();
        quest.escrow = ctx.accounts.escrow.key();
        quest.reward_mint = ctx.accounts.reward_mint.key();
        quest.reward_amount = reward_amount;
        quest.quest_type = quest_type;
        quest.status = QuestStatus::Active;
        quest.target = target;
        quest.max_claimers = max_claimers;
        quest.current_claimers = 0;
        quest.time_limit = time_limit;
        quest.proof_deadline_hours = DEFAULT_PROOF_DEADLINE_HOURS;
        quest.review_deadline_hours = DEFAULT_REVIEW_DEADLINE_HOURS;
        quest.description_hash = description_hash;
        quest.created_at = Clock::get()?.unix_timestamp;
        quest.bump = ctx.bumps.quest;

        config.quest_count = config.quest_count
            .checked_add(1)
            .ok_or(QuestError::Overflow)?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            reward_amount,
        )?;

        emit!(QuestCreated {
            quest_id: quest.id,
            creator: quest.creator,
            reward_amount,
            reward_mint: quest.reward_mint,
            quest_type,
        });

        Ok(())
    }

    pub fn claim_quest(
        ctx: Context<ClaimQuest>,
        stake_amount: u64,
    ) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        let claim = &mut ctx.accounts.claim;
        let now = Clock::get()?.unix_timestamp;

        require!(quest.status == QuestStatus::Active, QuestError::QuestNotActive);
        require!(quest.current_claimers < quest.max_claimers, QuestError::QuestFull);

        require!(
            quest.creator != ctx.accounts.claimer.key(),
            QuestError::CannotClaimOwnQuest
        );

        if quest.quest_type == QuestType::Direct {
            require!(
                quest.target == Some(ctx.accounts.claimer.key()),
                QuestError::NotTargetUser
            );
        }

        if let Some(limit) = quest.time_limit {
            require!(now < limit, QuestError::QuestExpired);
        }

        let min_stake = quest.reward_amount
            .checked_mul(MIN_STAKE_BPS)
            .ok_or(QuestError::Overflow)?
            .checked_div(10000)
            .ok_or(QuestError::Overflow)?;
        require!(stake_amount >= min_stake, QuestError::StakeTooLow);

        claim.quest = quest.key();
        claim.claimer = ctx.accounts.claimer.key();
        claim.stake_amount = stake_amount;
        claim.status = ClaimStatus::Active;
        claim.proof_deadline = now
            .checked_add(
                (quest.proof_deadline_hours as i64)
                    .checked_mul(SECONDS_PER_HOUR)
                    .ok_or(QuestError::Overflow)?
            )
            .ok_or(QuestError::Overflow)?;
        claim.review_deadline = None;
        claim.proof_hash = None;
        claim.claimed_at = now;
        claim.submitted_at = None;
        claim.bump = ctx.bumps.claim;

        quest.current_claimers = quest.current_claimers
            .checked_add(1)
            .ok_or(QuestError::Overflow)?;
        if quest.current_claimers >= quest.max_claimers {
            quest.status = QuestStatus::Claimed;
        }

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.claimer_token_account.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.claimer.to_account_info(),
                },
            ),
            stake_amount,
        )?;

        emit!(QuestClaimed {
            quest_id: quest.id,
            claimer: claim.claimer,
            stake_amount,
        });

        Ok(())
    }

    pub fn submit_proof(
        ctx: Context<SubmitProof>,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        let quest = &ctx.accounts.quest;
        let claim = &mut ctx.accounts.claim;
        let now = Clock::get()?.unix_timestamp;

        require!(claim.status == ClaimStatus::Active, QuestError::ClaimNotActive);
        require!(claim.claimer == ctx.accounts.claimer.key(), QuestError::NotClaimer);
        require!(now <= claim.proof_deadline, QuestError::ProofDeadlinePassed);

        claim.proof_hash = Some(proof_hash);
        claim.status = ClaimStatus::Submitted;
        claim.submitted_at = Some(now);
        claim.review_deadline = Some(
            now.checked_add(
                (quest.review_deadline_hours as i64)
                    .checked_mul(SECONDS_PER_HOUR)
                    .ok_or(QuestError::Overflow)?
            )
            .ok_or(QuestError::Overflow)?
        );

        emit!(ProofSubmitted {
            quest_id: quest.id,
            claimer: claim.claimer,
            proof_hash,
        });

        Ok(())
    }

    /// Oracle-only: approve after AI or creator verification
    pub fn approve_completion(ctx: Context<ApproveCompletion>) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        let claim = &mut ctx.accounts.claim;
        let config = &ctx.accounts.config;

        require!(claim.status == ClaimStatus::Submitted, QuestError::ClaimNotSubmitted);
        require!(
            ctx.accounts.authority.key() == config.authority,
            QuestError::NotOracle
        );

        let fee_amount = quest.reward_amount
            .checked_mul(config.fee_basis_points as u64)
            .ok_or(QuestError::Overflow)?
            .checked_div(10000)
            .ok_or(QuestError::Overflow)?;
        let reward_after_fee = quest.reward_amount
            .checked_sub(fee_amount)
            .ok_or(QuestError::Overflow)?;

        let quest_seeds = &[
            b"quest",
            &quest.id.to_le_bytes(),
            &[quest.bump],
        ];
        let signer_seeds = &[&quest_seeds[..]];

        let claimer_payout = reward_after_fee
            .checked_add(claim.stake_amount)
            .ok_or(QuestError::Overflow)?;

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.claimer_token_account.to_account_info(),
                    authority: quest.to_account_info(),
                },
                signer_seeds,
            ),
            claimer_payout,
        )?;

        if fee_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                        authority: quest.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee_amount,
            )?;
        }

        claim.status = ClaimStatus::Approved;
        quest.status = QuestStatus::Completed;

        emit!(QuestCompleted {
            quest_id: quest.id,
            claimer: claim.claimer,
            reward_amount: reward_after_fee,
            fee_amount,
        });

        Ok(())
    }

    /// Oracle-only: reject completion
    /// safety_flagged: if true, return stake to claimer (content issue, not their fault)
    pub fn reject_completion(
        ctx: Context<RejectCompletion>,
        safety_flagged: bool,
    ) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        let claim = &mut ctx.accounts.claim;
        let config = &ctx.accounts.config;

        require!(claim.status == ClaimStatus::Submitted, QuestError::ClaimNotSubmitted);
        require!(
            ctx.accounts.authority.key() == config.authority,
            QuestError::NotOracle
        );

        let quest_seeds = &[
            b"quest",
            &quest.id.to_le_bytes(),
            &[quest.bump],
        ];
        let signer_seeds = &[&quest_seeds[..]];

        if safety_flagged {
            // Safety rejection: reward back to creator, stake back to claimer
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.creator_token_account.to_account_info(),
                        authority: quest.to_account_info(),
                    },
                    signer_seeds,
                ),
                quest.reward_amount,
            )?;

            if claim.stake_amount > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.escrow.to_account_info(),
                            to: ctx.accounts.claimer_token_account.to_account_info(),
                            authority: quest.to_account_info(),
                        },
                        signer_seeds,
                    ),
                    claim.stake_amount,
                )?;
            }
        } else {
            // Normal rejection: reward + stake go to creator
            let creator_payout = quest.reward_amount
                .checked_add(claim.stake_amount)
                .ok_or(QuestError::Overflow)?;

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.creator_token_account.to_account_info(),
                        authority: quest.to_account_info(),
                    },
                    signer_seeds,
                ),
                creator_payout,
            )?;
        }

        claim.status = ClaimStatus::Rejected;
        quest.status = QuestStatus::Failed;

        emit!(QuestFailed {
            quest_id: quest.id,
            claimer: claim.claimer,
            reason: FailReason::Rejected,
        });

        Ok(())
    }

    /// Claimer voluntarily abandons — forfeits stake to creator
    pub fn abandon_claim(ctx: Context<AbandonClaim>) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        let claim = &mut ctx.accounts.claim;

        require!(claim.status == ClaimStatus::Active, QuestError::ClaimNotActive);
        require!(claim.claimer == ctx.accounts.claimer.key(), QuestError::NotClaimer);

        let quest_seeds = &[
            b"quest",
            &quest.id.to_le_bytes(),
            &[quest.bump],
        ];
        let signer_seeds = &[&quest_seeds[..]];

        if claim.stake_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.creator_token_account.to_account_info(),
                        authority: quest.to_account_info(),
                    },
                    signer_seeds,
                ),
                claim.stake_amount,
            )?;
        }

        claim.status = ClaimStatus::Abandoned;
        quest.current_claimers = quest.current_claimers.saturating_sub(1);
        if quest.status == QuestStatus::Claimed {
            quest.status = QuestStatus::Active;
        }

        emit!(ClaimAbandoned {
            quest_id: quest.id,
            claimer: claim.claimer,
        });

        Ok(())
    }

    /// Permissionless crank: expire claim after proof deadline
    pub fn expire_claim(ctx: Context<ExpireClaim>) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        let claim = &mut ctx.accounts.claim;
        let now = Clock::get()?.unix_timestamp;

        require!(claim.status == ClaimStatus::Active, QuestError::ClaimNotActive);
        require!(now > claim.proof_deadline, QuestError::DeadlineNotReached);

        let quest_seeds = &[
            b"quest",
            &quest.id.to_le_bytes(),
            &[quest.bump],
        ];
        let signer_seeds = &[&quest_seeds[..]];

        if claim.stake_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.creator_token_account.to_account_info(),
                        authority: quest.to_account_info(),
                    },
                    signer_seeds,
                ),
                claim.stake_amount,
            )?;
        }

        claim.status = ClaimStatus::Expired;
        quest.current_claimers = quest.current_claimers.saturating_sub(1);
        if quest.status == QuestStatus::Claimed {
            quest.status = QuestStatus::Active;
        }

        emit!(ClaimExpired {
            quest_id: quest.id,
            claimer: claim.claimer,
        });

        Ok(())
    }

    /// Permissionless crank: auto-approve after review deadline (creator didn't respond)
    pub fn auto_approve(ctx: Context<AutoApprove>) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        let claim = &mut ctx.accounts.claim;
        let config = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;

        require!(claim.status == ClaimStatus::Submitted, QuestError::ClaimNotSubmitted);
        let review_deadline = claim.review_deadline.ok_or(QuestError::NoReviewDeadline)?;
        require!(now > review_deadline, QuestError::DeadlineNotReached);

        let fee_amount = quest.reward_amount
            .checked_mul(config.fee_basis_points as u64)
            .ok_or(QuestError::Overflow)?
            .checked_div(10000)
            .ok_or(QuestError::Overflow)?;
        let reward_after_fee = quest.reward_amount
            .checked_sub(fee_amount)
            .ok_or(QuestError::Overflow)?;

        let quest_seeds = &[
            b"quest",
            &quest.id.to_le_bytes(),
            &[quest.bump],
        ];
        let signer_seeds = &[&quest_seeds[..]];

        let claimer_payout = reward_after_fee
            .checked_add(claim.stake_amount)
            .ok_or(QuestError::Overflow)?;

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.claimer_token_account.to_account_info(),
                    authority: quest.to_account_info(),
                },
                signer_seeds,
            ),
            claimer_payout,
        )?;

        if fee_amount > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                        authority: quest.to_account_info(),
                    },
                    signer_seeds,
                ),
                fee_amount,
            )?;
        }

        claim.status = ClaimStatus::Approved;
        quest.status = QuestStatus::Completed;

        emit!(QuestCompleted {
            quest_id: quest.id,
            claimer: claim.claimer,
            reward_amount: reward_after_fee,
            fee_amount,
        });

        Ok(())
    }

    pub fn cancel_quest(ctx: Context<CancelQuest>) -> Result<()> {
        let quest = &mut ctx.accounts.quest;

        require!(quest.status == QuestStatus::Active, QuestError::QuestNotActive);
        require!(quest.current_claimers == 0, QuestError::QuestAlreadyClaimed);
        require!(quest.creator == ctx.accounts.creator.key(), QuestError::NotCreator);

        let quest_seeds = &[
            b"quest",
            &quest.id.to_le_bytes(),
            &[quest.bump],
        ];
        let signer_seeds = &[&quest_seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: quest.to_account_info(),
                },
                signer_seeds,
            ),
            quest.reward_amount,
        )?;

        quest.status = QuestStatus::Cancelled;

        emit!(QuestCancelled {
            quest_id: quest.id,
            creator: quest.creator,
        });

        Ok(())
    }
}

// ============================================================================
// ACCOUNTS
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + QuestConfig::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, QuestConfig>,

    /// CHECK: Treasury account for fees
    pub treasury: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateQuest<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, QuestConfig>,

    #[account(
        init,
        payer = creator,
        space = 8 + Quest::INIT_SPACE,
        seeds = [b"quest", &config.quest_count.to_le_bytes()],
        bump
    )]
    pub quest: Account<'info, Quest>,

    #[account(
        init,
        payer = creator,
        token::mint = reward_mint,
        token::authority = quest,
        seeds = [b"escrow", quest.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, TokenAccount>,

    pub reward_mint: Account<'info, token::Mint>,

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, constraint = creator_token_account.owner == creator.key())]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimQuest<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(
        init,
        payer = claimer,
        space = 8 + Claim::INIT_SPACE,
        seeds = [b"claim", quest.key().as_ref(), claimer.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, Claim>,

    #[account(mut, seeds = [b"escrow", quest.key().as_ref()], bump)]
    pub escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub claimer: Signer<'info>,

    #[account(mut, constraint = claimer_token_account.owner == claimer.key())]
    pub claimer_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitProof<'info> {
    pub quest: Account<'info, Quest>,

    #[account(
        mut,
        seeds = [b"claim", quest.key().as_ref(), claimer.key().as_ref()],
        bump = claim.bump
    )]
    pub claim: Account<'info, Claim>,

    pub claimer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ApproveCompletion<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, QuestConfig>,

    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(mut)]
    pub claim: Account<'info, Claim>,

    #[account(mut, seeds = [b"escrow", quest.key().as_ref()], bump)]
    pub escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub claimer_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RejectCompletion<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, QuestConfig>,

    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(mut)]
    pub claim: Account<'info, Claim>,

    #[account(mut, seeds = [b"escrow", quest.key().as_ref()], bump)]
    pub escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub claimer_token_account: Account<'info, TokenAccount>,

    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AbandonClaim<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(
        mut,
        seeds = [b"claim", quest.key().as_ref(), claimer.key().as_ref()],
        bump = claim.bump
    )]
    pub claim: Account<'info, Claim>,

    #[account(mut, seeds = [b"escrow", quest.key().as_ref()], bump)]
    pub escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub claimer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ExpireClaim<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(mut)]
    pub claim: Account<'info, Claim>,

    #[account(mut, seeds = [b"escrow", quest.key().as_ref()], bump)]
    pub escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,

    /// CHECK: Anyone can call this (permissionless crank)
    pub cranker: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AutoApprove<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, QuestConfig>,

    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(mut)]
    pub claim: Account<'info, Claim>,

    #[account(mut, seeds = [b"escrow", quest.key().as_ref()], bump)]
    pub escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub claimer_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub treasury: Account<'info, TokenAccount>,

    /// CHECK: Anyone can call this (permissionless crank)
    pub cranker: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelQuest<'info> {
    #[account(mut)]
    pub quest: Account<'info, Quest>,

    #[account(mut, seeds = [b"escrow", quest.key().as_ref()], bump)]
    pub escrow: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, constraint = creator_token_account.owner == creator.key())]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ============================================================================
// STATE
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct QuestConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub fee_basis_points: u16,
    pub burn_basis_points: u16,
    pub quest_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Quest {
    pub id: u64,
    pub creator: Pubkey,
    pub escrow: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_amount: u64,
    pub quest_type: QuestType,
    pub status: QuestStatus,
    pub target: Option<Pubkey>,
    pub max_claimers: u8,
    pub current_claimers: u8,
    pub time_limit: Option<i64>,
    pub proof_deadline_hours: u8,
    pub review_deadline_hours: u8,
    pub description_hash: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Claim {
    pub quest: Pubkey,
    pub claimer: Pubkey,
    pub stake_amount: u64,
    pub status: ClaimStatus,
    pub proof_deadline: i64,
    pub review_deadline: Option<i64>,
    pub proof_hash: Option<[u8; 32]>,
    pub claimed_at: i64,
    pub submitted_at: Option<i64>,
    pub bump: u8,
}

// ============================================================================
// ENUMS
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum QuestType {
    Direct,
    Open,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum QuestStatus {
    Active,
    Claimed,
    Completed,
    Failed,
    Cancelled,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ClaimStatus {
    Active,
    Submitted,
    Approved,
    Rejected,
    Abandoned,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum FailReason {
    Rejected,
    Expired,
    Abandoned,
}

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub fee_basis_points: u16,
}

#[event]
pub struct QuestCreated {
    pub quest_id: u64,
    pub creator: Pubkey,
    pub reward_amount: u64,
    pub reward_mint: Pubkey,
    pub quest_type: QuestType,
}

#[event]
pub struct QuestClaimed {
    pub quest_id: u64,
    pub claimer: Pubkey,
    pub stake_amount: u64,
}

#[event]
pub struct ProofSubmitted {
    pub quest_id: u64,
    pub claimer: Pubkey,
    pub proof_hash: [u8; 32],
}

#[event]
pub struct QuestCompleted {
    pub quest_id: u64,
    pub claimer: Pubkey,
    pub reward_amount: u64,
    pub fee_amount: u64,
}

#[event]
pub struct QuestFailed {
    pub quest_id: u64,
    pub claimer: Pubkey,
    pub reason: FailReason,
}

#[event]
pub struct QuestCancelled {
    pub quest_id: u64,
    pub creator: Pubkey,
}

#[event]
pub struct ClaimAbandoned {
    pub quest_id: u64,
    pub claimer: Pubkey,
}

#[event]
pub struct ClaimExpired {
    pub quest_id: u64,
    pub claimer: Pubkey,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum QuestError {
    #[msg("Reward below minimum")]
    RewardTooLow,
    #[msg("Invalid max claimers")]
    InvalidMaxClaimers,
    #[msg("Quest is not active")]
    QuestNotActive,
    #[msg("Quest is full")]
    QuestFull,
    #[msg("Quest has expired")]
    QuestExpired,
    #[msg("Not the target user for this quest")]
    NotTargetUser,
    #[msg("Claim is not active")]
    ClaimNotActive,
    #[msg("Not the claimer")]
    NotClaimer,
    #[msg("Claim not submitted")]
    ClaimNotSubmitted,
    #[msg("Not authorized (oracle only)")]
    NotOracle,
    #[msg("Not the creator")]
    NotCreator,
    #[msg("Quest already claimed")]
    QuestAlreadyClaimed,
    #[msg("Cannot claim your own quest")]
    CannotClaimOwnQuest,
    #[msg("Stake below minimum (5% of reward)")]
    StakeTooLow,
    #[msg("Direct quest requires a target")]
    DirectQuestNeedsTarget,
    #[msg("Cannot target yourself")]
    CannotTargetSelf,
    #[msg("Proof deadline has passed")]
    ProofDeadlinePassed,
    #[msg("Deadline not yet reached")]
    DeadlineNotReached,
    #[msg("No review deadline set")]
    NoReviewDeadline,
    #[msg("Invalid time limit")]
    InvalidTimeLimit,
    #[msg("Invalid fee configuration")]
    InvalidFeeConfig,
    #[msg("Arithmetic overflow")]
    Overflow,
}
