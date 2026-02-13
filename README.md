# QUEST

We wanted to find out if we can turn "i'll give you 100 bucks to do {stupid idea}" into a social challenge protocol. Post quests, complete them on video, collect the reward.

## How it works

User A creates a quest and funds the reward with $QUEST → User B accepts the challenge → Records video proof → AI verifies if it was completed → Winner receives $QUEST payout.

## What we're testing

1. **can AI be the trust layer?** if verification actually works, you don't need to know someone to dare them. gets interesting once strangers start challenging strangers.

2. **is "challenge video" a content format?** stakes make content better. the money makes it interesting. is this a primitive?

3. **can money bootstrap a network?** post a quest, money brings people. skip the invite-your-friends grind.

---

## Stack

```
apps/web/        # nextjs 14, privy auth, tailwind
contracts/       # anchor program on solana  
packages/sdk/    # typescript sdk
docs/PRD.md      # full spec
```

### contracts

anchor program handles escrow, quest creation, claims, settlement. funds lock on create, release on verified completion. 2.5% fee on payouts (half burned, half treasury).

### verification

using gpt5-mini to analyze video and compare it to the quest description. spits out a confidence score. high confidence = auto-settle. low confidence = goes to the quest creator to review. disputes go to community vote.

### storage

videos go to arweave so they're permanent. thumbnails on cloudflare r2. hash stored on-chain for verification.

### auth

privy for login (email, google, wallet, whatever). also does embedded wallets so people without crypto can still use it.

```bash
pnpm install
pnpm dev:web           # frontend
pnpm build:contracts   # anchor build
pnpm test:contracts    # anchor test
```

---

wip / internal