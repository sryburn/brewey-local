'use client'
import { useState } from 'react'
import { CAPABILITIES, type Capability } from '@/types/access'
import type { Token, TokenUsageStats } from '@/types/tokens'

interface TokensListProps {
  tokens: Token[]
  onRevoke: (tokenId: string) => Promise<void>
  onUpdate: (tokenId: string, scopes: Capability[]) => Promise<void>
}

export function TokensList({ tokens, onRevoke, onUpdate }: TokensListProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<Capability[]>([])
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [usageData, setUsageData] = useState<Record<string, TokenUsageStats>>({})
  const [loadingUsage, setLoadingUsage] = useState<Record<string, boolean>>({})

  const loadUsageData = async (tokenId: string) => {
    setLoadingUsage(prev => ({ ...prev, [tokenId]: true }))
    try {
      const response = await fetch(`/api/tokens/${tokenId}/usage`)

      if (response.ok) {
        const data = await response.json()
        setUsageData(prev => ({ ...prev, [tokenId]: data }))
      }
    } catch (error) {
      console.error('Failed to load usage data:', error)
    } finally {
      setLoadingUsage(prev => ({ ...prev, [tokenId]: false }))
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const isExpired = (expiresAt?: string) => {
    return expiresAt && new Date(expiresAt) < new Date()
  }

  if (tokens.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <p>No tokens created yet.</p>
        <p className="text-sm">Create your first token above to get started.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">Your Tokens</h3>
      
      <div className="space-y-3">
        {tokens.map(token => {
          const usage = usageData[token.id]
          const expired = isExpired(token.expires_at)
          const isLoadingStats = loadingUsage[token.id]
          
          return (
            <div 
              key={token.id} 
              className={`border rounded-lg p-4 ${
                token.revoked || expired 
                  ? 'bg-gray-50 dark:bg-gray-800/50 opacity-75 border-gray-200 dark:border-gray-700' 
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">{token.name}</h3>
                    {token.revoked && (
                      <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-xs rounded">
                        Revoked
                      </span>
                    )}
                    {expired && (
                      <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 text-xs rounded">
                        Expired
                      </span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600 dark:text-gray-400">
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">Permissions:</span><br/>
                      {token.scopes.join(', ')}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">Usage:</span><br/>
                      {token.usage_count.toLocaleString()} requests
                    </div>
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">Last Used:</span><br/>
                      {token.last_used_at ? formatDate(token.last_used_at) : 'Never'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">Created:</span><br/>
                      {formatDate(token.created_at)}
                    </div>
                  </div>

                  {token.expires_at && (
                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                      <span className="font-medium text-gray-700 dark:text-gray-300">Expires:</span> {formatDate(token.expires_at)}
                    </div>
                  )}

                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-500 font-mono">
                    {token.key_prefix}_••••••••••••••••••••••••••••••••
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => loadUsageData(token.id)}
                    disabled={isLoadingStats}
                    className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-300"
                  >
                    {isLoadingStats ? 'Loading...' : usage ? 'Refresh' : 'Load Stats'}
                  </button>
                  
                  {!token.revoked && !expired && <button type="button" onClick={() => { setEditing(token.id); setPermissions(token.scopes.filter(scope => CAPABILITIES.includes(scope as Capability)) as Capability[]); setEditError('') }} className="px-3 py-1 text-sm border rounded">Edit permissions</button>}
                  {!token.revoked && !expired && (
                    <button
                      onClick={() => onRevoke(token.id)}
                      className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>

              {editing === token.id && <form className="mt-4 space-y-2" onSubmit={async event => {
                event.preventDefault(); setSaving(true); setEditError('')
                try { await onUpdate(token.id,permissions); setEditing(null) } catch (error) { setEditError(error instanceof Error ? error.message : 'Unable to update permissions') } finally { setSaving(false) }
              }}>
                <p className="text-sm">Write access includes reading that resource. Other permissions are independent.</p>
                {CAPABILITIES.map(permission => <label key={permission} className="flex gap-2"><input type="checkbox" checked={permissions.includes(permission)} onChange={event => setPermissions(previous => event.target.checked ? [...previous,permission] : previous.filter(value => value!==permission))} />{permission}</label>)}
                {editError && <p role="alert" className="text-red-600">{editError}</p>}
                <button disabled={saving||!permissions.length} className="px-3 py-1 bg-amber-600 text-white rounded">Save permissions</button><button type="button" onClick={() => setEditing(null)} className="px-3 py-1 border rounded">Cancel</button>
              </form>}
              {usage && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">Rate Limit:</span><br/>
                      <span className="text-gray-600 dark:text-gray-400">
                        {usage.rateLimit.used} / {usage.rateLimit.limit} per hour
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">Remaining:</span><br/>
                      <span className="text-gray-600 dark:text-gray-400">
                        {usage.rateLimit.remaining} requests
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-700 dark:text-gray-300">Resets:</span><br/>
                      <span className="text-gray-600 dark:text-gray-400">
                        {usage.rateLimit.resetTime 
                          ? formatDate(usage.rateLimit.resetTime)
                          : 'N/A'
                        }
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
