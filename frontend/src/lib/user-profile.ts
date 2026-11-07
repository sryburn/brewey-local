import type { AppUser } from '@/types/user'

export interface UserProfile {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
  provider: 'local' | 'os'
  created_at: string
  updated_at: string
}
export function getUserProfile(user: AppUser | null): UserProfile | null {
  if (!user) return null
  return { id: user.id, email: user.email, full_name: user.user_metadata.full_name, avatar_url: user.user_metadata.avatar_url,
    provider: user.identity_provider, created_at: user.created_at, updated_at: user.updated_at }
}
export function getDisplayName(user: AppUser | null): string {
  return getUserProfile(user)?.full_name || user?.username || user?.email.split('@')[0] || 'Anonymous'
}
export function getAvatarUrl(user: AppUser | null): string | null { return getUserProfile(user)?.avatar_url || null }
