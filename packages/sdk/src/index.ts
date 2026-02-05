import { Connection, PublicKey, Transaction, SystemProgram } from '@solana/web3.js'
import { AnchorProvider, Program, Idl, BN } from '@coral-xyz/anchor'

// Types
export type QuestType = 'direct' | 'open' | 'guild' | 'chain'
export type QuestStatus = 'active' | 'claimed' | 'completed' | 'failed' | 'cancelled' | 'expired'
export type ClaimStatus = 'active' | 'submitted' | 'approved' | 'rejected' | 'expired'

export interface Quest {
  id: string
  onchainId: string
  creator: string
  description: string
  questType: QuestType
  status: QuestStatus
  rewardAmount: number
  rewardToken: 'QUEST' | 'SOL' | 'USDC'
  target?: string
  maxClaimers: number
  currentClaimers: number
  timeLimit?: number
  createdAt: number
}

export interface Claim {
  id: string
  questId: string
  claimer: string
  status: ClaimStatus
  stakeAmount: number
  claimedAt: number
  submittedAt?: number
}

export interface CreateQuestParams {
  description: string
  rewardAmount: number
  rewardToken: 'QUEST' | 'SOL' | 'USDC'
  questType: QuestType
  target?: string
  maxClaimers?: number
  timeLimitHours?: number
}

export interface ClaimQuestParams {
  questId: string
  stakeAmount?: number
}

export interface SubmitProofParams {
  questId: string
  videoUrl: string
  videoHash: string
}

// SDK Class
export class QuestSDK {
  private connection: Connection
  private provider: AnchorProvider | null = null
  private program: Program | null = null
  private apiUrl: string

  constructor(config: {
    rpcUrl: string
    apiUrl: string
    programId?: string
  }) {
    this.connection = new Connection(config.rpcUrl, 'confirmed')
    this.apiUrl = config.apiUrl
  }

  // Initialize with wallet
  async connect(provider: AnchorProvider) {
    this.provider = provider
    // Load program IDL and initialize
    // this.program = new Program(IDL, PROGRAM_ID, provider)
  }

  // Quest Operations
  async createQuest(params: CreateQuestParams): Promise<Quest> {
    const response = await fetch(`${this.apiUrl}/api/quests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    
    if (!response.ok) {
      throw new Error(`Failed to create quest: ${response.statusText}`)
    }
    
    return response.json()
  }

  async getQuest(questId: string): Promise<Quest> {
    const response = await fetch(`${this.apiUrl}/api/quests/${questId}`)
    
    if (!response.ok) {
      throw new Error(`Failed to get quest: ${response.statusText}`)
    }
    
    return response.json()
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

    const response = await fetch(`${this.apiUrl}/api/quests?${searchParams}`)
    
    if (!response.ok) {
      throw new Error(`Failed to list quests: ${response.statusText}`)
    }
    
    return response.json()
  }

  async claimQuest(params: ClaimQuestParams): Promise<Claim> {
    const response = await fetch(`${this.apiUrl}/api/quests/${params.questId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stakeAmount: params.stakeAmount || 0 }),
    })
    
    if (!response.ok) {
      throw new Error(`Failed to claim quest: ${response.statusText}`)
    }
    
    return response.json()
  }

  async submitProof(params: SubmitProofParams): Promise<{ proofId: string; aiScore: number }> {
    const response = await fetch(`${this.apiUrl}/api/quests/${params.questId}/proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoUrl: params.videoUrl,
        videoHash: params.videoHash,
      }),
    })
    
    if (!response.ok) {
      throw new Error(`Failed to submit proof: ${response.statusText}`)
    }
    
    return response.json()
  }

  async approveQuest(questId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/quests/${questId}/approve`, {
      method: 'POST',
    })
    
    if (!response.ok) {
      throw new Error(`Failed to approve quest: ${response.statusText}`)
    }
  }

  async rejectQuest(questId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/quests/${questId}/reject`, {
      method: 'POST',
    })
    
    if (!response.ok) {
      throw new Error(`Failed to reject quest: ${response.statusText}`)
    }
  }

  async cancelQuest(questId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/api/quests/${questId}`, {
      method: 'DELETE',
    })
    
    if (!response.ok) {
      throw new Error(`Failed to cancel quest: ${response.statusText}`)
    }
  }

  // User Operations
  async getUser(userId: string): Promise<any> {
    const response = await fetch(`${this.apiUrl}/api/users/${userId}`)
    
    if (!response.ok) {
      throw new Error(`Failed to get user: ${response.statusText}`)
    }
    
    return response.json()
  }

  async getUserQuests(userId: string): Promise<Quest[]> {
    const response = await fetch(`${this.apiUrl}/api/users/${userId}/quests`)
    
    if (!response.ok) {
      throw new Error(`Failed to get user quests: ${response.statusText}`)
    }
    
    return response.json()
  }

  async getUserClaims(userId: string): Promise<Claim[]> {
    const response = await fetch(`${this.apiUrl}/api/users/${userId}/claims`)
    
    if (!response.ok) {
      throw new Error(`Failed to get user claims: ${response.statusText}`)
    }
    
    return response.json()
  }

  // Feed Operations
  async getFeed(type: 'foryou' | 'following' | 'discover' = 'foryou'): Promise<Quest[]> {
    const response = await fetch(`${this.apiUrl}/api/feed/${type}`)
    
    if (!response.ok) {
      throw new Error(`Failed to get feed: ${response.statusText}`)
    }
    
    return response.json()
  }

  // Media Operations
  async getUploadUrl(contentType: string): Promise<{ uploadUrl: string; fileId: string }> {
    const response = await fetch(`${this.apiUrl}/api/media/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType }),
    })
    
    if (!response.ok) {
      throw new Error(`Failed to get upload URL: ${response.statusText}`)
    }
    
    return response.json()
  }
}

// Export factory function
export function createQuestSDK(config: {
  rpcUrl?: string
  apiUrl?: string
}) {
  return new QuestSDK({
    rpcUrl: config.rpcUrl || 'https://api.mainnet-beta.solana.com',
    apiUrl: config.apiUrl || 'https://api.quest.gg',
  })
}

// Export types and classes
export default QuestSDK
