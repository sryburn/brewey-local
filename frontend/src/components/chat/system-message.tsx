import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '@/types/chat'

interface SystemMessageProps {
  message: Message
}

export default function SystemMessage({ message }: SystemMessageProps) {

  const getSystemMessageStyle = () => {
    if (message.content.includes('error') || message.content.includes('failed')) {
      return 'bg-red-50 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-200 dark:border-red-700'
    }
    if (message.content.includes('success') || message.content.includes('created')) {
      return 'bg-green-50 dark:bg-green-900 text-green-800 dark:text-green-200 border-green-200 dark:border-green-700'
    }
    if (message.content.includes('warning') || message.content.includes('confirm')) {
      return 'bg-yellow-50 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-200 dark:border-yellow-700'
    }
    return 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 border-blue-200 dark:border-blue-700'
  }

  const getIcon = () => {
    if (message.content.includes('error') || message.content.includes('failed')) {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
    if (message.content.includes('success') || message.content.includes('created')) {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
    if (message.content.includes('warning') || message.content.includes('confirm')) {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      )
    }
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }

  return (
    <div className="flex justify-center mb-4">
      <div className={`
        max-w-[90%] border rounded-lg px-4 py-3 shadow-sm
        ${getSystemMessageStyle()}
      `}>
        <div className="flex items-start space-x-2">
          <div className="flex-shrink-0 mt-0.5">
            {getIcon()}
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium mb-1">
              System Message
            </div>
            <div className="text-sm break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  ul: ({ children }) => <ul className="list-disc list-outside pl-6 mb-1 space-y-0 [&_ul]:list-[circle]">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-outside pl-6 mb-1 space-y-0 [&_ol]:list-[lower-alpha]">{children}</ol>,
                  li: ({ children }) => <li>{children}</li>,
                  p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                  code: ({ children }) => (
                    <code className="bg-gray-100 dark:bg-stone-700 text-gray-900 dark:text-stone-200 px-1 rounded text-sm">
                      {children}
                    </code>
                  )
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
            {message.metadata?.recipeId && (
              <div className="text-xs mt-2 opacity-75">
                Recipe ID: {message.metadata.recipeId}
              </div>
            )}
            <div className="text-xs mt-2 opacity-75">
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