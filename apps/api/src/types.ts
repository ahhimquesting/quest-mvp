export interface Env {
  // Turso
  TURSO_DATABASE_URL: string
  TURSO_AUTH_TOKEN: string

  // Privy
  PRIVY_APP_ID: string
  PRIVY_APP_SECRET: string
  PRIVY_VERIFICATION_KEY: string

  // Solana
  SOLANA_RPC_URL: string
  ORACLE_KEYPAIR: string
  QUEST_PROGRAM_ID: string
  QUEST_MINT: string

  // OpenAI
  OPENAI_API_KEY: string

  // R2
  R2: R2Bucket
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_ACCOUNT_ID: string
  R2_BUCKET_NAME: string
  R2_PUBLIC_URL: string

  // Queues
  VERIFICATION_QUEUE: Queue

  // KV
  RATE_LIMIT_KV: KVNamespace

  // Internal
  WEBHOOK_SECRET: string
  TREASURY_TOKEN_ACCOUNT: string
  ENVIRONMENT: string
}

export interface AuthContext {
  userId: string
  pubkey: string
  privyUserId: string
}

export interface VerificationMessage {
  proofId: string
}
