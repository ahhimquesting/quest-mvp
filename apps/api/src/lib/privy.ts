import { jwtVerify, importSPKI } from 'jose'
import type { Env } from '../types'

let cachedKey: CryptoKey | null = null

export async function verifyPrivyToken(token: string, env: Env) {
  if (!cachedKey) {
    cachedKey = await importSPKI(env.PRIVY_VERIFICATION_KEY, 'RS256')
  }

  const { payload } = await jwtVerify(token, cachedKey, {
    issuer: 'privy.io',
    audience: env.PRIVY_APP_ID,
  })

  return payload
}
