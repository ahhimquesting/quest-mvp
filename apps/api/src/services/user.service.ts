import { eq } from 'drizzle-orm'
import { users } from '../db/schema'
import type { Database } from '../db/client'

export async function getUserById(db: Database, id: string) {
  return db.select().from(users).where(eq(users.id, id)).get()
}

export async function getUserByPubkey(db: Database, pubkey: string) {
  return db.select().from(users).where(eq(users.pubkey, pubkey)).get()
}

export async function updateUser(
  db: Database,
  id: string,
  data: { username?: string; avatarUrl?: string },
) {
  await db.update(users).set(data).where(eq(users.id, id))
  return db.select().from(users).where(eq(users.id, id)).get()
}

export function formatUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    pubkey: user.pubkey,
    username: user.username,
    avatarUrl: user.avatarUrl,
    questsCompleted: user.questsCompleted,
    questsPosted: user.questsPosted,
    activeClaims: user.activeClaims,
    flags: user.flags,
    createdAt: user.createdAt,
  }
}
