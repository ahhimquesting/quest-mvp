use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("QUESTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

#[program]
pub mod quest {
    use super::*;

    /// Initialize the protocol configuration
    pub fn initialize(
        ctx: Context<Initialize>,
        fee_basis_points: u16,
        burn_basis_points: u16,
    ) -> Result<()> {
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

    /// Create a new quest with staked rewards
    pub fn create_quest(
        ctx: Context<CreateQuest>,
        reward_amount: u64,
        quest_type: QuestType,
        target: Option<Pubkey>,
        max_claimers: u8,
        time_limit: Option<i64>,
        description_hash: [u8; 32],
    ) -> Result<()> {
        require!(reward_amount > 0, QuestError::InvalidRewardAmount);
        require!(max_claimers > 0 && max_claimers <= 100, QuestError::InvalidMaxClaimers);
        
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
        quest.description_hash = description_hash;
        quest.created_at = Clock::get()?.unix_timestamp;
        quest.bump = ctx.bumps.quest;
        
        config.quest_count += 1;
        
        // Transfer reward to escrow
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

    /// Claim a quest
    pub fn claim_quest(
        ctx: Context<ClaimQuest>,
        stake_amount: u64,
    ) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        let claim = &mut ctx.accounts.claim;
        
        require!(quest.status == QuestStatus::Active, QuestError::QuestNotActive);
        require!(quest.current_claimers < quest.max_claimers, QuestError::QuestFull);
        
        // Check if direct quest targets this claimer
        if quest.quest_type == QuestType::Direct {
            require!(
                quest.target == Some(ctx.accounts.claimer.key()),
                QuestError::NotTargetUser
            );
        }
        
        // Check time limit
        if let Some(limit) = quest.time_limit {
            require!(
                Clock::get()?.unix_timestamp < limit,
                QuestError::QuestExpired
            );
        }
        
        claim.quest = quest.key();
        claim.claimer = ctx.accounts.claimer.key();
        claim.stake_amount = stake_amount;
        claim.status = ClaimStatus::Active;
        claim.claimed_at = Clock::get()?.unix_timestamp;
        claim.bump = ctx.bumps.claim;
        
        quest.current_claimers += 1;
        if quest.current_claimers >= quest.max_claimers {
            quest.status = QuestStatus::Claimed;
        }
        
        // Transfer stake if any
        if stake_amount > 0 {
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
        }
        
        emit!(QuestClaimed {
            quest_id: quest.id,
            claimer: claim.claimer,
            stake_amount,
        });
        
        Ok(())
    }

    /// Submit proof hash (actual verification happens off-chain)
    pub fn submit_proof(
        ctx: Context<SubmitProof>,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        let claim = &mut ctx.accounts.claim;
        
        require!(claim.status == ClaimStatus::Active, QuestError::ClaimNotActive);
        require!(claim.claimer == ctx.accounts.claimer.key(), QuestError::NotClaimer);
        
        claim.proof_hash = Some(proof_hash);
        claim.status = ClaimStatus::Submitted;
        claim.submitted_at = Some(Clock::get()?.unix_timestamp);
        
        emit!(ProofSubmitted {
            quest_id: ctx.accounts.quest.id,
            claimer: claim.claimer,
            proof_hash,
        });
        
        Ok(())
    }

    /// Approve quest completion (creator or oracle)
    pub fn approve_completion(ctx: Context<ApproveCompletion>) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        let claim = &mut ctx.accounts.claim;
        let config = &ctx.accounts.config;
        
        require!(claim.status == ClaimStatus::Submitted, QuestError::ClaimNotSubmitted);
        
        // Only creator or oracle can approve
        require!(
            ctx.accounts.approver.key() == quest.creator || 
            ctx.accounts.approver.key() == config.authority,
            QuestError::NotAuthorized
        );
        
        // Calculate fee
        let fee_amount = quest.reward_amount
            .checked_mul(config.fee_basis_points as u64)
            .unwrap()
            .checked_div(10000)
            .unwrap();
        let reward_after_fee = quest.reward_amount.checked_sub(fee_amount).unwrap();
        
        // Transfer reward to claimer
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
                    to: ctx.accounts.claimer_token_account.to_account_info(),
                    authority: quest.to_account_info(),
                },
                signer_seeds,
            ),
            reward_after_fee + claim.stake_amount,
        )?;
        
        // Transfer fee to treasury
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

    /// Reject quest completion
    pub fn reject_completion(ctx: Context<RejectCompletion>) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        let claim = &mut ctx.accounts.claim;
        let config = &ctx.accounts.config;
        
        require!(claim.status == ClaimStatus::Submitted, QuestError::ClaimNotSubmitted);
        
        require!(
            ctx.accounts.rejector.key() == quest.creator || 
            ctx.accounts.rejector.key() == config.authority,
            QuestError::NotAuthorized
        );
        
        // Return reward to creator, forfeit claimer stake
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
            quest.reward_amount + claim.stake_amount,
        )?;
        
        claim.status = ClaimStatus::Rejected;
        quest.status = QuestStatus::Failed;
        
        emit!(QuestFailed {
            quest_id: quest.id,
            claimer: claim.claimer,
            reason: FailReason::Rejected,
        });
        
        Ok(())
    }

    /// Cancel quest (creator only, before claimed)
    pub fn cancel_quest(ctx: Context<CancelQuest>) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        
        require!(quest.status == QuestStatus::Active, QuestError::QuestNotActive);
        require!(quest.current_claimers == 0, QuestError::QuestAlreadyClaimed);
        require!(quest.creator == ctx.accounts.creator.key(), QuestError::NotCreator);
        
        // Return funds to creator
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
    
    pub approver: Signer<'info>,
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
    
    pub rejector: Signer<'info>,
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
    Guild,
    Chain,
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
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum FailReason {
    Rejected,
    Expired,
    Forfeited,
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

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum QuestError {
    #[msg("Invalid reward amount")]
    InvalidRewardAmount,
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
    #[msg("Not authorized")]
    NotAuthorized,
    #[msg("Not the creator")]
    NotCreator,
    #[msg("Quest already claimed")]
    QuestAlreadyClaimed,
}
