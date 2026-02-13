'use client'

import { QuestCard } from './quest-card'

// Mock data for now
const MOCK_QUESTS = [
  {
    id: '1',
    description: 'Chug a glass of pickle juice without making a face',
    reward: 25,
    token: 'QUEST',
    creator: {
      username: 'sam.sol',
      avatar: null,
    },
    status: 'active',
    claimers: 0,
    maxClaimers: 1,
    timeRemaining: '23h',
  },
  {
    id: '2',
    description: 'Do 50 pushups in under 2 minutes',
    reward: 50,
    token: 'QUEST',
    creator: {
      username: 'iqram.sol',
      avatar: null,
    },
    status: 'active',
    claimers: 0,
    maxClaimers: 3,
    timeRemaining: '47h',
  },
  {
    id: '3',
    description: 'Ask a stranger for their phone number (respectfully)',
    reward: 100,
    token: 'QUEST',
    creator: {
      username: 'chad.sol',
      avatar: null,
    },
    status: 'claimed',
    claimers: 1,
    maxClaimers: 1,
    timeRemaining: '12h',
  },
]

export function QuestFeed() {
  return (
    <section className="py-12 px-4">
      <div className="mx-auto max-w-4xl">
        {/* Tabs */}
        <div className="flex gap-4 border-b border-white/10 mb-8">
          <button className="px-4 py-3 text-sm font-medium text-quest-purple border-b-2 border-quest-purple">
            Open Quests
          </button>
          <button className="px-4 py-3 text-sm font-medium text-white/40 hover:text-white/60 transition-colors">
            My Quests
          </button>
        </div>

        {/* Quest List */}
        <div className="space-y-4">
          {MOCK_QUESTS.map((quest) => (
            <QuestCard key={quest.id} quest={quest} />
          ))}
        </div>

        {/* Empty State */}
        {MOCK_QUESTS.length === 0 && (
          <div className="text-center py-20">
            <p className="text-white/40">No quests yet. Be the first to post one!</p>
          </div>
        )}
      </div>
    </section>
  )
}
