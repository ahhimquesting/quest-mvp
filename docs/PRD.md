# QUEST — Product Requirements Document

**Version:** 0.2.0
**Last Updated:** February 2026
**Status:** Implementation-ready

---

## Executive Summary

QUEST is a social challenge protocol on Solana. Users post quests with token rewards, others claim and complete them on video, AI verifies completion, winner gets paid.

**Core Loop:** Post → Claim → Prove → Collect

**Token:** $QUEST (`E7Xfasv5CRTNc6Xb16w36BZk3HRSogh8T4ZFimSnpump`)

**MVP Scope:** Direct quests and Open quests only. No Guild, no Chain quests, no XP/levels. Get the core loop working first.

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

---

## Core Flows

### Post Quest
1. Enter challenge description (280 char max)
2. Set reward amount ($QUEST, SOL, or USDC)
3. Choose type: Direct or Open
4. Set optional time limit
5. Confirm → funds locked in escrow
6. Minimum reward: 1 $QUEST (or 0.001 SOL equivalent)
7. Description checked against blocklist + AI moderation before save

### Claim Quest
1. Browse open quests or receive direct quest
2. View details (challenge, reward, time)
3. Tap "Claim" → quest locked to you
4. Claim deposit required: minimum 5% of quest reward (anti-grief)
5. 24h proof deadline starts on claim
6. Cannot claim your own quest

### Complete Quest
1. Record video proof (15-60 seconds)
2. Submit for verification
3. Video uploaded to R2, hash computed and stored on-chain

### Abandon Quest
- Claimer can voluntarily abandon before submitting proof
- Forfeits claim deposit to quest creator
- Opens slot for other claimers

---

## Verification Pipeline

This is the product. The entire value prop depends on AI verification working.

### Frame Extraction
- Extract 1 frame per second (max 60 frames for 60s video)
- Extract audio track separately

### Audio Processing
- Run Whisper transcription on audio
- Include transcript in verification context (handles "say X" or "sing Y" quests)

### Vision Analysis
- Send frames + transcript + quest description to gpt5-mini
- Structured output:
```json
{
  "confidence": 0-100,
  "decision": "APPROVE" | "REJECT" | "UNCERTAIN",
  "reasoning": "string",
  "detected_actions": ["string"],
  "matches_description": true/false,
  "safety_flags": ["string"]
}
```

### Thresholds
- confidence >= 80 AND no safety_flags → auto-approve
- confidence <= 20 OR safety_flags present → auto-reject
- everything else → escalate to creator review

### Creator Review
- Creator has 24h to approve or reject
- If creator doesn't respond within 24h → auto-approve (permissionless crank)
- Creator approval/rejection goes through API → oracle calls contract

### Fallbacks
- OpenAI timeout (30s) → retry once, then escalate to creator
- OpenAI down → queue for retry, notify user of delay
- Cost tracking per verification (~$0.02-0.05 per video)

### Content Moderation
- Safety flags from gpt5-mini response
- Blocklist check on quest descriptions before creation
- If video flagged → reject + flag account for review
- 3 strikes = account banned

---

## On-chain / Off-chain Boundary

### On-chain (Anchor program)
- Quest creation + escrow lock
- Claim registration
- Proof hash submission (sha256 only, not the video)
- Settlement (approve/reject with fund transfer)
- Timeout enforcement via permissionless crank

### Off-chain (API / Workers)
- Video upload + storage
- AI verification pipeline
- Creator notification
- Calling contract instructions based on verification result

### Who Signs What
- **User signs:** create_quest, claim_quest, cancel_quest, abandon_claim
- **Backend oracle wallet signs:** approve_completion, reject_completion (after AI or creator decision)
- **Anyone can call (permissionless):** expire_claim, auto_approve (after timeout)

### Oracle Design (MVP)
- Single backend wallet, pubkey stored in QuestConfig.authority
- Backend receives webhook when AI completes verification
- Backend calls approve/reject based on result
- If creator review needed → backend waits for creator input via API, then calls contract
- Private key in environment variable (later: KMS, then multi-sig/decentralized oracle)

---

## Timeout Logic

All enforced in the contract:

```
Quest level:
  time_limit: Option<i64>     — deadline for any claim to complete

Claim level:
  proof_deadline: i64          — must submit proof within 24h of claim
  review_deadline: Option<i64> — set when proof submitted, creator has 24h

Permissionless cranks:
  expire_claim()  — anyone calls after proof_deadline passes
  auto_approve()  — anyone calls after review_deadline (no response = approve)
```

---

## Quest Types (MVP)

| Type | Description |
|------|-------------|
| **Direct** | Posted to specific user, only they can claim |
| **Open** | Anyone can claim, first N claimers get slots |

**Not in MVP:** Guild quests, Chain quests

---

## Token & Fees

**$QUEST** (`E7Xfasv5CRTNc6Xb16w36BZk3HRSogh8T4ZFimSnpump`)

**Fee:** 2.5% on successful quest completion
- 50% burned (Solana token program burn instruction, not dead wallet)
- 50% to treasury (multisig, later DAO)

**No special treatment for $QUEST payments.** Same fee regardless of token.

**Supported tokens:** $QUEST, SOL, USDC

---

## Anti-Abuse

### Quest Creation
- Minimum reward: 1 $QUEST (or 0.001 SOL equivalent)
- Rate limit: max 10 quests per wallet per day
- Description blocklist + AI moderation before save

### Claiming
- Rate limit: max 5 active claims per wallet
- Can't claim if 2+ expired/abandoned claims in last 7 days
- Claim deposit required (min 5% of reward)
- Cannot claim own quest

### Claim Deposit
- Required on claim, minimum 5% of quest reward
- Complete successfully → get deposit back
- Abandon or fail → deposit goes to quest creator
- Rejection due to AI safety flag → deposit returned to claimer

### Verification Gaming
- Track approval rate per creator — flag if >95% (self-dealing)
- Track claim success rate per user — flag if suspiciously high with same creators
- Manual review queue for flagged accounts

### Content
- Quest description: blocklist + AI moderation before save
- Video: gpt5-mini safety_flags in verification response
- Flagged content: reject + queue account for manual review
- 3 strikes = account banned

---

## Storage

**R2 for everything. Arweave is too expensive for MVP.**

### Flow
1. User uploads video → Cloudflare R2
2. Video processed, thumbnail generated, stored in R2
3. Hash computed and stored on-chain
4. Quest completes successfully → keep in R2 for 90 days
5. Quest fails/rejected → delete after 7 days
6. Optional: user can pay to archive to Arweave (later feature)

### Costs
- R2: ~$0.015/GB/month storage + $0.36/million reads
- 30MB video × 10k/month = 300GB = ~$4.50/month
- vs Arweave: $1,500-3,000/month

---

## Auth

### Privy + Solana
1. User logs in via Privy (email, google, twitter, or wallet)
2. Privy creates/loads embedded wallet OR connects external wallet
3. Privy JWT contains wallet pubkey claim
4. API validates JWT, extracts pubkey
5. For contract interactions:
   - Embedded wallet: API can request Privy to sign
   - External wallet: frontend prompts user to sign, sends signed tx to API to relay

### API Auth
```
Authorization: Bearer <privy-jwt>

JWT payload includes:
- sub: privy user id
- wallet: { address: "ABC123..." }
```

### Backend Oracle Wallet
- Separate wallet controlled by backend
- Only used for approve/reject/expire calls
- Pubkey stored in QuestConfig.authority
- Private key in environment variable (later: KMS)

### Rate Limits
- 100 requests/minute per user
- 10 quest creates/day per wallet
- 5 active claims per wallet

---

## Data Models

### User
```typescript
interface User {
  id: string;
  pubkey: string;
  username: string;
  avatar_url?: string;
  quests_completed: number;
  quests_posted: number;
  active_claims: number;
  flags: number;  // abuse flags, 3 = banned
  created_at: timestamp;
}
```

### Quest
```typescript
interface Quest {
  id: string;
  onchain_id: string;
  creator_id: string;
  description: string;
  quest_type: 'direct' | 'open';
  status: QuestStatus;
  reward_amount: number;
  reward_mint: string;  // $QUEST, SOL, or USDC mint address
  target_pubkey?: string;  // for direct quests
  max_claimers: number;
  current_claimers: number;
  deadline?: timestamp;
  escrow_pda: string;
  created_at: timestamp;
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
  stake_amount: number;
  proof_deadline: timestamp;  // 24h from claim
  review_deadline?: timestamp;  // 24h from proof submission
  claimed_at: timestamp;
}

type ClaimStatus =
  | 'active'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'abandoned'
  | 'expired';
```

### Proof
```typescript
interface Proof {
  id: string;
  claim_id: string;
  video_url: string;        // R2 URL
  video_hash: string;       // sha256, stored on-chain
  thumbnail_url: string;    // R2
  arweave_url?: string;     // only if archived
  expires_at?: timestamp;   // when R2 copy will be deleted
  duration_seconds: number;
  transcript?: string;
  ai_confidence?: number;
  ai_decision?: 'APPROVE' | 'REJECT' | 'UNCERTAIN';
  ai_reasoning?: string;
  safety_flags: string[];
  final_decision?: 'approved' | 'rejected';
  decided_by: 'ai' | 'creator' | 'timeout';
  created_at: timestamp;
}
```

---

## Smart Contract (Anchor)

### Accounts
```rust
#[account]
pub struct QuestConfig {
    pub authority: Pubkey,        // oracle wallet
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
    pub quest_type: QuestType,       // Direct or Open
    pub status: QuestStatus,
    pub target: Option<Pubkey>,      // for direct quests
    pub max_claimers: u8,
    pub time_limit: Option<i64>,
    pub proof_deadline_hours: u8,    // default 24
    pub review_deadline_hours: u8,   // default 24
    pub bump: u8,
}

#[account]
pub struct Claim {
    pub quest: Pubkey,
    pub claimer: Pubkey,
    pub stake_amount: u64,
    pub status: ClaimStatus,
    pub proof_deadline: i64,
    pub review_deadline: Option<i64>,
    pub proof_hash: Option<[u8; 32]>,
    pub bump: u8,
}
```

### Instructions
```rust
pub fn initialize(ctx, fee_bps, burn_bps) -> Result<()>
pub fn create_quest(ctx, reward_amount, quest_type, target, time_limit) -> Result<()>
pub fn claim_quest(ctx, stake_amount) -> Result<()>
pub fn submit_proof(ctx, proof_hash) -> Result<()>
pub fn approve_completion(ctx) -> Result<()>    // oracle only
pub fn reject_completion(ctx) -> Result<()>     // oracle only
pub fn cancel_quest(ctx) -> Result<()>          // creator only, before claimed
pub fn abandon_claim(ctx) -> Result<()>         // claimer only
pub fn expire_claim(ctx) -> Result<()>          // permissionless, after proof_deadline
pub fn auto_approve(ctx) -> Result<()>          // permissionless, after review_deadline
```

### Validations
```rust
// create_quest
- reward_amount >= min_reward
- creator cannot be target of direct quest

// claim_quest
- stake_amount >= reward_amount * 5 / 100
- proof_deadline = now + 24h
- quest.creator != claimer (self-claim prevention)

// approve_completion
- only oracle can call
- creator approval goes through API → oracle calls contract

// reject_completion
- rejection due to safety flag → return stake to claimer
- otherwise → stake goes to quest creator
```

### Events
```rust
QuestCreated { quest_id, creator, reward_amount, quest_type }
QuestClaimed { quest_id, claimer, stake_amount }
QuestCompleted { quest_id, claimer, reward_amount, fee_amount }
QuestFailed { quest_id, claimer, reason }
ClaimAbandoned { quest_id, claimer }
ClaimExpired { quest_id, claimer }
```

---

## API Endpoints

```
# Auth
POST   /api/auth/verify              Verify Privy JWT, return session

# Quests
POST   /api/quests                   Create quest (signs tx)
GET    /api/quests                   List quests
GET    /api/quests/:id               Get quest detail
DELETE /api/quests/:id               Cancel quest (before claimed)

# Claims
POST   /api/quests/:id/claim         Claim quest
DELETE /api/claims/:id               Abandon claim
POST   /api/claims/:id/proof         Upload video + submit proof

# Creator actions (triggers oracle)
POST   /api/claims/:id/approve       Creator approves
POST   /api/claims/:id/reject        Creator rejects

# Users
GET    /api/users/me
PATCH  /api/users/me
GET    /api/users/:pubkey

# Feed
GET    /api/feed                     Open quests, paginated
GET    /api/feed/mine                My quests + claims

# Webhooks (internal)
POST   /api/webhooks/verification-complete    AI result callback
```

---

## Tech Stack

```
apps/web/        # Next.js 14, Privy auth, TailwindCSS
contracts/       # Anchor program on Solana
packages/sdk/    # TypeScript SDK
docs/PRD.md      # This document
```

- Frontend: Next.js 14, TailwindCSS
- Auth: Privy
- API: Cloudflare Workers, Hono
- DB: Turso (SQLite edge), Redis
- Chain: Solana, Anchor
- Storage: Cloudflare R2
- AI: gpt5-mini (verification), Whisper (transcription)

---

## UI/UX

### Design Principles
1. **Achievement energy** — completion feels like unlocking
2. **One-tap actions** — claim, approve, reject
3. **Video-first** — proof videos are hero content
4. **Mobile-first** — designed for thumb navigation

### Key Screens
- **Home/Feed** — open quests, paginated
- **Quest Detail** — description, reward, claim button, proof video
- **Post Quest** — multi-step flow with cost preview
- **Record Proof** — camera with quest overlay
- **Profile** — avatar, quest history, active claims

### Visual Identity

| Element | Value |
|---------|-------|
| Primary | #7B5CFF (Electric Purple) |
| Secondary | #0A0A0A (Black), #FFFFFF (White) |
| Accent | #FFD700 (Gold) |
| Success | #22C55E |
| Error | #EF4444 |
| Typography | Inter (UI), Space Grotesk (Display) |
| Radius | 12px (cards), 8px (buttons) |

---

## MVP Roadmap

### Phase 1 (2 weeks)
- [ ] Anchor program with all instructions
- [ ] Deploy to devnet
- [ ] Basic tests

### Phase 2 (2 weeks)
- [ ] API: quest CRUD, claim flow
- [ ] Video upload to R2
- [ ] AI verification pipeline
- [ ] Oracle signing flow

### Phase 3 (2 weeks)
- [ ] Web frontend: browse, create, claim, record, submit
- [ ] Privy auth integration
- [ ] Creator review UI

### Phase 4 (1 week)
- [ ] Timeout cranks (manual/script initially)
- [ ] Basic abuse tracking
- [ ] Mainnet deploy

### NOT in MVP
- Guild quests
- Chain quests
- XP / levels
- Community voting / arbitration
- Mobile app
- Arweave archival
- Leaderboards

---

## Decisions Made

| Question | Decision | Rationale |
|----------|----------|-----------|
| Claim stake minimum | 5% of reward | Low enough to not deter claims, high enough to prevent spam |
| Review timeout | Auto-approve | Favors the claimer who did the work. Creator should be responsive. |
| Supported tokens | $QUEST, SOL, USDC | Cover crypto-native and stablecoin users |
| Video length | 15-60 seconds | Long enough to prove, short enough to verify cheaply |
| Storage | R2 only (MVP) | 300x cheaper than Arweave. Archive later as opt-in. |
| Fee on $QUEST | Same 2.5% | Simplicity over special treatment |

---

## Prohibited Categories

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

## Verification Prompt

```
You are a quest verification AI. Analyze the video frames and audio transcript to determine if the quest was completed.

Quest description: {description}
Video frames: {frames}
Audio transcript: {transcript}

Respond with structured JSON:
{
  "confidence": <0-100>,
  "decision": "APPROVE" | "REJECT" | "UNCERTAIN",
  "reasoning": "<2-3 sentences>",
  "detected_actions": ["<action1>", "<action2>"],
  "matches_description": <true/false>,
  "safety_flags": ["<flag1>"]  // violence, nudity, self-harm, etc. Empty if none.
}

Be strict but fair. Only APPROVE if clearly completed. Flag any unsafe content.
```

---

*Last reviewed February 2026*
