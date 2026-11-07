'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { authClient } from './auth-client'
import type { AppUser } from '@/types/user'
import useChatStore from './stores/chat-store'
import { useRecipeStore } from './stores/recipe-store'
import { getUserProfile, type UserProfile } from './user-profile'

interface AuthContextType {
  user: AppUser | null
  userProfile: UserProfile | null
  loading: boolean
  signIn: (username: string, password: string) => Promise<{ error: Error | null }>
  signUp: (username: string, password: string, email?: string) => Promise<{ error: Error | null; signedIn?: boolean }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userProfile: null,
  loading: true,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  signOut: async () => { },
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const identity = useRef<string | null | undefined>(undefined)
  const sessionRevision = useRef(0)

  const applyIdentity = useCallback((currentUser: AppUser | null, signedOut = false) => {
    const nextId = currentUser?.id ?? null
    let storedOwner: string | null = null
    try { storedOwner = localStorage.getItem('brewey-chat-owner') } catch { /* unknown ownership fails closed */ }
    const changed = identity.current !== undefined && identity.current !== nextId
    if (signedOut || !nextId || changed || storedOwner !== nextId) {
      // Clear memory synchronously before exposing a new identity. Async imports
      // or retries could otherwise allow previous-account history into a request.
      try { useChatStore.getState().clearAll() } catch { /* memory is cleared before persistence writes */ }
      useRecipeStore.getState().clearRecipeState()
      try { localStorage.removeItem('brewey-chat-storage') } catch { /* memory remains clear */ }
    }
    try {
      if (nextId) localStorage.setItem('brewey-chat-owner', nextId)
      else localStorage.removeItem('brewey-chat-owner')
    } catch { /* unavailable storage is treated as unknown on the next load */ }
    identity.current = nextId
    sessionRevision.current += 1
    useRecipeStore.getState().setUserId(nextId)
    setUser(currentUser)
    setUserProfile(getUserProfile(currentUser))
    setLoading(false)
  }, [])

  useEffect(() => {
    let active = true
    const initialRevision = sessionRevision.current
    void authClient.getSession().then(({ data: { session } }) => {
      if (active && sessionRevision.current === initialRevision) applyIdentity(session?.user ?? null)
    }).catch(() => {
      if (active && sessionRevision.current === initialRevision) applyIdentity(null)
    })

    // Broadcast sign-out/account-switch events use the current identity ref,
    // including events from another browser tab. Same-user refreshes preserve chat.
    const { data: { subscription } } = authClient.onAuthStateChange((event, session) => {
      if (!active) return
      const currentUser = event === 'SIGNED_OUT' ? null : session?.user ?? null
      applyIdentity(currentUser, event === 'SIGNED_OUT')

    })
    return () => { active = false; subscription.unsubscribe() }
  }, [applyIdentity])


  const signIn = async (username: string, password: string) => {
    const { error } = await authClient.signInWithPassword({
      username,
      password,
    })
    return { error }
  }

  const signUp = async (username: string, password: string, email?: string) => {
    const { data, error } = await authClient.signUp({ username, password, ...(email ? { email } : {}) })
    return { error, signedIn: !!data.user }
  }

  const signOut = async () => {
    // Fail closed locally even if the server sign-out request later fails.
    applyIdentity(null, true)
    const { error } = await authClient.signOut()
    if (error) throw error
  }

  const value = {
    user,
    userProfile,
    loading,
    signIn,
    signUp,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}