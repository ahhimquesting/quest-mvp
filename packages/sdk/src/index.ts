import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js'
import { AnchorProvider, Program, Idl, BN } from '@coral-xyz/anchor'

// Constants
export const QUEST_MINT = new PublicKey('E7Xfasv5CRTNc6Xb16w36BZk3HRSogh8T4ZFimSnpump')
export const PROGRAM_ID = new PublicKey('QUESTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')

// Types
export type QuestType = 'direct' | 'open'
export type QuestStatus = 'active' | 'claimed' | 'completed' | 'failed' | 'cancelled' | 'expired'
export type ClaimStatus = 'active' | 'submitted' | 'approved' | 'rejected' | 'abandoned' | 'expired'

export interface User {
  id: string
  pubkey: string
  username: string
  avatarUrl?: string
  questsCompleted: number
  questsPosted: number
  activeClaims: number
  flags: number
  createdAt: number
}

export interface Quest {
  id: string
  onchainId: string
  creatorId: string
  description: string
  questType: QuestType
  status: QuestStatus
  rewardAmount: number
  rewardMint: string
  targetPubkey?: string
  maxClaimers: number
  currentClaimers: number
  deadline?: number
  escrowPda: string
  createdAt: number
}

export interface Claim {
  id: string
  questId: string
  claimerId: string
  status: ClaimStatus
  stakeAmount: number
  proofDeadline: number
  reviewDeadline?: number
  claimedAt: number
}

export interface Proof {
  id: string
  claimId: string
  videoUrl: string
  videoHash: string
  thumbnailUrl: string
  durationSeconds: number
  transcript?: string
  aiConfidence?: number
  aiDecision?: 'APPROVE' | 'REJECT' | 'UNCERTAIN'
  aiReasoning?: string
  safetyFlags: string[]
  finalDecision?: 'approved' | 'rejected'
  decidedBy: 'ai' | 'creator' | 'timeout'
  createdAt: number
}

export interface CreateQuestParams {
  description: string
  rewardAmount: number
  rewardMint: string
  questType: QuestType
  targetPubkey?: string
  maxClaimers?: number
  timeLimitHours?: number
}

export interface ClaimQuestParams {
  questId: string
  stakeAmount: number
}

export interface SubmitProofParams {
  claimId: string
  videoUrl: string
  videoHash: string
}

class QuestAPIError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'QuestAPIError'
  }
}

export class QuestSDK {
  private connection: Connection
  private provider: AnchorProvider | null = null
  private apiUrl: string
  private authToken: string | null = null

  constructor(config: {
    rpcUrl: string
    apiUrl: string
  }) {
    this.connection = new Connection(config.rpcUrl, 'confirmed')
    this.apiUrl = config.apiUrl
  }

  setAuthToken(token: string) {
    this.authToken = token
  }

  async connect(provider: AnchorProvider) {
    this.provider = provider
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }

    const response = await fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: { ...headers, ...options?.headers },
    })

    if (!response.ok) {
      throw new QuestAPIError(response.status, response.statusText)
    }

    return response.json()
  }

  // Auth
  async verifyAuth(): Promise<{ userId: string; wallet: string }> {
    return this.request('/api/auth/verify', { method: 'POST' })
  }

  // Quests
  async createQuest(params: CreateQuestParams): Promise<Quest> {
    return this.request('/api/quests', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async getQuest(questId: string): Promise<Quest> {
    return this.request(`/api/quests/${questId}`)
  }

  async listQuests(params?: {
    status?: QuestStatus
    questType?: QuestType
    creator?: string
    limit?: number
    offset?: number
  }): Promise<Quest[]> {
    const searchParams = new URLSearchParams()
    if (params?.status) searchParams.set('status', params.status)
    if (params?.questType) searchParams.set('type', params.questType)
    if (params?.creator) searchParams.set('creator', params.creator)
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.offset) searchParams.set('offset', params.offset.toString())

    return this.request(`/api/quests?${searchParams}`)
  }

  async cancelQuest(questId: string): Promise<void> {
    await this.request(`/api/quests/${questId}`, { method: 'DELETE' })
  }

  // Claims
  async claimQuest(questId: string, params: ClaimQuestParams): Promise<Claim> {
    return this.request(`/api/quests/${questId}/claim`, {
      method: 'POST',
      body: JSON.stringify(params),
    })
  }

  async abandonClaim(claimId: string): Promise<void> {
    await this.request(`/api/claims/${claimId}`, { method: 'DELETE' })
  }

  async submitProof(params: SubmitProofParams): Promise<Proof> {
    return this.request(`/api/claims/${params.claimId}/proof`, {
      method: 'POST',
      body: JSON.stringify({
        videoUrl: params.videoUrl,
        videoHash: params.videoHash,
      }),
    })
  }

  async approveClaim(claimId: string): Promise<void> {
    await this.request(`/api/claims/${claimId}/approve`, { method: 'POST' })
  }

  async rejectClaim(claimId: string): Promise<void> {
    await this.request(`/api/claims/${claimId}/reject`, { method: 'POST' })
  }

  // Users
  async getMe(): Promise<User> {
    return this.request('/api/users/me')
  }

  async updateMe(data: { username?: string; avatarUrl?: string }): Promise<User> {
    return this.request('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async getUser(pubkey: string): Promise<User> {
    return this.request(`/api/users/${pubkey}`)
  }

  // Feed
  async getFeed(params?: { limit?: number; offset?: number }): Promise<Quest[]> {
    const searchParams = new URLSearchParams()
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.offset) searchParams.set('offset', params.offset.toString())

    return this.request(`/api/feed?${searchParams}`)
  }

  async getMyFeed(): Promise<{ quests: Quest[]; claims: Claim[] }> {
    return this.request('/api/feed/mine')
  }

  // Media
  async getUploadUrl(contentType: string): Promise<{ uploadUrl: string; fileId: string }> {
    return this.request('/api/media/upload', {
      method: 'POST',
      body: JSON.stringify({ contentType }),
    })
  }
}

export function createQuestSDK(config: {
  rpcUrl?: string
  apiUrl?: string
}) {
  return new QuestSDK({
    rpcUrl: config.rpcUrl || 'https://api.mainnet-beta.solana.com',
    apiUrl: config.apiUrl || 'https://api.quest.gg',
  })
}

export default QuestSDK
