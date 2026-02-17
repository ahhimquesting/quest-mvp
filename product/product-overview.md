# QUEST — Product Design Overview

**Purpose:** Reference document for product design decisions across UI, UX, and visual identity.

---

## 1. Product Concept

QUEST turns informal dares and challenges into a protocol. Someone posts a challenge with real money attached, someone else claims it, films themselves completing it, AI verifies the video, and the winner gets paid.

**Core loop:** Post → Claim → Prove → Collect

The product sits at the intersection of social media, gaming, and crypto — the "side quest" as a new content primitive. Every completed quest produces a short video with stakes behind it, making the content inherently more interesting than typical social posts.

**Token:** $QUEST (`E7Xfasv5CRTNc6Xb16w36BZk3HRSogh8T4ZFimSnpump`)

---

## 2. User Personas

### The Instigator (Quest Giver)
- Has crypto to spend on entertainment
- Gets a kick out of daring people
- Wants to watch someone actually do the thing
- Motivation: entertainment, social influence, content creation
- Key emotion: anticipation → satisfaction

### The Performer (Quest Taker)
- Motivated by money and attention
- Already comfortable filming themselves
- Competitive, wants to prove they can do it
- Motivation: rewards, recognition, adrenaline
- Key emotion: confidence → triumph

---

## 3. Information Architecture

```
Home (/)
├── Hero — value prop, CTA to start or browse
├── Open Quests — feed of available quests
└── My Quests — user's posted + claimed quests

Post Quest (/quests/new)
├── Description input (280 char)
├── Reward amount + token selector
├── Quest type (Direct / Open)
├── Time limit (optional)
└── Confirmation + escrow preview

Quest Detail (/quests/:id)
├── Challenge description
├── Creator info
├── Reward badge
├── Claim button / status
├── Proof video (if submitted)
└── Verification status

Record Proof (/claims/:id/record)
├── Camera with quest overlay
├── Timer (15-60s)
└── Submit for verification

Profile (/profile)
├── Avatar + username
├── Stats (completed, posted, active)
└── Quest history
```

---

## 4. Screen Inventory & Interactions

### 4.1 Home / Feed
**Purpose:** Browse available quests, see activity.

**Layout:** Vertical feed of quest cards. Two tabs: "Open Quests" (public feed, default) and "My Quests" (authenticated user's quests + claims).

**Behavior:**
- Infinite scroll, paginated via API
- Cards sorted by recency (newest first)
- Pull-to-refresh on mobile
- Unauthenticated users see feed but "Claim" buttons trigger login

**Content states:**
- Loading: skeleton cards (3 placeholders)
- Empty (Open Quests): "No quests yet. Be the first to post one!"
- Empty (My Quests): "You haven't posted or claimed any quests yet."
- Error: "Couldn't load quests. Pull to refresh."

### 4.2 Quest Card
**Purpose:** Scannable preview of a quest in the feed.

**Anatomy:**
```
┌──────────────────────────────────┐
│  [Avatar] creator.username       │
│           "Quest Giver"    [💰 reward QUEST] │
│                                  │
│  Challenge description text      │
│                                  │
│  🕐 23h remaining  👥 0/3 claimed│
│                                  │
│  [ ━━━━━ Claim Quest ━━━━━━ ]   │
└──────────────────────────────────┘
```

**States:**
- `active` — purple CTA "Claim Quest"
- `claimed` — disabled "Quest Claimed" (muted)
- `completed` — green badge, shows proof thumbnail
- `expired` — dimmed, no action
- `cancelled` — dimmed, strikethrough reward

**Interactions:**
- Tap card → navigate to Quest Detail
- Tap "Claim Quest" → claim flow (with deposit confirmation)
- Long press (mobile) → share quest

### 4.3 Post Quest
**Purpose:** Create a new quest with funded escrow.

**Flow (multi-step):**
1. **Describe** — text input (280 char), with live character count. Placeholder: "Dare someone to..."
2. **Set reward** — amount input + token selector (QUEST / SOL / USDC). Show minimum reward hint. Show equivalent USD value.
3. **Choose type** — Direct (tag a user) or Open (anyone can claim). If Direct, show user search field.
4. **Options** — max claimers (Open only, default 1), time limit (optional, hours).
5. **Confirm** — summary card showing: description, reward, type, cost breakdown (reward + gas). "Post Quest" CTA locks funds in escrow.

**Validation:**
- Description: 1-280 chars, passes blocklist
- Reward: >= minimum (1 QUEST / 0.001 SOL)
- Direct quests: target must exist, cannot be self
- Wallet must have sufficient balance

**Success state:** Quest card appears with "Your quest is live!" toast. Redirect to Quest Detail.

### 4.4 Quest Detail
**Purpose:** Full view of a quest. Hub for claiming, submitting proof, and reviewing.

**Layout sections:**
- **Header:** Quest description (large text), creator avatar + name
- **Reward badge:** Token amount with icon, prominent
- **Status bar:** Current state with progress indicator
- **Claim section:** CTA button (context-dependent)
- **Proof section:** Video player (if proof submitted), verification status
- **Timeline:** Key events (created, claimed, proof submitted, verified)

**Context-dependent actions:**
| Viewer | Quest State | Action Available |
|--------|-------------|-----------------|
| Anyone | active | Claim Quest |
| Claimer | claimed (no proof) | Record Proof, Abandon |
| Claimer | submitted | Waiting for verification |
| Creator | submitted | Approve / Reject (if escalated) |
| Anyone | completed | View proof video |

### 4.5 Record Proof
**Purpose:** Capture video evidence of quest completion.

**Layout:**
- Full-screen camera view
- Quest description overlay at top (so claimer remembers what to do)
- Record button (large, center bottom)
- Timer: counts up from 0, minimum 15s, maximum 60s
- Stop button replaces record after 15s

**Post-recording:**
- Preview playback
- "Submit Proof" or "Retake"
- Upload progress indicator
- Success: redirect to Quest Detail with "submitted" status

### 4.6 Profile
**Purpose:** User identity, stats, and quest history.

**Layout:**
- Avatar (editable) + username (editable)
- Wallet address (truncated, copy button)
- Stats row: Quests Completed | Quests Posted | Active Claims
- Tabbed history: Posted Quests | Completed | Claims
- Each tab is a filtered quest card list

### 4.7 Creator Review (Escalated)
**Purpose:** When AI is uncertain, creator reviews the proof video.

**Layout:**
- Quest description reminder
- Proof video player (auto-plays)
- AI analysis summary: confidence %, reasoning, detected actions
- Two CTAs: "Approve" (green) / "Reject" (red)
- Timer: "Auto-approves in Xh" countdown
- Warning: "If you don't respond, this will auto-approve."

---

## 5. Visual Identity

### 5.1 Color System

| Token | Value | Usage |
|-------|-------|-------|
| `--quest-purple` | `#7B5CFF` | Primary actions, brand, links |
| `--quest-gold` | `#FFD700` | Rewards, earnings, success highlights |
| `--quest-black` | `#0A0A0A` | Background |
| `--white` | `#FFFFFF` | Primary text |
| `--white-60` | `rgba(255,255,255,0.6)` | Secondary text |
| `--white-40` | `rgba(255,255,255,0.4)` | Tertiary text, labels |
| `--white-10` | `rgba(255,255,255,0.1)` | Borders, dividers |
| `--white-5` | `rgba(255,255,255,0.05)` | Card backgrounds, subtle fills |
| `--success` | `#22C55E` | Approved, completed |
| `--error` | `#EF4444` | Rejected, failed, destructive |
| `--warning` | `#F59E0B` | Pending review, expiring soon |

**Dark theme only.** No light mode. The dark background makes reward amounts and video thumbnails pop.

### 5.2 Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Display | Space Grotesk | 700 | Headlines, logo, stat numbers |
| Body | Inter | 400, 500, 600 | UI text, descriptions, buttons |

**Scale:**
- Hero headline: `text-5xl` / `text-7xl` (mobile/desktop)
- Section title: `text-2xl` font-display font-bold
- Card description: `text-lg`
- Body text: `text-sm` / `text-base`
- Labels/meta: `text-xs` / `text-sm` at white/40 opacity
- Stats: `text-3xl` font-display font-bold in quest-gold

### 5.3 Spacing & Layout

- Base grid: 4px
- Card padding: 24px (`p-6`)
- Card gap: 16px (`space-y-4`)
- Section padding: 48px vertical (`py-12`)
- Max content width: `max-w-4xl` (896px)
- Max page width: `max-w-7xl` (1280px)
- Header height: 64px (`h-16`)
- Border radius: 12px cards (`rounded-xl`), 8px buttons (`rounded-lg`)

### 5.4 Component Patterns

**Buttons:**
- Primary: `bg-quest-purple text-white rounded-lg` — hover to `quest-purple/90`
- Secondary: `border border-white/20 text-white rounded-lg` — hover to `bg-white/5`
- Disabled: `border border-white/20 text-white/60 cursor-not-allowed`
- Destructive: `bg-error text-white rounded-lg`

**Cards:**
- `rounded-xl border border-white/10 bg-white/5 p-6`
- Hover: `hover:border-quest-purple/50 transition-colors`

**Badges/pills:**
- Reward: `rounded-full bg-quest-gold/10 px-3 py-1.5` with gold text and coin icon
- Status: rounded-full with status-specific color at 10% opacity background

**Inputs:**
- `bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder:text-white/30`
- Focus: `focus:border-quest-purple focus:ring-1 focus:ring-quest-purple`

**Navigation tabs:**
- Active: `text-quest-purple border-b-2 border-quest-purple`
- Inactive: `text-white/40 hover:text-white/60`

**Toasts/notifications:**
- Success: green left border, dark bg
- Error: red left border, dark bg
- Info: purple left border, dark bg

### 5.5 Iconography

Using Lucide React icons throughout:
- `Clock` — time remaining
- `Users` — claimer count
- `Coins` — reward amount
- `Video` — proof recording
- `Check` — approved/completed
- `X` — rejected/failed
- `AlertTriangle` — warning/flagged

Consistent size: `w-4 h-4` in card meta, `w-5 h-5` in buttons, `w-6 h-6` as standalone.

---

## 6. Motion & Transitions

### Page transitions
- Route changes: fade-in (`opacity 0 → 1`, 200ms ease)
- Header: fixed with `backdrop-blur-lg` for scroll transparency

### Micro-interactions
- Button hover: color shift via `transition-colors` (150ms)
- Card hover: border color shift to `quest-purple/50`
- CTA press: scale down to 0.98 (50ms), scale back (100ms)
- Success: brief gold shimmer on reward badge

### Loading states
- Skeleton cards: pulsing gray blocks matching card anatomy
- Proof upload: linear progress bar in quest-purple
- Verification: animated spinner + "AI is reviewing your proof..."

### Video
- Auto-play proof videos on Quest Detail (muted, with sound toggle)
- Thumbnail fallback if video not loaded
- Tap to fullscreen on mobile

---

## 7. Responsive Breakpoints

| Breakpoint | Width | Key changes |
|------------|-------|-------------|
| Mobile | < 640px | Single column, full-width CTAs, stacked hero buttons, bottom nav |
| Tablet | 640-1024px | Same as mobile with wider cards |
| Desktop | > 1024px | Side-by-side hero buttons, horizontal nav, wider max-width |

**Mobile-first approach.** All base styles target mobile. Desktop adds horizontal layouts and wider spacing.

### Mobile-specific patterns
- Bottom navigation bar (Home, Discover, Post, Profile)
- Full-width buttons
- Swipe gestures on quest cards (swipe right to claim)
- Camera integration for proof recording
- Touch target minimum: 44x44px

---

## 8. Auth Patterns

**Provider:** Privy (email, Google, Twitter, wallet)

**Login methods displayed:** Email, wallet connect, Google, Twitter

**Theme:** Dark, accent `#7B5CFF`

**Embedded wallets:** Auto-created for users without wallets on login. Users never need to know about crypto if they don't want to.

**Auth-gated actions:**
- Post Quest → requires login
- Claim Quest → requires login
- Record Proof → requires login
- Browse feed → no login required

**Pattern:** Unauthenticated users see the full feed. Tapping any action triggers the Privy login modal. After login, the action completes automatically (no re-navigation).

---

## 9. Key UX Principles

1. **One-tap actions** — Claim, approve, reject are single taps. No multi-step confirmations for low-stakes actions. Deposit confirmation is the only gate.

2. **Video-first** — Proof videos are the hero content. Quest detail pages center around the video. Feed should eventually surface completed quest videos.

3. **Achievement energy** — Completing a quest should feel like unlocking something. Gold flash on reward, bold "COMPLETED" state, visible payout amount.

4. **Transparent stakes** — Always show: reward amount, deposit required, time remaining, who's reviewing. No hidden mechanics.

5. **Failure is graceful** — Abandoned and expired quests are dimmed, not deleted. Rejected proofs show reasoning. Users understand what happened and why.

6. **Progressive disclosure** — Feed shows minimal card info. Tap for full detail. Post quest is multi-step so users aren't overwhelmed. Crypto mechanics (escrow, PDAs, on-chain hashes) are completely hidden.

---

## 10. Content & Copy Guidelines

### Voice
- Casual, direct, slightly provocative
- Gaming language: "quest," "claim," "loot," "side quest"
- Never corporate, never formal
- Short sentences. Fragmented is fine.

### Examples

| Context | Copy |
|---------|------|
| Hero headline | "Side quests. Main rewards." |
| Hero subhead | "Post challenges with real rewards. Complete them on video. AI verifies. Winner collects the loot." |
| Empty feed | "No quests yet. Be the first to post one!" |
| Post CTA | "Post a Quest" / "Post Quest" |
| Claim CTA | "Claim Quest" |
| Claimed state | "Quest Claimed" |
| Login CTA | "Start Questing" / "Connect" |
| Proof submit | "Submit Proof" |
| Verification pending | "AI is reviewing your proof..." |
| Auto-approve warning | "Auto-approves in 23h if creator doesn't respond" |
| Deposit label | "Claim deposit (returned on completion)" |
| Success toast | "Quest completed! Reward sent to your wallet." |
| Rejection reason | "AI confidence: 12%. Your video didn't match the quest description." |

### Quest description guidance (for creators)
- Be specific: "Do 50 pushups in under 2 minutes" not "Do pushups"
- One action per quest
- Include measurable criteria when possible
- Placeholder text: "Dare someone to..."

---

## 11. Edge Cases & Empty States

| State | Treatment |
|-------|-----------|
| No quests in feed | Illustration + "No quests yet" + CTA to post |
| No claims on profile | "You haven't claimed any quests yet. Browse open quests." |
| Quest expired before claim | Dimmed card, "Expired" badge, funds returned note |
| Video upload failed | Retry button + "Upload failed. Check your connection." |
| AI verification timeout | "Verification is taking longer than usual. We'll notify you." |
| Wallet insufficient funds | Disable CTA + "Insufficient balance" tooltip |
| Rate limit hit | "You've reached the daily limit. Try again tomorrow." |
| Account flagged | Warning banner on profile, restricted posting |
| Network error | Toast: "Connection lost. Retrying..." with auto-retry |

---

## 12. Notification Patterns

### In-app (toast / banner)
- Quest created successfully
- Someone claimed your quest
- Proof submitted for your review
- Quest approved / rejected
- Reward received
- Claim deposit returned

### Push (future, mobile)
- "Someone claimed your quest!"
- "Your proof was approved. $50 QUEST sent!"
- "Creator review needed — auto-approves in 12h"
- "Your claim is expiring in 2h"

### Email (future)
- Weekly digest: quests completed, rewards earned
- Account warnings (flags, approaching ban)

---

*This document is a living reference for product design. Update as the product evolves.*
