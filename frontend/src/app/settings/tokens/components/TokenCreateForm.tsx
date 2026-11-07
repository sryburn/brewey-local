'use client'
import { useState } from 'react'
import { CAPABILITIES, type Capability } from '@/types/access'
import type { CreateTokenRequest } from '@/types/tokens'

interface TokenCreateFormProps {
  onSubmit: (data: CreateTokenRequest) => Promise<void>
}

export function TokenCreateForm({ onSubmit }: TokenCreateFormProps) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Capability[]>(['recipes:read', 'catalog:read'])
  const [expiresAt, setExpiresAt] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const descriptions: Record<Capability,string> = {
    'recipes:read': 'Read your recipe library and calculations',
    'recipes:write': 'Create, edit and delete your recipes; includes reading recipes',
    'catalog:read': 'Search reference ingredients and beer styles',
    'profile:read': 'Read your brewing profile and units',
    'profile:write': 'Update your brewing profile and units; includes reading your profile',
  }
  const availableScopes = CAPABILITIES.map(value => ({ value, label: value, description: descriptions[value] }))

  const handleScopeChange = (scope: Capability, checked: boolean) => {
    if (checked) {
      setScopes([...scopes, scope])
    } else {
      setScopes(scopes.filter(s => s !== scope))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setValidationError(null)

    if (!name.trim()) {
      setValidationError('Please enter a token name')
      return
    }

    if (scopes.length === 0) {
      setValidationError('Please select at least one capability')
      return
    }

    setIsCreating(true)
    try {
      await onSubmit({
        name: name.trim(),
        scopes,
        expiresAt: expiresAt || undefined,
        rateLimitPerHour: 1000
      })
      
      // Reset form
      setName('')
      setScopes(['recipes:read', 'catalog:read'])
      setExpiresAt('')
      setValidationError(null)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">Create New Token</h2>
      
      {validationError && (
        <div className="mb-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 p-4">
          <div className="text-sm text-red-700 dark:text-red-200">{validationError}</div>
        </div>
      )}
      
      <p className="mb-4 text-sm text-gray-500">The same permissions apply through the REST API and MCP server. Tokens never grant administrator or account settings access.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Token Name */}
        <div>
          <label htmlFor="token-name" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Token Name
          </label>
          <input
            id="token-name"
            name="token-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., My Recipe App"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            maxLength={100}
            required
            autoComplete="off"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            A descriptive name to help you identify this token
          </p>
        </div>

        {/* Scopes */}
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Permissions
          </label>
          <div className="space-y-2">
            {availableScopes.map(scope => (
              <label key={scope.value} htmlFor={`scope-${scope.value}`} className="flex items-start space-x-2">
                <input
                  id={`scope-${scope.value}`}
                  name={`scope-${scope.value}`}
                  type="checkbox"
                  checked={scopes.includes(scope.value)}
                  onChange={(e) => handleScopeChange(scope.value, e.target.checked)}
                  className="mt-1 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">{scope.label}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">{scope.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Expiration */}
        <div>
          <label htmlFor="token-expiration" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Expiration (Optional)
          </label>
          <input
            id="token-expiration"
            name="token-expiration"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Leave empty for no expiration
          </p>
        </div>

        <button
          type="submit"
          disabled={isCreating}
          className="w-full bg-amber-600 text-white py-2 px-4 rounded-md hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isCreating ? 'Creating...' : 'Create Token'}
        </button>
      </form>
    </div>
  )
}
