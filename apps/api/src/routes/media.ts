import { Hono } from 'hono'
import type { Env, AuthContext } from '../types'
import { authMiddleware } from '../middleware/auth'
import { nanoid } from 'nanoid'
import { StorageService } from '../services/storage.service'
import { BadRequest } from '../lib/errors'

export const mediaRoutes = new Hono<{ Bindings: Env }>()

// POST /api/media/upload — proxy upload to R2
mediaRoutes.post('/upload', authMiddleware, async (c) => {
  const auth = c.get('auth') as AuthContext
  const contentType = c.req.header('content-type') || ''

  if (!contentType.startsWith('video/')) {
    throw new BadRequest('Content-Type must be video/*')
  }

  const fileId = nanoid()
  const storage = new StorageService(c.env.R2, c.env.R2_PUBLIC_URL)
  const body = c.req.raw.body

  if (!body) throw new BadRequest('No body')

  const url = await storage.uploadVideo(auth.userId, fileId, body, contentType)

  // Compute SHA-256 hash
  // Note: we already consumed the stream for upload, so the client should
  // compute the hash client-side and include it in the proof submission.
  // This endpoint just handles the upload.

  return c.json({ uploadUrl: url, fileId })
})

// POST /api/media/upload-frame — upload a single frame
mediaRoutes.post('/upload-frame', authMiddleware, async (c) => {
  const claimId = c.req.header('x-claim-id')
  const frameIndex = c.req.header('x-frame-index')

  if (!claimId || frameIndex === null || frameIndex === undefined) {
    throw new BadRequest('x-claim-id and x-frame-index headers required')
  }

  const body = await c.req.arrayBuffer()
  const storage = new StorageService(c.env.R2, c.env.R2_PUBLIC_URL)
  const key = await storage.uploadFrame(claimId, parseInt(frameIndex), body)

  return c.json({ key })
})
