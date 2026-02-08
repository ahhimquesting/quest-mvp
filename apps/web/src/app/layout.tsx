import type { Metadata } from 'next'
import { Inter, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

export const metadata: Metadata = {
  title: 'QUEST | Side quests. Main rewards.',
  description: 'Social challenge protocol on Solana. Post quests, complete them on video, collect the loot.',
  openGraph: {
    title: 'QUEST',
    description: 'Side quests. Main rewards.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'QUEST',
    description: 'Side quests. Main rewards.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="bg-quest-black text-white min-h-screen antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
