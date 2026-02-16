import { Hono } from 'hono'
import type { Env, VerificationMessage } from './types'
import { corsMiddleware } from './middleware/cors'
import { rateLimitMiddleware } from './middleware/rate-limit'
import { authRoutes } from './routes/auth'
import { questRoutes } from './routes/quests'
import { claimRoutes } from './routes/claims'
import { userRoutes } from './routes/users'
import { feedRoutes } from './routes/feed'
import { mediaRoutes } from './routes/media'
import { webhookRoutes } from './routes/webhooks'
import { processVerificationJob } from './services/verification.service'
import { runCrank } from './cron/crank'
import { ApiError } from './lib/errors'

const app = new Hono<{ Bindings: Env }>()

// Global middleware
app.use('*', corsMiddleware)
app.use('/api/*', rateLimitMiddleware)

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }))

// Routes
app.route('/api/auth', authRoutes)
app.route('/api/quests', questRoutes)
app.route('/api/claims', claimRoutes)
app.route('/api/users', userRoutes)
app.route('/api/feed', feedRoutes)
app.route('/api/media', mediaRoutes)
app.route('/api/webhooks', webhookRoutes)

// Global error handler
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message }, err.status as any)
  }
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

// 404
app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default {
  fetch: app.fetch,

  // Queue consumer: AI verification pipeline
  async queue(batch: MessageBatch<VerificationMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processVerificationJob(env, message.body.proofId)
        message.ack()
      } catch (err) {
        console.error(`Verification failed for proof ${message.body.proofId}:`, err)
        message.retry()
      }
    }
  },

  // Cron: expire claims + auto-approve past deadline
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCrank(env))
  },
}
