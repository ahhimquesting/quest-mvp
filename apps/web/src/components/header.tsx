'use client'

import { usePrivy } from '@privy-io/react-auth'
import Link from 'next/link'

export function Header() {
  const { ready, authenticated, login, logout, user } = usePrivy()

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/10 bg-quest-black/80 backdrop-blur-lg">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="font-display text-2xl font-bold text-quest-purple">
              QUEST
            </span>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <Link 
              href="/discover" 
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              Discover
            </Link>
            <Link 
              href="/leaderboard" 
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              Leaderboard
            </Link>
          </nav>

          {/* Auth */}
          <div className="flex items-center gap-4">
            {ready && !authenticated && (
              <button
                onClick={login}
                className="rounded-lg bg-quest-purple px-4 py-2 text-sm font-medium text-white hover:bg-quest-purple/90 transition-colors"
              >
                Connect
              </button>
            )}
            
            {ready && authenticated && (
              <div className="flex items-center gap-4">
                <Link
                  href="/quests/new"
                  className="rounded-lg bg-quest-purple px-4 py-2 text-sm font-medium text-white hover:bg-quest-purple/90 transition-colors"
                >
                  Post Quest
                </Link>
                <button
                  onClick={logout}
                  className="text-sm text-white/60 hover:text-white transition-colors"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
