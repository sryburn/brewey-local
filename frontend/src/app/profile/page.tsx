'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Profile page - redirects to Settings > Profile tab
 * This maintains backward compatibility with /profile links and slash commands
 */

export default function ProfilePage() {
  const router = useRouter()
  
  useEffect(() => {
    // Redirect to settings with profile tab
    router.replace('/settings?tab=profile')
  }, [router])
  
  // Show loading state while redirecting
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600 mx-auto mb-4"></div>
        <p className="text-sm text-gray-600 dark:text-gray-400">Redirecting to settings...</p>
      </div>
    </div>
  )
}
