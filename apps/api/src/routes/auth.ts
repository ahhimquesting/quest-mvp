import { Hono } from 'hono'
import type { Env, AuthContext } from '../types'
import { authMiddleware } from '../middleware/auth'

export const authRoutes = new Hono<{ Bindings: Env }>()

// POST /api/auth/verify
authRoutes.post('/verify', authMiddleware, (c) => {
  const auth = c.get('auth') as AuthContext
  return c.json({ userId: auth.userId, wallet: auth.pubkey })
})
