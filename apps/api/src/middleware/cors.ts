import { cors } from 'hono/cors'

export const corsMiddleware = cors({
  origin: ['https://quest.gg', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400,
})
