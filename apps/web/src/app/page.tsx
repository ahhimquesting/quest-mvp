import { Header } from '@/components/header'
import { Hero } from '@/components/hero'
import { QuestFeed } from '@/components/quest-feed'

export default function Home() {
  return (
    <main className="min-h-screen">
      <Header />
      <Hero />
      <QuestFeed />
    </main>
  )
}
