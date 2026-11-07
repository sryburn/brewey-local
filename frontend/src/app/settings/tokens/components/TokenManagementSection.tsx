'use client'
import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useAuth } from '@/lib/auth-context'
import { ExternalLink } from 'lucide-react'
import { TokenCreateForm } from './TokenCreateForm'
import { TokensList } from './TokensList'
import { NewTokenDisplay } from './NewTokenDisplay'
import type { Capability } from '@/types/access'
import type { Token, CreateTokenRequest, CreateTokenResponse } from '@/types/tokens'

export function TokenManagementSection() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [newToken, setNewToken] = useState<string | null>(null)
  const [newTokenData, setNewTokenData] = useState<CreateTokenResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const { user } = useAuth()

  const identity = useRef(user?.id)
  useLayoutEffect(() => { identity.current = user?.id }, [user?.id])
  useEffect(() => {
    setTokens([]); setNewToken(null); setNewTokenData(null); setError(null); setSuccess(null); setShowCreateForm(false)
    setIsLoading(!!user?.id)
    if (user?.id) void loadTokens()
  }, [user?.id])

  const loadTokens = async () => {
    const owner = identity.current
    try {
      const response = await fetch('/api/tokens')

      if (response.ok) {
        const data = await response.json()
        if (identity.current !== owner) return
        setTokens(data.tokens)
      }
    } catch (error) {
      console.error('Failed to load tokens:', error)
    } finally {
      if (identity.current === owner) setIsLoading(false)
    }
  }

  const createToken = async (formData: CreateTokenRequest) => {
    const owner = identity.current
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/tokens/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      })

      const result = await response.json()
      if (identity.current !== owner) return

      if (result.success) {
        setNewToken(result.token)
        setNewTokenData(result)
        setShowCreateForm(false) // Hide form after successful creation
        loadTokens() // Refresh the list
      } else {
        setError(result.error || 'Failed to create token')
      }
    } catch (error) {
      if (identity.current !== owner) return
      console.error('Token creation failed:', error)
      setError('Failed to create token. Please try again.')
    }
  }

  const updatePermissions = async (id: string, scopes: Capability[]) => {
    const owner = identity.current
    const response = await fetch(`/api/tokens/${encodeURIComponent(id)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scopes }) })
    const result = await response.json()
    if (identity.current !== owner) return
    if (!response.ok) throw new Error(result.error || 'Unable to update token permissions')
    setTokens(previous => previous.map(token => token.id === id ? result.token : token))
  }

  const revokeToken = async (tokenId: string) => {
    const owner = identity.current
    if (!confirm('Are you sure you want to revoke this token? This action cannot be undone.')) {
      return
    }

    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/api/tokens/${tokenId}`, {
        method: 'DELETE'
      })

      if (identity.current !== owner) return
      if (response.ok) {
        setSuccess('Token revoked successfully')
        loadTokens() // Refresh the list
      } else {
        setError('Failed to revoke token. Please try again.')
      }
    } catch (error) {
      if (identity.current !== owner) return
      console.error('Token revocation failed:', error)
      setError('Failed to revoke token. Please try again.')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        Please log in to manage your tokens.
      </div>
    )
  }

  const apiDocsUrl = '/api/docs'

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 mb-2">Personal Access Tokens</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Generate tokens to access the Brewey API and MCP server programmatically.{' '}
          <a
            href={apiDocsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline"
          >
            View API Documentation
            <ExternalLink className="h-3 w-3" />
          </a>
        </p>
      </div>

      {/* Error and Success Messages */}
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-4">
          <div className="text-sm text-red-700 dark:text-red-200">{error}</div>
        </div>
      )}

      {success && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 p-4">
          <div className="text-sm text-green-700 dark:text-green-200">{success}</div>
        </div>
      )}

      {/* Create Token Button / Form */}
      {!showCreateForm ? (
        <button
          onClick={() => {
            setShowCreateForm(true)
            setError(null)
            setSuccess(null)
          }}
          className="bg-amber-600 text-white py-2 px-4 rounded-lg hover:bg-amber-700 transition-colors font-medium text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
        >
          Create New Token
        </button>
      ) : (
        <TokenCreateForm onSubmit={createToken} />
      )}

      {/* Show new token once */}
      {newToken && newTokenData && (
        <NewTokenDisplay
          token={newToken}
          tokenData={newTokenData}
          onDismiss={() => {
            setNewToken(null)
            setNewTokenData(null)
          }}
        />
      )}

      {/* List existing tokens */}
      <TokensList key={user.id} onUpdate={updatePermissions}
        tokens={tokens}
        onRevoke={revokeToken}
      />
    </div>
  )
}
