'use client'
import { useState } from 'react'
import type { CreateTokenResponse } from '@/types/tokens'

interface NewTokenDisplayProps {
  token: string
  tokenData: CreateTokenResponse
  onDismiss: () => void
}

export function NewTokenDisplay({ token, tokenData, onDismiss }: NewTokenDisplayProps) {
  const [copied, setCopied] = useState(false)
  const apiProxyUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/recipes`

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  return (
    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-green-800 dark:text-green-200">
            Token Created Successfully!
          </h3>
          <p className="text-green-700 dark:text-green-300 text-sm">
            ⚠️ Save this token now. You won&apos;t be able to see it again.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200 text-xl leading-none"
        >
          ✕
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-green-800 dark:text-green-200 mb-1">
            Your Personal Access Token
          </label>
          <div className="flex items-center space-x-2">
            <code className="flex-1 bg-white dark:bg-gray-800 px-3 py-2 border border-green-200 dark:border-green-700 rounded font-mono text-sm break-all text-gray-900 dark:text-gray-100">
              {token}
            </code>
            <button
              onClick={copyToClipboard}
              className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium text-green-800 dark:text-green-200">Name:</span>
            <span className="text-green-700 dark:text-green-300 ml-1">{tokenData.name}</span>
          </div>
          <div>
            <span className="font-medium text-green-800 dark:text-green-200">Permissions:</span>
            <span className="text-green-700 dark:text-green-300 ml-1">{tokenData.scopes?.join(', ')}</span>
          </div>
          <div>
            <span className="font-medium text-green-800 dark:text-green-200">Rate Limit:</span>
            <span className="text-green-700 dark:text-green-300 ml-1">{tokenData.rateLimitPerHour}/hour</span>
          </div>
          <div>
            <span className="font-medium text-green-800 dark:text-green-200">Expires:</span>
            <span className="text-green-700 dark:text-green-300 ml-1">
              {tokenData.expiresAt
                ? new Date(tokenData.expiresAt).toLocaleDateString()
                : 'Never'
              }
            </span>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-green-200 dark:border-green-700 rounded p-3 text-sm">
          <h4 className="font-medium mb-2 text-gray-900 dark:text-gray-100">Usage Examples:</h4>
          <div className="space-y-2 font-mono text-xs">
            <div>
              <strong className="text-gray-900 dark:text-gray-100">MCP Server:</strong><br/>
              <code className="text-gray-600 dark:text-gray-400">Authorization: Bearer {token}</code>
            </div>
            <div>
              <strong className="text-gray-900 dark:text-gray-100">REST API:</strong><br/>
              <code className="text-gray-600 dark:text-gray-400">Authorization: Bearer {token}</code>
            </div>
            <div>
              <strong className="text-gray-900 dark:text-gray-100">cURL:</strong><br/>
              <code className="text-gray-600 dark:text-gray-400 break-all">
                curl -H &quot;Authorization: Bearer {token}&quot; {apiProxyUrl}
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
