import { useState } from 'react'
import type { Message } from '@/types/chat'

interface ActionMessageProps {
  message: Message
  onAction: (action: string, data?: unknown) => void
}

export default function ActionMessage({ message, onAction }: ActionMessageProps) {
  const [isProcessing, setIsProcessing] = useState(false)

  const handleAction = async (action: string, data?: unknown) => {
    setIsProcessing(true)
    try {
      await onAction(action, data)
    } finally {
      setIsProcessing(false)
    }
  }

  const renderActionButtons = () => {
    if (message.metadata?.needsConfirmation) {
      return (
        <div className="flex space-x-2 mt-3">
          <button
            onClick={() => handleAction('confirm', message.metadata)}
            disabled={isProcessing}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-green-600 dark:bg-green-700 text-white dark:text-green-100 hover:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? 'Processing...' : 'Confirm'}
          </button>
          <button
            onClick={() => handleAction('cancel')}
            disabled={isProcessing}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-gray-300 dark:bg-stone-600 text-gray-700 dark:text-stone-100 hover:bg-gray-400 dark:hover:bg-stone-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      )
    }

    // Render custom action buttons based on message type
    if (message.content.includes('recipe')) {
      return (
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={() => handleAction('view_recipe', message.metadata)}
            className="px-3 py-1.5 rounded-md text-sm transition-colors bg-amber-100 dark:bg-blue-800 text-amber-800 dark:text-blue-100 hover:bg-amber-200 dark:hover:bg-blue-700"
          >
            View Recipe
          </button>
          <button
            onClick={() => handleAction('edit_recipe', message.metadata)}
            className="px-3 py-1.5 rounded-md text-sm transition-colors bg-amber-100 dark:bg-blue-800 text-amber-800 dark:text-blue-100 hover:bg-amber-200 dark:hover:bg-blue-700"
          >
            Edit Recipe
          </button>
        </div>
      )
    }

    return null
  }

  return (
    <div className="flex justify-center mb-4">
      <div className="max-w-[90%] border rounded-lg px-4 py-3 shadow-sm bg-white dark:bg-stone-700 border-gray-200 dark:border-stone-600 text-gray-900 dark:text-stone-100">
        <div className="flex items-start space-x-2">
          <div className="flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-blue-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium mb-1 text-gray-900 dark:text-stone-100">
              Action Required
            </div>
            <div className="text-sm whitespace-pre-wrap break-words text-gray-700 dark:text-stone-200">
              {message.content}
            </div>
            
            {renderActionButtons()}
            
            <div className="text-xs mt-2 text-gray-500 dark:text-stone-400">
              {(message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp)).toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}