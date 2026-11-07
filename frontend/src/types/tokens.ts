export interface Token {
  id: string
  name: string
  scopes: string[]
  last_used_at?: string
  last_used_ip?: string
  usage_count: number
  rate_limit_per_hour: number
  expires_at?: string
  revoked: boolean
  created_at: string
  key_prefix: string
}

export interface CreateTokenRequest {
  name: string
  scopes: string[]
  expiresAt?: string | null
  rateLimitPerHour?: number
}

export interface CreateTokenResponse {
  success: boolean
  token?: string
  name?: string
  scopes?: string[]
  rateLimitPerHour?: number
  expiresAt?: string | null
  error?: string
}

export interface TokenUsageStats {
  token: {
    id: string
    name: string
    scopes: string[]
    usage_count: number
    last_used_at?: string
    last_used_ip?: string
    created_at: string
  }
  rateLimit: {
    limit: number
    used: number
    remaining: number
    resetTime?: string
  }
}

export interface TokenListResponse {
  tokens: Token[]
}

export interface TokenUpdateRequest {
  name?: string
  scopes?: string[]
  expires_at?: string | null
  rate_limit_per_hour?: number
}
