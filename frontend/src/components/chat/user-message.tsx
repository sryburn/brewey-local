import type { Message } from '@/types/chat'

interface UserMessageProps {
  message: Message
}

export default function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%] rounded-lg px-4 py-3 shadow-sm bg-amber-600 dark:bg-amber-700 text-white dark:text-amber-50">
        <div className="whitespace-pre-wrap break-words">
          {message.content}
        </div>
        <div className="text-xs mt-1 opacity-75 text-amber-100 dark:text-amber-200">
          {(message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp)).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </div>
      </div>
    </div>
  )
}