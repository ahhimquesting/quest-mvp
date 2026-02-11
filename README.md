# QUEST

**Side quests. Main rewards.**

A social challenge protocol on Solana. Post quests with token rewards, complete them on video, collect the loot.

## Overview

QUEST turns everyday dares into staked missions:

1. **Post** — Create a challenge with a $QUEST reward
2. **Claim** — Accept the quest
3. **Prove** — Record video proof
4. **Collect** — AI verifies, winner gets paid

## Packages

```
quest/
├── apps/
│   ├── web/          # Next.js web application
│   └── mobile/       # React Native (Expo) mobile app
├── contracts/
│   └── programs/
│       └── quest/    # Anchor program (Solana)
├── packages/
│   ├── sdk/          # TypeScript SDK
│   └── ui/           # Shared UI components
└── docs/             # Documentation & specs
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Rust 1.75+
- Solana CLI 1.18+
- Anchor 0.30+

### Install

```bash
pnpm install
```

### Development

```bash
# Start web app
pnpm dev:web

# Start mobile app  
pnpm dev:mobile

# Build contracts
pnpm build:contracts

# Run tests
pnpm test
```

## Documentation

- [Product Requirements (PRD)](./docs/PRD.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [API Reference](./docs/API.md)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React Native, TailwindCSS |
| Auth | Privy |
| API | Cloudflare Workers, Hono |
| Database | Turso, Redis |
| Blockchain | Solana, Anchor |
| Storage | Arweave, Cloudflare R2 |
| AI | OpenAI GPT-4V, Whisper |

## Token

**$QUEST** — SPL token on Solana

- Quest rewards (primary currency)
- XP multipliers for native payments
- Verification rewards
- Loot drops for viral content

## License

MIT
