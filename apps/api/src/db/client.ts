import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import * as schema from './schema'
import type { Env } from '../types'

export type Database = ReturnType<typeof createDbClient>

export function createDbClient(env: Env) {
  const client = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  })

  return drizzle(client, { schema })
}
