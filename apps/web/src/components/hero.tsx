'use client'

import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'

export function Hero() {
  const { login, authenticated } = usePrivy()

  return (
    <section className="pt-32 pb-20 px-4">
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="font-display text-5xl sm:text-7xl font-bold tracking-tight">
          Side quests.
          <br />
          <span className="text-quest-purple">Main rewards.</span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-white/60 max-w-2xl mx-auto">
          Post challenges with real rewards. Complete them on video.
          AI verifies. Winner collects the loot.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          {!authenticated ? (
            <button
              onClick={login}
              className="w-full sm:w-auto rounded-xl bg-quest-purple px-8 py-4 text-lg font-semibold text-white hover:bg-quest-purple/90 transition-colors"
            >
              Start Questing
            </button>
          ) : (
            <Link
              href="/quests/new"
              className="w-full sm:w-auto rounded-xl bg-quest-purple px-8 py-4 text-lg font-semibold text-white hover:bg-quest-purple/90 transition-colors text-center"
            >
              Post a Quest
            </Link>
          )}

          <Link
            href="/discover"
            className="w-full sm:w-auto rounded-xl border border-white/20 px-8 py-4 text-lg font-semibold text-white hover:bg-white/5 transition-colors text-center"
          >
            Browse Quests
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-16 grid grid-cols-3 gap-8 max-w-lg mx-auto">
          <div>
            <div className="font-display text-3xl font-bold text-quest-gold">$0</div>
            <div className="text-sm text-white/40">Rewards Paid</div>
          </div>
          <div>
            <div className="font-display text-3xl font-bold text-quest-gold">0</div>
            <div className="text-sm text-white/40">Quests Completed</div>
          </div>
          <div>
            <div className="font-display text-3xl font-bold text-quest-gold">0</div>
            <div className="text-sm text-white/40">Active Questers</div>
          </div>
        </div>
      </div>
    </section>
  )
}
