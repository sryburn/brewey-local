import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '@/types/chat'

interface AssistantMessageProps {
  message: Message
}

export default function AssistantMessage({ message }: AssistantMessageProps) {
  const [showDetails, setShowDetails] = useState(false)

  // Feature flag for debug tool call section
  // Set to true to re-enable the expandable debug tool call section
  // This could be moved to a settings/config in the future
  const SHOW_DEBUG_TOOL_CALLS = false

  // Check if this message is currently streaming
  const isStreaming = message.metadata?.isStreaming && !message.metadata?.isComplete
  const reasoningPreview = message.metadata?.reasoningPreview
  const statusMessages = message.metadata?.statusMessages || []
  const isExecutingTool = message.metadata?.isExecutingTool

  return (
    <div className="flex justify-start mb-4">
      <div className="flex items-start space-x-3 max-w-[80%]">
        {/* AI Avatar */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gray-600 dark:bg-stone-600">
          <span className="text-white text-sm font-medium">B</span>
        </div>

        {/* Message Content */}
        <div className="rounded-lg px-4 py-3 shadow-sm bg-gray-100 dark:bg-stone-700 text-gray-900 dark:text-stone-100">
          {message.metadata?.turnStatus === 'interrupted' && <p className="mb-2 text-xs text-stone-500">Response interrupted. Saved input and partial output are retained.</p>}
          {message.metadata?.turnStatus === 'failed' && <p className="mb-2 text-xs text-red-600">Response failed. Review the saved transcript before sending another message.</p>}
          {/* Keep provider summaries readable after the answer arrives. */}
          {reasoningPreview && (
            <details open={!!isStreaming && !message.content} className="mb-2 rounded-md border border-gray-300 dark:border-stone-600 bg-gray-100 dark:bg-stone-800 p-3 text-sm text-gray-900 dark:text-stone-100">
              <summary className="cursor-pointer font-medium">Thinking summary</summary>
              <div className="mt-2">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                    em: ({ children }) => <em className="italic">{children}</em>,
                    ul: ({ children }) => <ul className="list-disc list-outside pl-6 mb-2 space-y-0 [&_ul]:list-[circle]">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal list-outside pl-6 mb-2 space-y-0 [&_ol]:list-[lower-alpha]">{children}</ol>,
                    h1: ({ children }) => <h1 className="text-lg font-bold mb-1">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-base font-semibold mb-1">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
                    code: ({ children }) => (
                      <code className="bg-gray-200 dark:bg-stone-700 text-gray-900 dark:text-stone-200 px-1 rounded text-xs break-words">
                        {children}
                      </code>
                    )
                  }}
                >
                  {reasoningPreview}
                </ReactMarkdown>
              </div>
            </details>
          )}

          <div className="break-words text-gray-900 dark:!text-stone-100">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 className="text-2xl font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-bold mb-1 mt-2 first:mt-0">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-bold mb-1 mt-2 first:mt-0">{children}</h3>,
                h4: ({ children }) => <h4 className="text-base font-bold mb-1 mt-1 first:mt-0">{children}</h4>,
                h5: ({ children }) => <h5 className="text-sm font-bold mb-1 mt-1 first:mt-0">{children}</h5>,
                h6: ({ children }) => <h6 className="text-xs font-bold mb-1 mt-1 first:mt-0">{children}</h6>,
                ul: ({ children }) => <ul className="list-disc list-outside pl-6 mb-2 space-y-0 [&_ul]:list-[circle]">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-outside pl-6 mb-2 space-y-0 [&_ol]:list-[lower-alpha]">{children}</ol>,
                li: ({ children }) => <li>{children}</li>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-gray-300 dark:border-stone-500 pl-4 my-2 italic text-gray-700 dark:text-stone-300">
                    {children}
                  </blockquote>
                ),
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                br: () => <br />,
                code: ({ children }) => (
                  <code className="bg-gray-100 dark:bg-stone-700 text-gray-900 dark:text-stone-200 px-1 rounded text-sm break-words">
                    {children}
                  </code>
                ),
                a: ({ href, children }) => (
                  <a 
                    href={href} 
                    className="text-blue-600 dark:text-amber-500 underline hover:text-blue-800 dark:hover:text-amber-400"
                  >
                    {children}
                  </a>
                ),
                pre: ({ children }) => (
                  <pre className="bg-gray-100 dark:bg-stone-800 p-3 rounded-md mb-2 text-sm whitespace-pre-wrap break-words overflow-hidden">
                    {children}
                  </pre>
                ),
                table: ({ children }) => (
                  <div className="mb-2 overflow-hidden">
                    <table className="w-full border-collapse border border-gray-300 dark:border-stone-500 table-fixed">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-gray-50 dark:bg-stone-600">
                    {children}
                  </thead>
                ),
                tbody: ({ children }) => <tbody>{children}</tbody>,
                tr: ({ children }) => <tr className="border-b border-gray-300 dark:border-stone-500">{children}</tr>,
                th: ({ children }) => (
                  <th className="border border-gray-300 dark:border-stone-500 px-3 py-2 text-left font-bold text-gray-900 dark:text-stone-100 break-words">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-gray-300 dark:border-stone-500 px-3 py-2 text-gray-900 dark:text-stone-100 break-words">
                    {children}
                  </td>
                )
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>

          {/* Status messages log - shows running list of tool operations */}
          {statusMessages.length > 0 && (
            <div className="mt-2 space-y-1">
              {statusMessages.map((status, index) => (
                <div key={index} className="flex items-center">
                  <div className="flex space-x-1 mr-2">
                    <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-amber-400"></div>
                  </div>
                  <span className="text-xs text-gray-600 dark:text-stone-400">
                    {status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Fallback streaming indicator for when no status messages */}
          {(isStreaming || isExecutingTool) && statusMessages.length === 0 && (
            <div className="flex items-center mt-2">
              <div className="flex space-x-1">
                <div className="w-2 h-2 rounded-full animate-bounce bg-amber-400"></div>
                <div className="w-2 h-2 rounded-full animate-bounce bg-amber-400" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 rounded-full animate-bounce bg-amber-400" style={{ animationDelay: '0.2s' }}></div>
              </div>
              <span className="text-xs ml-2 text-gray-500 dark:text-stone-400">
                {isExecutingTool ? 'Brewey is working...' : 'Brewey is thinking...'}
              </span>
            </div>
          )}


          {/* Debug Tool calls - expandable with GitHub-style blocks (hidden by default) */}
          {SHOW_DEBUG_TOOL_CALLS && message.metadata?.toolCalls && message.metadata.toolCalls.length > 0 && (
            <div className="mt-3 pt-2 border-t border-gray-200 dark:border-stone-600">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-sm flex items-center hover:opacity-80 text-blue-600 dark:text-blue-400 font-medium"
              >
                <span>🔧 Used {message.metadata.toolCalls.length} tool{message.metadata.toolCalls.length > 1 ? 's' : ''}</span>
                <svg
                  className={`w-4 h-4 ml-2 transition-transform ${showDetails ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showDetails && (
                <div className="mt-2 space-y-1">
                  {message.metadata.toolCalls.map((tool, index) => (
                    <div key={tool.id || index} className="text-sm font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-stone-800 px-2 py-1 rounded border">
                      🔧 {tool.name} {tool.status === 'pending' && '⏳'}{tool.status === 'success' && '✅'}{tool.status === 'error' && '❌'}
                      {tool.timestamp && (
                        <span className="text-xs text-gray-400 dark:text-stone-500 ml-2">
                          {new Date(tool.timestamp).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Timestamp */}
          <div className="text-xs mt-2 text-gray-500 dark:text-stone-400">
            {(message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp)).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </div>
        </div>
      </div>
    </div>
  )
}