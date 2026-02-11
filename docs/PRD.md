# QUEST — Product Requirements Document

**Version:** 0.1.0  
**Last Updated:** February 2025  
**Status:** Draft  

---

## Executive Summary

QUEST is a social challenge protocol on Solana that turns everyday dares into staked missions. Users post quests with token rewards, others claim and complete them on video, AI verifies completion, and winners collect the loot.

**Core Loop:** Post → Claim → Prove → Collect

**Token:** $QUEST (SPL token on Solana)

---

## Problem Statement

People have always made informal challenges with friends:
- "I'll give you $20 if you ask for their number"
- "Bet you can't eat that whole thing"
- "$50 says you won't jump in"

This universal behavior has never been productized because stakes are verbal, proof is "trust me," and settlement is awkward.

**Now possible because:**
- Crypto enables instant, trustless escrow
- AI can verify video completion
- Everyone already films everything
- Gaming language ("side quest") is mainstream

---

## User Personas

### Quest Giver — "The Instigator"
Wants to make things interesting, has crypto to stake, enjoys chaos

### Quest Taker — "The Performer"
Motivated by rewards and recognition, already posts content, competitive

### Verifier — "The Judge"
Earns rewards for accurate verification, builds reputation

---

## Core Flows

### Post Quest
1. Enter challenge description (280 char max)
2. Set reward amount ($QUEST, SOL, USDC)
3. Choose type: Direct / Open / Guild
4. Set optional time limit, min level
5. Confirm → funds locked in escrow

### Claim Quest
1. Browse open quests or receive direct quest
2. View details (challenge, reward, time)
3. Tap "Claim" → quest locked to you
4. Optional: stake matching amount for bonus XP

### Complete Quest
1. Record video proof (15-60 seconds)
2. AI generates caption + highlight clip
3. Submit for verification

### Verification Tiers
```
Tier 1: AI (instant) — auto-approve >85%, auto-reject <15%
Tier 2: Quest Giver (24h) — one-tap approve/reject
Tier 3: Community Vote (48h) — majority decides
Tier 4: Arbitration — protocol team final decision
```

### Settlement
- Complete → reward released, 2.5% fee (50% burn, 50% treasury)
- Failed → funds returned to giver, taker stake forfeited

---

## Quest Types

| Type | Description |
|------|-------------|
| **Direct** | Posted to specific user, only they can claim |
| **Open** | Anyone can claim, first N claimers get slots |
| **Guild** | Multiple contributors pool rewards |
| **Chain** | Must pass on after completion (exponential growth) |

---

## Token Mechanics

**$QUEST Utility:**
- Quest rewards (primary currency)
- 1.5x XP multiplier for native payments
- Quest boost (visibility)
- Verification rewards
- Loot drops for viral clips

**Fees:**
- 2.5% on completed quests
- 50% burned / 50% treasury
- 0% on $QUEST quests during launch

**XP & Levels:**

| Level | XP | Unlocks |
|-------|-----|---------|
| 1 | 0 | Basic quests |
| 5 | 500 | Community voting |
| 10 | 2,000 | Custom templates |
| 50 | 50,000 | Judge status |

---

## Technical Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Web App   │  │  iOS App    │  │ Android App │
│  (Next.js)  │  │ (RN/Expo)   │  │ (RN/Expo)   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       └────────────────┼────────────────┘
                        ▼
              ┌─────────────────┐
              │   API Gateway   │
              │  (CF Workers)   │
              └────────┬────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│    Auth     │ │   Quest     │ │   Media     │
│  (Privy)    │ │  Service    │ │  Service    │
└─────────────┘ └──────┬──────┘ └──────┬──────┘
                       ▼               ▼
              ┌─────────────┐  ┌─────────────┐
              │   Solana    │  │   Storage   │
              │  (Anchor)   │  │(Arweave/R2) │
              └─────────────┘  └─────────────┘
```

**Stack:**
- Frontend: Next.js 14, React Native, TailwindCSS
- Auth: Privy
- API: Cloudflare Workers, Hono
- DB: Turso (SQLite edge), Redis
- Chain: Solana, Anchor
- Storage: Arweave (permanent), R2 (CDN)
- AI: GPT-4V (verification), Whisper (captions)

---

## Data Models

### User
```typescript
interface User {
  id: string;
  pubkey: string;
  username: string;
  xp: number;
  level: number;
  quests_completed: number;
  quests_posted: number;
  verification_score: number;
}
```

### Quest
```typescript
interface Quest {
  id: string;
  onchain_id: string;
  creator_id: string;
  description: string;
  quest_type: 'direct' | 'open' | 'guild' | 'chain';
  status: QuestStatus;
  reward_amount: number;
  reward_token: 'QUEST' | 'SOL' | 'USDC';
  escrow_address: string;
}

type QuestStatus = 
  | 'active'
  | 'claimed'
  | 'submitted'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';
```

### Claim
```typescript
interface Claim {
  id: string;
  quest_id: string;
  claimer_id: string;
  status: ClaimStatus;
  stake_amount: number | null;
}

type ClaimStatus =
  | 'active'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'expired';
```

### Proof
```typescript
interface Proof {
  id: string;
  claim_id: string;
  video_url: string;
  video_hash: string;
  ai_score: number | null;
  verification_tier: 1 | 2 | 3 | 4;
}
```

---

## Smart Contract (Anchor)

### Accounts
```rust
#[account]
pub struct QuestConfig {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub fee_basis_points: u16,    // 250 = 2.5%
    pub burn_basis_points: u16,   // 5000 = 50% of fee
    pub quest_count: u64,
    pub bump: u8,
}

#[account]
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
    pub time_limit: Option<i64>,
    pub bump: u8,
}

#[account]
pub struct Claim {
    pub quest: Pubkey,
    pub claimer: Pubkey,
    pub stake_amount: u64,
    pub status: ClaimStatus,
    pub bump: u8,
}
```

### Instructions
```rust
pub fn initialize(ctx, fee_bps, burn_bps) -> Result<()>
pub fn create_quest(ctx, reward_amount, quest_type, target, time_limit) -> Result<()>
pub fn claim_quest(ctx, stake_amount) -> Result<()>
pub fn submit_proof(ctx, proof_hash) -> Result<()>
pub fn approve_completion(ctx) -> Result<()>
pub fn reject_completion(ctx) -> Result<()>
pub fn cancel_quest(ctx) -> Result<()>
pub fn expire_quest(ctx) -> Result<()>
```

### Events
```rust
#[event]
pub struct QuestCreated { quest_id, creator, reward_amount, quest_type }

#[event]
pub struct QuestClaimed { quest_id, claimer, stake_amount }

#[event]
pub struct QuestCompleted { quest_id, claimer, reward_amount, fee_amount }

#[event]
pub struct QuestFailed { quest_id, claimer, reason }
```

---

## API Endpoints

### Quests
```
POST   /api/quests              Create quest
GET    /api/quests              List quests (filters: type, status, creator)
GET    /api/quests/:id          Get quest details
DELETE /api/quests/:id          Cancel quest (creator only, before claimed)
POST   /api/quests/:id/claim    Claim quest
POST   /api/quests/:id/proof    Submit proof
POST   /api/quests/:id/approve  Approve completion (creator)
POST   /api/quests/:id/reject   Reject completion (creator)
GET    /api/quests/:id/votes    Get community votes
POST   /api/quests/:id/vote     Submit vote
```

### Users
```
GET    /api/users/me            Current user
PATCH  /api/users/me            Update profile
GET    /api/users/:id           Get profile
GET    /api/users/:id/quests    User's quests
GET    /api/users/:id/claims    User's claims
```

### Feed
```
GET    /api/feed                Personalized feed
GET    /api/feed/discover       Trending
GET    /api/feed/following      Following
```

### Media
```
POST   /api/media/upload        Get signed upload URL
POST   /api/media/process       Trigger video processing
```

---

## UI/UX

### Design Principles
1. **Achievement energy** — completion feels like unlocking
2. **One-tap actions** — claim, approve, reject
3. **Video-first** — proof videos are hero content
4. **Progress visible** — XP bar always accessible
5. **Mobile-first** — designed for thumb navigation

### Key Screens
- **Home/Feed** — tabs for For You / Following / Discover
- **Quest Detail** — description, reward, claim button, proof video
- **Post Quest** — multi-step flow with cost preview
- **Record Proof** — camera with quest overlay
- **Profile** — avatar, level, XP bar, quest history

### Visual Identity

| Element | Value |
|---------|-------|
| Primary | #7B5CFF (Electric Purple) |
| Secondary | #0A0A0A (Black), #FFFFFF (White) |
| Accent | #FFD700 (Gold, achievements) |
| Success | #22C55E |
| Error | #EF4444 |
| Typography | Inter (UI), Space Grotesk (Display) |
| Radius | 12px (cards), 8px (buttons) |

### Animations
- Quest complete: confetti + XP tick-up
- Level up: full-screen celebration
- Claim: card flip
- Verification pass: checkmark morph

---

## Success Metrics

**North Star:** Weekly Active Quest Completions

### Primary Metrics

| Metric | Month 1 | Month 3 |
|--------|---------|---------|
| Quests Created | 1,000 | 10,000 |
| Quests Completed | 500 | 6,000 |
| Completion Rate | 40% | 60% |
| DAU | 500 | 5,000 |
| WAU | 2,000 | 15,000 |

### Secondary Metrics
- Verification accuracy: >90% AI matches final outcome
- Time to completion: <24h median
- Viral coefficient: >0.5 shares per completion
- D7 retention: >30%

### Guardrails
- Dispute rate: <5%
- Content flags: <1%
- Failed transactions: <0.1%

---

## Roadmap

### Phase 0: Token (Week 0)
- [ ] Deploy $QUEST on Pump.fun
- [ ] Landing page
- [ ] Twitter/Discord setup

### Phase 1: MVP (Weeks 1-4)
- [ ] Quest program on devnet
- [ ] Web app core loop
- [ ] AI verification (Tier 1-2)
- [ ] Basic profile and feed

### Phase 2: Mobile + Polish (Weeks 5-8)
- [ ] iOS TestFlight
- [ ] Android beta
- [ ] Community voting (Tier 3)
- [ ] XP and levels
- [ ] Push notifications

### Phase 3: Growth (Weeks 9-12)
- [ ] Chain Quests
- [ ] Guild Quests
- [ ] Loot drops
- [ ] Creator partnerships
- [ ] Leaderboards

### Phase 4: Scale (Months 4-6)
- [ ] Governance
- [ ] API for integrations
- [ ] Brand quests
- [ ] International expansion

---

## Open Questions

### Product
1. Allow zero-reward quests (just XP)?
2. NSFW quests with age gating?
3. Max chain length for Chain Quests?
4. Quest templates/presets?

### Technical
1. Arweave vs Filecoin for storage?
2. Oracle design for off-chain → on-chain verification?
3. Multi-sig or DAO for treasury?

### Business
1. Brand-sponsored quests?
2. Geographic restrictions?
3. Insurance/reserve fund for disputes?

---

## Appendix: Prohibited Categories

1. Illegal activities
2. Harm to self/others
3. Involving minors
4. Non-consensual acts
5. Animal cruelty
6. Property destruction
7. Hate speech
8. Sexual content
9. Doxxing/privacy violations
10. Financial fraud

---

## Appendix: AI Verification Prompt

```
You are a quest verification AI. Given a quest description and video, determine completion.

Quest: {description}
Video: {video_frames}

Respond with:
1. Confidence score (0-100)
2. Reasoning (2-3 sentences)
3. Decision: APPROVE, REJECT, or UNCERTAIN

Be strict but fair.
```

---

## Appendix: XP Formula

```
base_xp = 100
reward_bonus = reward_value_usd * 10
streak_multiplier = 1 + (streak_days * 0.1)  // max 2x
token_multiplier = 1.5 if paid_in_quest else 1

total_xp = (base_xp + reward_bonus) * streak_multiplier * token_multiplier
```

---

*Last reviewed February 2025*
