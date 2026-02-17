import { Hono } from 'hono'
import type { Env, AuthContext } from '../types'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { createDbClient } from '../db/client'
import { getUserById, getUserByPubkey, updateUser, formatUser } from '../services/user.service'
import { BadRequest, NotFound } from '../lib/errors'

export const userRoutes = new Hono<{ Bindings: Env }>()

// GET /api/users/me
userRoutes.get('/me', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = createDbClient(c.env)
  const user = await getUserById(db, auth.userId)
  if (!user) throw new NotFound('User not found')
  return c.json(formatUser(user))
})

// PATCH /api/users/me
userRoutes.patch('/me', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const body = await c.req.json<{ username?: string; avatarUrl?: string }>()

  if (body.username) {
    if (body.username.length < 3 || body.username.length > 30) {
      throw new BadRequest('Username must be 3-30 characters')
    }
    if (!/^[a-zA-Z0-9._]+$/.test(body.username)) {
      throw new BadRequest('Username can only contain letters, numbers, dots, and underscores')
    }
  }

  const db = createDbClient(c.env)
  const user = await updateUser(db, auth.userId, {
    ...(body.username && { username: body.username }),
    ...(body.avatarUrl !== undefined && { avatarUrl: body.avatarUrl }),
  })

  if (!user) throw new NotFound('User not found')
  return c.json(formatUser(user))
})

// GET /api/users/:pubkey
userRoutes.get('/:pubkey', optionalAuthMiddleware, async (c) => {
  const pubkey = c.req.param('pubkey')
  const db = createDbClient(c.env)
  const user = await getUserByPubkey(db, pubkey)
  if (!user) throw new NotFound('User not found')
  return c.json(formatUser(user))
})
