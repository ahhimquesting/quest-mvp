'use client'

import { Clock, Users, Coins } from 'lucide-react'

interface Quest {
  id: string
  description: string
  reward: number
  token: string
  creator: {
    username: string
    avatar: string | null
  }
  status: string
  claimers: number
  maxClaimers: number
  timeRemaining: string
}

export function QuestCard({ quest }: { quest: Quest }) {
  const isActive = quest.status === 'active'
  const isClaimed = quest.status === 'claimed'

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-6 hover:border-quest-purple/50 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-quest-purple/20 flex items-center justify-center">
            <span className="text-sm font-medium text-quest-purple">
              {quest.creator.username.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-white">{quest.creator.username}</p>
            <p className="text-xs text-white/40">Quest Giver</p>
          </div>
        </div>
        
        {/* Reward */}
        <div className="flex items-center gap-2 rounded-full bg-quest-gold/10 px-3 py-1.5">
          <Coins className="w-4 h-4 text-quest-gold" />
          <span className="text-sm font-semibold text-quest-gold">
            {quest.reward} {quest.token}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="mt-4 text-lg text-white">{quest.description}</p>

      {/* Meta */}
      <div className="mt-4 flex items-center gap-4 text-sm text-white/40">
        <div className="flex items-center gap-1.5">
          <Clock className="w-4 h-4" />
          <span>{quest.timeRemaining}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Users className="w-4 h-4" />
          <span>{quest.claimers}/{quest.maxClaimers} claimed</span>
        </div>
      </div>

      {/* Action */}
      <div className="mt-6">
        {isActive && (
          <button className="w-full rounded-lg bg-quest-purple py-3 text-sm font-semibold text-white hover:bg-quest-purple/90 transition-colors">
            Claim Quest
          </button>
        )}
        {isClaimed && (
          <button 
            className="w-full rounded-lg border border-white/20 py-3 text-sm font-semibold text-white/60 cursor-not-allowed"
            disabled
          >
            Quest Claimed
          </button>
        )}
      </div>
    </div>
  )
}
